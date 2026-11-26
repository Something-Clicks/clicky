import { CAPABILITIES, unavailableReason, type Availability, type CapabilityId } from "./capabilities";

/**
 * Workflow selection (spec 12.2): each kind of request runs only the capabilities it needs.
 * Kinds match the marketing_workflows.kind check constraint.
 */
export type WorkflowKind =
  | "website_review"
  | "homepage_headline"
  | "competitor_research"
  | "marketing_plan"
  | "promotional_campaign"
  | "results_review";

export const WORKFLOWS: Record<WorkflowKind, { label: string; capabilities: CapabilityId[] }> = {
  // Understand the business, analyze the website, identify and rank needs, explain why. Runs on checks today.
  website_review: {
    label: "Review the website and rank what to fix",
    capabilities: ["business_intelligence", "website_intelligence", "seo_intelligence", "marketing_analysis"],
  },
  homepage_headline: {
    label: "Improve the homepage headline",
    capabilities: ["business_intelligence", "website_intelligence", "marketing_analysis", "content_creation"],
  },
  competitor_research: {
    label: "Research competitors",
    capabilities: ["business_intelligence", "market_research"],
  },
  marketing_plan: {
    label: "Develop a marketing plan",
    capabilities: ["business_intelligence", "market_research", "website_intelligence", "marketing_analysis", "marketing_strategy"],
  },
  promotional_campaign: {
    label: "Prepare a promotional campaign",
    capabilities: ["business_intelligence", "market_research", "campaign_planning"],
  },
  results_review: {
    label: "Evaluate the latest marketing results",
    capabilities: ["performance_intelligence", "marketing_analysis", "marketing_strategy"],
  },
};

export const isWorkflowKind = (v: unknown): v is WorkflowKind => typeof v === "string" && Object.hasOwn(WORKFLOWS, v);

export interface PlannedStep {
  capability: CapabilityId;
  runsOn: string;
  available: boolean;
  reason: string | null;
}

export interface WorkflowPlan {
  kind: WorkflowKind;
  capabilities: CapabilityId[];
  steps: PlannedStep[];
  /** Null when every required capability can run; otherwise why the workflow is blocked. */
  blocked: string | null;
}

export function planWorkflow(kind: WorkflowKind, env: Availability): WorkflowPlan {
  const capabilities = WORKFLOWS[kind].capabilities;
  const steps = capabilities.map((id) => {
    const reason = unavailableReason(id, env);
    return { capability: id, runsOn: CAPABILITIES[id].runsOn, available: reason === null, reason };
  });
  const missing = steps.filter((s) => !s.available);
  const blocked = missing.length
    ? `Needs ${missing.map((s) => CAPABILITIES[s.capability].label).join(", ")}: ${[...new Set(missing.map((s) => s.reason))].join(" ")}`
    : null;
  return { kind, capabilities, steps, blocked };
}
