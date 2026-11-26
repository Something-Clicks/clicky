/**
 * Runs the model check against OUR model server. Needs no database and no customer data; it never runs in CI.
 *
 *   SELF_HOSTED_MODEL_URL=https://… SELF_HOSTED_MODEL_TOKEN=… SELF_HOSTED_MODEL_ID=… \
 *   MODELCHECK_FIXTURES=1 pnpm modelcheck                       # the 4 bundled fictional sites (a smoke set, NOT the frozen evaluation set)
 *   … MODELCHECK_URLS="https://a.example,https://b.example"      # real sites ONLY with the owner's written permission
 * Optional: SELF_HOSTED_ATTEMPT_TIMEOUT_MS (try 240000 for slow models), SELF_HOSTED_EXTRA_BODY (a thinking switch your
 * server understands), MODELCHECK_GPU_USD_PER_HOUR (price of the GPU used, to estimate compute per business).
 * Writes eval-results/modelcheck-<time>.json (raw outputs, for people to score) and .md (automatic measurements).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { selfHostedProvider } from "@/lib/server/agent/providers/self-hosted";
import type { FetchedPage } from "@/lib/server/safe-fetch";

import { runSite, summarize, toMarkdown, type ModelCheckReport } from "./run";

const provider = selfHostedProvider(process.env);
const urls = (process.env.MODELCHECK_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const fixtures = process.env.MODELCHECK_FIXTURES === "1";
const FIXTURE_SITES = [["plumber.html", "sunrise-plumbing.example"], ["thin-onepager.html", "joes-lawn.example"], ["claims-heavy.html", "texas-best-roofing.example"], ["images-only.html", "bloom-studio.example"]] as const;

describe.skipIf(!provider || (!fixtures && urls.length === 0))("model check against our model server", () => {
  it("runs every capability on each site and writes the measurements and raw outputs", async () => {
    const gpu = Number(process.env.MODELCHECK_GPU_USD_PER_HOUR);
    const tasks = [];
    const sites: string[] = [];
    if (fixtures) {
      for (const [file, host] of FIXTURE_SITES) {
        const body = readFileSync(join(__dirname, "..", "..", "tests", "fixtures", "sites", file), "utf8");
        const fetchPage = async (url: string): Promise<FetchedPage> => { const root = new URL(url).pathname === "/"; return { url, status: root ? 200 : 404, contentType: "text/html", body: root ? body : "", truncated: false, redirects: [] }; };
        sites.push(`https://${host}/`);
        tasks.push(...(await runSite(provider!, `https://${host}/`, { businessName: host, serviceArea: null, primaryGoal: null }, { fetchPage, pageSpeed: async () => ({ ok: false as const, reason: "not measured" }) })).tasks);
      }
    }
    for (const u of urls) {
      sites.push(u);
      tasks.push(...(await runSite(provider!, u, { businessName: new URL(u).hostname.replace(/^www\./, ""), serviceArea: null, primaryGoal: null })).tasks);
    }
    const report: ModelCheckReport = { provider: provider!.id, model: provider!.model ?? "unknown", startedAt: new Date().toISOString(), sites, tasks, summary: summarize(tasks, Number.isFinite(gpu) && gpu > 0 ? gpu : null) };
    mkdirSync("eval-results", { recursive: true });
    const stamp = report.startedAt.replace(/[:.]/g, "-");
    writeFileSync(`eval-results/modelcheck-${stamp}.json`, JSON.stringify(report, null, 2));
    writeFileSync(`eval-results/modelcheck-${stamp}.md`, toMarkdown(report));
    console.log(`Model check written to eval-results/modelcheck-${stamp}.md`);
    expect(tasks.length).toBeGreaterThan(0);
  }, 3_600_000);
});
