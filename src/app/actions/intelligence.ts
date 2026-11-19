"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { getWorkspace } from "@/lib/auth";
import { log } from "@/lib/log";
import { runAnalysis } from "@/lib/server/analysis";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

const START_ERRORS: Record<string, string> = {
  already_running: "An analysis is already running. It usually takes about a minute.",
  daily_limit: "You've run 10 analyses today. You can run another tomorrow.",
  no_website: "Add your website first, then run the analysis.",
  needs_plan: "Your plan doesn't include another analysis. See Billing to choose a plan.",
};

export async function startAnalysis(_prev: FormState, _form?: FormData): Promise<FormState> {
  const ws = await getWorkspace();
  if (!ws.organization || !ws.business) return { error: "Finish your business setup first." };
  const supabase = await createClient();
  const { data: analysisId, error } = await supabase.rpc("start_analysis", { p_org: ws.organization.id });
  if (error || !analysisId) {
    const known = START_ERRORS[(error as { hint?: string } | null)?.hint ?? ""];
    if (!known) log.error("analysis.start_failed", { organizationId: ws.organization.id, error: error?.message });
    return { error: known ?? "We couldn't start the analysis. Please try again." };
  }
  const { data: profile } = await supabase
    .from("business_profiles")
    .select("website")
    .eq("organization_id", ws.organization.id)
    .single();
  const website = profile?.website ?? ws.business.website!;
  const biz = {
    businessName: ws.business.businessName,
    serviceArea: ws.business.serviceArea,
    primaryGoal: ws.business.primaryGoal,
  };
  log.info("analysis.started", { organizationId: ws.organization.id, analysisId });
  // The visitor gets an answer right away; the analysis keeps running on the server.
  after(() => runAnalysis(supabase, analysisId, website, biz, { notifyOrg: ws.organization!.id }));
  revalidatePath("/app", "layout");
  return { ok: true, message: "Analysis started. This usually takes about a minute." };
}

export async function setCardStatus(form: FormData): Promise<void> {
  const ws = await getWorkspace();
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  if (!ws.organization || !/^[0-9a-f-]{36}$/i.test(id) || !["done", "dismissed", "new"].includes(status)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_action_card_status", { p_card: id, p_status: status, p_note: null });
  if (error) log.error("action_card.status_failed", { cardId: id, error: error.message });
  revalidatePath("/app", "layout");
}
