/**
 * The marketing agent's capabilities (spec section 2.2) and what each one runs on today.
 *
 *   checks      - fixed, evidence-based code that exists and works now (no model)
 *   model       - needs a language model; blocked until a provider is configured
 *   integration - needs an authorized third-party integration; none exists yet
 *
 * Capabilities are internal. Customers never see or choose them.
 */
export type CapabilityId =
  | "business_intelligence"
  | "market_research"
  | "website_intelligence"
  | "seo_intelligence"
  | "marketing_analysis"
  | "marketing_strategy"
  | "content_creation"
  | "campaign_planning"
  | "marketing_execution"
  | "performance_intelligence";

export type RunsOn = "checks" | "model" | "integration";

export interface Capability {
  id: CapabilityId;
  label: string;
  runsOn: RunsOn;
  /** What it actually does today (or would do), in one line. */
  today: string;
}

export const CAPABILITIES: Record<CapabilityId, Capability> = {
  business_intelligence: {
    id: "business_intelligence", label: "Business Intelligence", runsOn: "checks",
    today: "Business, Brand and Customer profile with evidence classes: contact details and services from fixed extraction; what the business does, audience, value proposition and voice from the model (development and Preview). The owner confirms.",
  },
  website_intelligence: {
    id: "website_intelligence", label: "Website Intelligence", runsOn: "checks",
    today: "Safely fetches the homepage and key internal pages and records what was observed (analyzeWebsite).",
  },
  seo_intelligence: {
    id: "seo_intelligence", label: "SEO Intelligence", runsOn: "checks",
    today: "On-page checks only (titles, descriptions, headings, indexability) plus PageSpeed when measured. No keyword data source is connected.",
  },
  marketing_analysis: {
    id: "marketing_analysis", label: "Marketing Analysis", runsOn: "checks",
    today: "Evidence-backed findings from fixed checks, ranked; plus model-assisted messaging, conversion and content findings with quoted evidence (behind a switch, development and Preview).",
  },
  performance_intelligence: {
    id: "performance_intelligence", label: "Performance Intelligence", runsOn: "checks",
    today: "Re-checks completed or approved work on the next website check (verified fixed / still found) and compares PageSpeed.",
  },
  market_research: {
    id: "market_research", label: "Market Research", runsOn: "checks",
    today: "Reads the public homepage of up to 5 websites the owner names, and the owner's own, and records what each visibly shows (phone, tap-to-call, service area, reviews, prices, search markup). It does not find competitors or use keyword or traffic data.",
  },
  marketing_strategy: {
    id: "marketing_strategy", label: "Marketing Strategy", runsOn: "model",
    today: "A proposed plan from the business understanding and the open findings: objectives, ordered priorities tied to real actions, next steps and questions for the owner; the owner revises, approves or rejects it (behind a switch, development and Preview). Market research is not connected, so the plan uses only the business's own details and website findings.",
  },
  content_creation: {
    id: "content_creation", label: "Content Creation", runsOn: "model",
    today: "Homepage copy and SEO titles/descriptions from the business understanding and the evidence; editable versions; owner approval (behind a switch, development and Preview).",
  },
  campaign_planning: {
    id: "campaign_planning", label: "Campaign Planning", runsOn: "checks",
    today: "Fixed playbooks (fix what visitors notice first, close gaps other sites show, ask for reviews, Google Business Profile) offered only when something observed calls for them. Tasks carry their reason and evidence class, with fixed-template drafts the owner edits; the owner approves, does the work and marks it done.",
  },
  marketing_execution: {
    id: "marketing_execution", label: "Marketing Execution", runsOn: "integration",
    today: "Not available: no publishing or sending integration exists. The owner does the work and records it.",
  },
};

export interface Availability {
  /** A model provider is configured (see provider.ts). */
  modelProvider: boolean;
}

/** Why a capability cannot run now, or null when it can. */
export function unavailableReason(id: CapabilityId, env: Availability): string | null {
  const c = CAPABILITIES[id];
  if (c.runsOn === "checks") return null;
  if (c.runsOn === "model") return env.modelProvider ? null : "No language model is available yet. Something Clicks is building its own model hosting.";
  return "No authorized integration exists for this yet.";
}
