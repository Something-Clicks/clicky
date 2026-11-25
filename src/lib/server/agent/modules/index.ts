import { getModelProvider } from "../provider";
import type { CapabilityId } from "../capabilities";
import { businessIntelligence } from "./business-intelligence";
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
 *   built (fixed, evidence-based code): business_intelligence, website_intelligence,
 *     seo_intelligence, marketing_analysis, performance_intelligence
 *   not built yet (report "blocked"): market_research, marketing_strategy, content_creation,
 *     campaign_planning, marketing_execution
 */
const hasModel = () => getModelProvider() !== null;

export const MODULES = {
  business_intelligence: businessIntelligence,
  website_intelligence: websiteIntelligence,
  seo_intelligence: seoIntelligence,
  marketing_analysis: marketingAnalysis,
  performance_intelligence: performanceIntelligence,
  market_research: notYetAvailable("market_research", hasModel),
  marketing_strategy: notYetAvailable("marketing_strategy", hasModel),
  content_creation: notYetAvailable("content_creation", hasModel),
  campaign_planning: notYetAvailable("campaign_planning", hasModel),
  marketing_execution: notYetAvailable("marketing_execution", hasModel),
} satisfies Record<CapabilityId, CapabilityModule<never, unknown>>;

export const BUILT: CapabilityId[] = ["business_intelligence", "website_intelligence", "seo_intelligence", "marketing_analysis", "performance_intelligence"];
