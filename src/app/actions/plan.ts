"use server";

import { revalidatePath } from "next/cache";

import { FEATURES } from "@/config/features";
import { getWorkspace } from "@/lib/auth";
import { log } from "@/lib/log";
import { loadUnderstanding } from "@/lib/server/agent/context";
import { meteredProvider, ModelBudgetExceeded } from "@/lib/server/agent/metering";
import { createPlan, PlanRejected } from "@/lib/server/agent/modules/marketing-strategy";
import { getModelProvider, ModelOutputInvalid } from "@/lib/server/agent/provider";
import { cardStage } from "@/lib/stages";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import type { FormState } from "@/lib/validation";

const UUID = /^[0-9a-f-]{36}$/i;
/** A plan request must be finished well inside the page's 120 s limit. */
const REQUEST_DEADLINE_MS = 100_000;
const IMPACT = { high: 0, medium: 1, low: 2 } as const;
const LEVEL = (v: string) => IMPACT[v as keyof typeof IMPACT] ?? 3;

/**
 * Prepares a proposed marketing plan (Marketing Strategy), or a revised one when the owner adds notes.
 * Runs as the signed-in user; every model call is metered per business; nothing is applied: the plan
 * waits for the owner to approve or reject it.
 */
export async function preparePlan(_prev: FormState, form: FormData): Promise<FormState> {
  const deadlineAt = Date.now() + REQUEST_DEADLINE_MS; // counted from the start of the request
  if (!FEATURES.strategy) return { error: "Plans aren't available yet." };
  const ws = await getWorkspace();
  if (!ws.organization || !ws.business) return { error: "Please finish setting up your business first." };
  const notes = String(form.get("notes") ?? "").trim().slice(0, 600) || null;
  const rawProvider = getModelProvider();
  if (!rawProvider) return { error: "Plans aren't switched on yet." };
  const orgId = ws.organization.id;

  const supabase = await createClient();
  const { data: analysis } = await supabase
    .from("analyses")
    .select("id")
    .eq("organization_id", orgId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!analysis) return { error: "Check your website first. The plan builds on what we find." };

  const { data: rows } = await supabase
    .from("action_cards")
    .select("id, title, why_it_matters, recommended_action, impact_priority, confidence, evidence_class, status, verification")
    .eq("organization_id", orgId)
    .in("status", ["new", "approved", "in_progress"])
    .limit(100);
  const open = (rows ?? [])
    .filter((c) => cardStage(c) !== "completed")
    .sort((a, b) => LEVEL(a.impact_priority) - LEVEL(b.impact_priority) || LEVEL(a.confidence) - LEVEL(b.confidence));
  if (!open.length) return { error: "There's nothing open to plan around right now." };

  const b = ws.business;
  const profile = { businessName: b.businessName, website: b.website ?? "", serviceArea: b.serviceArea, primaryGoal: b.primaryGoal };
  const { understanding } = await loadUnderstanding(supabase, orgId, profile);

  // One plan at a time per business, atomically in the database for the whole request (a second click or a second tab is
  // told to wait). The slot expires on its own if this request dies.
  const key = process.env.MODEL_USAGE_KEY?.trim();
  if (!key) return { error: "Plans aren't switched on yet." };
  const { data: slot, error: slotError } = await supabase.rpc("acquire_agent_slot", { p_key: key, p_org: orgId, p_name: "marketing_strategy.plan", p_seconds: 150 });
  if (slotError || typeof slot !== "string") {
    return { error: (slotError as { hint?: string } | null)?.hint === "busy" ? "Your plan is already being prepared. Give it a minute." : "We couldn't start your plan. Please try again." };
  }

  try {
    const provider = meteredProvider(rawProvider, { db: supabase, orgId, capability: "marketing_strategy.plan" });
    const result = await createPlan(provider, {
      businessName: b.businessName,
      serviceArea: b.serviceArea,
      primaryGoal: b.primaryGoal,
      known: understanding.known,
      cards: open.map((c) => ({
        id: c.id, title: c.title, why_it_matters: c.why_it_matters, recommended_action: c.recommended_action,
        impact: c.impact_priority, confidence: c.confidence, evidence_class: c.evidence_class ?? "unknown", stage: cardStage(c),
      })),
      ownerNotes: notes,
      deadlineAt,
    });
    const { error } = await supabase.rpc("save_marketing_plan", {
      p_org: orgId, p_analysis: analysis.id, p_plan: result.plan as unknown as Json, p_provider: result.provider, p_model: result.model,
    });
    if (error) throw new Error(`save_marketing_plan: ${error.message}`);
    log.info("plan.proposed", { orgId, priorities: result.plan.priorities.length, dropped: result.rejected.length, revised: notes !== null, ...result.usage });
  } catch (e) {
    log.error("plan.failed", { orgId, error: e });
    if (e instanceof ModelBudgetExceeded) return { error: "Planning has reached its usage limit for now. Please try again later." };
    if (e instanceof PlanRejected || e instanceof ModelOutputInvalid) return { error: "We couldn't prepare a usable plan this time. Please try again." };
    return { error: "We couldn't prepare the plan. Please try again." };
  } finally {
    const { error: releaseError } = await supabase.rpc("release_agent_slot", { p_key: key, p_org: orgId, p_name: "marketing_strategy.plan", p_token: slot });
    if (releaseError) log.warn("plan.slot_release_failed", { orgId, error: releaseError.message });
  }
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
