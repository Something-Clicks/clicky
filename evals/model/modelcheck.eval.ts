/**
 * Runs the model check against OUR model server. Needs no database and no customer data; it never runs in CI.
 *
 *   SELF_HOSTED_MODEL_URL=https://… SELF_HOSTED_MODEL_TOKEN=… SELF_HOSTED_MODEL_ID=… \
 *   MODELCHECK_SET=test pnpm modelcheck        # the frozen evaluation dataset: dev | test | all (evals/model/dataset)
 *   MODELCHECK_SET=test MODELCHECK_CASES=T1,T7  # a subset (an official round needs all of "test")
 *   MODELCHECK_FIXTURES=1 pnpm modelcheck       # the 4 older fixture sites (a smoke set, NOT the dataset)
 *   MODELCHECK_URLS="https://a.example,…"        # real sites ONLY with the owner's written permission
 * Optional: SELF_HOSTED_ATTEMPT_TIMEOUT_MS (try 240000 for slow models), SELF_HOSTED_EXTRA_BODY (a thinking switch your
 * server understands), MODELCHECK_GPU_USD_PER_HOUR and MODELCHECK_GPU_CLASS (the GPU used, for the cost estimate),
 * MODELCHECK_LABEL (for example r1 for round 1).
 * Writes eval-results/modelrun-<model>-<label>-<time>.json (every output, check and measurement: the input to scoring) and a
 * .md summary of the AUTOMATIC measurements. Quality is judged by people with `pnpm modelscore`.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { groqProvider } from "@/lib/server/agent/providers/groq";
import { DECODING, selfHostedProvider } from "@/lib/server/agent/providers/self-hosted";
import type { FetchedPage } from "@/lib/server/safe-fetch";

import { ALL_CASES, DEV_SET, TEST_SET, datasetHash } from "./dataset";
import type { FreezeRecord } from "./freeze";
import { runEvalCase, runSite, summarize, toMarkdown, type ModelCheckReport } from "./run";
import type { CaseRun, ModelRun } from "./types";

// MODELCHECK_PROVIDER=groq runs the dataset against Groq (GROQ_API_KEY, GROQ_MODEL and the two GROQ_PRICE_* variables); the default is the self-hosted server.
const provider = process.env.MODELCHECK_PROVIDER === "groq" ? groqProvider(process.env) : selfHostedProvider(process.env);
const urls = (process.env.MODELCHECK_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const fixtures = process.env.MODELCHECK_FIXTURES === "1";
const set = process.env.MODELCHECK_SET as "dev" | "test" | "all" | undefined;
const FIXTURE_SITES = [["plumber.html", "sunrise-plumbing.example"], ["thin-onepager.html", "joes-lawn.example"], ["claims-heavy.html", "texas-best-roofing.example"], ["images-only.html", "bloom-studio.example"]] as const;
const gitCommit = () => { try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } };
const OUT = process.env.EVAL_RESULTS_DIR ?? "eval-results";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

describe.skipIf(!provider || (!fixtures && urls.length === 0 && !set))("model check against our model server", () => {
  it("runs the frozen evaluation dataset and writes every output, check and measurement", async () => {
    if (!set) return;
    const chosen = (set === "dev" ? DEV_SET : set === "test" ? TEST_SET : ALL_CASES).filter((c) => !process.env.MODELCHECK_CASES || process.env.MODELCHECK_CASES.split(",").map((s) => s.trim()).includes(c.id));
    const names = ALL_CASES.map((c) => c.business.name);
    const cases: CaseRun[] = [];
    for (const c of chosen) cases.push(await runEvalCase(provider!, c, names));
    const freeze = JSON.parse(readFileSync(join(__dirname, "dataset", "FREEZE.json"), "utf8")) as FreezeRecord;
    const gpu = Number(process.env.MODELCHECK_GPU_USD_PER_HOUR);
    const run: ModelRun = {
      schema: 1, provider: provider!.id, model: provider!.model ?? "unknown", startedAt: new Date().toISOString(),
      datasetHash: datasetHash(), frozenMatch: datasetHash() === freeze.datasetHash,
      set: process.env.MODELCHECK_CASES ? "custom" : set,
      settings: { temperature: DECODING.temperature, topP: DECODING.topP, attemptTimeoutMs: provider!.attemptTimeoutMs ?? null, extraBody: process.env.SELF_HOSTED_EXTRA_BODY ?? null, gpuUsdPerHour: Number.isFinite(gpu) && gpu > 0 ? gpu : null, gpuClass: process.env.MODELCHECK_GPU_CLASS ?? null, node: process.version, gitCommit: gitCommit() },
      cases,
    };
    mkdirSync(OUT, { recursive: true });
    const file = `${OUT}/modelrun-${slug(run.model)}-${slug(process.env.MODELCHECK_LABEL ?? "run")}-${stamp()}`;
    writeFileSync(`${file}.json`, JSON.stringify(run, null, 2));
    const tasks = cases.flatMap((c) => c.tasks);
    const report: ModelCheckReport = { provider: run.provider, model: run.model, startedAt: run.startedAt, sites: chosen.map((c) => c.id), tasks, summary: summarize(tasks, run.settings.gpuUsdPerHour) };
    writeFileSync(`${file}.md`, toMarkdown(report));
    console.log(`Model run written to ${file}.json (dataset ${run.datasetHash.slice(0, 12)}, frozen match: ${run.frozenMatch})`);
    expect(cases.length).toBeGreaterThan(0);
  }, 6 * 3_600_000);

  it("runs the older fixture sites or real sites (a smoke test; not the dataset)", async () => {
    if (!fixtures && urls.length === 0) return;
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
    mkdirSync(OUT, { recursive: true });
    const f = `${OUT}/modelcheck-${stamp()}`;
    writeFileSync(`${f}.json`, JSON.stringify(report, null, 2));
    writeFileSync(`${f}.md`, toMarkdown(report));
    console.log(`Model check written to ${f}.md`);
    expect(tasks.length).toBeGreaterThan(0);
  }, 3_600_000);
});
