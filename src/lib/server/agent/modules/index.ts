import { getModelProvider, type ModelProvider } from "../provider";
import type { CapabilityId } from "../capabilities";
import { campaignPlanning } from "./campaign-planning";
import { businessIntelligence } from "./business-intelligence";
import { createContent, type ContentDraft, type ContentInput } from "./content-creation";
import { marketResearch } from "./market-research";
import { marketingAnalysis } from "./marketing-analysis";
import { createPlan, type MarketingPlan, type PlanInput } from "./marketing-strategy";
import { performanceIntelligence } from "./performance-intelligence";
import { seoIntelligence } from "./seo-intelligence";
import type { CapabilityModule } from "./types";
import { marketingExecution } from "./marketing-execution";
import { websiteIntelligence } from "./website-intelligence";

/**
 * The Something Clicks Marketing Agent's capability modules, one per capability in the
 * specification (§2.2). Workflows reach capabilities only through this registry.
 *
 *   built, fixed evidence-based code: website_intelligence, seo_intelligence, performance_intelligence
 *   built, fixed code plus a model-assisted part (development and Preview only): business_intelligence,
 *     marketing_analysis
 *   built, model only (blocked without a provider): content_creation (website copy, SEO titles/descriptions),
 *     marketing_strategy (a proposed plan the owner approves)
 *   built, fixed code (no model): market_research (named public homepages), campaign_planning (fixed playbooks)
 *   built, fixed code (no model): marketing_execution (only actions the application performs itself, after the owner
 *     authorizes; publishing, sending and ad spend have no integration and are refused)
 */
const hasModel = () => getModelProvider() !== null;

/**
 * Model-using modules take their provider from the caller, who wraps it with meteredProvider, so a call can never
 * skip cost metering. Without one they are blocked: because none is configured, or because the caller supplied none.
 */
const noProvider = (): { status: "blocked"; reason: string } => ({
  status: "blocked",
  reason: hasModel() ? "A metered model provider must be supplied by the caller." : "No model provider is configured (development and Preview only).",
});

/** Content Creation (§8): website copy and SEO titles/descriptions, via the provider-neutral interface. */
const contentCreation: CapabilityModule<ContentInput & { provider?: ModelProvider | null }, ContentDraft> = {
  id: "content_creation",
  async run(input) {
    const provider = input.provider;
    if (!provider) return noProvider();
    const draft = await createContent(provider, input);
    return { status: "done", output: draft, detail: `Prepared ${draft.fields.length} part${draft.fields.length === 1 ? "" : "s"} of ${input.kind === "meta" ? "a page title and description" : "homepage copy"}.` };
  },
};

/** Marketing Strategy (§7): a proposed plan from the business understanding and the open findings. */
const marketingStrategy: CapabilityModule<PlanInput, MarketingPlan> = {
  id: "marketing_strategy",
  async run(input) {
    const provider = input.provider;
    if (!provider) return noProvider();
    const plan = await createPlan(provider, input);
    const n = plan.plan.priorities.length;
    return { status: "done", output: plan, detail: `Proposed a plan with ${n} priorit${n === 1 ? "y" : "ies"} and ${plan.plan.next_steps.length} next steps for the owner to review.` };
  },
};

export const MODULES = {
  business_intelligence: businessIntelligence,
  website_intelligence: websiteIntelligence,
  seo_intelligence: seoIntelligence,
  marketing_analysis: marketingAnalysis,
  performance_intelligence: performanceIntelligence,
  market_research: marketResearch,
  marketing_strategy: marketingStrategy,
  content_creation: contentCreation,
  campaign_planning: campaignPlanning,
  marketing_execution: marketingExecution,
} satisfies Record<CapabilityId, CapabilityModule<never, unknown>>;

export const BUILT: CapabilityId[] = ["business_intelligence", "website_intelligence", "seo_intelligence", "marketing_analysis", "performance_intelligence", "content_creation", "marketing_strategy", "market_research", "campaign_planning", "marketing_execution"];
