"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { log } from "@/lib/log";
import { confirmUrl } from "@/lib/email-links";
import { safeNextPath } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";
import {
  emailSchema,
  fieldErrors,
  formFields,
  passwordSchema,
  signInSchema,
  signUpSchema,
  type FormState,
} from "@/lib/validation";

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
      emailRedirectTo: confirmUrl(await siteOrigin(), "/app/onboarding"),
    },
  });
  if (error) {
    log.warn("auth.sign_up_failed", { code: error.code ?? error.name });
    const messages: Record<string, string> = {
      weak_password: "Choose a stronger password.",
      email_address_invalid: "Enter a real email address you can open.",
      email_address_not_authorized: "We can't send email to that address yet. Try another address.",
      over_email_send_rate_limit: "Too many attempts. Please wait a minute and try again.",
      user_already_exists: "That email already has an account. Sign in instead.",
      signup_disabled: "New accounts are paused right now. Please try again later.",
    };
    const message = messages[error.code ?? ""] ?? "We couldn't create your account. Please try again.";
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

/**
 * Emails a one-time sign-in link (for accounts made with Save this, which have no
 * password). Same answer whether or not the address has an account.
 */
export async function sendSignInLink(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formFields(form, ["email"]);
  const parsed = emailSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const next = safeNextPath(form.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false, emailRedirectTo: confirmUrl(await siteOrigin(), next) },
  });
  if (error && error.code === "over_email_send_rate_limit") {
    return { error: "Too many attempts. Please wait a minute and try again.", values };
  }
  if (error && error.code !== "otp_disabled" && error.code !== "user_not_found") {
    log.warn("auth.sign_in_link_failed", { code: error.code ?? error.name });
  }
  return { ok: true, message: "If that email has an account, a sign-in link is on its way.", values };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Sends a password reset link. The response is the same whether or not the
 * address has an account, so this cannot be used to discover who has signed up.
 */
export async function requestPasswordReset(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formFields(form, ["email"]);
  const parsed = emailSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: confirmUrl(await siteOrigin(), "/reset-password"),
  });
  if (error) {
    log.warn("auth.reset_request_failed", { code: error.code ?? error.name });
    if (error.code === "over_email_send_rate_limit") {
      return { error: "Too many attempts. Please wait a minute and try again.", values };
    }
  }
  return { ok: true, message: "If that email has an account, a reset link is on its way.", values };
}

/** Sets a new password for the signed-in user (after a reset link, or from Settings). */
export async function updatePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formFields(form, ["password", "confirm"]);
  const parsed = passwordSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your reset link has expired. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    log.warn("auth.password_update_failed", { userId: userData.user.id, code: error.code ?? error.name });
    const message =
      error.code === "same_password"
        ? "Choose a password you haven't used here before."
        : error.code === "weak_password"
          ? "Choose a stronger password."
          : "We couldn't change your password. Please try again.";
    return { error: message };
  }
  log.info("auth.password_updated", { userId: userData.user.id });
  return { ok: true, message: "Your password has been changed." };
}
