import { daysBetween, nowIso } from './core/util';
import type { CardRow, ResearchRow } from './domain/models';
import { OPEN_GATE, type PlanGate } from './plans';
import { PROFILE_FIELDS } from './profile/fields';
import { freshness, isAssumption } from './profile/service';
import type { Ctx } from './store/authz';
import { Authz, inSite } from './store/authz';
import type { Db } from './store/db';

const latest = (rs: ResearchRow[], kind: ResearchRow['kind'], ctx: Ctx) => rs.find((r) => r.kind === kind && inSite(r, ctx));

/**
 * Marketing Studio: one place that turns everything the agent has saved (competitors, keyword data, market notes, audience,
 * results) into insights. Pure read model: every number is something the customer supplied or the agent retrieved, never invented.
 */
export class InsightsService {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly gate: PlanGate = OPEN_GATE) {}

  async summary(ctx: Ctx) {
    await this.authz.require(ctx, 'view'); await this.gate.require(ctx, 'insights');
    const research = await this.db.research.list(ctx.businessId, undefined, { newestFirst: true });
    const cards = (await this.db.cards.list(ctx.businessId)).filter((c) => inSite(c, ctx));
    const profile = (await this.db.profiles.get(ctx.businessId, ctx.siteId ?? ctx.businessId)) ?? (await this.db.profiles.get(ctx.businessId, ctx.businessId));
    const comp = latest(research, 'competitor', ctx); const kw = latest(research, 'keyword', ctx); const gaps = latest(research, 'content_gap', ctx); const mkt = latest(research, 'market', ctx);
    const rep = (await this.db.reports.list(ctx.businessId, undefined, { newestFirst: true })).find((r) => inSite(r, ctx));
    const missing: string[] = [];
    if (!comp) missing.push('Competitor research: add competitor websites on the Research page.');
    if (!kw) missing.push('Keyword data: upload a keyword export (for example from Semrush) on the Research page.');
    if (!rep) missing.push('Results: upload Search Console or Analytics data on the Performance page.');
    const open = cards.filter((c) => !['rejected', 'dismissed', 'resolved', 'verified', 'executed'].includes(c.card.status));
    const byCategory = Object.entries(open.reduce<Record<string, number>>((a, c) => ((a[c.card.category] = (a[c.card.category] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]);
    const rowsOf = (r?: ResearchRow) => ((r?.data as { rows?: { keyword: string; volume?: number; difficulty?: number; intent: string; position?: number }[] } | undefined)?.rows ?? []);
    return {
      generatedAt: nowIso(),
      competitive: comp ? { collectedAt: comp.collectedAt, evidence: comp.evidence, stale: freshness({ provenance: { source: 'research', recordedAt: comp.collectedAt, evidence: comp.evidence } }) === 'stale', data: comp.data as { competitors: unknown[]; differences: { point: string; evidenceClass: string }[]; opportunities: { opportunity: string; basis: string; evidenceClass: string }[] } } : undefined,
      keywords: kw ? { collectedAt: kw.collectedAt, total: rowsOf(kw).length, top: rowsOf(kw).filter((r) => r.volume !== undefined).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 8), byIntent: Object.entries(rowsOf(kw).reduce<Record<string, number>>((a, r) => ((a[r.intent] = (a[r.intent] ?? 0) + 1), a), {})), gaps: ((gaps?.data as { gaps?: { keyword: string; volume?: number; coverage: string; intent: string }[] } | undefined)?.gaps ?? []).slice(0, 8), clusters: ((kw.data as { clusters?: { topic: string; keywords: string[]; totalVolume?: number }[] }).clusters ?? []).slice(0, 6) } : undefined,
      market: mkt ? { collectedAt: mkt.collectedAt, evidence: mkt.evidence, findings: (mkt.data as { findings: { claim: string; evidenceClass: string; basis: string }[]; researchQuestions: string[] }).findings, questions: (mkt.data as { researchQuestions: string[] }).researchQuestions } : undefined,
      audience: profile ? PROFILE_FIELDS.filter((f) => f.category === 'customer' && profile.fields[f.key]).map((f) => { const v = profile.fields[f.key]!; return { label: f.label, value: v.value, status: v.confirmed ? 'confirmed' : isAssumption(v) ? 'assumption' : 'supplied' }; }) : [],
      performance: rep ? { at: rep.createdAt, metrics: (rep.data as { metrics: { label: string; assessment: string; pctChange: number | null; confidence: string }[] }).metrics } : undefined,
      opportunities: { open: open.length, byCategory, top: open.sort((a: CardRow, b: CardRow) => a.card.priority.rank - b.card.priority.rank).slice(0, 5).map((c) => ({ id: c.id, title: c.card.title, priority: c.card.priority.label, evidenceClass: c.card.evidenceClass })) },
      missing,
    };
  }
}

/** Marketing Assistant and up: where the customer stands, what improved since earlier reviews, what is next. */
export class ProgressService {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly gate: PlanGate = OPEN_GATE) {}

  async summary(ctx: Ctx) {
    await this.authz.require(ctx, 'view'); await this.gate.require(ctx, 'progress_tracking');
    const cards = (await this.db.cards.list(ctx.businessId)).filter((c) => inSite(c, ctx));
    const by = cards.reduce<Record<string, number>>((a, c) => ((a[c.card.status] = (a[c.card.status] ?? 0) + 1), a), {});
    const done = (by.resolved ?? 0) + (by.verified ?? 0) + (by.executed ?? 0); const open = cards.filter((c) => ['new', 'drafting', 'ready_for_review', 'approved', 'authorized', 'executing', 'failed'].includes(c.card.status));
    const runs = (await this.db.workflows.list(ctx.businessId, undefined, { newestFirst: true })).filter((w) => inSite(w, ctx) && w.status === 'succeeded');
    const reviews = runs.filter((w) => w.taskType === 'website_audit').slice(0, 12).map((w) => ({ id: w.id, at: w.completedAt ?? w.createdAt, findings: (w.state.findingCount as number | undefined) ?? 0, newCards: (w.state.cardIds as string[] | undefined)?.length ?? 0, resolved: (w.state.resolvedCount as number | undefined) ?? 0, scheduled: w.request.startsWith('Scheduled') }));
    const audit = await this.db.audit.list(ctx.businessId);
    const approved = audit.filter((a) => a.action === 'deliverable.approved').length; const completed = audit.filter((a) => a.action === 'activity.completed').map((a) => ({ at: a.createdAt, type: (a.detail as { type?: string } | undefined)?.type ?? 'work', url: (a.detail as { url?: string | null } | undefined)?.url ?? null }));
    const last = reviews[0]?.at;
    return {
      total: cards.length, done, open: open.length, resolved: by.resolved ?? 0, byStatus: by, percentDone: cards.length ? Math.round((done / cards.length) * 100) : 0,
      reviews, approvedDrafts: approved, completedActivities: completed.slice(0, 10), lastReviewAt: last, daysSinceReview: last ? Math.floor(daysBetween(last, nowIso())) : undefined,
      next: open.sort((a, b) => a.card.priority.rank - b.card.priority.rank).slice(0, 4).map((c) => ({ id: c.id, title: c.card.title, priority: c.card.priority.label, status: c.card.status })),
      resolvedItems: cards.filter((c) => c.card.status === 'resolved').slice(0, 8).map((c) => ({ id: c.id, title: c.card.title })),
    };
  }
}
