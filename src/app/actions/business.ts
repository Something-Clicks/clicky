"use server";

import { revalidatePath } from "next/cache";

import { FACT_FIELDS, type FactCategory } from "@/lib/business-profile";
import { FEATURES } from "@/config/features";
import { getWorkspace } from "@/lib/auth";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f-]{36}$/i;

/** The owner confirms, corrects or rejects a detail the Marketing Agent proposed. */
export async function reviewFact(form: FormData): Promise<void> {
  if (!FEATURES.businessProfile) return;
  const ws = await getWorkspace();
  const id = String(form.get("id") ?? "");
  const decision = String(form.get("decision") ?? "");
  const value = String(form.get("value") ?? "").trim().slice(0, 500) || null;
  if (!ws.organization || ws.organization.role !== "owner" || !UUID.test(id) || !["confirm", "reject"].includes(decision)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_business_fact", { p_fact: id, p_decision: decision, p_value: value });
  if (error && !["already_reviewed", "owner_only"].includes((error as { hint?: string }).hint ?? "")) {
    log.error("business_fact.review_failed", { id, error: error.message });
  }
  revalidatePath("/app/business");
}

/** The owner adds a detail directly. */
export async function addFact(form: FormData): Promise<void> {
  if (!FEATURES.businessProfile) return;
  const ws = await getWorkspace();
  const [category, field] = String(form.get("field") ?? "").split(".");
  const value = String(form.get("value") ?? "").trim().slice(0, 500);
  const valid = category && field && Object.hasOwn(FACT_FIELDS, category) && (FACT_FIELDS[category as FactCategory] as readonly string[]).includes(field);
  if (!ws.organization || ws.organization.role !== "owner" || !valid || !value) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_business_fact", { p_org: ws.organization.id, p_category: category!, p_field: field!, p_value: value });
  if (error && (error as { hint?: string }).hint !== "duplicate") log.error("business_fact.add_failed", { error: error.message });
  revalidatePath("/app/business");
}
