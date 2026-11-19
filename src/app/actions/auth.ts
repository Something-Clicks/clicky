"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { log } from "@/lib/log";
import { safeNextPath } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formFields, signInSchema, signUpSchema, type FormState } from "@/lib/validation";

async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formFields(form, ["email", "password"]);
  const parsed = signInSchema.safeParse(values);
  const keep = { email: values.email ?? "" };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: keep };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    log.info("auth.sign_in_failed", { code: error.code ?? error.name });
    const message =
      error.code === "email_not_confirmed"
        ? "Confirm your email first. We sent you a link when you signed up."
        : "That email and password don't match. Try again.";
    return { error: message, values: keep };
  }
  redirect(safeNextPath(form.get("next")));
}

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formFields(form, ["fullName", "email", "password"]);
  const parsed = signUpSchema.safeParse(values);
  const keep = { fullName: values.fullName ?? "", email: values.email ?? "" };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: keep };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${await siteOrigin()}/auth/callback?next=/app/onboarding`,
    },
  });
  if (error) {
    log.warn("auth.sign_up_failed", { code: error.code ?? error.name });
    const message =
      error.code === "weak_password"
        ? "Choose a stronger password."
        : error.code === "over_email_send_rate_limit"
          ? "Too many attempts. Please wait a minute and try again."
          : "We couldn't create your account. Please try again.";
    return { error: message, values: keep };
  }
  log.info("auth.signed_up", { userId: data.user?.id });
  // With email confirmation on, there is no session until the link is opened.
  if (data.session) redirect("/app/onboarding");
  return {
    ok: true,
    message: "Check your email. We sent a link to confirm your account.",
  };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
