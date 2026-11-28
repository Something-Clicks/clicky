import type { FactField, FactSource, StoredFact } from "@/lib/business-profile";
import { FACT_LABEL } from "@/lib/business-profile";

/**
 * Conflicting-fact detection (spec §14, "customer context and memory"): when two sources disagree about the same single-valued
 * detail of a business (the phone number the owner confirmed against the one the website shows now, the service area in the profile
 * against the one on the site), the agent does NOT pick a winner and does NOT state either as fact. It reports the disagreement,
 * says who said what and when, and asks the owner. Pure and deterministic: no model, no network.
 *
 * Only fields that hold ONE value are compared. A business has many services, trust signals and customer questions, so differing
 * values there are normal and never a conflict.
 */

/** Fields where a business has exactly one true value at a time. */
export const SINGLE_VALUED: readonly FactField[] = ["contact_phone", "contact_email", "service_area", "location", "industry", "business_model", "price_positioning", "goal"];

export interface ConflictClaim {
  value: string;
  source: FactSource | "profile" | "homepage_scan";
  status: StoredFact["status"] | "profile";
  evidence_class: StoredFact["evidence_class"];
  observed_at: string | null;
  /** The stored fact this came from, when it is one (the owner confirms or rejects it on the Business screen). */
  factId: string | null;
}

export interface FactConflict {
  field: FactField;
  label: string;
  claims: ConflictClaim[];
  /**
   * "confirmed_vs_new": the owner confirmed one value and a source now says another (the site changed, or the confirmation is old).
   * "confirmed_vs_confirmed": two confirmed values (a mistake somewhere).
   * "unconfirmed": two proposals nobody has confirmed.
   */
  kind: "confirmed_vs_new" | "confirmed_vs_confirmed" | "unconfirmed";
  question: string;
}

const digits = (s: string) => s.replace(/\D/g, "");
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t)));
const STOP = new Set(["the", "and", "for", "area", "areas", "serving", "service", "services", "and", "near", "within", "around", "county", "city", "our", "all"]);

/** Do two values name the same thing? Phones by their last ten digits, emails exactly, text by overlapping meaning words. */
export function sameValue(field: FactField, a: string, b: string): boolean {
  if (field === "contact_phone") {
    const x = digits(a).slice(-10), y = digits(b).slice(-10);
    return x.length >= 7 && y.length >= 7 ? x === y : a.trim() === b.trim();
  }
  if (field === "contact_email") return a.trim().toLowerCase() === b.trim().toLowerCase();
  const x = tokens(a), y = tokens(b);
  if (x.size === 0 || y.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = [...x].filter((t) => y.has(t)).length;
  // One mention containing the other ("Austin" vs "Austin and Round Rock") agrees; disjoint places disagree.
  return shared > 0 && (shared === Math.min(x.size, y.size) || shared / new Set([...x, ...y]).size >= 0.5);
}

export interface ConflictInput {
  facts: StoredFact[];
  profile: { serviceArea: string | null };
  /** What the business's own homepage showed on its latest read (competitor_scans where is_self), if it was read. */
  selfSignals?: { phone?: string | null; observed_at?: string | null } | null;
}

const questionFor = (field: FactField, claims: ConflictClaim[]) => {
  const list = claims.map((c) => `“${c.value}”`).join(" and ");
  return field === "contact_phone" ? `Your records show two phone numbers, ${list}. Which one should customers call?`
    : field === "contact_email" ? `Your records show two email addresses, ${list}. Which one is right?`
    : field === "service_area" ? `Your records describe your service area two ways, ${list}. Which is right?`
    : `Your records disagree about ${FACT_LABEL[field].toLowerCase()}: ${list}. Which is right?`;
};

export function detectConflicts({ facts, profile, selfSignals }: ConflictInput): FactConflict[] {
  const byField = new Map<FactField, ConflictClaim[]>();
  const add = (field: FactField, claim: ConflictClaim) => byField.set(field, [...(byField.get(field) ?? []), claim]);

  for (const f of facts) {
    if (f.value === null || (f.status !== "confirmed" && f.status !== "proposed")) continue;
    if (!SINGLE_VALUED.includes(f.field)) continue;
    add(f.field, { value: f.value, source: f.source, status: f.status, evidence_class: f.evidence_class, observed_at: f.observed_at, factId: f.id });
  }
  if (profile.serviceArea) add("service_area", { value: profile.serviceArea, source: "profile", status: "profile", evidence_class: "verified", observed_at: null, factId: null });
  if (selfSignals?.phone) add("contact_phone", { value: selfSignals.phone, source: "homepage_scan", status: "proposed", evidence_class: "verified", observed_at: selfSignals.observed_at ?? null, factId: null });

  const out: FactConflict[] = [];
  for (const [field, claims] of byField) {
    // Group the claims that agree; more than one group is a conflict.
    const groups: ConflictClaim[][] = [];
    for (const c of claims) {
      const g = groups.find((g) => sameValue(field, g[0]!.value, c.value));
      if (g) g.push(c); else groups.push([c]);
    }
    if (groups.length < 2) continue;
    const reps = groups.map((g) => g.find((c) => c.status === "confirmed" || c.status === "profile") ?? g[0]!);
    const confirmedGroups = groups.filter((g) => g.some((c) => c.status === "confirmed" || c.status === "profile")).length;
    out.push({
      field, label: FACT_LABEL[field], claims: reps,
      kind: confirmedGroups >= 2 ? "confirmed_vs_confirmed" : confirmedGroups === 1 ? "confirmed_vs_new" : "unconfirmed",
      question: questionFor(field, reps),
    });
  }
  const order = { confirmed_vs_confirmed: 0, confirmed_vs_new: 1, unconfirmed: 2 } as const;
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.field.localeCompare(b.field));
}

/** Fields that have an unresolved conflict: the agent must not state their values as fact until the owner decides. */
export const disputedFields = (conflicts: FactConflict[]): Set<FactField> => new Set(conflicts.map((c) => c.field));
