import type { Evidence } from "../../checks";
import type { CapabilityModule } from "./types";
import type { ClassifiedFinding, MarketingAnalysis } from "./marketing-analysis";

/**
 * SEO Intelligence (§4.3, §5.2 SEO): today, on-page search signals only: page titles, meta
 * descriptions, headings (via the findings), plus what was checked on every reviewed page.
 * Keyword research and search visibility need a data source (manual Semrush import later).
 */
export interface SeoIntelligence {
  findings: ClassifiedFinding[];
  pages: { url: string; title: string | null; title_length: number | null }[];
  keyword_data: "not_connected";
}

export const seoIntelligence: CapabilityModule<{ analysis: MarketingAnalysis }, SeoIntelligence> = {
  id: "seo_intelligence",
  async run({ analysis }) {
    const findings = analysis.findings.filter((f) => f.category === "seo");
    const pages = analysis.evidence
      .filter((e: Evidence) => e.check_key === "site.page_reviewed" && e.url)
      .map((e) => {
        const title = e.excerpt?.startsWith("Title: ") ? e.excerpt.slice(7) : null;
        return { url: e.url!, title, title_length: title?.length ?? null };
      });
    return {
      status: "done",
      output: { findings, pages, keyword_data: "not_connected" },
      detail: `${findings.length} on-page search finding${findings.length === 1 ? "" : "s"} across ${pages.length} page${pages.length === 1 ? "" : "s"}; keyword data not connected.`,
    };
  },
};
