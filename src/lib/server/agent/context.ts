import "server-only";

import type { StoredFact } from "@/lib/business-profile";

import type { Db } from "../analysis";
import { understand, type BusinessUnderstanding, type OwnerProfile } from "./modules/business-intelligence";
import type { SuppliedMetric } from "./modules/performance-intelligence";
import type { WorkflowKind } from "./workflows";

/**
 * Customer context for the Marketing Agent (§14): the business understanding a capability needs,
 * read as the signed-in user (RLS limits it to their own business).
 */
export async function loadUnderstanding(db: Pick<Db, "from">, orgId: string, profile: OwnerProfile): Promise<{ facts: StoredFact[]; understanding: BusinessUnderstanding }> {
  const { data } = await db
    .from("business_facts")
    .select("id, category, field, value, source, evidence_class, basis, evidence, status, observed_at, confirmed_at")
    .eq("organization_id", orgId)
    .in("status", ["proposed", "confirmed"])
    .order("created_at", { ascending: true });
  const facts = (data ?? []) as unknown as StoredFact[];
  return { facts, understanding: understand(profile, facts) };
}

/**
 * The structured memory the orchestrator retrieves for a piece of work (§3.4, §14). Each section is loaded only when the
 * kind of work needs it ("retrieve only the information relevant to the current task"), always as the signed-in user, so
 * RLS keeps every read inside their own business. Research older than RESEARCH_STALE_DAYS is flagged, never treated as
 * current (§3.4 "must not treat outdated research as current facts").
 */
export type ContextSection = "business" | "cards" | "decisions" | "research" | "performance" | "plan";

export const CONTEXT_NEEDS: Record<WorkflowKind, ContextSection[]> = {
  website_review: ["business"],
  homepage_headline: ["business", "cards"],
  competitor_research: ["business", "research"],
  marketing_plan: ["business", "cards", "decisions", "research", "performance"],
  promotional_campaign: ["business", "cards", "research"],
  results_review: ["cards", "performance", "decisions", "plan"],
};

export const RESEARCH_STALE_DAYS = 90;

export interface ContextCard {
  id: string;
  check_key: string | null;
  title: string;
  why_it_matters: string;
  recommended_action: string;
  impact_priority: string;
  confidence: string;
  evidence_class: string | null;
  execution_type: string;
  status: string;
  stage: string;
  verification: string | null;
  effort: string | null;
  depends_on: string[];
  analysis_id: string;
}

export interface AgentContext {
  sections: ContextSection[];
  facts?: StoredFact[];
  understanding?: BusinessUnderstanding;
  latestAnalysis?: { id: string; completed_at: string } | null;
  /** Open cards (prepared or approved, not completed or dismissed). */
  openCards?: ContextCard[];
  /** Cards that were marked done or approved, for outcomes. */
  trackedCards?: ContextCard[];
  /** Previous decisions: what the owner dismissed (and their note), rejected plans, dismissed campaigns. */
  decisions?: { dismissed: { check_key: string | null; title: string; note: string | null }[]; rejectedPlans: number; dismissedCampaigns: string[] };
  research?: {
    competitors: { host: string; is_self: boolean; status: string; signals: Record<string, unknown>; scanned_at: string; stale: boolean }[];
    keywords: { term: string; source: string; metrics: Record<string, unknown>; evidence_class: string; basis: string | null; measured_on: string; stale: boolean }[];
    staleCount: number;
  };
  performance?: { metrics: SuppliedMetric[]; executions: { status: string; action: string; verification: string | null }[] };
  approvedPlan?: { id: string; created_at: string; plan: unknown } | null;
}

const CARD_COLUMNS = "id, check_key, title, why_it_matters, recommended_action, impact_priority, confidence, evidence_class, execution_type, status, stage, verification, effort, depends_on, analysis_id";
const ageDays = (iso: string, now: number) => (now - Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso)) / 86_400_000;

export async function loadAgentContext(
  db: Pick<Db, "from">,
  orgId: string,
  profile: OwnerProfile,
  kind: WorkflowKind,
  now = Date.now(),
): Promise<AgentContext> {
  const sections = CONTEXT_NEEDS[kind];
  const ctx: AgentContext = { sections };
  const jobs: Promise<void>[] = [];

  if (sections.includes("business")) {
    jobs.push(loadUnderstanding(db, orgId, profile).then((r) => { ctx.facts = r.facts; ctx.understanding = r.understanding; }));
  }
  jobs.push((async () => {
    const { data } = await db.from("analyses").select("id, completed_at").eq("organization_id", orgId).not("completed_at", "is", null)
      .order("completed_at", { ascending: false }).limit(1).maybeSingle();
    ctx.latestAnalysis = data ? { id: data.id, completed_at: data.completed_at as string } : null;
  })());
  if (sections.includes("cards")) {
    jobs.push((async () => {
      const { data } = await db.from("action_cards").select(CARD_COLUMNS).eq("organization_id", orgId)
        .in("status", ["new", "approved", "in_progress", "done"]).order("created_at", { ascending: false }).limit(200);
      const rows = (data ?? []) as unknown as ContextCard[];
      ctx.openCards = rows.filter((c) => c.stage === "prepared" || c.stage === "approved");
      ctx.trackedCards = rows.filter((c) => c.status === "done" || c.status === "approved");
    })());
  }
  if (sections.includes("decisions")) {
    jobs.push((async () => {
      const [cards, plans, campaigns] = await Promise.all([
        db.from("action_cards").select("check_key, title, result_summary").eq("organization_id", orgId).eq("status", "dismissed").order("updated_at", { ascending: false }).limit(20),
        db.from("marketing_plans").select("id").eq("organization_id", orgId).eq("status", "rejected").limit(50),
        db.from("marketing_campaigns").select("playbook").eq("organization_id", orgId).eq("status", "dismissed").not("decided_by", "is", null).limit(20),
      ]);
      ctx.decisions = {
        dismissed: (cards.data ?? []).map((c) => ({ check_key: c.check_key, title: c.title, note: c.result_summary === "Dismissed by your team." ? null : c.result_summary })),
        rejectedPlans: plans.data?.length ?? 0,
        dismissedCampaigns: [...new Set((campaigns.data ?? []).map((c) => c.playbook))],
      };
    })());
  }
  if (sections.includes("research")) {
    jobs.push((async () => {
      const [scans, items] = await Promise.all([
        db.from("competitor_scans").select("host, is_self, status, signals, scanned_at").eq("organization_id", orgId).order("scanned_at", { ascending: false }).limit(10),
        db.from("research_items").select("term, source, metrics, evidence_class, basis, measured_on").eq("organization_id", orgId).order("measured_on", { ascending: false }).limit(100),
      ]);
      const competitors = (scans.data ?? []).map((s) => ({ ...s, signals: (s.signals ?? {}) as Record<string, unknown>, stale: ageDays(s.scanned_at, now) > RESEARCH_STALE_DAYS }));
      const keywords = (items.data ?? []).map((k) => ({ ...k, metrics: (k.metrics ?? {}) as Record<string, unknown>, stale: ageDays(k.measured_on, now) > RESEARCH_STALE_DAYS }));
      ctx.research = { competitors, keywords, staleCount: competitors.filter((c) => c.stale).length + keywords.filter((k) => k.stale).length };
    })());
  }
  if (sections.includes("performance")) {
    jobs.push((async () => {
      const [metrics, execs] = await Promise.all([
        db.from("performance_metrics").select("metric, period_start, period_end, value, source").eq("organization_id", orgId).order("period_end", { ascending: false }).limit(500),
        db.from("execution_records").select("status, action, verification").eq("organization_id", orgId).order("requested_at", { ascending: false }).limit(200),
      ]);
      ctx.performance = {
        metrics: (metrics.data ?? []).map((m) => ({ ...m, value: Number(m.value) })),
        executions: execs.data ?? [],
      };
    })());
  }
  if (sections.includes("plan")) {
    jobs.push((async () => {
      const { data } = await db.from("marketing_plans").select("id, created_at, plan").eq("organization_id", orgId).eq("status", "approved")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      ctx.approvedPlan = data ?? null;
    })());
  }
  await Promise.all(jobs);
  return ctx;
}
