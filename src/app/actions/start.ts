"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { getUser, getWorkspace } from "@/lib/auth";
import { confirmUrl } from "@/lib/email-links";
import { log } from "@/lib/log";
import { getPreview, readPreviewCookie, runPreview, setPreviewCookie } from "@/lib/server/preview";
import { isPreviewEnabled, isSiteConfigured, newToken, siteDb, siteKey, ticketOk, track, visitorHash } from "@/lib/server/site";
import { setStartFlow } from "@/lib/start-flow";
import { createClient } from "@/lib/supabase/server";
import { domainOf, emailSchema, fieldErrors, formFields, startSchema, type FormState } from "@/lib/validation";

async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

const TRY_AGAIN = "Something went wrong. Please try again.";
const START_LIMITS: Record<string, string> = {
  ip_limit: "You've checked a few websites today. Create a free account to keep going.",
  domain_limit: "This website was checked a few times today. Please try again tomorrow.",
  busy: "We're very busy right now. Please try again in a little while.",
};

/**
 * Homepage: website + ZIP → the first result.
 *  - Free first result on: analyze now, no account needed (anonymous preview).
 *  - Off (the production default until the Privacy Policy is published): carry the
 *    website and ZIP to sign-up; the first analysis runs right after business setup.
 */
export async function startFirstUse(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formFields(form, ["website", "zipCode"]);
  // Bots fill the hidden field or submit instantly.
  if (String(form.get("company") ?? "") !== "") return { error: TRY_AGAIN, values };
  if (isSiteConfigured() && !ticketOk(form.get("ticket"))) {
    return { error: "That was quick! Please check your details and try again.", values };
  }
  const parsed = startSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  await track("website_submitted");
  const website = parsed.data.website!;
  const zipCode = parsed.data.zipCode;

  let signedIn = false;
  try {
    signedIn = Boolean(await getUser());
  } catch {
    // Auth unavailable: treat as signed out.
  }
  if (signedIn) {
    const ws = await getWorkspace();
    if (ws.organization) redirect("/app");
    await setStartFlow({ website, zipCode });
    redirect("/app/onboarding");
  }

  if (!isPreviewEnabled()) {
    await setStartFlow({ website, zipCode });
    await track("signup_started", { from: "home" });
    redirect("/signup");
  }

  const view = newToken();
  const domain = domainOf(website);
  const { data, error } = await siteDb().rpc("site_preview_start", {
    p_key: siteKey(),
    p_website: website,
    p_domain: domain,
    p_zip: zipCode,
    p_ip_hash: await visitorHash(),
    p_view: view,
  });
  if (error || !data) {
    const known = START_LIMITS[(error as { hint?: string } | null)?.hint ?? ""];
    if (!known) log.error("preview.start_failed", { error: error?.message });
    return { error: known ?? TRY_AGAIN, values };
  }
  const { id, cached } = data as { id: string; cached: boolean };
  await setPreviewCookie(id, view);
  await track("first_use_started", { cached });
  if (cached) await track("first_result_completed", { cached: true });
  else after(() => runPreview(id, website, domain));
  redirect("/start");
}

/**
 * Save this: binds the result to the visitor's email and a single-use claim token, then
 * emails a sign-in link. The link works in any browser: the claim completes only for
 * the same, verified email address.
 */
export async function savePreview(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formFields(form, ["email"]);
  if (String(form.get("company") ?? "") !== "") return { error: TRY_AGAIN, values };
  const parsed = emailSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const c = await readPreviewCookie();
  if (!c || !isPreviewEnabled()) return { error: "Your result has expired. Please check your website again.", values };

  const claim = newToken();
  const { error } = await siteDb().rpc("site_preview_save", {
    p_key: siteKey(),
    p_id: c.id,
    p_view: c.view,
    p_email: parsed.data.email,
    p_claim: claim,
  });
  if (error) {
    const hint = (error as { hint?: string }).hint;
    if (hint === "save_limit") return { error: "We've sent a few links already. Check your inbox, or try again tomorrow.", values };
    if (hint !== "not_available" && hint !== "not_found") log.error("preview.save_failed", { error: error.message });
    return { error: "This result can't be saved anymore. Please check your website again.", values };
  }
  await track("save_this_clicked");

  const supabase = await createClient();
  const { error: otpError } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: confirmUrl(await siteOrigin(), `/claim?t=${claim}`), shouldCreateUser: true },
  });
  if (otpError) {
    log.warn("preview.link_failed", { code: otpError.code ?? otpError.name });
    if (otpError.code === "over_email_send_rate_limit") {
      return { error: "Too many attempts. Please wait a minute and try again.", values };
    }
    if (otpError.code === "email_address_invalid") return { fieldErrors: { email: "Enter a real email address you can open." }, values };
    return { error: "We couldn't send the link. Please try again.", values };
  }
  await track("signup_started", { from: "save_this" });
  return { ok: true, message: "Check your email. Open the link on any device to save your results.", values };
}

const FeedbackSchema = z.object({
  kind: z.enum(["first_result", "upgrade"]),
  rating: z.enum(["up", "down", ""]),
  reason: z.string().trim().max(500, "Keep it under 500 characters."),
});

/** Thumbs up/down after the first result, and "What stopped you?" on the upgrade screen. */
export async function sendFeedback(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formFields(form, ["kind", "rating", "reason"]);
  if (String(form.get("company") ?? "") !== "") return { ok: true, message: "Thanks!" };
  const parsed = FeedbackSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const { kind, rating, reason } = parsed.data;
  if (!rating && !reason) return { error: "Pick a thumb or write a few words.", values };
  if (!isSiteConfigured()) return { ok: true, message: "Thanks!" };

  let org: string | null = null;
  let followupEmail: string | null = null;
  let user = null;
  try {
    user = await getUser();
  } catch {
    // Feedback still counts when Auth is unavailable.
  }
  if (user) {
    const ws = await getWorkspace();
    org = ws.organization?.id ?? null;
    // Follow-up permission only for signed-in people, with their account email.
    if (form.get("followup") === "on" && ws.email) followupEmail = ws.email;
  }
  const preview = kind === "first_result" ? await getPreview() : null;
  const { error } = await siteDb().rpc("site_submit_feedback", {
    p_key: siteKey(),
    p_kind: kind,
    p_rating: rating || null,
    p_reason: reason || null,
    p_preview: preview?.id ?? null,
    p_org: org,
    p_ip_hash: await visitorHash(),
    p_followup_email: followupEmail,
  });
  if (error) {
    if ((error as { hint?: string }).hint === "rate_limited") return { error: "Thanks, we've got plenty from you for now." };
    log.error("feedback.save_failed", { error: error.message });
    return { error: TRY_AGAIN, values };
  }
  await track("feedback_submitted", { kind, ...(rating ? { rating } : {}) });
  return { ok: true, message: "Thanks! That helps." };
}
