import "server-only";

import { cookies } from "next/headers";

import { log } from "@/lib/log";
import type { Json } from "@/lib/supabase/types";

import { analyzeWebsite, friendlyReason } from "./analysis";
import { siteDb, siteKey, track } from "./site";

/** HTTP-only cookie holding "<preview id>.<view token>". The token is the only way to read the result. */
export const PREVIEW_COOKIE = "sc_preview";

export async function setPreviewCookie(id: string, view: string) {
  (await cookies()).set(PREVIEW_COOKIE, `${id}.${view}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}

export async function readPreviewCookie(): Promise<{ id: string; view: string } | null> {
  const raw = (await cookies()).get(PREVIEW_COOKIE)?.value ?? "";
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,})$/.exec(raw);
  return m ? { id: m[1]!, view: m[2]! } : null;
}

export async function clearPreviewCookie() {
  (await cookies()).delete(PREVIEW_COOKIE);
}

export interface PreviewCard {
  check_key: string;
  title: string;
  explanation: string;
  why_it_matters: string;
  recommended_action: string;
  expected_benefit: string;
  impact_priority: "high" | "medium" | "low";
  confidence: string;
  ai_capable: boolean;
  execution_type: string;
  evidence_keys: string[];
}
export interface PreviewEvidence {
  key: string;
  source: string;
  kind: string;
  check_key: string;
  url: string | null;
  observation: string;
  excerpt: string | null;
}
export interface Preview {
  id: string;
  website: string;
  domain: string;
  zip_code: string;
  status: "running" | "complete" | "failed";
  evidence: PreviewEvidence[] | null;
  cards: PreviewCard[] | null;
  coverage: Record<string, { status: string; pages_reviewed?: number; score?: number }> | null;
  summary: string | null;
  failure_reason: string | null;
  saved: boolean;
  claimed: boolean;
  created_at: string;
}

export async function getPreview(): Promise<Preview | null> {
  const c = await readPreviewCookie();
  if (!c) return null;
  const { data, error } = await siteDb().rpc("site_preview_get", { p_key: siteKey(), p_id: c.id, p_view: c.view });
  if (error) {
    log.error("preview.read_failed", { error: error.message });
    return null;
  }
  return (data as unknown as Preview | null) ?? null;
}

/** Runs the analysis for an anonymous preview and saves the result (never throws). */
export async function runPreview(id: string, website: string, domain: string) {
  const started = Date.now();
  const db = siteDb();
  try {
    const r = await analyzeWebsite(website, { businessName: domain, serviceArea: null, primaryGoal: null });
    const { error } = await db.rpc("site_preview_complete", {
      p_key: siteKey(),
      p_id: id,
      p_evidence: r.evidence as unknown as Json,
      p_cards: r.findings as unknown as Json,
      p_coverage: r.coverage as unknown as Json,
      p_summary: r.summary,
      p_wording: r.wording,
    });
    if (error) throw new Error(`site_preview_complete failed: ${error.message}`);
    log.info("preview.completed", { previewId: id, ms: Date.now() - started, cards: r.findings.length, wording: r.wording });
    await track("first_result_completed");
  } catch (error) {
    log.warn("preview.failed", { previewId: id, ms: Date.now() - started, error });
    const { error: failError } = await db.rpc("site_preview_fail", { p_key: siteKey(), p_id: id, p_reason: friendlyReason(error, website) });
    if (failError) log.error("preview.fail_record_failed", { previewId: id, error: failError.message });
  }
}
