"use server";

import { revalidatePath } from "next/cache";

import { FEATURES } from "@/config/features";
import { getWorkspace } from "@/lib/auth";
import { log } from "@/lib/log";
import { parseSiteList, readSignals, type DiscoverState, type SiteSignals } from "@/lib/research";
import { loadUnderstanding } from "@/lib/server/agent/context";
import { CAMPAIGN_DEADLINE_MS, deadlineMs } from "@/lib/server/agent/deadline";
import { writeCampaignDraftsFor } from "@/lib/server/agent/drafts-run";
import { meteredProvider } from "@/lib/server/agent/metering";
import { discoverCompetitors } from "@/lib/server/agent/modules/competitor-discovery";
import type { ResearchSource } from "@/lib/server/agent/modules/research-summary";
import { runCampaignPlanning, runCompetitorResearch } from "@/lib/server/agent/orchestrator";
import { getModelProvider } from "@/lib/server/agent/provider";
import { cardStage } from "@/lib/stages";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

const UUID = /^[0-9a-f-]{36}$/i;

/** Reads the owner's own homepage and up to 5 websites they name, and saves what each visibly shows. */
export async function compareWebsites(_prev: FormState, form: FormData): Promise<FormState> {
  if (!FEATURES.campaigns) return { error: "Comparing isn't available yet." };
  const ws = await getWorkspace();
  if (!ws.organization || !ws.business) return { error: "Please finish setting up your business first." };
  // One website per line (or separated by commas). A line with spaces in it is one bad entry, not several words.
  const urls = parseSiteList(form.getAll("sites").map((v) => String(v)).join("\n"));
  if (urls.length > 5) return { error: "That's more than 5. Pick the 5 that matter most." };
  const supabase = await createClient();
  // Why each site is on the list: "found in a web search", or "named by you". Short owner-visible text, never an instruction.
  const origins: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("origin:") && typeof v === "string") origins[k.slice(7).toLowerCase().replace(/^www\./, "").slice(0, 120)] = v.replace(/\s+/g, " ").trim().slice(0, 300);
  // A model-written summary is added only when a model is switched on; the comparison itself never needs one.
  const rawProvider = getModelProvider();
  const orgId = ws.organization.id;
  let keywords: ResearchSource | null = null;
  if (rawProvider) {
    const { data: items } = await supabase.from("research_items").select("term, metrics, source, measured_on").eq("organization_id", orgId).order("imported_at", { ascending: false }).limit(8);
    if (items?.length) {
      keywords = { id: "kw:1", label: "Keyword data you imported", kind: "keywords", facts: items.map((i) => {
        const m = (i.metrics ?? {}) as Record<string, unknown>;
        const bits = ["volume", "position", "clicks"].flatMap((f) => (typeof m[f] === "number" ? [`${f} ${m[f]}`] : []));
        return `${i.term} (${i.source === "search_console_export" ? "Search Console" : i.source === "semrush_export" ? "Semrush export" : "your list"}, measured ${i.measured_on}${bits.length ? `: ${bits.join(", ")}` : ""})`;
      }) };
    }
  }
  const out = await runCompetitorResearch(supabase, { orgId, ownWebsite: ws.business.website ?? "", urls }, {
    ...(rawProvider && process.env.MODEL_USAGE_KEY?.trim() ? {
      summary: { businessName: ws.business.businessName, origins, keywords, deadlineAt: Date.now() + deadlineMs(100_000), provider: (workflowId: string | null) => meteredProvider(rawProvider, { db: supabase, orgId, capability: "market_research.summary", workflowId }) },
    } : {}),
  });
  revalidatePath("/app/research");
  if (out.status === "failed") return { error: out.reason ?? "We couldn't compare those sites." };
  const skipped = out.failed.length ? ` We couldn't read ${out.failed.map((f) => f.host).join(", ")}.` : "";
  return { ok: true, message: `Compared ${out.read} website${out.read === 1 ? "" : "s"}.${skipped}` };
}

/** Last time each business asked to find similar businesses: the public sources are used politely (best effort, per server instance). */
const lastDiscovery = new Map<string, number>();

/**
 * Finds websites of similar local businesses from open sources (map listings, web search), each with where it came from.
 * Saves nothing and reads none of their pages: the owner picks which to compare, and only then are their homepages read.
 */
export async function findCompetitors(_prev: DiscoverState, _form: FormData): Promise<DiscoverState> {
  if (!FEATURES.campaigns) return { error: "Finding similar businesses isn't available yet." };
  const ws = await getWorkspace();
  if (!ws.organization || !ws.business) return { error: "Please finish setting up your business first." };
  const orgId = ws.organization.id;
  if (Date.now() - (lastDiscovery.get(orgId) ?? 0) < 60_000) return { error: "That search just ran. Give it a minute, then try again." };
  lastDiscovery.set(orgId, Date.now());
  const supabase = await createClient();
  const b = ws.business;
  const { understanding } = await loadUnderstanding(supabase, orgId, { businessName: b.businessName, website: b.website ?? "", serviceArea: b.serviceArea, primaryGoal: b.primaryGoal });
  // Only what the owner confirmed or the agent proposed, and never a detail the sources disagree about.
  const services = understanding.known.filter((k) => (k.field === "service" || k.field === "product") && !k.disputed).map((k) => k.value).slice(0, 3);
  if (services.length === 0) { const w = understanding.known.find((k) => k.field === "what_it_does" && !k.disputed); if (w) services.push(w.value); }
  const { data: scans } = await supabase.from("competitor_scans").select("host").eq("organization_id", orgId);
  try {
    const found = await discoverCompetitors({ ownWebsite: b.website ?? "", serviceArea: b.serviceArea, services, alreadyComparing: (scans ?? []).map((s) => s.host) });
    log.info("research.discovery", { orgId, candidates: found.candidates.length, sources: found.sourceStatus.map((s) => `${s.source}:${s.status}`) });
    return { result: { candidates: found.candidates.map(({ host, url, name, basis, sources }) => ({ host, url, name, basis, sources })), limits: found.limits, attribution: found.attribution, sourceStatus: found.sourceStatus } };
  } catch (error) {
    log.error("research.discovery_failed", { orgId, error });
    return { error: "We couldn't look just now. Please try again later." };
  }
}

export async function removeComparison(form: FormData): Promise<void> {
  if (!FEATURES.campaigns) return;
  const ws = await getWorkspace();
  const id = String(form.get("id") ?? "");
  if (!ws.organization || !UUID.test(id)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_competitor_scan", { p_id: id });
  if (error) log.error("research.remove_failed", { id, error: error.message });
  revalidatePath("/app/research");
}

/** Proposes campaigns from what is known and observed (fixed playbooks). Nothing is applied. */
export async function prepareCampaigns(_prev: FormState, form: FormData): Promise<FormState> {
  if (!FEATURES.campaigns) return { error: "Campaigns aren't available yet." };
  const ws = await getWorkspace();
  if (!ws.organization || !ws.business) return { error: "Please finish setting up your business first." };
  const orgId = ws.organization.id;
  const b = ws.business;
  const supabase = await createClient();
  const [{ data: rows }, { data: scans }] = await Promise.all([
    supabase.from("action_cards")
      .select("id, title, why_it_matters, recommended_action, impact_priority, evidence_class, status, verification")
      .eq("organization_id", orgId).in("status", ["new", "approved", "in_progress"]).limit(100),
    supabase.from("competitor_scans").select("host, status, is_self, signals").eq("organization_id", orgId),
  ]);
  const cards = (rows ?? []).filter((c) => cardStage(c) !== "completed").map((c) => ({
    id: c.id, title: c.title, why_it_matters: c.why_it_matters, recommended_action: c.recommended_action, impact: c.impact_priority, evidence_class: c.evidence_class ?? "unknown",
  }));
  const primaryGoal = b.primaryGoal ?? "";
  const { facts } = await loadUnderstanding(supabase, orgId, { businessName: b.businessName, website: b.website ?? "", serviceArea: b.serviceArea ?? "", primaryGoal });
  const confirmedArea = facts.find((f) => f.field === "service_area" && f.status === "confirmed" && f.value)?.value ?? "";
  const serviceArea = b.serviceArea || confirmedArea;
  const confirmedServices = facts.filter((f) => f.field === "service" && f.status === "confirmed" && f.value).map((f) => f.value as string);
  const confirmedAudience = facts.find((f) => f.field === "audience" && f.status === "confirmed" && f.value)?.value ?? null;
  // A service named in the request ("promote our drain cleaning") is promoted if the owner confirmed it; otherwise the first one.
  const asked = String(form.get("request") ?? "").toLowerCase();
  const focusService = confirmedServices.find((s) => asked && asked.includes(s.toLowerCase())) ?? null;
  const done = (scans ?? []).filter((s) => s.status === "done").map((s) => ({ host: s.host, own: s.is_self, signals: readSignals(s.signals) })).filter((s): s is { host: string; own: boolean; signals: SiteSignals } => s.signals !== null);
  const own = done.find((s) => s.own)?.signals ?? null;
  const out = await runCampaignPlanning(supabase, {
    orgId,
    campaign: { businessName: b.businessName, serviceArea, primaryGoal, confirmedServices, confirmedAudience, focusService, cards, own, competitors: done.filter((s) => !s.own).map(({ host, signals }) => ({ host, signals })) },
  });
  revalidatePath("/app/campaigns");
  if (out.status !== "prepared") return { error: out.reason ?? "We couldn't prepare campaigns this time." };
  return { ok: true, message: `Prepared ${out.saved} campaign${out.saved === 1 ? "" : "s"} for you to review.` };
}

const back = (id: string) => revalidatePath(`/app/campaigns/${id}`);

/** The owner approves or dismisses a campaign. Approval is agreement, never completion. */
export async function decideCampaign(form: FormData): Promise<void> {
  if (!FEATURES.campaigns) return;
  const ws = await getWorkspace();
  const id = String(form.get("id") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (!ws.organization || ws.organization.role !== "owner" || !UUID.test(id) || !["approved", "dismissed"].includes(decision)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_campaign", { p_campaign: id, p_decision: decision });
  if (error && !["already_decided", "owner_only"].includes((error as { hint?: string }).hint ?? "")) log.error("campaign.decide_failed", { id, error: error.message });
  back(id);
  revalidatePath("/app/campaigns");
}

export async function editTaskDraft(form: FormData): Promise<void> {
  if (!FEATURES.campaigns) return;
  const ws = await getWorkspace();
  const id = String(form.get("task") ?? "");
  const campaign = String(form.get("campaign") ?? "");
  const text = String(form.get("text") ?? "").slice(0, 4000);
  if (!ws.organization || !UUID.test(id) || !text.trim()) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_task_deliverable", { p_task: id, p_text: text });
  if (error) log.error("campaign.edit_failed", { id, error: error.message });
  if (UUID.test(campaign)) back(campaign);
}

export async function markTask(form: FormData): Promise<void> {
  if (!FEATURES.campaigns) return;
  const ws = await getWorkspace();
  const id = String(form.get("task") ?? "");
  const campaign = String(form.get("campaign") ?? "");
  const status = String(form.get("status") ?? "");
  const note = String(form.get("note") ?? "").slice(0, 500) || null;
  if (!ws.organization || !UUID.test(id) || !["done", "skipped", "approved"].includes(status)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_task_status", { p_task: id, p_status: status, p_note: note as string });
  if (error && !["not_approved", "dependency_open"].includes((error as { hint?: string }).hint ?? "")) log.error("campaign.mark_failed", { id, error: error.message });
  if (UUID.test(campaign)) back(campaign);
  revalidatePath("/app/campaigns");
}

/** Writes a draft for each page, email and post in a campaign (Content Creation, metered). Nothing is sent or published. */
export async function writeCampaignDrafts(_prev: FormState, form: FormData): Promise<FormState> {
  if (!FEATURES.campaigns || !FEATURES.drafts) return { error: "This isn't available yet." };
  const ws = await getWorkspace();
  const id = String(form.get("campaign") ?? "");
  if (!ws.organization || !ws.business || !UUID.test(id)) return { error: "That campaign could not be found." };
  const out = await writeCampaignDraftsFor(ws.organization.id, ws.business, id, Date.now() + deadlineMs(CAMPAIGN_DEADLINE_MS));
  back(id);
  return out;
}
