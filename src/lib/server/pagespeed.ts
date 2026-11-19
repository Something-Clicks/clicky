import "server-only";

import { log } from "@/lib/log";

export interface PageSpeedResult {
  ok: true;
  url: string;
  strategy: "mobile";
  performanceScore: number; // 0-100
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
}
export interface PageSpeedMissing {
  ok: false;
  reason: string;
}

/**
 * Google PageSpeed Insights (mobile). Uses PAGESPEED_API_KEY when set; without a key
 * Google allows only a small shared quota. A failure is reported as missing data,
 * never as a made-up score.
 */
export async function runPageSpeed(url: string, timeoutMs = 60_000): Promise<PageSpeedResult | PageSpeedMissing> {
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  endpoint.searchParams.set("category", "performance");
  const key = process.env.PAGESPEED_API_KEY;
  if (key) endpoint.searchParams.set("key", key);

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) {
      log.warn("pagespeed.http_error", { status: res.status });
      return {
        ok: false,
        reason: res.status === 429 ? "PageSpeed Insights is busy right now (quota reached)." : `PageSpeed Insights returned an error (${res.status}).`,
      };
    }
    const json = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number | null } };
        audits?: Record<string, { numericValue?: number }>;
      };
    };
    const lh = json.lighthouseResult;
    const score = lh?.categories?.performance?.score;
    if (typeof score !== "number") return { ok: false, reason: "PageSpeed Insights could not score this page." };
    const num = (k: string) => (typeof lh?.audits?.[k]?.numericValue === "number" ? lh.audits[k]!.numericValue! : null);
    return {
      ok: true,
      url,
      strategy: "mobile",
      performanceScore: Math.round(score * 100),
      lcpMs: num("largest-contentful-paint"),
      cls: num("cumulative-layout-shift"),
      tbtMs: num("total-blocking-time"),
    };
  } catch (error) {
    log.warn("pagespeed.failed", { error });
    return { ok: false, reason: "PageSpeed Insights did not respond in time." };
  }
}
