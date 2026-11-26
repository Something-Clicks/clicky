"use server";

import { revalidatePath } from "next/cache";

import { FEATURES } from "@/config/features";
import { getWorkspace } from "@/lib/auth";
import { log } from "@/lib/log";
import { deadlineMs, REQUEST_DEADLINE_MS } from "@/lib/server/agent/deadline";
import { planThroughAgent } from "@/lib/server/agent/plan-run";
import { getModelProvider } from "@/lib/server/agent/provider";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

const UUID = /^[0-9a-f-]{36}$/i;
/** A plan request must be finished well inside the page's 120 s limit. */

/**
 * Prepares a proposed marketing plan (Marketing Strategy), or a revised one when the owner adds notes.
 * Runs as the signed-in user; nothing is applied: the plan waits for the owner to approve or reject it.
 * With no model configured (today) the plan is built by fixed rules and free-text notes are not used; with a model,
 * every call is metered per business.
 */
export async function preparePlan(_prev: FormState, form: FormData): Promise<FormState> {
  const deadlineAt = Date.now() + deadlineMs(REQUEST_DEADLINE_MS); // counted from the start of the request
  if (!FEATURES.strategy) return { error: "Plans aren't available yet." };
  const ws = await getWorkspace();
  if (!ws.organization || !ws.business) return { error: "Please finish setting up your business first." };
  const rawProvider = getModelProvider();
  // Fixed rules cannot read free text: without a model, notes are ignored (and the screen does not offer them).
  const notes = rawProvider ? String(form.get("notes") ?? "").trim().slice(0, 600) || null : null;
  const out = await planThroughAgent(ws.organization.id, ws.business, notes, deadlineAt, null);
  if (out.error) return out;
  revalidatePath("/app/plan");
  return { ok: true, message: notes ? "Here's the revised plan." : "Here's your plan." };
}

/** The owner approves or rejects a proposed plan. Approval means agreement, not that any work is done. */
export async function decidePlan(form: FormData): Promise<void> {
  if (!FEATURES.strategy) return;
  const ws = await getWorkspace();
  const id = String(form.get("id") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (!ws.organization || ws.organization.role !== "owner" || !UUID.test(id) || !["approved", "rejected"].includes(decision)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_marketing_plan", { p_plan: id, p_decision: decision });
  if (error && !["already_decided", "owner_only"].includes((error as { hint?: string }).hint ?? "")) log.error("plan.decide_failed", { id, error: error.message });
  revalidatePath("/app/plan");
}
