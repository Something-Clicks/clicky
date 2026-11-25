import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import type { Database, Json } from "@/lib/supabase/types";

import type { BusinessContext, Evidence } from "./checks";
import { marketingAnalysis, type ClassifiedFinding } from "./agent/modules/marketing-analysis";
import { seoIntelligence, type SeoIntelligence } from "./agent/modules/seo-intelligence";
import { expectDone } from "./agent/modules/types";
import { websiteIntelligence } from "./agent/modules/website-intelligence";
import type { RankedNeed } from "./agent/rank";
import type { runPageSpeed } from "./pagespeed";
import { notify } from "./notify";
import { FetchBlockedError, type FetchedPage } from "./safe-fetch";
import type { SiteScan } from "./site-scan";
import { track } from "./site";

export type Db = SupabaseClient<Database>;

/** The overview line above the cards: counts only, fixed wording. */
export function templateSummary(findings: { impact_priority: string }[], pagesReviewed: number): string {
  const high = findings.filter((f) => f.impact_priority === "high").length;
  if (findings.length === 0) {
    return `We reviewed ${pagesReviewed} page${pagesReviewed === 1 ? "" : "s"} and didn't find anything that needs attention right now.`;
  }
  return `We reviewed ${pagesReviewed} page${pagesReviewed === 1 ? "" : "s"} and found ${findings.length} thing${findings.length === 1 ? "" : "s"} worth your attention${high ? `, ${high} of them high impact` : ""}. Start with the first card below.`;
}

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
  /** Findings with their category and evidence class (Marketing Analysis). */
  findings: ClassifiedFinding[];
  coverage: Record<string, unknown>;
  summary: string;
  wording: "ai" | "template";
  pagespeed: boolean;
  /** What Website Intelligence retrieved, for capabilities that run next (Business Intelligence). */
  scan: SiteScan;
  ranked: RankedNeed[];
  seo: SeoIntelligence;
}

/**
 * Runs the Marketing Agent's analysis capabilities on a website: Website Intelligence, then
 * Marketing Analysis, then SEO Intelligence, then wording. Shared by the workspace analysis and the
 * anonymous first result, so both show exactly the same evidence.
 */
export async function analyzeWebsite(website: string, biz: BusinessContext, deps: AnalysisDeps = {}): Promise<AnalysisResult> {
  const site = expectDone(await websiteIntelligence.run({ website, fetchPage: deps.fetchPage, pageSpeed: deps.pageSpeed }), "website_intelligence").output;
  const analysis = expectDone(await marketingAnalysis.run({ site, business: biz }), "marketing_analysis").output;
  const seo = expectDone(await seoIntelligence.run({ analysis }), "seo_intelligence").output;
  // Card wording is fixed text written by Something Clicks for each check; no model rewrites it.
  const summary = templateSummary(analysis.findings, site.pagesReviewed);
  const findings = analysis.findings;
  const coverage = {
    website: { status: "observed", pages_reviewed: site.pagesReviewed, pages_unreachable: site.scan.failures.length },
    pagespeed: site.psi.ok ? { status: "measured", score: site.psi.performanceScore } : { status: "missing", reason: site.psi.reason },
    search_console: { status: "not_connected" },
    google_business_profile: { status: "not_connected" },
  };
  return { evidence: analysis.evidence, findings, coverage, summary, wording: "template", pagespeed: site.psi.ok, scan: site.scan, ranked: analysis.ranked, seo };
}

export type AnalysisOutcome = { ok: true; result: AnalysisResult } | { ok: false; reason: string };

export async function runAnalysis(
  db: Pick<Db, "rpc">,
  analysisId: string,
  website: string,
  biz: BusinessContext,
  deps: AnalysisDeps = {},
): Promise<AnalysisOutcome> {
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
    return { ok: true, result: r };
  } catch (error) {
    log.error("analysis.failed", { analysisId, ms: Date.now() - started, error });
    const reason = friendlyReason(error, website);
    const { error: failError } = await db.rpc("fail_analysis", { p_analysis: analysisId, p_reason: reason });
    if (failError) log.error("analysis.fail_record_failed", { analysisId, error: failError.message });
    return { ok: false, reason };
  }
}
