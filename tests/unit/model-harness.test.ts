/**
 * The model-check harness (evals/model) end to end against a local STAND-IN server on the bundled fictional sites.
 * Proves wiring and recording: every capability is driven through the self-hosted adapter, attempts/time/tokens/grounding
 * yield are recorded, failures are typed and never crash the run, and no server text leaks. It measures NO model.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { selfHostedProvider } from "@/lib/server/agent/providers/self-hosted";
import type { FetchedPage } from "@/lib/server/safe-fetch";

import { runSite, summarize, toMarkdown, type TaskResult } from "../../evals/model/run";
import { completion, json, sampleFromSchema, startStub, type Stub } from "../support/model-stub";

let stub: Stub | null = null;
afterEach(async () => { await stub?.close(); stub = null; });

const page = (name: string) => readFileSync(join(__dirname, "..", "fixtures", "sites", name), "utf8");
const fetchOf = (name: string) => async (url: string): Promise<FetchedPage> => { const root = new URL(url).pathname === "/"; return { url, status: root ? 200 : 404, contentType: "text/html", body: root ? page(name) : "", truncated: false, redirects: [] }; };
const deps = (name: string) => ({ fetchPage: fetchOf(name), pageSpeed: async () => ({ ok: false as const, reason: "not measured" }) });
const biz = { businessName: "Sunrise Plumbing", serviceArea: null, primaryGoal: null };
const provider = (s: Stub) => selfHostedProvider({ SELF_HOSTED_MODEL_URL: s.url, SELF_HOSTED_MODEL_TOKEN: "t".repeat(32), SELF_HOSTED_MODEL_ID: "stand-in" })!;
const taskOf = (body: Record<string, unknown>) => ((body.response_format as { json_schema: { name: string } }).json_schema.name);

describe("runSite drives every capability through the adapter and records what happened", () => {
  it("records usable and unusable tasks, typed failures, grounding yield, attempts and tokens, without crashing", async () => {
    let understandCalls = 0;
    stub = await startStub((seen, res) => {
      const schema = (seen.body.response_format as { json_schema: { schema: unknown } }).json_schema.schema;
      if (taskOf(seen.body) === "business_intelligence_understand") {
        understandCalls++;
        if (understandCalls === 1) return json(res, 200, completion("Sorry, here is some prose, not JSON")); // forces a retry
        return json(res, 200, completion(JSON.stringify({ facts: [
          { category: "business", field: "service", value: "Drain cleaning", evidence_class: "verified", basis: "", quotes: [{ page_key: "page0", quote: "We clear drains and repair water heaters" }] },
          { category: "business", field: "trust_signal", value: "Forty years of experience", evidence_class: "verified", basis: "", quotes: [{ page_key: "page0", quote: "We have forty years of experience" }] },
        ] })));
      }
      return json(res, 200, completion(JSON.stringify(sampleFromSchema(schema))));
    });
    const { site, tasks } = await runSite(provider(stub), "https://sunrise-plumbing.example/", biz, deps("plumber.html"));
    expect(site.ok).toBe(true);
    const by = Object.fromEntries(tasks.map((t) => [t.task, t])) as Record<string, TaskResult>;
    expect(Object.keys(by)).toEqual(["understanding", "findings", "plan", "draft_meta", "draft_page_copy"]);

    // Understanding: first answer unusable → one retry (2 attempts); the real quote is kept, the invented one is dropped by our grounding.
    expect(by.understanding).toMatchObject({ ok: true, attempts: 2, yield: { proposed: 2, kept: 1, rejectedReasons: { quote_not_found: 1 } } });
    expect(by.understanding!.inputTokens).toBe(240); // two attempts × the stand-in's 120
    // Findings: valid but empty answer is a usable answer with nothing to keep.
    expect(by.findings).toMatchObject({ ok: true, attempts: 1, yield: { proposed: 0, kept: 0 } });
    // A plan with no priorities is refused by our own rules: recorded as a typed failure, not thrown.
    expect(by.plan).toMatchObject({ ok: false });
    expect(by.plan!.failure).toMatch(/^(plan_rejected|unusable):/);
    // Placeholder draft text passes the automatic content rules (they cannot judge quality): a person scores drafts from the saved output.
    for (const k of ["draft_meta", "draft_page_copy"]) { expect(by[k]!.ok).toBe(true); expect(by[k]!.output).toEqual(expect.arrayContaining([expect.objectContaining({ text: "x" })])); }
    for (const t of tasks) { expect(t.ms).toBeGreaterThanOrEqual(0); expect(JSON.stringify(t)).not.toContain("t".repeat(32)); }
  });

  it("a site that cannot be scanned yields one 'not scanned' record and no model calls", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion("{}")));
    const { tasks } = await runSite(provider(stub), "https://down.example/", biz, { fetchPage: async () => { throw new Error("connect failed"); }, pageSpeed: async () => ({ ok: false as const, reason: "n/a" }) });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ task: "scan", ok: false, failure: "site_not_scanned", attempts: 0 });
    expect(stub.seen).toHaveLength(0);
  });

  it("a server that is down is recorded as a failure on every task, never as a crash", async () => {
    stub = await startStub((_s, res) => json(res, 503, { error: "overloaded" }));
    const { tasks } = await runSite(provider(stub), "https://sunrise-plumbing.example/", biz, deps("plumber.html"));
    expect(tasks.every((t) => !t.ok && /^error:SelfHostedError$/.test(t.failure ?? ""))).toBe(true);
  });
});

describe("summary and report", () => {
  const t = (over: Partial<TaskResult>): TaskResult => ({ site: "a", task: "plan", ok: true, failure: null, ms: 10_000, attempts: 1, inputTokens: 1000, outputTokens: 500, yield: { proposed: 10, kept: 7, rejectedReasons: {} }, output: null, ...over });

  it("computes usable and first-attempt rates, grounded yield, tokens per second and compute cost per business", () => {
    const tasks = [t({}), t({ site: "a", task: "findings", ms: 20_000, attempts: 2 }), t({ site: "b", ok: false, failure: "unusable:schema_mismatch", yield: null, ms: 30_000 })];
    const s = summarize(tasks, 3.6); // $3.60 an hour = $0.001 a second
    expect(s).toMatchObject({ tasks: 3, usable: 2, usablePct: 66.7, firstAttemptPct: 33.3, groundedYieldPct: 70, failures: { "unusable:schema_mismatch": 1 }, inputTokens: 3000, outputTokens: 1500 });
    expect(s.outputTokensPerSecond).toBe(25); // 1500 tokens over 60 s
    expect(s.businessSeconds).toEqual([30, 30]);
    expect(s.estimatedComputeUsdPerBusiness).toBe(0.03); // 30 s × $0.001
    expect(summarize(tasks, null).estimatedComputeUsdPerBusiness).toBeNull();
  });

  it("the markdown report states these are automatic measurements and lists every task", () => {
    const tasks = [t({})];
    const md = toMarkdown({ provider: "self-hosted", model: "m", startedAt: "2026-11-26T00:00:00Z", sites: ["a"], tasks, summary: summarize(tasks, null) });
    expect(md).toMatch(/AUTOMATIC measurements only/);
    expect(md).toMatch(/\| a \| plan \| yes \| 1 \|/);
  });
});
