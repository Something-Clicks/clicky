import { siteSignals, type SiteSignals } from "@/lib/research";

import { createSafeFetcher, FetchBlockedError, type FetchedPage } from "../../safe-fetch";
import { extractFacts } from "../../site-scan";
import type { CapabilityModule } from "./types";

/**
 * Market Research (§4), the part that needs no model and no data subscription: reads the public homepage of each website
 * the owner names (and the owner's own) and records what is visibly there. It never searches for competitors, never
 * guesses who they are, and never presents anything it did not read. A site it cannot read is recorded as failed.
 */
export interface ResearchInput {
  /** The business's own website first, then up to 5 sites the owner named. */
  targets: { url: string; own: boolean }[];
  fetchPage?: (url: string) => Promise<FetchedPage>;
}

export interface ResearchResult {
  url: string;
  host: string;
  own: boolean;
  status: "done" | "failed";
  signals: SiteSignals | null;
  failure: string | null;
}

export const marketResearch: CapabilityModule<ResearchInput, ResearchResult[]> = {
  id: "market_research",
  async run({ targets, fetchPage = createSafeFetcher() }) {
    const results = await Promise.all(
      targets.map(async (t): Promise<ResearchResult> => {
        let host = t.url;
        try {
          host = new URL(t.url).hostname.toLowerCase().replace(/^www\./, "");
          const page = await fetchPage(t.url);
          if (page.status >= 400) return { url: t.url, host, own: t.own, status: "failed", signals: null, failure: `The page returned an error (${page.status}).` };
          return { url: t.url, host, own: t.own, status: "done", signals: siteSignals(extractFacts(page)), failure: null };
        } catch (error) {
          const why = error instanceof FetchBlockedError ? error.message : "";
          // Plain words only: the address and the kind of problem, no internals.
          return { url: t.url, host, own: t.own, status: "failed", signals: null, failure: `We couldn't read ${host}${why ? ` (${why.slice(0, 120)})` : ""}.` };
        }
      }),
    );
    const read = results.filter((r) => r.status === "done").length;
    return { status: "done", output: results, detail: `Read ${read} of ${results.length} homepage${results.length === 1 ? "" : "s"}.` };
  },
};
