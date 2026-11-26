import "server-only";

import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

import { meteredProvider } from "./metering";
import { runMarketingPlan } from "./orchestrator";
import { getModelProvider } from "./provider";

/**
 * Runs the marketing_plan workflow through the orchestrator, holding the one-plan-at-a-time slot for the whole request
 * (a second click or a second tab is told to wait; the slot expires on its own if this request dies). With a model, every
 * call is metered per business and recorded against the workflow.
 */
export async function planThroughAgent(
  orgId: string,
  b: { businessName: string; website: string | null; serviceArea: string | null; primaryGoal: string | null },
  notes: string | null,
  deadlineAt: number,
  request: string | null,
): Promise<FormState> {
  const supabase = await createClient();
  const key = process.env.MODEL_USAGE_KEY?.trim();
  if (!key) return { error: "Plans aren't switched on yet." };
  const { data: slot, error: slotError } = await supabase.rpc("acquire_agent_slot", { p_key: key, p_org: orgId, p_name: "marketing_strategy.plan", p_seconds: 150 });
  if (slotError || typeof slot !== "string") {
    return { error: (slotError as { hint?: string } | null)?.hint === "busy" ? "Your plan is already being prepared. Give it a minute." : "We couldn't start your plan. Please try again." };
  }
  try {
    const rawProvider = getModelProvider();
    const profile = { businessName: b.businessName, website: b.website ?? "", serviceArea: b.serviceArea, primaryGoal: b.primaryGoal };
    const out = await runMarketingPlan(supabase, { orgId, profile, notes, request }, {
      deadlineAt,
      provider: rawProvider ? (workflowId) => meteredProvider(rawProvider, { db: supabase, orgId, capability: "marketing_strategy.plan", workflowId }) : undefined,
    });
    if (out.status === "failed") return { error: out.reason };
    log.info("plan.proposed", { orgId, by: out.by, priorities: out.priorities, revised: notes !== null });
    return { ok: true, message: "Here's your plan." };
  } finally {
    const { error: releaseError } = await supabase.rpc("release_agent_slot", { p_key: key, p_org: orgId, p_name: "marketing_strategy.plan", p_token: slot });
    if (releaseError) log.warn("plan.slot_release_failed", { orgId, error: releaseError.message });
  }
}

