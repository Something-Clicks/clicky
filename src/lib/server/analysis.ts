import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import type { Database, Json } from "@/lib/supabase/types";

import { wordFindings } from "./ai";
import { runChecks, type BusinessContext, type Evidence, type Finding } from "./checks";
import { runPageSpeed } from "./pagespeed";
import { notify } from "./notify";
import { createSafeFetcher, FetchBlockedError, type FetchedPage } from "./safe-fetch";
import { scanSite } from "./site-scan";
import { track } from "./site";

export type Db = SupabaseClient<Database>;

/**
 * What the customer sees when the analysis cannot finish: calm, plain words, and what to do next.
 * Never includes internals (status codes, port rules, stack traces).
 */
export function friendlyReason(error: unknown, website: string): string {
  const host = (() => {
    try {
      return new URL(website).hostname.replace(/^www\./, "");
    } catch {
      return website;
    }
  })();
  if (error instanceof FetchBlockedError) {
    switch (error.kind) {
      case "invalid_address":
        return "That doesn't look like a website address. Check it for typos (it should look like yourbusiness.com) and try again.";
      case "not_public":
        return `${host} isn't a public website we can check. Use the address people type to visit your site, like yourbusiness.com.`;
      case "redirects":
        return `${host} keeps sending visitors in circles, so we couldn't open it. Try your main address, like https://yourbusiness.com.`;
      case "not_a_page":
        return `That address opens a file, not a web page. Try your homepage address instead.`;
      case "too_large":
        return `The page at ${host} is too big for us to read. Try your main address, and try again in a little while.`;
      case "status": {
        const code = error.status ?? 0;
        if (code === 404 || code === 410) return `We couldn't find a page at ${host}. Check the address and try again.`;
        if (code === 401 || code === 403 || code === 406 || code === 429 || code === 451) {
          return `${host} didn't let us in. Some websites block automatic visitors. Try again in a few minutes, or ask whoever runs your website to allow Something Clicks.`;
        }
        return `${host} is having trouble answering right now. Try again in a few minutes.`;
      }
      default:
        return `We couldn't check ${host}. Check the address and try again in a few minutes.`;
    }
  }
  return `We couldn't reach ${host}. Check that the address is right and the site is online, then try again.`;
}

/**
 * Runs one analysis end to end as the signed-in user (RLS applies to every call).
 * The analysis row must already exist (start_analysis). Always ends in
 * complete_analysis or fail_analysis.
 */
export interface AnalysisDeps {
  fetchPage?: (url: string) => Promise<FetchedPage>;
  pageSpeed?: typeof runPageSpeed;
  /** When set, emails the business's opted-in people once the analysis is saved. */
  notifyOrg?: string;
}

/** The finished result of one website analysis, ready to save. */
export interface AnalysisResult {
  evidence: Evidence[];
  findings: Finding[];
  coverage: Record<string, unknown>;
  summary: string;
  wording: "ai" | "template";
  pagespeed: boolean;
}

/**
 * Scans the website, runs the checks, and words the findings. Shared by the workspace
 * analysis and the anonymous first result, so both show exactly the same evidence.
 */
export async function analyzeWebsite(website: string, biz: BusinessContext, deps: AnalysisDeps = {}): Promise<AnalysisResult> {
  const fetchPage = deps.fetchPage ?? createSafeFetcher();
  const pageSpeed = deps.pageSpeed ?? runPageSpeed;
  const [scan, psi] = await Promise.all([scanSite(website, fetchPage), pageSpeed(website)]);
  if (scan.homepage.status >= 400) {
    throw new FetchBlockedError(`your homepage returned an error (${scan.homepage.status}).`, "status", scan.homepage.status);
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
  return { evidence, findings: worded.findings, coverage, summary: worded.summary, wording: worded.wording as "ai" | "template", pagespeed: psi.ok };
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
    const r = await analyzeWebsite(website, biz, deps);
    const { error } = await db.rpc("complete_analysis", {
      p_analysis: analysisId,
      p_evidence: r.evidence as unknown as Json,
      p_cards: r.findings as unknown as Json,
      p_coverage: r.coverage as unknown as Json,
      p_summary: r.summary,
      p_wording: r.wording,
    });
    if (error) throw new Error(`complete_analysis failed: ${error.message}`);
    if (deps.notifyOrg) await notify(db, deps.notifyOrg, biz.businessName, "analysis_complete");
    await track("reanalysis_completed");
    log.info("analysis.completed", { analysisId, ms: Date.now() - started, cards: r.findings.length, evidence: r.evidence.length, wording: r.wording, pagespeed: r.pagespeed });
  } catch (error) {
    log.error("analysis.failed", { analysisId, ms: Date.now() - started, error });
    const { error: failError } = await db.rpc("fail_analysis", { p_analysis: analysisId, p_reason: friendlyReason(error, website) });
    if (failError) log.error("analysis.fail_record_failed", { analysisId, error: failError.message });
  }
}
