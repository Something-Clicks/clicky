import "server-only";

import type { ProposedFact } from "@/lib/business-profile";
import { EVIDENCE_CLASSES, type EvidenceClass } from "@/lib/evidence";
import { log } from "@/lib/log";
import type { Json } from "@/lib/supabase/types";

import { runAnalysis, type AnalysisDeps, type Db } from "../analysis";
import type { BusinessContext } from "../checks";
import { CAPABILITIES, type CapabilityId } from "./capabilities";
import { FEATURES } from "@/config/features";

import { MODULES } from "./modules";
import { sourcePages } from "./modules/business-understanding";
import { analyzeWithModel } from "./modules/marketing-analysis-model";
import { expectDone } from "./modules/types";
import { meteredProvider } from "./metering";
import { getModelProvider } from "./provider";
import type { RankedNeed } from "./rank";
import { planWorkflow, WORKFLOWS, type WorkflowKind } from "./workflows";

/**
 * The central Marketing Agent orchestrator (spec section 12).
 *
 * A controlled software workflow, not a prompt. For each request it:
 * Every step runs a capability module from ./modules (one per capability in the specification).
 *   1. understands the business (Business Intelligence: the owner's profile; what is missing),
 *   2. plans: selects only the capabilities the request needs and checks each can run,
 *   3. analyzes the website (the existing analyzeWebsite / complete_analysis path, unchanged),
 *   4. identifies and ranks the marketing needs (Marketing Analysis and SEO Intelligence; every finding
 *      carries one of the four evidence classes), and proposes business details found on the website
 *      (Business Intelligence; the owner confirms them),
 *   5. prepares the work: the Action Cards, each with evidence, why it matters and what to do,
 *   6. presents it for the owner's review (cards start in stage "prepared"),
 *   7. records the outcome: owner approval (approve_action_card / decide_approval), the team marking it
 *      done, and verification by the next check (verify_outcomes). Those happen later, in the database.
 *
 * Everything is saved in marketing_workflows (steps, capabilities, result, errors). Today every step
 * that runs is a fixed, evidence-based check; no model is called. Steps that need a model are recorded
 * as blocked, never faked. If the workflow record cannot be written (for example the migration is not
 * applied yet), the customer's website check still runs exactly as before and the problem is logged.
 */

export type StepStatus = "done" | "skipped" | "blocked" | "failed" | "waiting";
export interface StepRecord {
  step: string;
  capability: CapabilityId | null;
  status: StepStatus;
  detail: string;
  at: string;
}

export interface BusinessInput extends BusinessContext {
  website: string;
}

export interface WebsiteReviewResult {
  /** How the recommendations were produced. Always "website_check" today. */
  source: "website_check";
  /** True only when every card's wording came from a model (ai.ts, dormant). The findings themselves never do. */
  model_worded: boolean;
  summary: string;
  ranked: RankedNeed[];
  /** Findings per evidence class (verified / inferred / estimated / unknown). */
  evidence_classes: Record<EvidenceClass, number>;
  missing_business_info: string[];
  /** New business details proposed from the website this run (awaiting the owner). */
  business_facts_proposed: number | null;
  coverage: Record<string, unknown>;
  /** Cards that could get a prepared draft once Content Creation is built. */
  drafts_possible: number;
}

export type WorkflowOutcome =
  | { status: "prepared"; workflowId: string | null; result: WebsiteReviewResult; steps: StepRecord[] }
  | { status: "blocked" | "failed"; workflowId: string | null; reason: string; steps: StepRecord[] };

const now = () => new Date().toISOString();

type WorkflowDb = Pick<Db, "rpc">;

async function openRecord(db: WorkflowDb, orgId: string, kind: WorkflowKind, request: string | null, capabilities: CapabilityId[], analysisId: string | null) {
  try {
    const { data, error } = await db.rpc("start_marketing_workflow", {
      p_org: orgId, p_kind: kind, p_request: request, p_capabilities: capabilities, p_analysis: analysisId,
    });
    if (error || !data) {
      log.error("workflow.record_start_failed", { orgId, kind, error: error?.message, hint: (error as { hint?: string } | null)?.hint });
      return null;
    }
    return data;
  } catch (error) {
    log.error("workflow.record_start_failed", { orgId, kind, error });
    return null;
  }
}

interface ModelRecord {
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

async function closeRecord(db: WorkflowDb, id: string | null, status: "prepared" | "blocked" | "failed", steps: StepRecord[], result: unknown, reason: string | null, model: ModelRecord | null = null) {
  if (!id) return;
  try {
    const { error } = await db.rpc("finish_marketing_workflow", {
      p_workflow: id, p_status: status, p_steps: steps as unknown as Json, p_result: (result ?? null) as Json | null,
      p_error: reason, p_provider: model?.provider ?? null, p_model: model?.model ?? null,
      p_usage: model ? ({ input_tokens: model.usage.inputTokens, output_tokens: model.usage.outputTokens } as Json) : null,
    });
    if (error) log.error("workflow.record_finish_failed", { workflowId: id, error: error.message });
  } catch (error) {
    log.error("workflow.record_finish_failed", { workflowId: id, error });
  }
}

/**
 * The website review: every customer-facing website check runs through here (the Check button,
 * the first check after setup, and the weekly re-check). The analysis row must already exist
 * (start_analysis enforces limits and free uses).
 */
export async function runWebsiteReview(
  db: WorkflowDb,
  input: { orgId: string; analysisId: string; business: BusinessInput; request?: string | null },
  deps: AnalysisDeps = {},
): Promise<WorkflowOutcome> {
  const plan = planWorkflow("website_review", { modelProvider: getModelProvider() !== null });
  const steps: StepRecord[] = [];
  const step = (s: Omit<StepRecord, "at">) => steps.push({ ...s, at: now() });
  const workflowId = await openRecord(db, input.orgId, "website_review", input.request ?? null, plan.capabilities, input.analysisId);
  const { businessName, serviceArea, primaryGoal, website } = input.business;
  const profile = { businessName, serviceArea, primaryGoal, website };

  // 1. Understand the business (Business Intelligence, from the owner's profile).
  const before = expectDone(await MODULES.business_intelligence.run({ profile }), "business_intelligence");
  step({ step: "understand_business", capability: "business_intelligence", status: "done", detail: before.detail });

  // 2. Plan: only the capabilities this request needs (all available: this workflow needs no model).
  step({ step: "plan", capability: null, status: "done", detail: `Capabilities: ${plan.capabilities.map((c) => CAPABILITIES[c].label).join(", ")}.` });

  // 3–5. Website Intelligence → Marketing Analysis → SEO Intelligence, saved by complete_analysis.
  const analysis = await runAnalysis(db, input.analysisId, website, { businessName, serviceArea, primaryGoal }, deps);
  if (!analysis.ok) {
    step({ step: "analyze_website", capability: "website_intelligence", status: "failed", detail: analysis.reason });
    await closeRecord(db, workflowId, "failed", steps, null, analysis.reason);
    return { status: "failed", workflowId, reason: analysis.reason, steps };
  }
  const r = analysis.result;
  const pages = 1 + r.scan.pages.length;
  step({
    step: "analyze_website", capability: "website_intelligence", status: "done",
    detail: `Reviewed ${pages} page${pages === 1 ? "" : "s"}${r.scan.failures.length ? `; ${r.scan.failures.length} could not be read` : ""}; mobile speed ${r.pagespeed ? "measured" : "not available"}.`,
  });
  const classes = Object.fromEntries(EVIDENCE_CLASSES.map((c) => [c, r.findings.filter((f) => f.evidence_class === c).length])) as Record<EvidenceClass, number>;
  step({
    step: "analyze_marketing", capability: "marketing_analysis", status: "done",
    detail: `${r.findings.length} finding${r.findings.length === 1 ? "" : "s"} from ${r.evidence.length} pieces of evidence (${EVIDENCE_CLASSES.map((c) => `${classes[c]} ${c}`).join(", ")}).`,
  });
  step({
    step: "analyze_seo", capability: "seo_intelligence", status: "done",
    detail: `${r.seo.findings.length} on-page search finding${r.seo.findings.length === 1 ? "" : "s"} across ${r.seo.pages.length} page${r.seo.pages.length === 1 ? "" : "s"}; keyword data not connected.`,
  });

  // 6. Business Intelligence from the website: propose details for the owner to confirm.
  // Every model call is metered per business (daily/monthly caps, usage recorded) before and after it runs.
  const baseProvider = getModelProvider();
  const meter = (capability: string) => (baseProvider ? meteredProvider(baseProvider, { db, orgId: input.orgId, capability, workflowId }) : null);
  const provider = meter("business_intelligence.understand");
  const bi = expectDone(await MODULES.business_intelligence.run({ profile, scan: r.scan, provider }), "business_intelligence");
  const modelRun = bi.output.model && !("failed" in bi.output.model) ? bi.output.model : null;
  const proposed = await proposeFacts(db, input.orgId, input.analysisId, bi.output.proposals);
  step({
    step: "learn_business", capability: "business_intelligence", status: proposed === null ? "failed" : "done",
    detail: proposed === null ? `${bi.output.proposals.length} details found on the website could not be saved.` : `${bi.detail} ${proposed} new detail${proposed === 1 ? "" : "s"} saved for the owner to confirm.`,
  });

  // 6b. Model-assisted Marketing Analysis (messaging, conversion, content), only where the
  //     modelFindings switch is on (never in Production). Findings follow the evidence rules.
  const usage = { inputTokens: modelRun?.usage.inputTokens ?? 0, outputTokens: modelRun?.usage.outputTokens ?? 0 };
  let modelName = modelRun?.model ?? null;
  if (provider && FEATURES.modelFindings) {
    try {
      const mf = await analyzeWithModel(meter("marketing_analysis.review")!, {
        pages: sourcePages(r.scan),
        businessName,
        known: bi.output.understanding.known,
        alreadyFound: r.findings.map((f) => f.title),
      });
      usage.inputTokens += mf.usage.inputTokens;
      usage.outputTokens += mf.usage.outputTokens;
      modelName = mf.model;
      let saved = 0;
      if (mf.cards.length) {
        const { data, error } = await db.rpc("add_model_findings", { p_analysis: input.analysisId, p_evidence: mf.evidence as unknown as Json, p_cards: mf.cards as unknown as Json });
        if (error) throw new Error(`add_model_findings: ${error.message}`);
        saved = typeof data === "number" ? data : 0;
      }
      step({
        step: "analyze_marketing_model", capability: "marketing_analysis", status: "done",
        detail: `${saved} finding${saved === 1 ? "" : "s"} on messaging, conversion and content saved (${mf.rejected.length} dropped for failing evidence checks).`,
      });
    } catch (error) {
      step({ step: "analyze_marketing_model", capability: "marketing_analysis", status: "failed", detail: error instanceof Error ? error.message.slice(0, 300) : "failed" });
    }
  }

  // 7. Identify and rank needs (Marketing Analysis).
  step({
    step: "rank_needs", capability: "marketing_analysis", status: "done",
    detail: r.ranked.length ? `${r.ranked.length} needs ranked; first: ${r.ranked[0]!.title}.` : "Nothing needs attention right now.",
  });

  // 8. Prepare the work and explain why it matters: the saved Action Cards.
  const draftsPossible = r.findings.filter((f) => f.ai_capable && f.execution_type !== "manual").length;
  step({
    step: "prepare_work", capability: "marketing_analysis", status: "done",
    detail: `${r.ranked.length} recommendation${r.ranked.length === 1 ? "" : "s"} prepared from website checks, each with evidence, why it matters and what to do.`,
  });
  if (draftsPossible) {
    // Drafts are prepared when the owner asks for one on an Action Card (Content Creation), not automatically.
    const ready = provider !== null && FEATURES.drafts;
    step({
      step: "prepare_drafts", capability: "content_creation", status: ready ? "waiting" : "blocked",
      detail: ready
        ? `${draftsPossible} can get a prepared draft when the owner asks for one.`
        : `${draftsPossible} could get a prepared draft. ${provider ? "Drafts are switched off here." : "No model provider is configured."}`,
    });
  }

  // 9. Present for review; the outcome is recorded later by the owner and the next check.
  step({ step: "owner_review", capability: null, status: "waiting", detail: "Waiting for the owner to approve, dismiss or mark each one done." });

  const result: WebsiteReviewResult = {
    source: "website_check",
    model_worded: r.wording === "ai",
    summary: r.summary,
    ranked: r.ranked,
    evidence_classes: classes,
    missing_business_info: bi.output.understanding.missing,
    business_facts_proposed: proposed,
    coverage: r.coverage,
    drafts_possible: draftsPossible,
  };
  await closeRecord(db, workflowId, "prepared", steps, result, null, provider && modelName ? { provider: provider.id, model: modelName, usage } : null);
  log.info("workflow.prepared", { workflowId, kind: "website_review", needs: r.ranked.length, proposed });
  return { status: "prepared", workflowId, result, steps };
}

/** Saves proposed business details. Returns how many were new, or null if they could not be saved. */
async function proposeFacts(db: WorkflowDb, orgId: string, analysisId: string, facts: ProposedFact[]): Promise<number | null> {
  if (!facts.length) return 0;
  try {
    const { data, error } = await db.rpc("propose_business_facts", { p_org: orgId, p_analysis: analysisId, p_facts: facts as unknown as Json });
    if (error) {
      log.error("business_facts.propose_failed", { orgId, error: error.message });
      return null;
    }
    return typeof data === "number" ? data : 0;
  } catch (error) {
    log.error("business_facts.propose_failed", { orgId, error });
    return null;
  }
}

/** Kinds whose steps are implemented. Others are planned and report themselves as blocked. */
const IMPLEMENTED: WorkflowKind[] = ["website_review"];

/**
 * Entry point for requests other than the website review. Selects capabilities; if any needed
 * capability cannot run (no model provider, no integration) or the workflow is not built yet,
 * it records a blocked workflow and says why. It never produces placeholder output.
 */
export async function requestMarketingWork(
  db: WorkflowDb,
  input: { orgId: string; kind: WorkflowKind; request: string | null },
): Promise<WorkflowOutcome> {
  if (input.kind === "website_review") {
    throw new Error("Start a website review with start_analysis, then runWebsiteReview.");
  }
  const plan = planWorkflow(input.kind, { modelProvider: getModelProvider() !== null });
  const reason = plan.blocked ?? (IMPLEMENTED.includes(input.kind) ? null : `"${WORKFLOWS[input.kind].label}" is planned but not built yet.`);
  const steps: StepRecord[] = plan.steps.map((s) => ({
    step: s.capability, capability: s.capability, status: s.available ? "skipped" : "blocked",
    detail: s.reason ?? "Not run: the workflow is blocked.", at: now(),
  }));
  const workflowId = await openRecord(db, input.orgId, input.kind, input.request, plan.capabilities, null);
  const why = reason ?? "Blocked.";
  await closeRecord(db, workflowId, "blocked", steps, null, why);
  log.info("workflow.blocked", { workflowId, kind: input.kind, reason: why });
  return { status: "blocked", workflowId, reason: why, steps };
}
