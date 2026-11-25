/**
 * Real-site check for the deterministic agent. Run ONLY on sites you own or have permission to scan, from a machine
 * with internet access:   SITECHECK_URLS="https://a.example,https://b.example" pnpm sitecheck
 * No database, no model, no key. Writes eval-results/sitecheck-<time>.md for a person to check against the live sites.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkSite, toMarkdown } from "./run";

const urls = (process.env.SITECHECK_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

describe.skipIf(urls.length === 0)("deterministic agent on real sites", () => {
  it("scans each site and writes a report to check by hand", async () => {
    const reports = [];
    for (const u of urls) reports.push(await checkSite(u, { businessName: new URL(u).hostname.replace(/^www\./, ""), serviceArea: null, primaryGoal: null }));
    mkdirSync("eval-results", { recursive: true });
    const file = `eval-results/sitecheck-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
    writeFileSync(file, toMarkdown(reports));
    console.log(`Report written to ${file}`);
    expect(reports.length).toBe(urls.length);
  }, 600_000);
});
