import "server-only";

import { log } from "@/lib/log";
import type { Json } from "@/lib/supabase/types";

import { runAnalysis, type AnalysisDeps, type Db } from "../analysis";
import type { BusinessContext } from "../checks";
import { CAPABILITIES, type CapabilityId } from "./capabilities";
import { getModelProvider } from "./provider";
import { rankNeeds, type RankedNeed } from "./rank";
import { planWorkflow, WORKFLOWS, type WorkflowKind } from "./workflows";

/**
 * The central Marketing Agent orchestrator (spec section 12).
 *
 * A controlled software workflow, not a prompt. For each request it:
 *   1. understands the business (the stored business profile; lists what is missing),
 *   2. plans: selects only the capabilities the request needs and checks each can run,
 *   3. analyzes the website (the existing analyzeWebsite / complete_analysis path, unchanged),
 *   4. identifies and ranks the marketing needs (deterministic ranking of the evidence-backed findings),
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
  missing_business_info: string[];
  coverage: Record<string, unknown>;
  /** Cards that could get a prepared draft once a model provider exists. */
  drafts_possible: number;
}

export type WorkflowOutcome =
  | { status: "prepared"; workflowId: string | null; result: WebsiteReviewResult; steps: StepRecord[] }
  | { status: "blocked" | "failed"; workflowId: string | null; reason: string; steps: StepRecord[] };

const now = () => new Date().toISOString();

/** Step 1: what the agent knows about the business, and what it does not. */
export function understandBusiness(biz: BusinessInput): { known: string[]; missing: string[] } {
  const known = ["business name", "website"];
  const missing: string[] = [];
  (biz.serviceArea ? known : missing).push("service area");
  (biz.primaryGoal ? known : missing).push("main goal");
  return { known, missing };
}

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

async function closeRecord(db: WorkflowDb, id: string | null, status: "prepared" | "blocked" | "failed", steps: StepRecord[], result: unknown, reason: string | null) {
  if (!id) return;
  try {
    const { error } = await db.rpc("finish_marketing_workflow", {
      p_workflow: id, p_status: status, p_steps: steps as unknown as Json, p_result: (result ?? null) as Json | null,
      p_error: reason, p_provider: null, p_model: null, p_usage: null,
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

  // 1. Understand the business.
  const biz = understandBusiness(input.business);
  step({
    step: "understand_business", capability: "business_intelligence", status: "done",
    detail: `Using the business profile: ${biz.known.join(", ")}.${biz.missing.length ? ` Not provided: ${biz.missing.join(", ")}.` : ""}`,
  });

  // 2. Plan (this workflow runs entirely on checks; it is never blocked by the model provider).
  step({ step: "plan", capability: null, status: "done", detail: `Capabilities: ${plan.capabilities.map((c) => CAPABILITIES[c].label).join(", ")}.` });

  // 3. Analyze the website (existing analysis, saved by complete_analysis).
  const { businessName, serviceArea, primaryGoal } = input.business;
  const analysis = await runAnalysis(db, input.analysisId, input.business.website, { businessName, serviceArea, primaryGoal }, deps);
  if (!analysis.ok) {
    step({ step: "analyze_website", capability: "website_intelligence", status: "failed", detail: analysis.reason });
    await closeRecord(db, workflowId, "failed", steps, null, analysis.reason);
    return { status: "failed", workflowId, reason: analysis.reason, steps };
  }
  const r = analysis.result;
  const pages = (r.coverage.website as { pages_reviewed?: number } | undefined)?.pages_reviewed ?? 1;
  step({
    step: "analyze_website", capability: "website_intelligence", status: "done",
    detail: `Reviewed ${pages} page${pages === 1 ? "" : "s"}; ${r.evidence.length} pieces of evidence recorded; PageSpeed ${r.pagespeed ? "measured" : "not available"}.`,
  });

  // 4. Identify and rank needs.
  const ranked = rankNeeds(r.findings, r.evidence);
  step({
    step: "rank_needs", capability: "marketing_analysis", status: "done",
    detail: ranked.length ? `${ranked.length} needs ranked; first: ${ranked[0]!.title}.` : "Nothing needs attention right now.",
  });

  // 5. Prepare the work and 6. explain why it matters: the saved Action Cards.
  const draftsPossible = r.findings.filter((f) => f.ai_capable && f.execution_type !== "manual").length;
  step({
    step: "prepare_work", capability: "marketing_analysis", status: "done",
    detail: `${ranked.length} recommendation${ranked.length === 1 ? "" : "s"} prepared from website checks, each with evidence, why it matters and what to do.`,
  });
  if (draftsPossible) {
    step({
      step: "prepare_drafts", capability: "content_creation", status: "blocked",
      detail: `${draftsPossible} could get a prepared draft. Blocked: no model provider is configured.`,
    });
  }

  // 7. Present for review; the outcome is recorded later by the owner and the next check.
  step({ step: "owner_review", capability: null, status: "waiting", detail: "Waiting for the owner to approve, dismiss or mark each one done." });

  const result: WebsiteReviewResult = {
    source: "website_check",
    model_worded: r.wording === "ai",
    summary: r.summary,
    ranked,
    missing_business_info: biz.missing,
    coverage: r.coverage,
    drafts_possible: draftsPossible,
  };
  await closeRecord(db, workflowId, "prepared", steps, result, null);
  log.info("workflow.prepared", { workflowId, kind: "website_review", needs: ranked.length });
  return { status: "prepared", workflowId, result, steps };
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
