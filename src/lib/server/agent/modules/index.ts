import { getModelProvider } from "../provider";
import type { CapabilityId } from "../capabilities";
import { businessIntelligence } from "./business-intelligence";
import { createContent, type ContentDraft, type ContentInput } from "./content-creation";
import { marketingAnalysis } from "./marketing-analysis";
import { createPlan, type MarketingPlan, type PlanInput } from "./marketing-strategy";
import { performanceIntelligence } from "./performance-intelligence";
import { seoIntelligence } from "./seo-intelligence";
import type { CapabilityModule } from "./types";
import { notYetAvailable } from "./unavailable";
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
 *   not built yet (report "blocked"): market_research, campaign_planning, marketing_execution
 */
const hasModel = () => getModelProvider() !== null;

/** Content Creation (§8): website copy and SEO titles/descriptions, via the provider-neutral interface. */
const contentCreation: CapabilityModule<ContentInput, ContentDraft> = {
  id: "content_creation",
  async run(input) {
    const provider = getModelProvider();
    if (!provider) return { status: "blocked", reason: "No model provider is configured (development and Preview only)." };
    const draft = await createContent(provider, input);
    return { status: "done", output: draft, detail: `Prepared ${draft.fields.length} part${draft.fields.length === 1 ? "" : "s"} of ${input.kind === "meta" ? "a page title and description" : "homepage copy"}.` };
  },
};

/** Marketing Strategy (§7): a proposed plan from the business understanding and the open findings. */
const marketingStrategy: CapabilityModule<PlanInput, MarketingPlan> = {
  id: "marketing_strategy",
  async run(input) {
    const provider = input.provider ?? getModelProvider();
    if (!provider) return { status: "blocked", reason: "No model provider is configured (development and Preview only)." };
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
  market_research: notYetAvailable("market_research", hasModel),
  marketing_strategy: marketingStrategy,
  content_creation: contentCreation,
  campaign_planning: notYetAvailable("campaign_planning", hasModel),
  marketing_execution: notYetAvailable("marketing_execution", hasModel),
} satisfies Record<CapabilityId, CapabilityModule<never, unknown>>;

export const BUILT: CapabilityId[] = ["business_intelligence", "website_intelligence", "seo_intelligence", "marketing_analysis", "performance_intelligence", "content_creation", "marketing_strategy"];
