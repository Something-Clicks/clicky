import "server-only";

import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

import { meteredProvider } from "./metering";
import { runCampaignDrafts } from "./orchestrator";
import { getModelProvider } from "./provider";

/**
 * Runs the campaign-drafts workflow as the signed-in member, holding a one-at-a-time slot for the business, with every model
 * call metered against the workflow. Server-only: never exported from a "use server" file (it takes an organization id).
 */
export async function writeCampaignDraftsFor(
  orgId: string,
  b: { businessName: string; website: string | null; serviceArea: string | null; primaryGoal: string | null },
  campaignId: string,
  deadlineAt: number,
): Promise<FormState> {
  const rawProvider = getModelProvider();
  if (!rawProvider) return { error: "We can't write these drafts yet. The templates are ready for you to edit." };
  const key = process.env.MODEL_USAGE_KEY?.trim();
  if (!key) return { error: "Drafts aren't switched on yet." };
  const supabase = await createClient();
  const { data: slot, error: slotError } = await supabase.rpc("acquire_agent_slot", { p_key: key, p_org: orgId, p_name: "content_creation.campaign", p_seconds: 300 });
  if (slotError || typeof slot !== "string") {
    return { error: (slotError as { hint?: string } | null)?.hint === "busy" ? "Your drafts are already being written. Give it a minute." : "We couldn't start. Please try again." };
  }
  try {
    const out = await runCampaignDrafts(supabase, {
      orgId, campaignId,
      profile: { businessName: b.businessName, website: b.website ?? "", serviceArea: b.serviceArea, primaryGoal: b.primaryGoal },
    }, {
      deadlineAt,
      provider: (workflowId) => meteredProvider(rawProvider, { db: supabase, orgId, capability: "content_creation.campaign", workflowId }),
    });
    log.info("campaign.drafts", { orgId, campaignId, status: out.status, written: out.written, rejected: out.rejected });
    if (out.status !== "prepared") return { error: out.reason ?? "We couldn't write the drafts this time." };
    return { ok: true, message: `Wrote ${out.written} draft${out.written === 1 ? "" : "s"}${out.rejected ? `; ${out.rejected} didn't pass our checks and kept the template` : ""}. Check every word before you use them.` };
  } finally {
    const { error } = await supabase.rpc("release_agent_slot", { p_key: key, p_org: orgId, p_name: "content_creation.campaign", p_token: slot });
    if (error) log.warn("campaign.drafts_slot_release_failed", { orgId, error: error.message });
  }
}
