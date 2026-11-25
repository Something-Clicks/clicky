/**
 * Something Clicks Marketing Agent: the structured Business, Brand and Customer profile
 * (specification §3 and §14). The database allows exactly these fields
 * (app_private.business_fact_field_ok); a database test keeps the two lists identical.
 */
import type { EvidenceClass } from "./evidence";

export const FACT_FIELDS = {
  business: [
    "what_it_does", "industry", "business_model", "service", "product", "service_area", "location",
    "contact_phone", "contact_email", "pricing", "competitive_advantage", "goal", "marketing_objective", "constraint",
  ],
  brand: ["voice", "tone", "value_proposition", "key_message", "preferred_term", "avoid_term", "brand_guideline"],
  customer: ["audience", "customer_problem", "motivation", "objection", "customer_question", "decision_factor"],
} as const;

export type FactCategory = keyof typeof FACT_FIELDS;
export type FactField = (typeof FACT_FIELDS)[FactCategory][number];
export type FactSource = "owner" | "website" | "model" | "research";
export type FactStatus = "proposed" | "confirmed" | "rejected" | "superseded";

export interface FactEvidence {
  kind: "observed" | "measured" | "estimated" | "missing";
  url: string | null;
  excerpt: string | null;
}

/** A fact the Marketing Agent proposes (it never confirms its own proposals). */
export interface ProposedFact {
  category: FactCategory;
  field: FactField;
  /** Null only when the class is "unknown": the fact records what is missing. */
  value: string | null;
  source: Exclude<FactSource, "owner">;
  evidence_class: EvidenceClass;
  basis: string | null;
  evidence: FactEvidence[];
}

/** A stored fact as read from business_facts. */
export interface StoredFact extends Omit<ProposedFact, "source"> {
  id: string;
  source: FactSource;
  status: FactStatus;
  observed_at: string;
  confirmed_at: string | null;
}

export const categoryOf = (field: FactField): FactCategory =>
  (Object.keys(FACT_FIELDS) as FactCategory[]).find((c) => (FACT_FIELDS[c] as readonly string[]).includes(field))!;

/** Plain labels for internal screens and documentation. */
export const FACT_LABEL: Record<FactField, string> = {
  what_it_does: "What the business does", industry: "Industry", business_model: "Business model", service: "Service",
  product: "Product", service_area: "Service area", location: "Location", contact_phone: "Phone", contact_email: "Email",
  pricing: "Pricing", competitive_advantage: "Competitive advantage", goal: "Business goal", marketing_objective: "Marketing objective",
  constraint: "Known constraint", voice: "Brand voice", tone: "Tone", value_proposition: "Value proposition", key_message: "Key message",
  preferred_term: "Preferred term", avoid_term: "Words to avoid", brand_guideline: "Brand guideline", audience: "Audience",
  customer_problem: "Customer problem", motivation: "Purchase motivation", objection: "Common objection",
  customer_question: "Customer question", decision_factor: "Decision factor",
};

/** Website-sourced facts not seen again for this long are stale: never treated as current (§3.4). */
export const STALE_AFTER_DAYS = 180;
