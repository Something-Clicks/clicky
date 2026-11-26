import "server-only";

import { FACT_LABEL, type FactField, type ProposedFact } from "@/lib/business-profile";
import { EVIDENCE_CLASSES, type EvidenceClass } from "@/lib/evidence";
import { log } from "@/lib/log";
import type { Json } from "@/lib/supabase/types";

import { runAnalysis, type AnalysisDeps, type Db } from "../analysis";
import type { BusinessContext } from "../checks";
import { CAPABILITIES, type CapabilityId } from "./capabilities";
import { FEATURES } from "@/config/features";

import { MODULES } from "./modules";
import { validateUrl, type FetchedPage } from "../safe-fetch";
import type { Campaign, CampaignInput } from "@/lib/campaigns";
import { sourcePages } from "./modules/business-understanding";
import { annotateCards } from "./modules/card-dependencies";
import { analyzeWithModel } from "./modules/marketing-analysis-model";
import { expectDone } from "./modules/types";
import { loadAgentContext, RESEARCH_STALE_DAYS, type AgentContext } from "./context";
import { understandRequest, type RequestUnderstanding } from "./intake";
import { meteredProvider, ModelBudgetExceeded } from "./metering";
import type { OwnerProfile } from "./modules/business-intelligence";
import { ContentRejected, createTaskDraft, isChannelKind, type ChannelKind } from "./modules/content-creation";
import { createPlan, PlanRejected } from "./modules/marketing-strategy";
import { followUps, type FollowUp, type PerformanceSummary } from "./modules/performance-intelligence";
import { buildRulesPlan, RULES_MODEL, RULES_PROVIDER } from "./modules/rules-strategy";
import { getModelProvider, ModelOutputInvalid, type ModelProvider } from "./provider";
import type { RankedNeed } from "./rank";
import { planWorkflow, type WorkflowKind } from "./workflows";

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

/** A durable background run (Trigger.dev) that is executing this workflow; recorded so a retry is traceable. */
export interface BackgroundRun {
  runId: string;
  attempt: number;
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
/** The model steps of a website check must be done by then, counted from the start of the workflow. */
export const WORKFLOW_DEADLINE_MS = 105_000;

export async function runWebsiteReview(
  db: WorkflowDb,
  input: { orgId: string; analysisId: string; business: BusinessInput; request?: string | null; background?: BackgroundRun | null },
  deps: AnalysisDeps = {},
): Promise<WorkflowOutcome> {
  // One deadline for the whole workflow (the request's limit is 120 s): the model steps get what is left of it.
  const deadlineAt = Date.now() + WORKFLOW_DEADLINE_MS;
  const plan = planWorkflow("website_review", { modelProvider: getModelProvider() !== null });
  const steps: StepRecord[] = [];
  const step = (s: Omit<StepRecord, "at">) => steps.push({ ...s, at: now() });
  const workflowId = await openRecord(db, input.orgId, "website_review", input.request ?? null, plan.capabilities, input.analysisId);
  const { businessName, serviceArea, primaryGoal, website } = input.business;
  const profile = { businessName, serviceArea, primaryGoal, website };
  if (input.background) {
    step({ step: "run_in_background", capability: null, status: "done", detail: `Running as a durable background job (run ${input.background.runId.slice(0, 40)}, attempt ${input.background.attempt}).` });
  }

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
  // The understanding of the business (model call, saved proposals) runs only where something shows or uses it:
  // never in Production, where all of these switches are off.
  const learns = FEATURES.businessProfile || FEATURES.modelFindings || FEATURES.strategy || FEATURES.drafts;
  const provider = learns ? meter("business_intelligence.understand") : null;
  const bi = expectDone(await MODULES.business_intelligence.run({ profile, scan: r.scan, provider, deadlineAt }), "business_intelligence");
  const modelRun = bi.output.model && !("failed" in bi.output.model) ? bi.output.model : null;
  const proposed = learns ? await proposeFacts(db, input.orgId, input.analysisId, bi.output.proposals) : 0;
  if (learns) {
    step({
      step: "learn_business", capability: "business_intelligence", status: proposed === null ? "failed" : "done",
      detail: proposed === null ? `${bi.output.proposals.length} details found on the website could not be saved.` : `${bi.detail} ${proposed} new detail${proposed === 1 ? "" : "s"} saved for the owner to confirm.`,
    });
  }

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
        deadlineAt,
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
      log.warn("workflow.model_findings_failed", { workflowId, error });
      // Plain words only in the record: raw provider or database messages stay in the server log.
      step({
        step: "analyze_marketing_model", capability: "marketing_analysis", status: "failed",
        detail: error instanceof ModelBudgetExceeded ? "Skipped: the model usage limit for this business was reached." : "The model step did not complete; the other results are unaffected.",
      });
    }
  }

  // 7. Identify and rank needs (Marketing Analysis).
  step({
    step: "rank_needs", capability: "marketing_analysis", status: "done",
    detail: r.ranked.length ? `${r.ranked.length} needs ranked; first: ${r.ranked[0]!.title}.` : "Nothing needs attention right now.",
  });

  // 7b. Effort and order: which actions should come before others (fixed dependency rules, saved on the cards).
  const annotations = annotateCards(r.findings.map((f) => ({ id: f.check_key, check_key: f.check_key })))
    .map((a) => ({ check_key: a.id, effort: a.effort, depends_on: a.depends_on }));
  const ordered = annotations.filter((a) => a.depends_on.length).length;
  if (annotations.length) {
    let saved = true;
    try {
      const { error } = await db.rpc("annotate_action_cards", { p_analysis: input.analysisId, p_rows: annotations as unknown as Json });
      if (error) { saved = false; log.error("workflow.annotate_failed", { workflowId, error: error.message }); }
    } catch (error) {
      saved = false;
      log.error("workflow.annotate_failed", { workflowId, error });
    }
    step({
      step: "order_work", capability: "marketing_analysis", status: saved ? "done" : "failed",
      detail: saved
        ? `Effort set on ${annotations.length} action${annotations.length === 1 ? "" : "s"}; ${ordered} should wait for another one first.`
        : "Effort and order could not be saved; the recommendations themselves are unaffected.",
    });
  }

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

/**
 * Records a request whose required capability cannot run (for example, a homepage headline with no model to write it).
 * It never produces placeholder output. Kinds that can run have their own entry points (see handleRequest).
 */
export async function requestMarketingWork(
  db: WorkflowDb,
  input: { orgId: string; kind: WorkflowKind; request: string | null },
): Promise<WorkflowOutcome> {
  const plan = planWorkflow(input.kind, { modelProvider: getModelProvider() !== null });
  if (!plan.blocked) throw new Error(`"${input.kind}" can run; use its workflow.`);
  const steps: StepRecord[] = plan.steps.map((s) => ({
    step: s.capability, capability: s.capability, status: s.available ? "skipped" : "blocked",
    detail: s.reason ?? "Not run: the workflow is blocked.", at: now(),
  }));
  const workflowId = await openRecord(db, input.orgId, input.kind, input.request, plan.capabilities, null);
  await closeRecord(db, workflowId, "blocked", steps, null, plan.blocked);
  log.info("workflow.blocked", { workflowId, kind: input.kind, reason: plan.blocked });
  return { status: "blocked", workflowId, reason: plan.blocked, steps };
}

export interface ResearchOutcome {
  status: "prepared" | "failed";
  workflowId: string | null;
  reason?: string;
  steps: StepRecord[];
  read: number;
  failed: { host: string; failure: string }[];
}

/**
 * Competitor research (Market Research, no model): reads the owner's own homepage and the sites the owner named,
 * records what each visibly shows, and saves it for comparison. It never finds competitors on its own.
 */
export async function runCompetitorResearch(
  db: WorkflowDb,
  input: { orgId: string; ownWebsite: string; urls: string[] },
  deps: { fetchPage?: (url: string) => Promise<FetchedPage> } = {},
): Promise<ResearchOutcome> {
  const plan = planWorkflow("competitor_research", { modelProvider: getModelProvider() !== null });
  const steps: StepRecord[] = [];
  const step = (s: Omit<StepRecord, "at">) => steps.push({ ...s, at: now() });
  const workflowId = await openRecord(db, input.orgId, "competitor_research", null, plan.capabilities, null);
  const hostOf = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");

  const targets: { url: string; own: boolean }[] = [];
  const failed: ResearchOutcome["failed"] = [];
  const seen = new Set<string>();
  let ownHost = "";
  try {
    ownHost = hostOf(validateUrl(input.ownWebsite).toString());
    targets.push({ url: validateUrl(input.ownWebsite).toString(), own: true });
    seen.add(ownHost);
  } catch {
    /* the business's own address is checked elsewhere; research can still run on the others */
  }
  for (const raw of input.urls) {
    try {
      const u = validateUrl(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`).toString();
      const h = hostOf(u);
      if (seen.has(h)) continue;
      seen.add(h);
      targets.push({ url: u, own: false });
    } catch {
      failed.push({ host: raw.trim().slice(0, 80), failure: "That doesn't look like a public website address." });
    }
  }
  if (!targets.some((t) => !t.own)) {
    const reason = "Add at least one website to compare with.";
    step({ step: "choose_sites", capability: "market_research", status: "failed", detail: reason });
    await closeRecord(db, workflowId, "failed", steps, null, reason);
    return { status: "failed", workflowId, reason, steps, read: 0, failed };
  }
  step({ step: "plan", capability: null, status: "done", detail: `Reading ${targets.length} homepage${targets.length === 1 ? "" : "s"} (yours and ${targets.length - (targets.some((t) => t.own) ? 1 : 0)} you named).` });
  const run = expectDone(await MODULES.market_research.run({ targets, fetchPage: deps.fetchPage }), "market_research");
  let read = 0;
  for (const r of run.output) {
    const { error } = await db.rpc("save_competitor_scan", {
      p_org: input.orgId, p_url: r.url, p_host: r.host, p_status: r.status,
      p_signals: (r.signals ?? {}) as unknown as Json, p_failure: r.failure, p_is_self: r.own,
    });
    if (error) {
      if ((error as { hint?: string }).hint === "competitor_limit") {
        const reason = "You can compare up to 5 other websites. Remove one first.";
        step({ step: "save_research", capability: "market_research", status: "failed", detail: reason });
        await closeRecord(db, workflowId, "failed", steps, null, reason);
        return { status: "failed", workflowId, reason, steps, read, failed };
      }
      log.error("research.save_failed", { orgId: input.orgId, error: error.message });
      failed.push({ host: r.host, failure: "We couldn't save this one." });
      continue;
    }
    if (r.status === "done") { if (!r.own) read += 1; } else failed.push({ host: r.host, failure: r.failure ?? "We couldn't read it." });
  }
  step({ step: "read_sites", capability: "market_research", status: read ? "done" : "failed", detail: `${run.detail} Observed on the public homepages only.` });
  step({ step: "owner_review", capability: null, status: "waiting", detail: "Waiting for the owner to look at the comparison." });
  await closeRecord(db, workflowId, read ? "prepared" : "failed", steps, { read, failed: failed.length }, read ? null : "None of the sites could be read.");
  log.info("research.prepared", { workflowId, read, failed: failed.length });
  return { status: read ? "prepared" : "failed", workflowId, reason: read ? undefined : "We couldn't read any of those sites.", steps, read, failed };
}

export interface CampaignOutcome {
  status: "prepared" | "blocked" | "failed";
  workflowId: string | null;
  reason?: string;
  steps: StepRecord[];
  saved: number;
}

/**
 * Campaign planning (fixed playbooks, no model): proposes campaigns from what is known and observed. Each is saved as a
 * proposal; only the owner approves, and nothing is published or sent.
 */
export async function runCampaignPlanning(db: WorkflowDb, input: { orgId: string; campaign: CampaignInput }): Promise<CampaignOutcome> {
  const plan = planWorkflow("promotional_campaign", { modelProvider: getModelProvider() !== null });
  const steps: StepRecord[] = [];
  const step = (s: Omit<StepRecord, "at">) => steps.push({ ...s, at: now() });
  const workflowId = await openRecord(db, input.orgId, "promotional_campaign", null, plan.capabilities, null);
  const c = input.campaign;
  step({
    step: "gather", capability: "business_intelligence", status: "done",
    detail: `${c.cards.length} open recommendation${c.cards.length === 1 ? "" : "s"}, ${c.confirmedServices.length} confirmed service${c.confirmedServices.length === 1 ? "" : "s"}, ${c.competitors.length} site${c.competitors.length === 1 ? "" : "s"} compared.`,
  });
  const run = await MODULES.campaign_planning.run(c);
  if (run.status === "blocked") {
    step({ step: "plan_campaigns", capability: "campaign_planning", status: "blocked", detail: run.reason });
    await closeRecord(db, workflowId, "blocked", steps, null, run.reason);
    return { status: "blocked", workflowId, reason: run.reason, steps, saved: 0 };
  }
  let saved = 0;
  for (const campaign of run.output as Campaign[]) {
    const { error } = await db.rpc("save_campaign", { p_org: input.orgId, p_campaign: campaign as unknown as Json });
    if (error) { log.error("campaign.save_failed", { orgId: input.orgId, playbook: campaign.playbook, error: error.message }); continue; }
    saved += 1;
  }
  if (!saved) {
    const reason = "We couldn't save the campaigns. Please try again.";
    step({ step: "save_campaigns", capability: "campaign_planning", status: "failed", detail: reason });
    await closeRecord(db, workflowId, "failed", steps, null, reason);
    return { status: "failed", workflowId, reason, steps, saved };
  }
  step({ step: "plan_campaigns", capability: "campaign_planning", status: "done", detail: run.detail });
  step({ step: "owner_review", capability: null, status: "waiting", detail: "Waiting for the owner to approve, edit and carry out each task." });
  await closeRecord(db, workflowId, "prepared", steps, { campaigns: saved }, null);
  return { status: "prepared", workflowId, steps, saved };
}

// ─────────────────────────────────────────────────────────────────────────────
// Request understanding and the remaining workflows (§12.1–12.2). Every kind of request now runs through the orchestrator
// with its relevant context (context.ts) and is recorded in marketing_workflows.
// ─────────────────────────────────────────────────────────────────────────────

type AgentDb = Pick<Db, "rpc" | "from">;

/** Understands a request and plans the workflow it needs (capabilities, how each runs, what blocks it). */
export function routeRequest(text: string, env = { modelProvider: getModelProvider() !== null }): { understanding: RequestUnderstanding; plan: ReturnType<typeof planWorkflow> | null } {
  const understanding = understandRequest(text);
  return { understanding, plan: understanding.kind ? planWorkflow(understanding.kind, env) : null };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Missing business details in plain words, for workflow records the owner can read. */
const missingWords = (fields: FactField[]) => (fields.length ? fields.map((f) => (FACT_LABEL[f] ?? f).toLowerCase()).join(", ") : "nothing");

/** A next step from the owner's own keyword research: only fresh rows, only figures the source reported. */
export function keywordNextStep(keywords: NonNullable<AgentContext["research"]>["keywords"]): string | null {
  const fresh = keywords.filter((k) => !k.stale);
  const num = (k: (typeof fresh)[number], key: string) => (typeof k.metrics[key] === "number" ? (k.metrics[key] as number) : -1);
  const gsc = fresh.filter((k) => k.source === "search_console_export" && num(k, "impressions") > 0).sort((a, b) => num(b, "impressions") - num(a, "impressions")).slice(0, 2);
  if (gsc.length) {
    return `Google Search Console (${gsc[0]!.measured_on}) shows people find you most for “${gsc.map((k) => k.term.slice(0, 60)).join("” and “")}”. Make sure the page they land on answers that search clearly.`.slice(0, 300);
  }
  const sem = fresh.filter((k) => k.source === "semrush_export" && num(k, "volume") > 0).sort((a, b) => num(b, "volume") - num(a, "volume")).slice(0, 2);
  if (sem.length) {
    return `Your Semrush export (${sem[0]!.measured_on}, Semrush's estimates) lists “${sem.map((k) => k.term.slice(0, 60)).join("” and “")}” as the most searched. Check that a page on your site is clearly about each.`.slice(0, 300);
  }
  return null;
}

export type PlanOutcome =
  | { status: "prepared"; workflowId: string | null; steps: StepRecord[]; by: "rules" | "model"; priorities: number }
  | { status: "failed"; workflowId: string | null; steps: StepRecord[]; reason: string; code: "no_analysis" | "no_open_actions" | "budget" | "invalid" | "error" };

/**
 * Marketing plan (§7): Business Intelligence (+ previous decisions) → Market Research (what is in the Research Library) →
 * Website Intelligence (the latest check) → Marketing Analysis (open actions with effort and order) → Marketing Strategy
 * (a model when one is configured, otherwise fixed rules, labelled as such) → saved as a proposal the owner decides on.
 */
export async function runMarketingPlan(
  db: AgentDb,
  input: { orgId: string; profile: OwnerProfile; notes: string | null; request?: string | null },
  deps: { provider?: (workflowId: string | null) => ModelProvider | null; deadlineAt?: number; now?: number } = {},
): Promise<PlanOutcome> {
  const plan = planWorkflow("marketing_plan", { modelProvider: getModelProvider() !== null });
  const steps: StepRecord[] = [];
  const step = (s: Omit<StepRecord, "at">) => steps.push({ ...s, at: now() });
  const workflowId = await openRecord(db, input.orgId, "marketing_plan", input.request ?? null, plan.capabilities, null);
  const fail = async (code: Extract<PlanOutcome, { status: "failed" }>["code"], reason: string, capability: CapabilityId | null, stepName: string): Promise<PlanOutcome> => {
    step({ step: stepName, capability, status: "failed", detail: reason });
    await closeRecord(db, workflowId, "failed", steps, null, reason);
    return { status: "failed", workflowId, steps, reason, code };
  };

  const ctx = await loadAgentContext(db, input.orgId, input.profile, "marketing_plan", deps.now);
  const u = ctx.understanding!;
  step({ step: "understand_business", capability: "business_intelligence", status: "done", detail: `${plural(u.known.length, "confirmed or proposed detail")}; missing: ${missingWords(u.missing)}. ${plural(ctx.decisions!.dismissed.length, "earlier dismissed action")} remembered.` });
  const r = ctx.research!;
  step({
    step: "research", capability: "market_research", status: "done",
    detail: `Research Library: ${plural(r.competitors.filter((c) => !c.is_self).length, "compared site")}, ${plural(r.keywords.length, "keyword")}${r.staleCount ? `; ${r.staleCount} older than ${RESEARCH_STALE_DAYS} days, not treated as current` : ""}.`,
  });
  if (!ctx.latestAnalysis) return fail("no_analysis", "Check your website first. The plan builds on what we find.", "website_intelligence", "review_website");
  step({ step: "review_website", capability: "website_intelligence", status: "done", detail: `Using the website check from ${ctx.latestAnalysis.completed_at.slice(0, 10)}.` });
  const open = ctx.openCards!.filter((c) => c.status !== "done");
  if (!open.length) return fail("no_open_actions", "There's nothing open to plan around right now.", "marketing_analysis", "analyze_marketing");
  step({ step: "analyze_marketing", capability: "marketing_analysis", status: "done", detail: `${plural(open.length, "open action")}; ${open.filter((c) => c.depends_on?.length).length} should wait for another first.` });

  const provider = deps.provider?.(workflowId) ?? null;
  let stored: Json;
  let by: { provider: string; model: string };
  let n = 0;
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  try {
    if (provider) {
      const result = await createPlan(provider, {
        businessName: input.profile.businessName, serviceArea: input.profile.serviceArea, primaryGoal: input.profile.primaryGoal, known: u.known,
        cards: open.map((c) => ({
          id: c.id, title: c.title, why_it_matters: c.why_it_matters, recommended_action: c.recommended_action,
          impact: c.impact_priority, confidence: c.confidence, evidence_class: c.evidence_class ?? "unknown", stage: c.stage as "prepared" | "approved",
        })),
        ownerNotes: input.notes,
        deadlineAt: deps.deadlineAt,
      });
      stored = result.plan as unknown as Json;
      by = { provider: result.provider, model: result.model };
      usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
      n = result.plan.priorities.length;
    } else {
      const rules = buildRulesPlan({
        businessName: input.profile.businessName, primaryGoal: input.profile.primaryGoal, missing: u.missing,
        cards: open.map((c) => ({
          id: c.id, check_key: c.check_key, title: c.title, why_it_matters: c.why_it_matters, recommended_action: c.recommended_action,
          impact: c.impact_priority, confidence: c.confidence, evidence_class: c.evidence_class ?? "unknown", depends_on: c.depends_on ?? [],
        })),
        memory: { dismissedChecks: ctx.decisions!.dismissed.map((d) => d.check_key).filter((k): k is string => Boolean(k)), staleResearch: r.staleCount },
      });
      if (!rules) return fail("no_open_actions", "There's nothing open to plan around right now.", "marketing_strategy", "plan_strategy");
      const research = keywordNextStep(r.keywords);
      if (research && rules.next_steps.length < 5) rules.next_steps.push(research);
      stored = rules as unknown as Json;
      by = { provider: RULES_PROVIDER, model: RULES_MODEL };
      n = rules.priorities.length;
    }
  } catch (e) {
    log.error("plan.failed", { orgId: input.orgId, workflowId, error: e });
    if (e instanceof ModelBudgetExceeded) return fail("budget", "Planning has reached its usage limit for now. Please try again later.", "marketing_strategy", "plan_strategy");
    if (e instanceof PlanRejected || e instanceof ModelOutputInvalid) return fail("invalid", "We couldn't prepare a usable plan this time. Please try again.", "marketing_strategy", "plan_strategy");
    return fail("error", "We couldn't prepare the plan. Please try again.", "marketing_strategy", "plan_strategy");
  }
  step({
    step: "plan_strategy", capability: "marketing_strategy", status: "done",
    detail: provider ? `Proposed ${plural(n, "priority", "priorities")} with the model.` : `Ordered ${plural(n, "priority", "priorities")} with fixed rules (impact, evidence, effort, order, goal, earlier decisions); no written analysis.`,
  });
  const { error } = await db.rpc("save_marketing_plan", { p_org: input.orgId, p_analysis: ctx.latestAnalysis.id, p_plan: stored, p_provider: by.provider, p_model: by.model });
  if (error) {
    log.error("plan.save_failed", { orgId: input.orgId, error: error.message });
    return fail("error", "We couldn't save the plan. Please try again.", "marketing_strategy", "save_plan");
  }
  step({ step: "owner_review", capability: null, status: "waiting", detail: "Waiting for the owner to approve or reject the plan." });
  await closeRecord(db, workflowId, "prepared", steps, { priorities: n, by: provider ? "model" : "rules", analysis_id: ctx.latestAnalysis.id }, null,
    usage ? { provider: by.provider, model: by.model, usage } : null);
  return { status: "prepared", workflowId, steps, by: provider ? "model" : "rules", priorities: n };
}

export interface ResultsReview {
  summary: PerformanceSummary;
  follow_ups: FollowUp[];
  next_action: { card_id: string; title: string; why: string } | null;
  plan_progress: { plan_id: string; total: number; completed: number } | null;
  reviewed_at: string;
}

/**
 * Results review (§11): Performance Intelligence (outcomes, executed work, supplied figures) → Marketing Analysis (what
 * needs another look) → Marketing Strategy (the next action by the same fixed rules as the plan, and progress on the
 * approved plan). Uses only real data; with none it says so and asks for it.
 */
export async function runResultsReview(
  db: AgentDb,
  input: { orgId: string; profile: OwnerProfile; request?: string | null },
  deps: { now?: number } = {},
): Promise<{ status: "prepared"; workflowId: string | null; steps: StepRecord[]; review: ResultsReview }> {
  const plan = planWorkflow("results_review", { modelProvider: getModelProvider() !== null });
  const steps: StepRecord[] = [];
  const step = (s: Omit<StepRecord, "at">) => steps.push({ ...s, at: now() });
  const workflowId = await openRecord(db, input.orgId, "results_review", input.request ?? null, plan.capabilities, null);
  const ctx = await loadAgentContext(db, input.orgId, input.profile, "results_review", deps.now);

  const perf = expectDone(await MODULES.performance_intelligence.run({ cards: ctx.trackedCards!, metrics: ctx.performance!.metrics, executions: ctx.performance!.executions }), "performance_intelligence");
  step({ step: "measure", capability: "performance_intelligence", status: "done", detail: perf.detail });

  const stillFound = ctx.trackedCards!.filter((c) => c.verification === "still_found").map((c) => ({ id: c.id, title: c.title }));
  const follow = followUps({ summary: perf.output, stillFound });
  step({ step: "analyze_results", capability: "marketing_analysis", status: "done", detail: `${plural(follow.length, "follow-up")}: ${follow.map((f) => f.kind).join(", ") || "none"}.` });

  const open = ctx.openCards!.filter((c) => c.status !== "done");
  const dismissed = ctx.decisions!.dismissed.map((d) => d.check_key).filter((k): k is string => Boolean(k));
  const rules = open.length ? buildRulesPlan({
    businessName: input.profile.businessName, primaryGoal: input.profile.primaryGoal, missing: [],
    cards: open.map((c) => ({ id: c.id, check_key: c.check_key, title: c.title, why_it_matters: c.why_it_matters, recommended_action: c.recommended_action, impact: c.impact_priority, confidence: c.confidence, evidence_class: c.evidence_class ?? "unknown", depends_on: c.depends_on ?? [] })),
    memory: { dismissedChecks: dismissed },
  }) : null;
  const first = rules?.priorities[0];
  const firstCard = first ? open.find((c) => c.id === first.card_id)! : null;
  const next_action = first && firstCard ? { card_id: first.card_id, title: firstCard.title, why: first.why_now } : null;

  let plan_progress: ResultsReview["plan_progress"] = null;
  const approved = ctx.approvedPlan;
  const priorities = (approved?.plan as { priorities?: { card_id: string }[] } | null)?.priorities ?? [];
  if (approved && priorities.length) {
    const doneIds = new Set(ctx.trackedCards!.filter((c) => c.stage === "completed").map((c) => c.id));
    plan_progress = { plan_id: approved.id, total: priorities.length, completed: priorities.filter((p) => doneIds.has(p.card_id)).length };
  }
  step({
    step: "next_action", capability: "marketing_strategy", status: "done",
    detail: `${next_action ? `Next: ${next_action.title}` : "Nothing open right now"} (fixed rules).${plan_progress ? ` Approved plan: ${plan_progress.completed} of ${plan_progress.total} done.` : ""}`,
  });

  const review: ResultsReview = { summary: perf.output, follow_ups: follow, next_action, plan_progress, reviewed_at: now() };
  await closeRecord(db, workflowId, "prepared", steps, review, null);
  return { status: "prepared", workflowId, steps, review };
}

export type HeadlineOutcome = {
  status: "prepared" | "blocked" | "failed";
  workflowId: string | null;
  steps: StepRecord[];
  reason?: string;
  /** The action the headline work belongs to, where a draft is prepared and approved. */
  card: { id: string; title: string } | null;
};

const HEADLINE_CHECK = /^(content\.h1_missing|content\.thin_homepage|model\.(headline|value|messag))/;

/**
 * Homepage headline (§12.2): Business Intelligence → Website Intelligence (the latest check) → Marketing Analysis (the
 * homepage messaging action, with its evidence) → Content Creation (a draft on that action). Content Creation needs a
 * model; without one the workflow stops there and says so. Nothing is written by a stand-in.
 */
export async function runHomepageHeadline(
  db: AgentDb,
  input: { orgId: string; profile: OwnerProfile; request?: string | null },
  deps: { draftsEnabled: boolean; now?: number },
): Promise<HeadlineOutcome> {
  const hasModel = getModelProvider() !== null;
  const plan = planWorkflow("homepage_headline", { modelProvider: hasModel });
  const steps: StepRecord[] = [];
  const step = (s: Omit<StepRecord, "at">) => steps.push({ ...s, at: now() });
  const workflowId = await openRecord(db, input.orgId, "homepage_headline", input.request ?? null, plan.capabilities, null);
  const ctx = await loadAgentContext(db, input.orgId, input.profile, "homepage_headline", deps.now);
  const u = ctx.understanding!;
  step({ step: "understand_business", capability: "business_intelligence", status: "done", detail: `${plural(u.known.length, "detail")} known; missing: ${missingWords(u.missing)}.` });
  if (!ctx.latestAnalysis) {
    const reason = "Check your website first. The headline work starts from what is on your homepage now.";
    step({ step: "review_website", capability: "website_intelligence", status: "failed", detail: reason });
    await closeRecord(db, workflowId, "failed", steps, null, reason);
    return { status: "failed", workflowId, steps, reason, card: null };
  }
  step({ step: "review_website", capability: "website_intelligence", status: "done", detail: `Using the homepage as read on ${ctx.latestAnalysis.completed_at.slice(0, 10)}.` });
  const card = ctx.openCards!.find((c) => c.status !== "done" && (c.execution_type === "page_copy" || (c.check_key !== null && HEADLINE_CHECK.test(c.check_key))));
  if (!card) {
    step({ step: "analyze_marketing", capability: "marketing_analysis", status: "done", detail: "The latest check found nothing about the homepage headline that needs attention." });
    await closeRecord(db, workflowId, "prepared", steps, { card: null, finding: "none" }, null);
    return { status: "prepared", workflowId, steps, card: null };
  }
  step({ step: "analyze_marketing", capability: "marketing_analysis", status: "done", detail: `Homepage messaging action: ${card.title}.` });
  const ref = { id: card.id, title: card.title };
  const draftable = card.execution_type === "page_copy";
  if (!hasModel || !deps.draftsEnabled || !draftable) {
    const reason = !hasModel
      ? "We can't write new headlines yet, so nothing was written. What we found, and the evidence, are on the action."
      : !draftable ? "This action needs a change only you or your web designer can make." : "Drafts are switched off here.";
    step({ step: "create_content", capability: "content_creation", status: "blocked", detail: reason });
    await closeRecord(db, workflowId, "blocked", steps, { card: ref }, reason);
    return { status: "blocked", workflowId, steps, reason, card: ref };
  }
  step({ step: "create_content", capability: "content_creation", status: "waiting", detail: "Ready to prepare a draft on that action when the owner asks for one." });
  await closeRecord(db, workflowId, "prepared", steps, { card: ref }, null);
  return { status: "prepared", workflowId, steps, card: ref };
}

export interface CampaignDraftsOutcome {
  status: "prepared" | "blocked" | "failed";
  workflowId: string | null;
  steps: StepRecord[];
  written: number;
  rejected: number;
  reason?: string;
}

/**
 * Content Creation for a campaign (§8.4–8.6): writes a draft for each task that has a channel (page, email, social, Google
 * post, text), from the business understanding and the campaign brief, through the metered model. Drafts are stored beside
 * the fixed template (save_task_model_draft) for the owner to edit and use; nothing is sent or published. Without a model
 * it is recorded as blocked and the templates remain.
 */
export async function runCampaignDrafts(
  db: AgentDb,
  input: { orgId: string; campaignId: string; profile: OwnerProfile; notes?: string | null },
  deps: { provider?: (workflowId: string | null) => ModelProvider | null; deadlineAt?: number },
): Promise<CampaignDraftsOutcome> {
  const plan = planWorkflow("promotional_campaign", { modelProvider: getModelProvider() !== null });
  const steps: StepRecord[] = [];
  const step = (s: Omit<StepRecord, "at">) => steps.push({ ...s, at: now() });
  const workflowId = await openRecord(db, input.orgId, "promotional_campaign", "Write the campaign drafts", [...plan.capabilities, "content_creation"], null);
  const finish = async (status: CampaignDraftsOutcome["status"], written: number, rejected: number, reason?: string): Promise<CampaignDraftsOutcome> => {
    await closeRecord(db, workflowId, status, steps, status === "prepared" ? { campaign_id: input.campaignId, written, rejected } : null, reason ?? null);
    return { status, workflowId, steps, written, rejected, reason };
  };

  const [{ data: campaign }, { data: tasks }] = await Promise.all([
    db.from("marketing_campaigns").select("id, status, brief, title").eq("id", input.campaignId).eq("organization_id", input.orgId).maybeSingle(),
    db.from("campaign_tasks").select("id, position, title, why, channel, deliverable, status").eq("campaign_id", input.campaignId).order("position", { ascending: true }),
  ]);
  if (!campaign || campaign.status === "dismissed") {
    step({ step: "load_campaign", capability: "campaign_planning", status: "failed", detail: "That campaign isn't open." });
    return finish("failed", 0, 0, "That campaign isn't open.");
  }
  const brief = (campaign.brief ?? null) as { objective: string; audience: string | null; offer: string | null; core_message: string } | null;
  const writable = (tasks ?? []).filter((t) => isChannelKind(t.channel) && t.status !== "done" && t.status !== "skipped");
  if (!brief || !writable.length) {
    step({ step: "load_campaign", capability: "campaign_planning", status: "done", detail: "Nothing in this campaign needs a written draft." });
    return finish("prepared", 0, 0);
  }
  const ctx = await loadAgentContext(db, input.orgId, input.profile, "promotional_campaign");
  step({ step: "understand_business", capability: "business_intelligence", status: "done", detail: `${plural(ctx.understanding!.known.length, "detail")} known; missing: ${missingWords(ctx.understanding!.missing)}.` });

  const provider = deps.provider?.(workflowId) ?? null;
  if (!provider) {
    const reason = "We can't write these drafts yet; the templates are ready to edit.";
    step({ step: "create_content", capability: "content_creation", status: "blocked", detail: reason });
    return finish("blocked", 0, 0, reason);
  }
  let written = 0;
  let rejected = 0;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  for (const t of writable) {
    try {
      const d = await createTaskDraft(provider, {
        channel: t.channel as ChannelKind, businessName: input.profile.businessName, known: ctx.understanding!.known,
        brief, task: { title: t.title, why: t.why }, template: t.deliverable, ownerNotes: input.notes ?? null, deadlineAt: deps.deadlineAt,
      });
      usage = { inputTokens: usage.inputTokens + d.usage.inputTokens, outputTokens: usage.outputTokens + d.usage.outputTokens };
      model = d.model;
      const { error } = await db.rpc("save_task_model_draft", { p_task: t.id, p_text: d.text, p_provider: d.provider, p_model: d.model });
      if (error) throw new Error(`save_task_model_draft: ${error.message}`);
      written += 1;
      step({ step: `draft_${t.position}`, capability: "content_creation", status: "done", detail: `Wrote “${t.title.slice(0, 80)}”.` });
    } catch (error) {
      rejected += 1;
      log.warn("campaign.draft_failed", { workflowId, task: t.id, error });
      const plain = error instanceof ContentRejected ? error.message : error instanceof ModelBudgetExceeded ? "The usage limit for this business was reached." : "This draft didn't finish; the template is still there.";
      step({ step: `draft_${t.position}`, capability: "content_creation", status: "failed", detail: `“${t.title.slice(0, 80)}”: ${plain}` });
      if (error instanceof ModelBudgetExceeded) break;
    }
  }
  step({ step: "owner_review", capability: null, status: "waiting", detail: "Waiting for the owner to edit and use the drafts. Nothing is sent or published." });
  await closeRecord(db, workflowId, written ? "prepared" : "failed", steps, written ? { campaign_id: input.campaignId, written, rejected } : null,
    written ? null : "No draft passed the checks.", model ? { provider: provider.id, model, usage } : null);
  return { status: written ? "prepared" : "failed", workflowId, steps, written, rejected, reason: written ? undefined : "No draft passed the checks." };
}
