"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { FEATURES } from "@/config/features";
import { getWorkspace } from "@/lib/auth";
import { log } from "@/lib/log";
import { loadUnderstanding } from "@/lib/server/agent/context";
import { ContentRejected, createContent, isDraftKind, type DraftKind } from "@/lib/server/agent/modules/content-creation";
import { getModelProvider, ModelOutputInvalid } from "@/lib/server/agent/provider";
import { draftFailureMessage } from "@/lib/server/drafts";
import { notify } from "@/lib/server/notify";
import { track } from "@/lib/server/site";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import type { FormState } from "@/lib/validation";

const UUID = /^[0-9a-f-]{36}$/i;

const START_ERRORS: Record<string, string> = {
  needs_plan: "You've used your free uses. Choose a plan to keep getting drafts.",
  not_ai_capable: "This one needs a change only you or your web designer can make.",
  card_closed: "This action is already closed.",
  already_running: "A draft is already being prepared.",
  pending_approval: "A draft for this action is waiting for your review.",
  daily_limit: "You've prepared 20 drafts today. You can prepare more tomorrow.",
};

export async function prepareDraft(_prev: FormState, form: FormData): Promise<FormState> {
  if (!FEATURES.drafts) return { error: "Drafts aren't available yet." };
  const ws = await getWorkspace();
  const cardId = String(form.get("id") ?? "");
  const instructions = String(form.get("instructions") ?? "").trim().slice(0, 1000) || null;
  if (!ws.organization || !UUID.test(cardId)) return { error: "That action could not be found." };
  const provider = getModelProvider();
  if (!provider) return { error: "Drafts aren't switched on yet." };

  const supabase = await createClient();
  const { data: card } = await supabase
    .from("action_cards")
    .select("id, title, explanation, recommended_action, execution_type, action_card_evidence ( analysis_evidence ( observation, excerpt, url ) )")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return { error: "That action could not be found." };
  if (!isDraftKind(card.execution_type)) return { error: "This kind of draft isn't available yet." };

  const { data: ent } = await supabase.rpc("current_entitlements", { p_org: ws.organization.id });
  const drafts = (ent as { drafts?: string } | null)?.drafts ?? "none";
  const free = drafts === "none" || (drafts === "meta" && card.execution_type !== "meta");
  const { data: runId, error } = await supabase.rpc("start_agent_run", { p_card: cardId, p_instructions: instructions ?? "" });
  if (error || !runId) {
    const known = START_ERRORS[(error as { hint?: string } | null)?.hint ?? ""];
    if (!known) log.error("agent_run.start_failed", { cardId, error: error?.message });
    return { error: known ?? "We couldn't start preparing the draft. Please try again." };
  }

  const b = ws.business!;
  const profile = { businessName: b.businessName, website: b.website ?? "", serviceArea: b.serviceArea, primaryGoal: b.primaryGoal };
  const { understanding } = await loadUnderstanding(supabase, ws.organization.id, profile);
  const input = {
    kind: card.execution_type as DraftKind,
    businessName: b.businessName,
    known: understanding.known,
    card: { title: card.title, explanation: card.explanation, recommendedAction: card.recommended_action },
    evidence: card.action_card_evidence.map((x) => x.analysis_evidence).filter((e) => e !== null),
    ownerNotes: instructions,
  };
  log.info("agent_run.started", { organizationId: ws.organization.id, runId, draftType: input.kind, free, provider: provider.id });
  if (free) await track("free_use_consumed", { kind: "draft" });

  after(async () => {
    const started = Date.now();
    try {
      const draft = await createContent(provider, input);
      const { error: saveError } = await supabase.rpc("complete_agent_run", {
        p_run: runId,
        p_output: { fields: draft.fields } as unknown as Json,
        p_model: draft.model,
        p_usage: { input_tokens: draft.usage.inputTokens, output_tokens: draft.usage.outputTokens, provider: draft.provider } as unknown as Json,
      });
      if (saveError) throw new Error(saveError.message);
      log.info("agent_run.succeeded", { runId, ms: Date.now() - started, ...draft.usage });
      await track("draft_created", { type: input.kind });
      await notify(supabase, ws.organization!.id, b.businessName, "draft_ready");
    } catch (e) {
      log.error("agent_run.failed", { runId, ms: Date.now() - started, error: e });
      const reason = e instanceof ContentRejected ? e.message : e instanceof ModelOutputInvalid ? "We couldn't prepare a usable draft. Please try again." : draftFailureMessage(e);
      const { error: failError } = await supabase.rpc("fail_agent_run", { p_run: runId, p_reason: reason });
      if (failError) log.error("agent_run.fail_record_failed", { runId, error: failError.message });
    }
  });

  revalidatePath("/app", "layout");
  return { ok: true, message: "Preparing your draft. This usually takes under a minute." };
}

/** Saves an edit to a draft that is waiting for approval: a new version. Any member of the business. */
export async function editDraft(_prev: FormState, form: FormData): Promise<FormState> {
  if (!FEATURES.drafts) return { error: "Drafts aren't available yet." };
  const ws = await getWorkspace();
  const id = String(form.get("approval") ?? "");
  if (!ws.organization || !UUID.test(id)) return { error: "That draft could not be found." };
  const fields: { key: string; text: string }[] = [];
  for (const [name, value] of form.entries()) {
    if (name.startsWith("field:")) fields.push({ key: name.slice(6), text: String(value).slice(0, 8000) });
  }
  if (!fields.length || fields.some((f) => !f.text.trim())) return { error: "Every part of the draft needs some text." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_draft", { p_approval: id, p_fields: fields as unknown as Json });
  if (error) {
    const hint = (error as { hint?: string }).hint;
    if (hint !== "not_pending") log.error("draft.edit_failed", { id, error: error.message });
    return { error: hint === "not_pending" ? "This draft was already decided." : "We couldn't save your changes. Please try again." };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Saved as a new version." };
}

/** The owner approves one specific version. */
export async function approveDraftVersion(form: FormData): Promise<void> {
  if (!FEATURES.drafts) return;
  const ws = await getWorkspace();
  const approval = String(form.get("approval") ?? "");
  const version = String(form.get("version") ?? "");
  if (!ws.organization || ws.organization.role !== "owner" || !UUID.test(approval) || !UUID.test(version)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_draft_version", { p_approval: approval, p_version: version });
  if (error && !["already_decided", "owner_only"].includes((error as { hint?: string }).hint ?? "")) log.error("approval.version_failed", { approval, error: error.message });
  else if (!error) await track("draft_approved");
  revalidatePath("/app", "layout");
}

const DECISIONS = ["approved", "rejected", "changes_requested"] as const;

export async function decideApproval(_prev: FormState, form: FormData): Promise<FormState> {
  if (!FEATURES.drafts) return { error: "Drafts aren't available yet." };
  const ws = await getWorkspace();
  const id = String(form.get("id") ?? "");
  const decision = String(form.get("decision") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);
  if (!ws.organization || !UUID.test(id) || !DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
    return { error: "That draft could not be found." };
  }
  if (ws.organization.role !== "owner") return { error: "Only the account owner can approve drafts." };
  if (decision === "changes_requested" && !note) return { fieldErrors: { note: "Tell us what to change." } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_approval", { p_approval: id, p_decision: decision, p_note: note || null });
  if (error) {
    const hint = (error as { hint?: string }).hint;
    if (hint !== "already_decided" && hint !== "owner_only") log.error("approval.decide_failed", { id, error: error.message });
    return { error: hint === "already_decided" ? "This draft was already decided." : hint === "owner_only" ? "Only the account owner can approve drafts." : "We couldn't save your decision. Please try again." };
  }
  log.info("approval.decided", { id, decision, userId: ws.userId });
  if (decision === "approved") await track("draft_approved");
  revalidatePath("/app", "layout");
  const messages: Record<string, string> = {
    approved: "Approved. Copy or download it, use it, then mark the action done.",
    rejected: "Rejected. You can prepare a new draft any time.",
    changes_requested: "Noted. Prepare a new draft from the action to apply your changes.",
  };
  return { ok: true, message: messages[decision] };
}
