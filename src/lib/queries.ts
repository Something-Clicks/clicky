import "server-only";

import { cache } from "react";

import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

/** Reads for the workspace. Every query runs as the signed-in user, so RLS scopes it. */

export const LEVEL_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const OPEN = ["new", "approved", "in_progress"];

export const getLatestAnalysis = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analyses")
    .select("id, status, website, source_coverage, summary, wording, failure_reason, started_at, completed_at")
    .eq("organization_id", orgId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) log.error("query.latest_analysis_failed", { orgId, error: error.message });
  return data;
});

export const getLastCompleteAnalysis = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("analyses")
    .select("id, completed_at, summary, wording, source_coverage")
    .eq("organization_id", orgId)
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
});

export type CardRow = Awaited<ReturnType<typeof getCards>>[number];

export const getCards = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("action_cards")
    .select(
      "id, check_key, title, explanation, why_it_matters, recommended_action, expected_benefit, impact_priority, confidence, ai_capable, execution_type, approval_required, status, wording, result_summary, created_at, completed_at, action_card_evidence ( analysis_evidence ( observation, url, kind ) )",
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) log.error("query.cards_failed", { orgId, error: error.message });
  return (data ?? []).sort(
    (a, b) =>
      Number(!OPEN.includes(a.status)) - Number(!OPEN.includes(b.status)) ||
      LEVEL_ORDER[a.impact_priority]! - LEVEL_ORDER[b.impact_priority]! ||
      LEVEL_ORDER[a.confidence]! - LEVEL_ORDER[b.confidence]!,
  );
});

export const openCards = (cards: CardRow[]) => cards.filter((c) => OPEN.includes(c.status));

export async function getCard(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("action_cards")
    .select(
      "*, action_card_evidence ( analysis_evidence ( id, source, kind, url, observation, excerpt, observed_at ) )",
    )
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function getEvidence(analysisId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("analysis_evidence")
    .select("id, source, kind, check_key, url, observation, excerpt")
    .eq("analysis_id", analysisId)
    .order("observed_at");
  return data ?? [];
}

export function firstEvidence(card: { action_card_evidence: { analysis_evidence: { observation: string; url: string | null; kind: string } | null }[] }) {
  return card.action_card_evidence.map((x) => x.analysis_evidence).find(Boolean) ?? null;
}

/** "today", "yesterday", "3 days ago". */
export function relativeDay(iso: string | null | undefined): string {
  if (!iso) return "Not yet";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}

export const impactLabel = (level: string) => `${level.toUpperCase()} IMPACT`;
