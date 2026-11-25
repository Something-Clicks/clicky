import { FACT_FIELDS, FACT_LABEL, STALE_AFTER_DAYS, type FactField, type FactSource, type ProposedFact, type StoredFact } from "@/lib/business-profile";
import type { EvidenceClass } from "@/lib/evidence";

import type { PageFacts, SiteScan } from "../../site-scan";
import type { ModelProvider, ModelUsage } from "../provider";
import { learnWithModel } from "./business-understanding";
import type { CapabilityModule } from "./types";

/**
 * Business Intelligence (§3, §14): the Marketing Agent's structured knowledge of the business.
 *
 * Two jobs:
 *  1. propose(): derive facts from what Website Intelligence retrieved. Deterministic today:
 *     phone numbers and email addresses (verified: observed on the site) and services
 *     (inferred: from pages the site links to under /services/, with the basis stated).
 *     Model-derived facts (what the business does, audience, value proposition) come later and
 *     follow the same evidence rules. The agent only proposes; the owner confirms.
 *  2. understand(): the current picture for any workflow: the owner's profile, confirmed facts and
 *     current proposals, what is missing, and what is stale (old website facts are never treated
 *     as current).
 */

export interface OwnerProfile {
  businessName: string;
  website: string;
  serviceArea: string | null;
  primaryGoal: string | null;
}

export interface KnownFact {
  field: FactField;
  label: string;
  value: string;
  source: FactSource;
  evidence_class: EvidenceClass;
  confirmed: boolean;
}

export interface BusinessUnderstanding {
  known: KnownFact[];
  missing: FactField[];
  stale: { field: FactField; value: string | null; observed_at: string }[];
}

/** The details every marketing workflow needs; listed as missing until known. */
export const CORE_FIELDS: FactField[] = ["what_it_does", "service", "audience", "service_area", "value_proposition", "contact_phone"];

const GOAL_LABEL: Record<string, string> = {
  get_found: "Get found by more customers",
  more_calls: "Get more calls and enquiries",
  easier_marketing: "Make marketing easier",
};

const SERVICE_PATH = /\/(services?|what-we-do|our-services)\/[^/?#]+\/?$/i;
const GENERIC_LABEL = /^(services?|our services|learn more|read more|more|details|view( all| more)?|see (all|more)|click here|home|menu|next|previous|book now|contact us)$/i;

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** "+1 (801) 555-0123" style for North American numbers; others as written. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/^tel:/i, "").replace(/[^\d+]/g, "");
  const d = digits.replace(/^\+?1(?=\d{10}$)/, "");
  return /^\d{10}$/.test(d) ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw.replace(/^tel:/i, "").trim();
}

export function propose(scan: SiteScan): ProposedFact[] {
  const pages: PageFacts[] = [scan.homepage, ...scan.pages];
  const facts: ProposedFact[] = [];
  const seen = new Set<string>();
  const add = (f: ProposedFact) => {
    const key = `${f.field}|${(f.value ?? "").toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      facts.push(f);
    }
  };

  for (const p of pages) {
    for (const tel of p.telLinks) {
      add({ category: "business", field: "contact_phone", value: formatPhone(tel), source: "website", evidence_class: "verified", basis: null,
        evidence: [{ kind: "observed", url: p.url, excerpt: `Tap-to-call link: ${tel}` }] });
    }
    for (const email of p.mailtoLinks) {
      add({ category: "business", field: "contact_email", value: email, source: "website", evidence_class: "verified", basis: null,
        evidence: [{ kind: "observed", url: p.url, excerpt: `Email link: ${email}` }] });
    }
  }
  if (!facts.some((f) => f.field === "contact_phone")) {
    const p = pages.find((pg) => pg.phoneInText);
    if (p) {
      add({ category: "business", field: "contact_phone", value: formatPhone(p.phoneInText!), source: "website", evidence_class: "verified", basis: null,
        evidence: [{ kind: "observed", url: p.url, excerpt: `Phone number in the page text: ${p.phoneInText}` }] });
    }
  }

  let services = 0;
  for (const p of pages) {
    for (const { url, text } of p.internalLinkTexts) {
      if (services >= 8 || !SERVICE_PATH.test(pathOf(url)) || GENERIC_LABEL.test(text) || text.length < 3 || text.length > 60) continue;
      const before = facts.length;
      add({ category: "business", field: "service", value: text, source: "website", evidence_class: "inferred",
        basis: `The website links to a page at ${pathOf(url)} labeled "${text}", which suggests it is a service offered.`,
        evidence: [{ kind: "observed", url: p.url, excerpt: `Link "${text}" → ${pathOf(url)}` }] });
      if (facts.length > before) services++;
    }
  }
  return facts;
}

const ageDays = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / 86_400_000;

export function understand(profile: OwnerProfile, facts: StoredFact[], now = new Date()): BusinessUnderstanding {
  const known: KnownFact[] = [];
  if (profile.serviceArea) known.push({ field: "service_area", label: FACT_LABEL.service_area, value: profile.serviceArea, source: "owner", evidence_class: "verified", confirmed: true });
  if (profile.primaryGoal) known.push({ field: "goal", label: FACT_LABEL.goal, value: GOAL_LABEL[profile.primaryGoal] ?? profile.primaryGoal, source: "owner", evidence_class: "verified", confirmed: true });

  const stale: BusinessUnderstanding["stale"] = [];
  for (const f of facts) {
    if (f.status !== "confirmed" && f.status !== "proposed") continue;
    if (f.value === null) continue; // an "unknown" record only says what is missing
    const isStale = f.status === "proposed" && f.source !== "owner" && ageDays(f.observed_at, now) > STALE_AFTER_DAYS;
    if (isStale) {
      stale.push({ field: f.field, value: f.value, observed_at: f.observed_at });
      continue;
    }
    known.push({ field: f.field, label: FACT_LABEL[f.field], value: f.value, source: f.source, evidence_class: f.evidence_class, confirmed: f.status === "confirmed" });
  }
  // Confirmed facts first, then proposals; owner facts lead within each.
  known.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || Number(b.source === "owner") - Number(a.source === "owner"));
  const missing = CORE_FIELDS.filter((field) => !known.some((k) => k.field === field));
  return { known, missing, stale };
}

export interface BusinessIntelligenceInput {
  profile: OwnerProfile;
  /** Stored facts (confirmed and proposed), when the caller has them. */
  facts?: StoredFact[];
  /** A fresh website scan to propose facts from, when one was just made. */
  scan?: SiteScan | null;
  /** When given (development and Preview only), the model reads the scan too. */
  provider?: ModelProvider | null;
  /** When the whole request must be finished (epoch ms); the model call never runs past it. */
  deadlineAt?: number;
  now?: Date;
}

export interface ModelRun {
  provider: string;
  model: string;
  usage: ModelUsage;
  accepted: number;
  rejected: { field: string; value: string; reason: string }[];
}

export interface BusinessIntelligence {
  understanding: BusinessUnderstanding;
  proposals: ProposedFact[];
  /** Present when the model ran; null when it did not; "failed" with a reason when it was tried and failed. */
  model: ModelRun | null | { failed: string };
}

export const businessIntelligence: CapabilityModule<BusinessIntelligenceInput, BusinessIntelligence> = {
  id: "business_intelligence",
  async run({ profile, facts = [], scan = null, provider = null, deadlineAt, now = new Date() }) {
    const proposals = scan ? propose(scan) : [];
    let model: BusinessIntelligence["model"] = null;
    if (scan && provider) {
      try {
        const m = await learnWithModel(provider, scan, profile, deadlineAt);
        const have = new Set(proposals.map((p) => `${p.field}|${(p.value ?? "").toLowerCase()}`));
        for (const f of m.accepted) if (!have.has(`${f.field}|${(f.value ?? "").toLowerCase()}`)) proposals.push(f);
        model = { provider: m.provider, model: m.model, usage: m.usage, accepted: m.accepted.length, rejected: m.rejected };
      } catch (error) {
        model = { failed: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "unknown error" };
      }
    }
    // Proposals from this scan count as current knowledge until the owner reviews them.
    const pending: StoredFact[] = proposals.map((p, i) => ({ ...p, id: `new-${i}`, status: "proposed", observed_at: now.toISOString(), confirmed_at: null }));
    const understanding = understand(profile, [...facts, ...pending], now);
    const fieldsKnown = new Set(understanding.known.map((k) => k.field)).size;
    const modelNote = model === null ? "" : "failed" in model ? ` Reading the website with the model failed: ${model.failed}.` : ` The model proposed ${model.accepted} detail${model.accepted === 1 ? "" : "s"} (${model.rejected.length} dropped for failing evidence checks).`;
    return {
      status: "done",
      output: { understanding, proposals, model },
      detail: `${fieldsKnown} of ${Object.values(FACT_FIELDS).flat().length} profile details known${proposals.length ? ` (${proposals.length} proposed from the website, awaiting the owner)` : ""}; missing: ${understanding.missing.map((f) => FACT_LABEL[f].toLowerCase()).join(", ") || "none"}.${modelNote}`,
    };
  },
};
