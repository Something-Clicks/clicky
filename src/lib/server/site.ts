import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { log } from "@/lib/log";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * Server-only access to the site_* database functions (anonymous previews, feedback,
 * funnel counts). They are authorized by SITE_SERVER_KEY, whose SHA-256 hash is stored
 * in the database. The public Supabase key alone cannot call them.
 */
export const siteKey = () => process.env.SITE_SERVER_KEY ?? "";
export const isSiteConfigured = () =>
  siteKey().length >= 32 && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

/** The free first result without an account. Off unless FREE_PREVIEW_ENABLED=true. */
export const isPreviewEnabled = () => process.env.FREE_PREVIEW_ENABLED === "true" && isSiteConfigured();

export function siteDb() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** A random token for a URL or cookie (256 bits). */
export const newToken = () => randomBytes(32).toString("base64url");

/** Keyed hash of the visitor's network address: lets us rate limit without storing the address. */
export async function visitorHash(): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${siteKey()}:${ip}`).digest("hex");
}

export type FunnelEvent =
  | "homepage_visit" | "first_use_started" | "first_result_completed" | "save_this_clicked" | "signup_started"
  | "signup_completed" | "free_use_consumed" | "upgrade_viewed" | "checkout_started" | "subscription_completed"
  | "purchase_completed" | "draft_created" | "draft_approved" | "work_completed" | "reanalysis_completed"
  | "feedback_submitted" | "website_submitted" | "sign_in" | "return_visit" | "limit_reached" | "pricing_viewed";

/**
 * Counts one funnel step. No personal data: props hold only small labels such as a plan id.
 * Never throws; a counting problem must not break the customer's action.
 */
export async function track(event: FunnelEvent, props: Record<string, string | number | boolean> = {}) {
  if (!isSiteConfigured()) return;
  try {
    const { error } = await siteDb().rpc("site_track", { p_key: siteKey(), p_event: event, p_props: props as Json });
    if (error) log.warn("funnel.track_failed", { event, error: error.message });
  } catch (error) {
    log.warn("funnel.track_failed", { event, error });
  }
}

/**
 * A signed form ticket: when the form was shown. Submissions faster than a person could
 * type (MIN_FILL_MS) or older than a couple of hours are refused.
 */
const MIN_FILL_MS = 2500;
const MAX_FILL_MS = 2 * 60 * 60 * 1000;
const sign = (ts: string) => createHash("sha256").update(`ticket:${siteKey()}:${ts}`).digest("base64url").slice(0, 32);
export const formTicket = (now = Date.now()) => `${now}.${sign(String(now))}`;
export function ticketOk(ticket: unknown, now = Date.now()): boolean {
  if (typeof ticket !== "string") return false;
  const [ts, sig] = ticket.split(".");
  if (!ts || !sig || sign(ts) !== sig) return false;
  const age = now - Number(ts);
  return age >= MIN_FILL_MS && age <= MAX_FILL_MS;
}
