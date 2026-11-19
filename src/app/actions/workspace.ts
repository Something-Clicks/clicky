"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getWorkspace, requireUser } from "@/lib/auth";
import { clearStartFlow, getStartFlow } from "@/lib/start-flow";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import {
  businessSchema,
  fieldErrors,
  formFields,
  profileSchema,
  settingsBusinessSchema,
  type FormState,
} from "@/lib/validation";

const GENERIC = "Something went wrong saving that. Please try again.";

/**
 * Onboarding "Business setup": creates the organization the first time, and
 * updates the same four fields afterwards (owner only).
 */
export async function saveBusinessSetup(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const values = formFields(form, ["businessName", "website", "serviceArea", "primaryGoal"]);
  const parsed = businessSchema.safeParse({ ...values, primaryGoal: values.primaryGoal || null });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const workspace = await getWorkspace();
  const supabase = await createClient();

  if (workspace.organization) {
    if (workspace.organization.role !== "owner") {
      return { error: "Only the account owner can change the business setup.", values };
    }
    const { data, error } = await supabase
      .from("business_profiles")
      .update({
        business_name: parsed.data.businessName,
        website: parsed.data.website,
        service_area: parsed.data.serviceArea,
        primary_goal: parsed.data.primaryGoal,
      })
      .eq("organization_id", workspace.organization.id)
      .select("organization_id");
    if (error || !data?.length) {
      log.error("business_profile.update_failed", {
        userId: user.id,
        organizationId: workspace.organization.id,
        error: error?.message ?? "no rows updated",
      });
      return { error: GENERIC, values };
    }
    revalidatePath("/app", "layout");
    redirect("/app");
  }

  const { data, error } = await supabase.rpc("create_organization", {
    p_business_name: parsed.data.businessName,
    p_website: parsed.data.website ?? "",
    p_service_area: parsed.data.serviceArea ?? "",
    p_primary_goal: parsed.data.primaryGoal ?? "",
  });
  if (error) {
    log.error("organization.create_failed", { userId: user.id, code: error.code, error: error.message });
    return { error: GENERIC, values };
  }
  log.info("organization.created", { userId: user.id, organizationId: data });
  if (await getStartFlow()) {
    await clearStartFlow();
    redirect("/app/billing?plan=diagnostic_audit");
  }
  redirect(parsed.data.website ? "/app/connections?onboarding=1" : "/app");
}

export async function updateProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const values = formFields(form, ["fullName"]);
  const parsed = profileSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", user.id);
  if (error) {
    log.error("profile.update_failed", { userId: user.id, error: error.message });
    return { error: GENERIC, values };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Saved.", values };
}

export async function updateBusiness(_prev: FormState, form: FormData): Promise<FormState> {
  const workspace = await getWorkspace();
  const values = formFields(form, ["businessName", "website"]);
  if (!workspace.organization) redirect("/app/onboarding");
  if (workspace.organization.role !== "owner") {
    return { error: "Only the account owner can change the business profile.", values };
  }
  const parsed = settingsBusinessSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const recurring = form.get("recurring") === "on";
  const { error: orgError } = await supabase
    .from("organizations")
    .update({ recurring_analysis: recurring })
    .eq("id", workspace.organization.id);
  if (orgError) log.error("organization.recurring_update_failed", { organizationId: workspace.organization.id, error: orgError.message });
  const { data, error } = await supabase
    .from("business_profiles")
    .update({ business_name: parsed.data.businessName, website: parsed.data.website })
    .eq("organization_id", workspace.organization.id)
    .select("organization_id");
  if (error || !data?.length) {
    log.error("business_profile.update_failed", {
      userId: workspace.userId,
      organizationId: workspace.organization.id,
      error: error?.message ?? "no rows updated",
    });
    return { error: GENERIC, values };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Saved.", values };
}

export async function updateNotifications(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const supabase = await createClient();
  const prefs = { draft_ready: form.get("draft_ready") === "on", analysis_complete: form.get("analysis_complete") === "on" };
  // Update first; create the row only if this person has none yet. (Only the two
  // preference columns are updatable, so a plain upsert is not allowed.)
  const { data: updated, error: updateError } = await supabase
    .from("notification_preferences")
    .update(prefs)
    .eq("user_id", user.id)
    .select("user_id");
  let error = updateError;
  if (!updateError && !updated?.length) {
    ({ error } = await supabase.from("notification_preferences").insert({ user_id: user.id, ...prefs }));
  }
  if (error) {
    log.error("notifications.update_failed", { userId: user.id, error: error.message });
    return { error: GENERIC };
  }
  return { ok: true, message: "Saved." };
}
