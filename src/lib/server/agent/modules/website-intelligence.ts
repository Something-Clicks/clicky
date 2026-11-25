import { runPageSpeed, type PageSpeedMissing, type PageSpeedResult } from "../../pagespeed";
import { createSafeFetcher, FetchBlockedError, type FetchedPage } from "../../safe-fetch";
import { scanSite, type SiteScan } from "../../site-scan";
import type { CapabilityModule } from "./types";

/**
 * Website Intelligence (§5): safe discovery of the homepage and the most relevant internal pages
 * (contact, services, about, pricing, locations), metadata and readable text, plus Google's mobile
 * speed measurement when available. Retrieval failures are recorded, never filled in.
 * Safety (SSRF, redirects, size, time) lives in safe-fetch.
 */
export interface WebsiteIntelligenceInput {
  website: string;
  fetchPage?: (url: string) => Promise<FetchedPage>;
  pageSpeed?: (url: string) => Promise<PageSpeedResult | PageSpeedMissing>;
}

export interface WebsiteIntelligence {
  scan: SiteScan;
  psi: PageSpeedResult | PageSpeedMissing;
  pagesReviewed: number;
}

export const websiteIntelligence: CapabilityModule<WebsiteIntelligenceInput, WebsiteIntelligence> = {
  id: "website_intelligence",
  async run({ website, fetchPage = createSafeFetcher(), pageSpeed = runPageSpeed }) {
    const [scan, psi] = await Promise.all([scanSite(website, fetchPage), pageSpeed(website)]);
    if (scan.homepage.status >= 400) {
      throw new FetchBlockedError(`your homepage returned an error (${scan.homepage.status}).`, "status", scan.homepage.status);
    }
    const pagesReviewed = 1 + scan.pages.length;
    return {
      status: "done",
      output: { scan, psi, pagesReviewed },
      detail: `Reviewed ${pagesReviewed} page${pagesReviewed === 1 ? "" : "s"}${scan.failures.length ? `; ${scan.failures.length} could not be read` : ""}; mobile speed ${psi.ok ? "measured" : "not available"}.`,
    };
  },
};
