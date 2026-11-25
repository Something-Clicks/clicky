import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/types";

export type NotificationKind = "draft_ready" | "analysis_complete";

export const isEmailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Sends one email through Resend. Returns a short status for the notification log. */
export async function sendEmail(to: string, subject: string, text: string, linkPath: string): Promise<{ status: "sent" | "skipped" | "failed"; detail: string }> {
  if (!isEmailConfigured()) return { status: "skipped", detail: "Email sending is not configured." };
  const link = `${siteUrl()}${linkPath}`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
        subject,
        text: `${text}\n\n${link}\n\nSomething Clicks · Change which emails you get in Settings.`,
        html: `<div style="font-family:Inter,system-ui,sans-serif;color:#252a35;font-size:15px;line-height:1.5"><p>${escapeHtml(text)}</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#3977d5;color:#fff;padding:11px 16px;border-radius:11px;text-decoration:none">Open Something Clicks</a></p><p style="color:#6d7480;font-size:12px">Something Clicks · Change which emails you get in Settings.</p></div>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn("email.send_failed", { status: res.status });
      return { status: "failed", detail: `Email provider returned ${res.status}.` };
    }
    return { status: "sent", detail: "Sent." };
  } catch (error) {
    log.warn("email.send_error", { error });
    return { status: "failed", detail: "Email provider did not respond." };
  }
}

const MESSAGES: Record<NotificationKind, (business: string) => { subject: string; text: string; path: string }> = {
  analysis_complete: (b) => ({
    subject: `Your website analysis for ${b} is ready`,
    text: `We finished reviewing ${b}'s website. Your Action Cards are updated with what needs attention and why.`,
    path: "/app",
  }),
  draft_ready: (b) => ({
    subject: `A draft for ${b} is ready for your review`,
    text: `A draft is ready for one of ${b}'s actions. Nothing is used until you approve it.`,
    path: "/app/approvals",
  }),
};

/**
 * Emails everyone in the business who wants this kind of update, and logs each
 * attempt. Never throws: a notification problem must not break the work it reports on.
 */
export async function notify(db: Pick<SupabaseClient<Database>, "rpc">, orgId: string, businessName: string, kind: NotificationKind) {
  try {
    const { data: recipients, error } = await db.rpc("notification_recipients", { p_org: orgId, p_kind: kind });
    if (error) throw new Error(error.message);
    const msg = MESSAGES[kind](businessName);
    for (const r of recipients ?? []) {
      const result = await sendEmail(r.email, msg.subject, msg.text, msg.path);
      await db.rpc("log_notification", { p_org: orgId, p_user: r.user_id, p_kind: kind, p_status: result.status, p_detail: result.detail });
    }
    log.info("notify.done", { orgId, kind, recipients: recipients?.length ?? 0, emailConfigured: isEmailConfigured() });
  } catch (error) {
    log.error("notify.failed", { orgId, kind, error });
  }
}
