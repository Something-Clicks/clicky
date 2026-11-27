import { ValidationError } from '../core/errors';
import { daysBetween, nowIso } from '../core/util';
import type { Level } from '../domain/enums';
import type { Finding, MetricRow } from '../domain/models';
import type { StructuredClient } from '../providers/structured';
import type { Usage } from '../providers/usage';
import type { Ctx } from '../store/authz';
import { Authz, inSite, siteOf } from '../store/authz';
import { OPEN_GATE, type PlanGate } from '../plans';
import type { AuditLog } from '../store/audit';
import type { Db } from '../store/db';
import { csvToObjects, toNumber } from './csv';
import { PerformanceRecsSchema, type PerformanceRecsOutput } from './contracts';

/** Metric catalogue: how each metric aggregates. Unknown metrics are rejected, never guessed. */
export const METRICS: Record<string, { agg: 'sum' | 'avg' | 'ratio'; label: string; minVolume: number; higherIsBetter: boolean; num?: string; den?: string }> = {
  sessions: { agg: 'sum', label: 'Website sessions', minVolume: 50, higherIsBetter: true },
  users: { agg: 'sum', label: 'Website users', minVolume: 50, higherIsBetter: true },
  clicks: { agg: 'sum', label: 'Search clicks', minVolume: 30, higherIsBetter: true },
  impressions: { agg: 'sum', label: 'Search impressions', minVolume: 300, higherIsBetter: true },
  avg_position: { agg: 'avg', label: 'Average search position', minVolume: 0, higherIsBetter: false },
  conversions: { agg: 'sum', label: 'Website conversions', minVolume: 10, higherIsBetter: true },
  leads: { agg: 'sum', label: 'Leads', minVolume: 10, higherIsBetter: true },
  emails_sent: { agg: 'sum', label: 'Emails sent', minVolume: 50, higherIsBetter: true },
  email_opens: { agg: 'sum', label: 'Email opens', minVolume: 20, higherIsBetter: true },
  email_clicks: { agg: 'sum', label: 'Email clicks', minVolume: 10, higherIsBetter: true },
  new_customers: { agg: 'sum', label: 'New customers', minVolume: 5, higherIsBetter: true },
  ctr: { agg: 'ratio', label: 'Search click-through rate', minVolume: 0, higherIsBetter: true, num: 'clicks', den: 'impressions' },
  conversion_rate: { agg: 'ratio', label: 'Conversion rate', minVolume: 0, higherIsBetter: true, num: 'conversions', den: 'sessions' },
};
const ALIASES: Record<string, string> = { position: 'avg_position', average_position: 'avg_position', avg_pos: 'avg_position', total_clicks: 'clicks', total_impressions: 'impressions', visits: 'sessions', form_submissions: 'conversions', key_events: 'conversions', opens: 'email_opens', sent: 'emails_sent' };

export interface ParsedMetrics { rows: { metric: string; value: number; dimension?: string; periodStart: string; periodEnd: string }[]; rejected: { line: number; reason: string }[]; ignoredColumns: string[] }

/** Parses long-format (metric,value,...) or wide-format (query/page + clicks, impressions, position ...) CSV exports. */
export function parseMetricsCsv(csv: string, defaults: { periodStart: string; periodEnd: string }): ParsedMetrics {
  const objs = csvToObjects(csv); const out: ParsedMetrics = { rows: [], rejected: [], ignoredColumns: [] };
  if (!objs.length) return out;
  const cols = Object.keys(objs[0]!); const known = (c: string) => (ALIASES[c] ?? c) in METRICS && METRICS[ALIASES[c] ?? c]!.agg !== 'ratio';
  const dimCol = ['query', 'top_queries', 'page', 'top_pages', 'campaign', 'keyword', 'landing_page', 'source'].find((c) => cols.includes(c));
  const isLong = cols.includes('metric') && cols.includes('value');
  if (!isLong) out.ignoredColumns = cols.filter((c) => !known(c) && c !== dimCol && c !== 'date' && c !== 'ctr');
  objs.forEach((o, i) => {
    const ps = o.period_start || o.date || defaults.periodStart; const pe = o.period_end || o.date || defaults.periodEnd;
    if (!/^\d{4}-\d{2}-\d{2}/.test(ps) || !/^\d{4}-\d{2}-\d{2}/.test(pe)) { out.rejected.push({ line: i + 2, reason: `Invalid date "${ps}"/"${pe}" (use YYYY-MM-DD)` }); return; }
    if (isLong) {
      const m = ALIASES[o.metric!.toLowerCase()] ?? o.metric!.toLowerCase(); const v = toNumber(o.value);
      if (!(m in METRICS) || METRICS[m]!.agg === 'ratio') { out.rejected.push({ line: i + 2, reason: `Unknown metric "${o.metric}"` }); return; }
      if (v === undefined || v < 0) { out.rejected.push({ line: i + 2, reason: `Invalid value "${o.value}"` }); return; }
      out.rows.push({ metric: m, value: v, dimension: o.dimension || undefined, periodStart: ps.slice(0, 10), periodEnd: pe.slice(0, 10) }); return;
    }
    for (const c of cols.filter(known)) {
      const v = toNumber(o[c]); if (v === undefined) continue;
      if (v < 0) { out.rejected.push({ line: i + 2, reason: `Negative ${c}` }); continue; }
      out.rows.push({ metric: ALIASES[c] ?? c, value: v, dimension: dimCol ? o[dimCol] || undefined : undefined, periodStart: ps.slice(0, 10), periodEnd: pe.slice(0, 10) });
    }
  });
  return out;
}

export interface MetricComparison {
  metric: string; label: string; current?: number; previous?: number; delta?: number; pctChange: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown'; assessment: 'improved' | 'declined' | 'unchanged' | 'insufficient_data' | 'no_comparison';
  confidence: Level; caveats: string[];
}
export interface PerformanceReportData {
  generatedAt: string; current: { start: string; end: string }; previous?: { start: string; end: string };
  metrics: MetricComparison[]; coincidentActivities: { at: string; action: string; deliverableType?: string; note: string }[];
  dataQuality: string[]; missingMetrics: string[]; sources: string[];
  recommendations?: PerformanceRecsOutput; mock?: boolean;
}

function aggregate(rows: MetricRow[], metric: string): number | undefined {
  const def = METRICS[metric]!; const rs = rows.filter((r) => r.metric === metric);
  if (def.agg === 'ratio') {
    const n = aggregate(rows, def.num!); const d = aggregate(rows, def.den!);
    return n !== undefined && d !== undefined && d > 0 ? n / d : undefined;
  }
  if (!rs.length) return undefined;
  if (def.agg === 'sum') {
    // If both a total row (no dimension) and dimension rows exist, trust totals to avoid double counting.
    const totals = rs.filter((r) => !r.dimension); return (totals.length ? totals : rs).reduce((a, r) => a + r.value, 0);
  }
  const w = rows.filter((r) => r.metric === 'impressions' && r.dimension); const byDim = new Map(w.map((r) => [r.dimension!, r.value]));
  const ps = rs.filter((r) => r.dimension && byDim.has(r.dimension));
  if (ps.length) { const tw = ps.reduce((a, r) => a + byDim.get(r.dimension!)!, 0); return tw ? ps.reduce((a, r) => a + r.value * byDim.get(r.dimension!)!, 0) / tw : undefined; }
  return rs.reduce((a, r) => a + r.value, 0) / rs.length;
}

export function compareMetrics(cur: MetricRow[], prev: MetricRow[], periods: { current: { start: string; end: string }; previous?: { start: string; end: string } }): { metrics: MetricComparison[]; dataQuality: string[] } {
  const dq: string[] = [];
  const curDays = daysBetween(periods.current.start, periods.current.end) + 1; const prevDays = periods.previous ? daysBetween(periods.previous.start, periods.previous.end) + 1 : 0;
  if (curDays < 14) dq.push(`The current period is only ${Math.round(curDays)} day(s); short periods are dominated by noise.`);
  if (periods.previous && Math.abs(curDays - prevDays) > 2) dq.push(`Periods differ in length (${Math.round(curDays)} vs ${Math.round(prevDays)} days); totals are not directly comparable.`);
  if (curDays < 28) dq.push('Seasonality cannot be assessed from a period shorter than a month; weekday/seasonal effects may explain changes.');
  const names = [...new Set([...cur, ...prev].map((r) => r.metric)), ...Object.entries(METRICS).filter(([, d]) => d.agg === 'ratio' && [...cur, ...prev].some((r) => r.metric === d.num) && [...cur, ...prev].some((r) => r.metric === d.den)).map(([k]) => k)];
  const metrics = [...new Set(names)].map((m): MetricComparison => {
    const def = METRICS[m]!; const c = aggregate(cur, m); const p = prev.length ? aggregate(prev, m) : undefined; const caveats: string[] = [];
    const base: MetricComparison = { metric: m, label: def.label, current: c, previous: p, pctChange: null, direction: 'unknown', assessment: 'no_comparison', confidence: 'low', caveats };
    if (c === undefined) { caveats.push('No current-period data for this metric.'); return base; }
    if (p === undefined) { caveats.push('No previous-period data to compare against.'); return base; }
    const delta = c - p; const pct = p !== 0 ? (delta / Math.abs(p)) * 100 : null; const direction = Math.abs(delta) < 1e-9 ? 'flat' : delta > 0 ? 'up' : 'down';
    const volume = def.agg === 'avg' || def.agg === 'ratio' ? Math.min(...[def.num, def.den].filter(Boolean).map((k) => aggregate(cur, k!) ?? 0), Infinity) : Math.min(c, p);
    const lowVol = def.agg === 'sum' && volume < def.minVolume;
    if (lowVol) caveats.push(`Volume is low (${Math.round(Math.min(c, p))} < ${def.minVolume}); percentage changes at this size are unreliable.`);
    if (pct === null) caveats.push('Previous value was zero; percentage change is undefined.');
    const meaningful = !lowVol && pct !== null && Math.abs(pct) >= (def.agg === 'avg' ? 10 : 15);
    const good = def.higherIsBetter ? delta > 0 : delta < 0;
    return { ...base, delta, pctChange: pct === null ? null : Math.round(pct * 10) / 10, direction, assessment: lowVol ? 'insufficient_data' : !meaningful ? 'unchanged' : good ? 'improved' : 'declined', confidence: lowVol || curDays < 14 ? 'low' : dq.length ? 'medium' : 'high', caveats };
  });
  return { metrics, dataQuality: dq };
}

export class PerformanceService {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly audit: AuditLog, private readonly llm: StructuredClient, private readonly gate: PlanGate = OPEN_GATE) {}

  /** Only supplied/authorised-source metrics are stored. Source and import time are recorded as provenance. */
  async ingestCsv(ctx: Ctx, source: string, csv: string, period: { periodStart: string; periodEnd: string }) {
    await this.authz.require(ctx, 'ingest_data'); await this.gate.require(ctx, 'performance');
    if (csv.length > 2_000_000) throw new ValidationError('CSV too large (2 MB max)');
    if (Number.isNaN(Date.parse(period.periodStart)) || Number.isNaN(Date.parse(period.periodEnd)) || period.periodEnd < period.periodStart) throw new ValidationError('Invalid reporting period');
    const parsed = parseMetricsCsv(csv, period);
    if (!parsed.rows.length) throw new ValidationError(`No valid metric rows found. ${parsed.rejected.slice(0, 3).map((r) => `line ${r.line}: ${r.reason}`).join('; ')}`);
    // Re-importing the same source+period replaces the earlier import instead of double counting.
    const existing = (await this.db.metrics.list(ctx.businessId, { source })).filter((m) => inSite(m, ctx));
    const dup = existing.filter((m) => parsed.rows.some((r) => r.periodStart === m.periodStart && r.periodEnd === m.periodEnd));
    if (dup.length) for (const d of dup) await this.db.metrics.update(ctx.businessId, d.id, { value: NaN, metric: '__superseded__' });
    const prov = { source: 'manual_import' as const, sourceRef: source, recordedAt: nowIso(), evidence: 'verified' as const };
    for (const r of parsed.rows) await this.db.metrics.insert({ businessId: ctx.businessId, siteId: siteOf(ctx), source, metric: r.metric, dimension: r.dimension, periodStart: r.periodStart, periodEnd: r.periodEnd, value: r.value, provenance: prov });
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'performance.ingested', entityType: 'metrics', entityId: source, detail: { rows: parsed.rows.length, rejected: parsed.rejected.length, replaced: dup.length, period } });
    return { imported: parsed.rows.length, rejected: parsed.rejected, ignoredColumns: parsed.ignoredColumns, replaced: dup.length };
  }

  private async forPeriod(ctx: Ctx, start: string, end: string) {
    return (await this.db.metrics.list(ctx.businessId)).filter((m) => inSite(m, ctx) && m.metric !== '__superseded__' && m.periodStart >= start && m.periodEnd <= end);
  }

  async report(ctx: Ctx, periods: { current: { start: string; end: string }; previous?: { start: string; end: string } }, usage: { current: Usage }, opts: { executionId?: string } = {}) {
    await this.authz.require(ctx, 'view'); await this.gate.require(ctx, 'performance');
    const cur = await this.forPeriod(ctx, periods.current.start, periods.current.end);
    const prev = periods.previous ? await this.forPeriod(ctx, periods.previous.start, periods.previous.end) : [];
    if (!cur.length) throw Object.assign(new ValidationError('No performance data has been supplied for the current period. Upload a Google Search Console, Analytics or email export first.', 'no_data'), {});
    const { metrics, dataQuality } = compareMetrics(cur, prev, periods);
    const audit = await this.audit.list(ctx.businessId);
    const acts = audit.filter((a) => a.action === 'activity.completed' || a.action === 'execution.verified' || a.action === 'deliverable.approved').filter((a) => { const d = a.createdAt.slice(0, 10); return d >= periods.current.start && d <= periods.current.end || (periods.previous && d >= periods.previous.start && d <= periods.current.end); })
      .map((a) => ({ at: a.createdAt, action: a.action, deliverableType: (a.detail as { type?: string } | undefined)?.type, note: 'Occurred during the comparison window. Timing coincides with, but does not prove, the change in results.' }));
    const have = new Set(metrics.map((m) => m.metric));
    const missingMetrics = ['sessions', 'clicks', 'impressions', 'conversions'].filter((m) => !have.has(m));
    const sources = [...new Set(cur.map((m) => m.source))];
    const data: PerformanceReportData = { generatedAt: nowIso(), current: periods.current, previous: periods.previous, metrics, coincidentActivities: acts, dataQuality, missingMetrics, sources };
    const refs = new Set(metrics.map((m) => m.metric));
    const res = await this.llm.generate({
      task: 'performance_recommendations', usage, schema: PerformanceRecsSchema,
      instructions: 'Recommend next actions from the computed metrics ONLY. Every recommendation must cite metricRefs from the supplied list. Mention uncertainty (low volume, short periods, seasonality, coincident activity not being causal). Never state numbers that are not in the metrics. Never promise expected improvements.',
      input: { metrics, dataQuality, missingMetrics, activities: acts },
      validate: (r) => { const bad = r.recommendations.find((x) => x.metricRefs.some((m) => !refs.has(m))); return bad ? `Recommendation "${bad.title}" cites unknown metric. Valid: ${[...refs].join(', ')}` : null; },
    });
    data.recommendations = res.data; data.mock = res.mock;
    const row = await this.db.reports.insert({ businessId: ctx.businessId, siteId: siteOf(ctx), data, periodStart: periods.current.start, periodEnd: periods.current.end });
    await this.audit.record({ businessId: ctx.businessId, actorType: 'agent', actorId: 'agent', action: 'performance.report', entityType: 'report', entityId: row.id, detail: { executionId: opts.executionId } });
    return row;
  }
  async reports(ctx: Ctx) { await this.authz.require(ctx, 'view'); return (await this.db.reports.list(ctx.businessId, undefined, { newestFirst: true })).filter((r) => inSite(r, ctx)); }

  /** Closes the loop (spec §11.3): completed work → evaluation or "supply data" follow-ups. */
  async followUpFindings(ctx: Ctx, minAgeDays = 14): Promise<Finding[]> {
    await this.authz.require(ctx, 'view');
    const audit = await this.audit.list(ctx.businessId); const out: Finding[] = [];
    const metrics = (await this.db.metrics.list(ctx.businessId)).filter((m) => inSite(m, ctx) && m.metric !== '__superseded__');
    for (const a of audit.filter((x) => x.action === 'activity.completed')) {
      const age = daysBetween(a.createdAt, nowIso()); if (age < minAgeDays) continue;
      const after = metrics.some((m) => m.periodEnd >= a.createdAt.slice(0, 10));
      const type = (a.detail as { type?: string } | undefined)?.type ?? 'work';
      out.push({
        key: `followup_${a.entityId}`, category: 'customer_acquisition', origin: 'rule', ruleId: 'followup', dependsOn: [], title: after ? `Evaluate results of the completed ${type.replace(/_/g, ' ')}` : `Supply performance data to evaluate the completed ${type.replace(/_/g, ' ')}`,
        observed: `A ${type.replace(/_/g, ' ')} was recorded as completed ${Math.round(age)} days ago${after ? ' and newer performance data is available.' : ', but no performance data after that date has been supplied.'}`, where: [], evidence: [{ kind: 'observation', source: 'activity log', text: `activity.completed on ${a.createdAt.slice(0, 10)} (customer-attested)` }],
        whyItMatters: 'Without results the agent cannot tell whether the work helped or what to do next.', affected: 'The business', consequence: after ? 'Opportunity to double down or adjust is missed.' : 'Strategy cannot learn from this work.', confidence: 'high', impact: 'medium', evidenceClass: 'verified',
        missingInfo: after ? [] : ['Search Console / Analytics export covering dates after completion.'], recommendation: after ? 'Run a performance review comparing the periods before and after completion.' : 'Upload a recent Search Console or Analytics export, then run a performance review.', effort: 'low',
      });
    }
    return out;
  }
}
