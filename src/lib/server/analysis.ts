import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import type { Database, Json } from "@/lib/supabase/types";

import { wordFindings } from "./ai";
import { runChecks, type BusinessContext } from "./checks";
import { runPageSpeed } from "./pagespeed";
import { createSafeFetcher, FetchBlockedError, type FetchedPage } from "./safe-fetch";
import { scanSite } from "./site-scan";

export type Db = SupabaseClient<Database>;

/** What the customer sees when the analysis cannot finish. Never includes internals. */
function friendlyReason(error: unknown, website: string): string {
  const host = (() => {
    try {
      return new URL(website).hostname;
    } catch {
      return website;
    }
  })();
  if (error instanceof FetchBlockedError) return `We couldn't analyze ${host}: ${error.message}`;
  return `We couldn't reach ${host}. Check that the website address is right and the site is online, then try again.`;
}

/**
 * Runs one analysis end to end as the signed-in user (RLS applies to every call).
 * The analysis row must already exist (start_analysis). Always ends in
 * complete_analysis or fail_analysis.
 */
export interface AnalysisDeps {
  fetchPage?: (url: string) => Promise<FetchedPage>;
  pageSpeed?: typeof runPageSpeed;
}

export async function runAnalysis(
  db: Pick<Db, "rpc">,
  analysisId: string,
  website: string,
  biz: BusinessContext,
  deps: AnalysisDeps = {},
) {
  const started = Date.now();
  try {
    const fetchPage = deps.fetchPage ?? createSafeFetcher();
    const pageSpeed = deps.pageSpeed ?? runPageSpeed;
    const [scan, psi] = await Promise.all([scanSite(website, fetchPage), pageSpeed(website)]);
    if (scan.homepage.status >= 400) {
      throw new FetchBlockedError(`your homepage returned an error (${scan.homepage.status}).`);
    }
    const { evidence, findings } = runChecks(scan, psi, biz);
    const pagesReviewed = 1 + scan.pages.length;
    const worded = await wordFindings(findings, evidence, biz, pagesReviewed);

    const coverage = {
      website: { status: "observed", pages_reviewed: pagesReviewed, pages_unreachable: scan.failures.length },
      pagespeed: psi.ok ? { status: "measured", score: psi.performanceScore } : { status: "missing", reason: psi.reason },
      search_console: { status: "not_connected" },
      google_business_profile: { status: "not_connected" },
    };

    const { error } = await db.rpc("complete_analysis", {
      p_analysis: analysisId,
      p_evidence: evidence as unknown as Json,
      p_cards: worded.findings as unknown as Json,
      p_coverage: coverage as unknown as Json,
      p_summary: worded.summary,
      p_wording: worded.wording,
    });
    if (error) throw new Error(`complete_analysis failed: ${error.message}`);
    log.info("analysis.completed", { analysisId, ms: Date.now() - started, cards: findings.length, evidence: evidence.length, wording: worded.wording, pagespeed: psi.ok });
  } catch (error) {
    log.error("analysis.failed", { analysisId, ms: Date.now() - started, error });
    const { error: failError } = await db.rpc("fail_analysis", { p_analysis: analysisId, p_reason: friendlyReason(error, website) });
    if (failError) log.error("analysis.fail_record_failed", { analysisId, error: failError.message });
  }
}
