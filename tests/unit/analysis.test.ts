import { describe, expect, it, vi } from "vitest";

import { runAnalysis } from "@/lib/server/analysis";
import { runChecks } from "@/lib/server/checks";
import type { FetchedPage } from "@/lib/server/safe-fetch";
import { FetchBlockedError } from "@/lib/server/safe-fetch";
import { extractFacts, pickPages, scanSite } from "@/lib/server/site-scan";

const page = (url: string, body: string, status = 200): FetchedPage => ({
  url, status, contentType: "text/html", body, truncated: false, redirects: [],
});

const WEAK_HOME = `<!doctype html><html><head></head><body>
  <nav><a href="/about">About</a><a href="/services/drains">Services</a><a href="/contact">Contact</a><a href="https://other.example/x">x</a><a href="/brochure.pdf">PDF</a></nav>
  <p>Call us at (801) 555-0123 for plumbing.</p><img src="a.jpg"><img src="b.jpg" alt="Van">
  <script>var secret = "not text";</script></body></html>`;

const STRONG_HOME = `<!doctype html><html lang="en"><head><title>Drain Cleaning & Plumbing in Salt Lake City | Sunrise Plumbing</title>
  <meta name="description" content="Fast, friendly plumbing in Salt Lake City. Call or book online today.">
  <meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body><h1>Reliable plumbing in Salt Lake City</h1><a href="tel:+18015550123">Call (801) 555-0123</a>
  <p>${"We fix leaks, clear drains and install water heaters for homes and businesses. ".repeat(20)}</p></body></html>`;

const biz = { businessName: "Sunrise Plumbing", serviceArea: "Salt Lake City", primaryGoal: "more_calls" };
const psiMissing = { ok: false as const, reason: "PageSpeed Insights is busy right now (quota reached)." };

describe("extractFacts / pickPages", () => {
  it("reads titles, headings, phones, images and same-site links; ignores scripts", () => {
    const f = extractFacts(page("https://sunrise.example/", WEAK_HOME));
    expect(f.title).toBeNull();
    expect(f.h1s).toEqual([]);
    expect(f.phoneInText).toBe("(801) 555-0123");
    expect(f.telLinks).toEqual([]);
    expect(f.imagesMissingAlt).toBe(1);
    expect(f.text).not.toContain("secret");
    expect(f.internalLinks).toEqual([
      "https://sunrise.example/about",
      "https://sunrise.example/services/drains",
      "https://sunrise.example/contact",
    ]);
    expect(pickPages(f)).toEqual([
      "https://sunrise.example/contact",
      "https://sunrise.example/services/drains",
      "https://sunrise.example/about",
    ]);
  });
});

describe("runChecks", () => {
  it("turns a weak homepage into prioritized, evidence-cited findings", async () => {
    const scan = await scanSite("https://sunrise.example/", async (u) => (u.endsWith("/") ? page(u, WEAK_HOME) : page(u, "<html><body><h1>x</h1></body></html>")));
    const { evidence, findings } = runChecks(scan, psiMissing, biz);
    const keys = findings.map((f) => f.check_key);
    expect(keys).toEqual(expect.arrayContaining([
      "meta.title_missing", "meta.description_missing", "content.h1_missing", "contact.no_click_to_call",
      "local.service_area_missing", "mobile.viewport_missing", "content.thin_homepage", "a11y.images_missing_alt",
    ]));
    // High impact first.
    const order = findings.map((f) => f.impact_priority);
    expect(order).toEqual([...order].sort((a, b) => ["high", "medium", "low"].indexOf(a) - ["high", "medium", "low"].indexOf(b)));
    // more_calls goal makes click-to-call high impact.
    expect(findings.find((f) => f.check_key === "contact.no_click_to_call")!.impact_priority).toBe("high");
    // Every finding cites evidence that exists.
    const evKeys = new Set(evidence.map((e) => e.key));
    for (const f of findings) {
      expect(f.evidence_keys.length).toBeGreaterThan(0);
      for (const k of f.evidence_keys) expect(evKeys.has(k)).toBe(true);
    }
    // Missing PageSpeed is recorded as missing, not invented.
    expect(evidence.find((e) => e.source === "pagespeed")).toMatchObject({ kind: "missing" });
    // No finding promises results.
    for (const f of findings) expect(JSON.stringify(f)).not.toMatch(/guarantee|\d+\s?%|rank first/i);
  });

  it("finds little on a strong homepage and records what is working", async () => {
    const scan = await scanSite("https://sunrise.example/", async (u) => page(u, STRONG_HOME));
    const psi = { ok: true as const, url: "https://sunrise.example/", strategy: "mobile" as const, performanceScore: 93, lcpMs: 1800, cls: 0.01, tbtMs: 50 };
    const { evidence, findings } = runChecks(scan, psi, biz);
    expect(findings).toEqual([]);
    expect(evidence.map((e) => e.check_key)).toEqual(expect.arrayContaining(["meta.title", "contact.click_to_call", "local.service_area", "pagespeed.performance"]));
    expect(evidence.find((e) => e.check_key === "pagespeed.performance")).toMatchObject({ kind: "measured", measurement: { score: 93 } });
  });
});

describe("runAnalysis", () => {
  it("saves evidence and cards through complete_analysis (template wording without an AI key)", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await runAnalysis({ rpc } as never, "a1", "https://sunrise.example/", biz, {
      fetchPage: async (u) => page(u, WEAK_HOME),
      pageSpeed: async () => psiMissing,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("complete_analysis");
    expect(args.p_wording).toBe("template");
    expect(args.p_cards.length).toBeGreaterThan(3);
    expect(args.p_coverage.pagespeed).toEqual({ status: "missing", reason: psiMissing.reason });
    expect(args.p_summary).toMatch(/We reviewed \d pages? and found/);
    // For manual end-to-end checks: DUMP_ANALYSIS_PAYLOAD=/path writes what would be saved.
    if (process.env.DUMP_ANALYSIS_PAYLOAD) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.DUMP_ANALYSIS_PAYLOAD, JSON.stringify(args));
    }
  });

  it("records a plain-language failure when the site cannot be fetched safely", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await runAnalysis({ rpc } as never, "a2", "https://sunrise.example/", biz, {
      fetchPage: async () => {
        throw new FetchBlockedError("That website points to a private address.");
      },
      pageSpeed: async () => psiMissing,
    });
    expect(rpc).toHaveBeenCalledWith("fail_analysis", {
      p_analysis: "a2",
      p_reason: "We couldn't analyze sunrise.example: That website points to a private address.",
    });
  });

  it("fails cleanly when the homepage returns an error", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await runAnalysis({ rpc } as never, "a3", "https://sunrise.example/", biz, {
      fetchPage: async (u) => page(u, "<html>gone</html>", 500),
      pageSpeed: async () => psiMissing,
    });
    expect(rpc.mock.calls[0]![0]).toBe("fail_analysis");
    expect(rpc.mock.calls[0]![1].p_reason).toMatch(/homepage returned an error \(500\)/);
  });
});
