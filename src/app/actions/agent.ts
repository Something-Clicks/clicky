"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { FEATURES } from "@/config/features";
import { getWorkspace } from "@/lib/auth";
import { log } from "@/lib/log";
import { isResearchSource, parseResearch } from "@/lib/research-import";
import { REQUEST_CHOICES, understandRequest } from "@/lib/server/agent/intake";
import { isExecutionAction } from "@/lib/server/agent/modules/marketing-execution";
import { isMetric } from "@/lib/server/agent/modules/performance-intelligence";
import { runHomepageHeadline, runResultsReview } from "@/lib/server/agent/orchestrator";
import { planThroughAgent } from "@/lib/server/agent/plan-run";
import { getModelProvider } from "@/lib/server/agent/provider";
import { isWorkflowKind, type WorkflowKind } from "@/lib/server/agent/workflows";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import type { FormState } from "@/lib/validation";

import { compareWebsites, prepareCampaigns } from "./campaigns";
import { startAnalysis } from "./intelligence";

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AskState extends FormState {
  /** Choices to offer when the request was unclear. */
  options?: { kind: WorkflowKind; label: string }[];
  request?: string;
}

/**
 * One request box for the whole Marketing Agent. The orchestrator understands the request (fixed rules; it asks when
 * unclear) and runs the workflow it needs, each of which is recorded. Nothing is published or sent from here.
 */
export async function ask(_prev: AskState, form: FormData): Promise<AskState> {
  if (!FEATURES.agent) return { error: "This isn't available yet." };
  const ws = await getWorkspace();
  if (!ws.organization || !ws.business) return { error: "Please finish setting up your business first." };
  const request = String(form.get("request") ?? "").trim().slice(0, 1000);
  const chosen = String(form.get("kind") ?? "");
  if (!request && !isWorkflowKind(chosen)) return { error: "Tell us what you'd like help with." };

  const understanding = understandRequest(request);
  const kind = isWorkflowKind(chosen) ? chosen : understanding.kind;
  if (!kind) {
    return { request, message: "Which of these do you mean?", options: understanding.options.map((k) => ({ kind: k, label: REQUEST_CHOICES[k] })) };
  }
  const orgId = ws.organization.id;
  const b = ws.business;
  const profile = { businessName: b.businessName, website: b.website ?? "", serviceArea: b.serviceArea, primaryGoal: b.primaryGoal };
  const supabase = await createClient();
  log.info("agent.request", { orgId, kind, confidence: isWorkflowKind(chosen) ? "chosen" : understanding.confidence });

  switch (kind) {
    case "website_review":
      return startAnalysis({});
    case "competitor_research": {
      if (!FEATURES.campaigns) return { error: "Comparing isn't available yet." };
      if (!understanding.urls.length) return { ok: true, redirectTo: "/app/research", message: "Name the websites to compare with." };
      const fd = new FormData();
      fd.set("sites", understanding.urls.join("\n"));
      const out = await compareWebsites({}, fd);
      return out.error ? out : { ...out, redirectTo: "/app/research" };
    }
    case "promotional_campaign": {
      if (!FEATURES.campaigns) return { error: "This isn't available yet." };
      const out = await prepareCampaigns({}, new FormData());
      return out.error ? out : { ...out, redirectTo: "/app/campaigns" };
    }
    case "marketing_plan": {
      if (!FEATURES.strategy) return { error: "Plans aren't available yet." };
      const out = await planThroughAgent(orgId, b, null, Date.now() + 100_000, request || null);
      revalidatePath("/app/plan");
      return out.error ? out : { ...out, redirectTo: "/app/plan" };
    }
    case "results_review": {
      await runResultsReview(supabase, { orgId, profile, request: request || null });
      revalidatePath("/app/results");
      return { ok: true, message: "Here's your results review.", redirectTo: "/app/results" };
    }
    case "homepage_headline": {
      const out = await runHomepageHeadline(supabase, { orgId, profile, request: request || null }, { draftsEnabled: FEATURES.drafts && getModelProvider() !== null });
      if (out.status === "failed") return { error: out.reason ?? "We couldn't look at your headline." };
      if (!out.card) return { ok: true, message: "Your latest website check didn't find a problem with your homepage headline." };
      return { ok: true, message: out.reason ?? "Here's the headline work.", redirectTo: `/app/actions/${out.card.id}` };
    }
  }
}

/** Results review on demand (Performance Intelligence → Marketing Analysis → Marketing Strategy). */
export async function reviewResults(_prev: FormState, _form: FormData): Promise<FormState> {
  if (!FEATURES.agent) return { error: "This isn't available yet." };
  const ws = await getWorkspace();
  if (!ws.organization || !ws.business) return { error: "Please finish setting up your business first." };
  const b = ws.business;
  const supabase = await createClient();
  await runResultsReview(supabase, { orgId: ws.organization.id, profile: { businessName: b.businessName, website: b.website ?? "", serviceArea: b.serviceArea, primaryGoal: b.primaryGoal } });
  revalidatePath("/app/results");
  return { ok: true, message: "Updated." };
}

/** Records one supplied figure for a period. Figures are the owner's; nothing is estimated. */
export async function recordMetric(_prev: FormState, form: FormData): Promise<FormState> {
  if (!FEATURES.agent) return { error: "This isn't available yet." };
  const ws = await getWorkspace();
  if (!ws.organization) return { error: "Please finish setting up your business first." };
  const metric = String(form.get("metric") ?? "");
  const start = String(form.get("period_start") ?? "");
  const end = String(form.get("period_end") ?? "");
  const raw = String(form.get("value") ?? "").trim().replace(/,/g, "");
  const value = Number(raw);
  const source = String(form.get("source") ?? "owner_entered");
  if (!isMetric(metric)) return { error: "Choose what you're recording." };
  if (!DATE.test(start) || !DATE.test(end) || end < start) return { error: "Choose the start and end of the period." };
  if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(value)) return { error: "Enter the number as a whole or decimal number." };
  if (!["owner_entered", "search_console_export", "analytics_export"].includes(source)) return { error: "Choose where the number comes from." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_performance_metrics", {
    p_org: ws.organization.id, p_source: source,
    p_rows: [{ metric, period_start: start, period_end: end, value, note: String(form.get("note") ?? "").slice(0, 300) || null }] as unknown as Json,
  });
  if (error) {
    const hint = (error as { hint?: string }).hint;
    if (hint === "future_period") return { error: "The period can't end in the future." };
    if (hint === "performance_limit") return { error: "You've saved the most numbers we keep (5,000). Remove some first." };
    log.error("performance.record_failed", { error: error.message });
    return { error: "We couldn't save that. Check the dates and the number." };
  }
  revalidatePath("/app/results");
  return { ok: true, message: "Saved." };
}

export async function removeMetric(form: FormData): Promise<void> {
  if (!FEATURES.agent) return;
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_performance_metric", { p_id: id });
  if (error) log.error("performance.remove_failed", { id, error: error.message });
  revalidatePath("/app/results");
}

/** Imports keyword research the owner exported (Semrush, Search Console) or typed. Parsed as data only. */
export async function importResearch(_prev: FormState, form: FormData): Promise<FormState> {
  if (!FEATURES.agent) return { error: "This isn't available yet." };
  const ws = await getWorkspace();
  if (!ws.organization) return { error: "Please finish setting up your business first." };
  const source = String(form.get("source") ?? "");
  const measuredOn = String(form.get("measured_on") ?? "");
  if (!isResearchSource(source)) return { error: "Choose where the keywords come from." };
  if (!DATE.test(measuredOn) || measuredOn > new Date().toISOString().slice(0, 10)) return { error: "Enter the date of the export (not in the future)." };
  let text = String(form.get("text") ?? "");
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 300_000) return { error: "The file is too large. Split it into smaller parts." };
    text = await file.text();
  }
  if (!text.trim()) return { error: "Paste the keywords or choose a file." };
  const parsed = parseResearch(text, source, measuredOn);
  if (!parsed.rows.length) return { error: parsed.skipped[0]?.reason ?? "We couldn't find any keywords in that." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_research_items", { p_org: ws.organization.id, p_source: source, p_measured_on: measuredOn, p_items: parsed.rows as unknown as Json });
  if (error) {
    if ((error as { hint?: string }).hint === "research_limit") return { error: "Your research library is full (2,000 keywords). Remove some first." };
    log.error("research.import_failed", { error: error.message });
    return { error: "We couldn't import that. Please try again." };
  }
  revalidatePath("/app/library");
  const detected = parsed.detected ? ` It looks like a ${parsed.detected === "search_console_export" ? "Search Console" : "Semrush"} export: check the source you chose.` : "";
  const skipped = parsed.skipped.length ? ` ${parsed.skipped.length} line${parsed.skipped.length === 1 ? "" : "s"} skipped.` : "";
  return { ok: true, message: `Imported ${data ?? parsed.rows.length} keyword${parsed.rows.length === 1 ? "" : "s"}.${skipped}${detected}` };
}

export async function removeResearch(form: FormData): Promise<void> {
  if (!FEATURES.agent) return;
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_research_item", { p_id: id });
  if (error) log.error("research.remove_item_failed", { id, error: error.message });
  revalidatePath("/app/library");
}

const EXEC_ERRORS: Record<string, string> = {
  needs_approved_draft: "Approve a draft first.",
  already_open: "This is already waiting.",
  owner_only: "Only the account owner can authorize this.",
  not_requested: "This isn't waiting for authorization any more.",
  not_authorized: "This hasn't been authorized.",
  daily_limit: "Too many requests today. Try again tomorrow.",
};

/** Any member asks for an action to be carried out; a repeated submit (same key) is the same request. */
export async function requestExecution(form: FormData): Promise<void> {
  if (!FEATURES.agent) return;
  const ws = await getWorkspace();
  const card = String(form.get("card") ?? "");
  const action = String(form.get("action") ?? "");
  const key = String(form.get("key") ?? "") || randomUUID();
  if (!ws.organization || !UUID.test(card) || !isExecutionAction(action)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_execution", {
    p_org: ws.organization.id, p_action: action, p_card: card, p_task: null, p_note: String(form.get("note") ?? "").slice(0, 500) || null, p_key: key.slice(0, 100),
  });
  if (error && !EXEC_ERRORS[(error as { hint?: string }).hint ?? ""]) log.error("execution.request_failed", { card, error: error.message });
  revalidatePath(`/app/actions/${card}`);
}

/** The owner authorizes; the application then carries it out (a separate, recorded event). */
export async function authorizeExecution(form: FormData): Promise<void> {
  if (!FEATURES.agent) return;
  const ws = await getWorkspace();
  const id = String(form.get("id") ?? "");
  const card = String(form.get("card") ?? "");
  if (!ws.organization || ws.organization.role !== "owner" || !UUID.test(id)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("authorize_execution", { p_id: id });
  if (error) {
    if (!EXEC_ERRORS[(error as { hint?: string }).hint ?? ""]) log.error("execution.authorize_failed", { id, error: error.message });
  } else {
    const { error: runError } = await supabase.rpc("execute_authorized", { p_id: id });
    if (runError) log.error("execution.run_failed", { id, error: runError.message });
  }
  if (UUID.test(card)) revalidatePath(`/app/actions/${card}`);
  revalidatePath("/app/results");
}

export async function cancelExecution(form: FormData): Promise<void> {
  if (!FEATURES.agent) return;
  const id = String(form.get("id") ?? "");
  const card = String(form.get("card") ?? "");
  if (!UUID.test(id)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_execution", { p_id: id });
  if (error && !(error as { hint?: string }).hint) log.error("execution.cancel_failed", { id, error: error.message });
  if (UUID.test(card)) revalidatePath(`/app/actions/${card}`);
}
