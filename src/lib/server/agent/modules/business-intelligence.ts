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
 *     phone numbers and email addresses (verified: observed on the site), the site's own schema.org markup
 *     (address, area served, price range, rating, offered services: verified), the site's own trust and offer
 *     statements quoted exactly (verified), and services (inferred: from pages the site links to under /services/,
 *     with the basis stated).
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

  // The site's own machine-readable markup (schema.org): the site states these details itself, so they are verified.
  for (const p of pages) {
    const sd = p.structured;
    if (!sd) continue;
    const observed = (what: string) => [{ kind: "observed" as const, url: p.url, excerpt: `Structured data on the page lists ${what}` }];
    const base = { category: "business" as const, source: "website" as const, evidence_class: "verified" as const, basis: null };
    if (sd.telephone) add({ ...base, field: "contact_phone", value: formatPhone(sd.telephone), evidence: observed(`telephone: ${sd.telephone}`) });
    if (sd.email) add({ ...base, field: "contact_email", value: sd.email, evidence: observed(`email: ${sd.email}`) });
    if (sd.address) add({ ...base, field: "location", value: sd.address, evidence: observed(`address: ${sd.address}`) });
    for (const area of sd.areaServed) add({ ...base, field: "service_area", value: area, evidence: observed(`area served: ${area}`) });
    if (sd.priceRange) add({ ...base, field: "pricing", value: `Price range shown on the site: ${sd.priceRange}`, evidence: observed(`price range: ${sd.priceRange}`) });
    if (sd.rating) {
      const counted = sd.rating.count ? ` from ${sd.rating.count} reviews` : "";
      add({ ...base, field: "trust_signal", value: `The site shows a rating of ${sd.rating.value} out of 5${counted} (its own figure; we have not checked it)`, evidence: observed(`rating: ${sd.rating.value}${counted}`) });
    }
    for (const svc of sd.services) add({ ...base, field: "service", value: svc, evidence: observed(`service: ${svc}`) });
  }

  for (const f of trustStatements(pages)) add(f);

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
  // The database accepts at most 50 proposals per call.
  return facts.slice(0, 50);
}

/**
 * Statements the site makes about itself that give a customer a reason to trust or choose it, found by fixed patterns.
 * Each one is the site's own sentence, quoted exactly (it is a substring of the page text), so the owner can see it.
 * We report what the site says; we never say it is true. Nothing here is a judgment or a model's reading.
 */
const TRUST_PATTERNS: { re: RegExp; field: "trust_signal" | "competitive_advantage" }[] = [
  { re: /\b(licensed|insured|bonded|certified|accredited)\b/i, field: "trust_signal" },
  { re: /\b(family|locally|veteran|woman|women)[- ]owned\b/i, field: "trust_signal" },
  { re: /\b(\d{1,3}\+?\s+years?\s+(of\s+)?(experience|in business)|serving\b[^.]{0,60}\bsince\s+(19|20)\d{2}|since\s+(19|20)\d{2}|established\s+in\s+(19|20)\d{2})/i, field: "trust_signal" },
  { re: /\b(\d(\.\d)?[- ]?stars?|five[- ]star|5[- ]star)\b/i, field: "trust_signal" },
  { re: /\b(warranty|warranties|guarantee[ds]?)\b/i, field: "trust_signal" },
  { re: /\bfree\s+(estimates?|quotes?|consultations?|inspections?)\b/i, field: "competitive_advantage" },
  { re: /\b(24\/7|24[- ]hours?|same[- ]day|emergency\s+(service|repair|calls?))\b/i, field: "competitive_advantage" },
];
const MAX_TRUST = 5;
const MAX_ADVANTAGE = 3;

export function trustStatements(pages: PageFacts[]): ProposedFact[] {
  const out: ProposedFact[] = [];
  const seen = new Set<string>();
  const counts = { trust_signal: 0, competitive_advantage: 0 };
  for (const p of pages) {
    // One block at a time (a paragraph, list item or heading), so a quote never joins navigation or a heading to a sentence.
    // A sentence is only used if it is word for word in the page text we keep.
    const sources = p.blocks.length ? p.blocks : [p.text];
    const sentences = sources.flatMap((b) => b.split(/(?<=[.!?])\s+/)).map((x) => x.trim()).filter((x) => x.length >= 15 && x.length <= 220 && p.text.includes(x));
    for (const sentence of sentences) {
      for (const { re, field } of TRUST_PATTERNS) {
        if (!re.test(sentence) || seen.has(sentence.toLowerCase())) continue;
        if (counts[field] >= (field === "trust_signal" ? MAX_TRUST : MAX_ADVANTAGE)) continue;
        seen.add(sentence.toLowerCase());
        counts[field]++;
        out.push({
          category: "business", field, value: `The site states: “${sentence}”`, source: "website", evidence_class: "verified", basis: null,
          evidence: [{ kind: "observed", url: p.url, excerpt: sentence }],
        });
        break;
      }
    }
  }
  return out;
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
