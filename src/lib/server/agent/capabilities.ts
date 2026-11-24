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
    today: "Reads the business profile the owner entered (name, website, service area, main goal) and lists what is missing.",
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
    today: "Turns check results into evidence-backed findings and ranks them (impact, evidence strength, confidence).",
  },
  performance_intelligence: {
    id: "performance_intelligence", label: "Performance Intelligence", runsOn: "checks",
    today: "Re-checks completed or approved work on the next website check (verified fixed / still found) and compares PageSpeed.",
  },
  market_research: {
    id: "market_research", label: "Market Research", runsOn: "model",
    today: "Not available: needs a model provider and a research data source.",
  },
  marketing_strategy: {
    id: "marketing_strategy", label: "Marketing Strategy", runsOn: "model",
    today: "Not available: needs a model provider.",
  },
  content_creation: {
    id: "content_creation", label: "Content Creation", runsOn: "model",
    today: "Not available: needs a model provider (drafts are switched off).",
  },
  campaign_planning: {
    id: "campaign_planning", label: "Campaign Planning", runsOn: "model",
    today: "Not available: needs a model provider.",
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
  if (c.runsOn === "model") return env.modelProvider ? null : "No model provider is configured (provider decision pending).";
  return "No authorized integration exists for this yet.";
}
