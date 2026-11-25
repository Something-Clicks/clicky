import { getModelProvider } from "../provider";
import type { CapabilityId } from "../capabilities";
import { businessIntelligence } from "./business-intelligence";
import { createContent, type ContentDraft, type ContentInput } from "./content-creation";
import { marketingAnalysis } from "./marketing-analysis";
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
 *   built, model only (blocked without a provider): content_creation (website copy, SEO titles/descriptions)
 *   not built yet (report "blocked"): market_research, marketing_strategy, campaign_planning, marketing_execution
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

export const MODULES = {
  business_intelligence: businessIntelligence,
  website_intelligence: websiteIntelligence,
  seo_intelligence: seoIntelligence,
  marketing_analysis: marketingAnalysis,
  performance_intelligence: performanceIntelligence,
  market_research: notYetAvailable("market_research", hasModel),
  marketing_strategy: notYetAvailable("marketing_strategy", hasModel),
  content_creation: contentCreation,
  campaign_planning: notYetAvailable("campaign_planning", hasModel),
  marketing_execution: notYetAvailable("marketing_execution", hasModel),
} satisfies Record<CapabilityId, CapabilityModule<never, unknown>>;

export const BUILT: CapabilityId[] = ["business_intelligence", "website_intelligence", "seo_intelligence", "marketing_analysis", "performance_intelligence", "content_creation"];
