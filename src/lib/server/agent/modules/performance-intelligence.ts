import type { CapabilityModule } from "./types";

/**
 * Performance Intelligence (§11). Works only with information that actually exists:
 *
 *   1. Outcomes of completed and approved work: verified fixed / still found / waiting, from the website checks
 *      (verify_outcomes in the database: "fixed" only when the same check no longer fires and its source was checked).
 *   2. Executed work: what the application carried out after the owner authorized it, and what a check later verified.
 *   3. Supplied figures (performance_metrics): only values the owner entered or exported from their own tools, each for an
 *      explicit period with its source. Nothing is measured by Something Clicks, and nothing is estimated or filled in.
 *
 * Period comparison is deliberately conservative (§11.2): it compares a metric only between two adjacent periods of the
 * same length from the same source; a change counts as meaningful only when it is at least 10% AND at least a small
 * absolute amount; it never attributes a change to a piece of work; it always states that seasonality and other factors
 * are not accounted for. With one period it says there is nothing to compare yet.
 */
export interface OutcomeCard {
  status: string;
  verification: string | null;
}

export interface SuppliedMetric {
  metric: string;
  period_start: string;
  period_end: string;
  value: number;
  source: string;
}

export interface ExecutionSummaryInput {
  status: string;
  action: string;
  verification: string | null;
}

export const METRICS: Record<string, { label: string; lowerIsBetter?: boolean; minChange: number }> = {
  website_visits: { label: "Website visits", minChange: 20 },
  search_impressions: { label: "Search impressions", minChange: 50 },
  search_clicks: { label: "Search clicks", minChange: 5 },
  average_position: { label: "Average search position", lowerIsBetter: true, minChange: 1 },
  calls: { label: "Phone calls", minChange: 3 },
  form_leads: { label: "Form enquiries", minChange: 3 },
  email_opens: { label: "Email opens", minChange: 10 },
  email_clicks: { label: "Email clicks", minChange: 3 },
  new_customers: { label: "New customers", minChange: 2 },
  reviews_received: { label: "Reviews received", minChange: 2 },
};
export const METRIC_KEYS = Object.keys(METRICS);
export const isMetric = (v: unknown): v is string => typeof v === "string" && Object.hasOwn(METRICS, v);

export type Direction = "better" | "worse" | "about_the_same";

export interface MetricComparison {
  metric: string;
  label: string;
  source: string;
  current: { period_start: string; period_end: string; value: number };
  previous: { period_start: string; period_end: string; value: number } | null;
  change: number | null;
  /** Percentage change, rounded to one decimal; null when the previous value is 0 or there is no previous period. */
  change_pct: number | null;
  direction: Direction | null;
  meaningful: boolean;
  note: string;
}

export interface PerformanceSummary {
  completed_or_approved: number;
  verified_fixed: number;
  still_found: number;
  awaiting_check: number;
  executed: number;
  executed_verified: number;
  executed_not_verified: number;
  comparisons: MetricComparison[];
  /** Plain statements about what the data can and cannot show. */
  caveats: string[];
  /** "none" when no figures were supplied at all; there is no traffic integration. */
  supplied_data: "none" | "some";
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Compares each metric's latest period with the adjacent earlier period of equal length from the same source. */
export function comparePeriods(metrics: SuppliedMetric[]): MetricComparison[] {
  const groups = new Map<string, SuppliedMetric[]>();
  for (const m of metrics) {
    if (!Object.hasOwn(METRICS, m.metric) || !Number.isFinite(m.value)) continue;
    const k = `${m.metric}|${m.source}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const out: MetricComparison[] = [];
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => b.period_end.localeCompare(a.period_end) || b.period_start.localeCompare(a.period_start));
    const cur = sorted[0]!;
    const len = days(cur.period_start, cur.period_end);
    // The previous period must end the day before the current one starts and have the same length.
    const prev = sorted.find((r) => r !== cur && days(r.period_end, cur.period_start) === 1 && days(r.period_start, r.period_end) === len) ?? null;
    const def = METRICS[cur.metric]!;
    const base = { metric: cur.metric, label: def.label, source: cur.source, current: { period_start: cur.period_start, period_end: cur.period_end, value: cur.value } };
    if (!prev) {
      const other = sorted.length > 1 ? " Earlier figures cover periods of a different length or are not directly before this one, so they are not compared." : "";
      out.push({ ...base, previous: null, change: null, change_pct: null, direction: null, meaningful: false, note: `Only one comparable period so far.${other}` });
      continue;
    }
    const change = Math.round((cur.value - prev.value) * 100) / 100;
    const pct = prev.value === 0 ? null : Math.round(((cur.value - prev.value) / prev.value) * 1000) / 10;
    const meaningful = Math.abs(change) >= def.minChange && (pct === null ? cur.value !== 0 : Math.abs(pct) >= 10);
    const up = change > 0;
    const direction: Direction = !meaningful ? "about_the_same" : up !== Boolean(def.lowerIsBetter) ? "better" : "worse";
    out.push({
      ...base,
      previous: { period_start: prev.period_start, period_end: prev.period_end, value: prev.value },
      change,
      change_pct: pct,
      direction,
      meaningful,
      note: meaningful
        ? `${def.label} ${direction === "better" ? "improved" : "got worse"} compared with the period before (${up ? "+" : ""}${change}${pct === null ? "" : `, ${up ? "+" : ""}${pct}%`}).`
        : `${def.label} stayed about the same compared with the period before.`,
    });
  }
  return out.sort((a, b) => METRIC_KEYS.indexOf(a.metric) - METRIC_KEYS.indexOf(b.metric) || a.source.localeCompare(b.source));
}

export function summarizePerformance(input: { cards: OutcomeCard[]; metrics?: SuppliedMetric[]; executions?: ExecutionSummaryInput[] }): PerformanceSummary {
  const tracked = input.cards.filter((c) => c.status === "done" || c.status === "approved");
  const executed = (input.executions ?? []).filter((e) => e.status === "succeeded");
  const comparisons = comparePeriods(input.metrics ?? []);
  const caveats: string[] = [];
  if (!input.metrics?.length) caveats.push("No results figures have been supplied, so traffic, enquiries and search results are not assessed. Something Clicks does not measure them itself.");
  else {
    caveats.push("These figures were supplied to Something Clicks; they were not measured by it.");
    if (comparisons.some((c) => c.previous)) caveats.push("Comparisons do not account for seasons, holidays, advertising or other changes, and do not show that any one piece of work caused a change.");
  }
  return {
    completed_or_approved: tracked.length,
    verified_fixed: tracked.filter((c) => c.verification === "fixed").length,
    still_found: tracked.filter((c) => c.verification === "still_found").length,
    awaiting_check: tracked.filter((c) => !c.verification).length,
    executed: executed.length,
    executed_verified: executed.filter((e) => e.verification === "verified").length,
    executed_not_verified: executed.filter((e) => e.verification === "not_verified").length,
    comparisons,
    caveats,
    supplied_data: input.metrics?.length ? "some" : "none",
  };
}

export const performanceIntelligence: CapabilityModule<{ cards: OutcomeCard[]; metrics?: SuppliedMetric[]; executions?: ExecutionSummaryInput[] }, PerformanceSummary> = {
  id: "performance_intelligence",
  async run(input) {
    const out = summarizePerformance(input);
    const compared = out.comparisons.filter((c) => c.previous).length;
    return {
      status: "done",
      output: out,
      detail: `${out.verified_fixed} verified fixed, ${out.still_found} still found, ${out.awaiting_check} waiting for the next check; ${out.executed} carried out; ${out.supplied_data === "none" ? "no results figures supplied" : `${compared} figure${compared === 1 ? "" : "s"} compared with the period before`}.`,
    };
  },
};

export interface FollowUp {
  kind: "still_found" | "worse" | "better" | "verified" | "no_data";
  title: string;
  why: string;
  card_id?: string;
  metric?: string;
}

/**
 * Follow-up recommendations from the results (§11.3, continuous improvement). Only from what was observed: work a check
 * still finds is reopened, a metric that got worse is flagged for a look, verified work is noted, and missing data is asked
 * for. Never "this worked because ...".
 */
export function followUps(input: { summary: PerformanceSummary; stillFound: { id: string; title: string }[] }): FollowUp[] {
  const out: FollowUp[] = [];
  for (const c of input.stillFound.slice(0, 5)) {
    out.push({ kind: "still_found", card_id: c.id, title: `Look again at “${c.title}”`, why: "It was marked done or approved, but the latest website check still finds it." });
  }
  for (const c of input.summary.comparisons.filter((x) => x.direction === "worse")) {
    out.push({ kind: "worse", metric: c.metric, title: `Check why ${c.label.toLowerCase()} dropped`, why: `${c.note} The figures alone do not say why.` });
  }
  for (const c of input.summary.comparisons.filter((x) => x.direction === "better")) {
    out.push({ kind: "better", metric: c.metric, title: `${c.label} improved`, why: `${c.note} Keep the work that was done around this period going.` });
  }
  if (input.summary.verified_fixed) {
    out.push({ kind: "verified", title: `${input.summary.verified_fixed} fix${input.summary.verified_fixed === 1 ? "" : "es"} confirmed on your website`, why: "A website check no longer finds these issues." });
  }
  if (input.summary.supplied_data === "none") {
    out.push({ kind: "no_data", title: "Add your results figures", why: "With monthly calls, enquiries or visits we can compare periods and see what changed." });
  }
  return out;
}
