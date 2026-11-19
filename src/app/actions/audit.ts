"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getUser, getWorkspace } from "@/lib/auth";
import { setStartFlow } from "@/lib/start-flow";
import { businessSchema, fieldErrors, formFields, type FormState } from "@/lib/validation";

const AuditSchema = businessSchema.pick({ businessName: true, website: true }).extend({
  primaryGoal: z.enum(["get_found", "more_calls", "understand", "not_sure"]),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
});

const GOAL_MAP: Record<string, string> = { get_found: "get_found", more_calls: "more_calls", understand: "easier_marketing", not_sure: "" };

/** Diagnostic Audit form → sign up → business setup → $39 checkout. */
export async function startAudit(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formFields(form, ["businessName", "website", "primaryGoal", "email"]);
  const parsed = AuditSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  await setStartFlow({
    businessName: parsed.data.businessName,
    website: parsed.data.website ?? "",
    primaryGoal: GOAL_MAP[parsed.data.primaryGoal] ?? "",
    email: parsed.data.email,
    plan: "diagnostic_audit",
  });
  if (await getUser()) {
    const ws = await getWorkspace();
    redirect(ws.organization ? "/app/billing?plan=diagnostic_audit" : "/app/onboarding");
  }
  redirect("/signup");
}
