/**
 * The Groq adapter against a local stand-in server. These tests prove protocol handling, fail-closed configuration,
 * secrecy of the key, the fixed address, the schema preparation, rate-limit handling and cost accounting. They are NOT
 * evidence that any model is good, and they do not show that Groq accepts these requests: no model and no Groq call is
 * involved anywhere in this file. That is checked only by `pnpm modelcheck` with a real key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { meteredProvider, ModelBudgetExceeded } from "@/lib/server/agent/metering";
import type { Clock } from "@/lib/server/agent/providers/groq-limits";
import { costMicro } from "@/lib/server/agent/pricing";
import { generateStructured, getModelProvider, ModelThrottled, registeredProviders } from "@/lib/server/agent/provider";
import { GROQ_ENDPOINT, groqProvider, readGroqConfig } from "@/lib/server/agent/providers/groq";
import { groqStrictSchema } from "@/lib/server/agent/providers/groq-schema";

import { completion, json, startStub, type Stub } from "../support/model-stub";

interface Node { type?: string; required?: string[]; additionalProperties?: unknown; $schema?: unknown; enum?: string[]; items?: Node; minLength?: unknown; properties: Record<string, Node> }

const KEY = "gsk_" + "a".repeat(40);
const base = { GROQ_API_KEY: KEY, GROQ_MODEL: "openai/gpt-oss-120b" };
/** Only a future explicit owner decision enables the paid tier; these tests prove it is fail-closed without published prices. */
const priced = { ...base, GROQ_TIER: "paid", GROQ_PRICE_INPUT_PER_MTOK: "0.15", GROQ_PRICE_OUTPUT_PER_MTOK: "0.6" };
/** A clock whose sleep does not wait: time just moves forward, so pacing can be proven without real minutes. */
const fakeClock = (): Clock & { t: number; slept: number[] } => { const c = { t: 1_000_000, slept: [] as number[], now: () => c.t, sleep: async (ms: number) => { c.slept.push(ms); c.t += ms; } }; return c; };
const req = { task: "business_intelligence.understand", system: "Be careful.", input: "<page>Hello</page>", jsonSchema: { type: "object", properties: { a: { type: "string", minLength: 1 } }, required: ["a"] }, maxOutputTokens: 500 };

let stub: Stub | null = null;
afterEach(async () => { await stub?.close(); stub = null; });

describe("configuration fails closed", () => {
  it("needs a plausible key and a model id; otherwise the adapter is absent", () => {
    expect(readGroqConfig(base)).not.toBeNull();
    expect(groqProvider({})).toBeNull();
    for (const bad of [{ ...base, GROQ_API_KEY: "" }, { ...base, GROQ_API_KEY: "short" }, { ...base, GROQ_API_KEY: "has space " + "a".repeat(30) }, { ...base, GROQ_MODEL: "" }, { ...base, GROQ_MODEL: "bad model id" }]) {
      expect(readGroqConfig(bad)).toBeNull();
    }
  });

  it("is FREE tier by default ($0, Free Plan limits), takes a reasoning effort only when valid, and a paid price only on the explicit paid tier with both halves", () => {
    expect(readGroqConfig(base)).toMatchObject({ strict: true, reasoningEffort: null, tier: "free", price: { input: 0, output: 0 }, attemptTimeoutMs: 90_000, limits: { rpm: 30, tpm: 8_000, rpd: 1_000, tpd: 200_000 } });
    // Published paid prices are ignored on the free tier: free usage is never presented as paid.
    expect(readGroqConfig({ ...base, GROQ_PRICE_INPUT_PER_MTOK: "0.15", GROQ_PRICE_OUTPUT_PER_MTOK: "0.6" })!.price).toEqual({ input: 0, output: 0 });
    expect(readGroqConfig({ ...base, GROQ_STRICT: "0" })!.strict).toBe(false);
    expect(readGroqConfig({ ...base, GROQ_REASONING_EFFORT: "Low" })!.reasoningEffort).toBe("low");
    expect(readGroqConfig({ ...base, GROQ_REASONING_EFFORT: "extreme" })).toBeNull();
    expect(readGroqConfig({ ...base, GROQ_TIER: "enterprise" })).toBeNull();
    expect(readGroqConfig({ ...base, GROQ_ATTEMPT_TIMEOUT_MS: "99999999" })!.attemptTimeoutMs).toBe(300_000);
    expect(readGroqConfig({ ...base, GROQ_TIER: "paid" })!.price).toBeNull();
    expect(readGroqConfig({ ...base, GROQ_TIER: "paid", GROQ_PRICE_INPUT_PER_MTOK: "0.1" })!.price).toBeNull();
    expect(readGroqConfig({ ...base, GROQ_TIER: "paid", GROQ_PRICE_INPUT_PER_MTOK: "-1", GROQ_PRICE_OUTPUT_PER_MTOK: "1" })!.price).toBeNull();
    expect(readGroqConfig(priced)!.price).toEqual({ input: 0.15, output: 0.6 });
    expect(readGroqConfig({ ...base, GROQ_TPM: "6000", GROQ_TPD: "500000" })!.limits).toMatchObject({ tpm: 6_000, tpd: 500_000 });
  });

  it("the address is fixed: no environment variable can aim the key elsewhere", () => {
    expect(GROQ_ENDPOINT).toBe("https://api.groq.com/openai/v1/chat/completions");
    const cfg = readGroqConfig({ ...base, GROQ_BASE_URL: "https://evil.example", GROQ_API_BASE: "https://evil.example", SELF_HOSTED_MODEL_URL: "https://evil.example" });
    expect(JSON.stringify(cfg)).not.toContain("evil");
  });
});

describe("provider selection is the only way in, and Production is closed", () => {
  const full = { ...priced, MARKETING_MODEL_PROVIDER: "groq" };
  it("is registered, but a key alone activates nothing; the provider switch is needed too", () => {
    expect(registeredProviders()).toEqual(["groq", "self-hosted"]);
    expect(getModelProvider(priced)).toBeNull();
    expect(getModelProvider({ ...full, MARKETING_MODEL_PROVIDER: "" })).toBeNull();
    expect(getModelProvider({ ...full, GROQ_API_KEY: undefined })).toBeNull();
    expect(getModelProvider(full)?.id).toBe("groq");
  });
  it("never yields a provider in Production, whatever is configured", () => {
    expect(getModelProvider({ ...full, VERCEL_ENV: "production" })).toBeNull();
    expect(getModelProvider({ ...full, VERCEL_ENV: "preview" })?.id).toBe("groq");
  });
  it("OpenRouter is not an adapter: naming it activates nothing", () => {
    expect(getModelProvider({ MARKETING_MODEL_PROVIDER: "openrouter", OPENROUTER_API_KEY: KEY })).toBeNull();
  });
});

describe("the schema sent to Groq's strict mode", () => {
  it("requires every property, forbids extras, and leaves out keywords Groq does not document (zod still enforces them)", () => {
    const out = groqStrictSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
      properties: { title: { type: "string", minLength: 1, maxLength: 60 }, tags: { type: "array", items: { type: "string" }, maxItems: 3 }, kind: { type: "string", enum: ["a", "b"] }, inner: { type: "object", properties: { n: { type: "number", minimum: 0 } } } },
      required: ["title"], additionalProperties: true,
    }) as Node;
    expect(out.$schema).toBeUndefined();
    expect(out.required).toEqual(["title", "tags", "kind", "inner"]);
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.title).toEqual({ type: "string" });
    expect(out.properties.tags).toEqual({ type: "array", items: { type: "string" } });
    expect(out.properties.kind!.enum).toEqual(["a", "b"]);
    expect(out.properties.inner).toEqual({ type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false });
  });

  it("is what zod's own schema becomes for the agent's strict objects", () => {
    const schema = z.object({ headline: z.string().min(1), items: z.array(z.object({ q: z.string() }).strict()).max(3) }).strict();
    const out = groqStrictSchema(z.toJSONSchema(schema)) as Node;
    expect(out.required).toEqual(["headline", "items"]);
    expect(out.properties.items!.items!.required).toEqual(["q"]);
  });
});

describe("the request it sends", () => {
  it("posts chat-completions with the key as a bearer header, a prepared strict schema, a completion-token limit and nothing streamed", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion('{"a":"ok"}')));
    const p = groqProvider({ ...base, GROQ_REASONING_EFFORT: "low" }, { baseUrl: `${stub.url}/openai/v1/chat/completions` })!;
    const out = await p.generate(req);
    const seen = stub.seen[0]!;
    expect(seen.url).toBe("/openai/v1/chat/completions");
    expect(seen.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen.body).toMatchObject({ model: "openai/gpt-oss-120b", stream: false, temperature: 0.2, top_p: 0.95, max_completion_tokens: 500, reasoning_effort: "low" });
    expect(seen.body).not.toHaveProperty("max_tokens");
    expect(seen.body.messages).toEqual([{ role: "system", content: "Be careful." }, { role: "user", content: "<page>Hello</page>" }]);
    expect(seen.body.response_format).toEqual({ type: "json_schema", json_schema: { name: "business_intelligence_understand", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false }, strict: true } });
    expect(out).toMatchObject({ output: { a: "ok" }, model: "stub-model-served", usage: { inputTokens: 120, outputTokens: 40 }, refused: false });
  });

  it("sends best-effort mode when strict is switched off; gpt-oss defaults to LOW reasoning (small free output allowance), other models send none", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion('{"a":"ok"}')));
    await groqProvider({ ...base, GROQ_STRICT: "0" }, { baseUrl: stub.url })!.generate(req);
    expect((stub.seen[0]!.body.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(false);
    expect(stub.seen[0]!.body).toMatchObject({ reasoning_effort: "low" });
    await groqProvider({ ...base, GROQ_MODEL: "qwen/qwen3.8-27b" }, { baseUrl: stub.url })!.generate(req);
    expect(stub.seen[1]!.body).not.toHaveProperty("reasoning_effort");
  });

  it("clamps the output allowance so input plus output fit the free minute, and refuses (as too large) when even a short answer would not", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion('{"a":"ok"}')));
    const p = groqProvider(base, { baseUrl: stub.url })!;
    await p.generate({ ...req, maxOutputTokens: 16_000 });
    const sent = stub.seen[0]!.body.max_completion_tokens as number;
    expect(sent).toBeLessThan(8_000);
    expect(sent).toBeGreaterThan(5_000);
    await expect(p.generate({ ...req, input: "x".repeat(30_000) })).rejects.toMatchObject({ name: "ModelThrottled", kind: "too_large" });
    expect(stub.seen).toHaveLength(1);
  });

  it("fails closed if Groq's headers show limits above the free tier (the key's plan changed): nothing more is sent", async () => {
    stub = await startStub((_s, res) => { res.writeHead(200, { "content-type": "application/json", "x-ratelimit-limit-tokens": "250000" }); res.end(JSON.stringify(completion('{"a":"ok"}'))); });
    const p = groqProvider(base, { baseUrl: stub.url })!;
    await expect(p.generate(req)).rejects.toThrow(/free tier/);
    await expect(p.generate(req)).rejects.toThrow(/free tier/);
    expect(stub.seen).toHaveLength(1);
  });
});

describe("answers and errors", () => {
  it("treats non-JSON and truncated text as 'not usable', refusals as refusals, and estimates usage HIGH when missing", async () => {
    stub = await startStub((_s, res) => json(res, 200, { ...completion("not json at all"), usage: undefined }));
    const r = await groqProvider(base, { baseUrl: stub.url })!.generate(req);
    expect(r.output).toBeNull();
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.usage.outputTokens).toBeGreaterThan(0);
    await stub.close();
    stub = await startStub((_s, res) => json(res, 200, { ...completion('{"a":"x"'), choices: [{ message: { content: '{"a":"x"' }, finish_reason: "length" }] }));
    expect((await groqProvider(base, { baseUrl: stub.url })!.generate(req)).output).toBeNull();
    await stub.close();
    stub = await startStub((_s, res) => json(res, 200, { ...completion(""), choices: [{ message: { content: "", refusal: "no" }, finish_reason: "stop" }] }));
    expect((await groqProvider(base, { baseUrl: stub.url })!.generate(req)).refused).toBe(true);
  });

  it("a schema-mismatch 400 (best-effort mode) is 'not usable' so the one validated retry applies; any other 400 is a typed failure that leaks nothing", async () => {
    stub = await startStub((_s, res) => json(res, 400, { error: { message: "Generated JSON does not match the expected schema. Please adjust your prompt." } }));
    const r = await groqProvider(base, { baseUrl: stub.url })!.generate(req);
    expect(r.output).toBeNull();
    await stub.close();
    stub = await startStub((_s, res) => json(res, 400, { error: { message: `bad request containing ${KEY} and secret text` } }));
    const err = await groqProvider(base, { baseUrl: stub.url })!.generate(req).catch((e) => e as Error);
    expect(err).toMatchObject({ name: "GroqError", status: 400 });
    expect(String((err as Error).message) + String((err as Error).stack)).not.toContain(KEY);
    expect(String((err as Error).message)).not.toContain("secret text");
  });

  it("does not follow redirects (the key cannot be sent elsewhere)", async () => {
    stub = await startStub((_s, res) => { res.writeHead(302, { location: "https://evil.example/steal" }); res.end(); });
    await expect(groqProvider(base, { baseUrl: stub.url })!.generate(req)).rejects.toMatchObject({ name: "GroqError", status: 302 });
    expect(stub.seen).toHaveLength(1);
  });

  it("a MINUTE rate limit is waited out (the stated time) and retried; a long minute wait, or a DAY limit, ends as ModelThrottled with the resume time", async () => {
    const minuteBody = JSON.stringify({ error: { message: "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7900, Requested 900. Please try again in 2.5s." } });
    const dayBody = JSON.stringify({ error: { message: "Rate limit reached on tokens per day (TPD): Limit 200000, Used 199900, Requested 900. Please try again in 1h2m3s." } });
    let n = 0;
    stub = await startStub((_s, res) => { if (n++ === 0) { res.writeHead(429, { "content-type": "application/json" }); res.end(minuteBody); } else json(res, 200, completion('{"a":"ok"}')); });
    const clock = fakeClock();
    const r = await groqProvider(base, { baseUrl: stub.url, clock })!.generate(req);
    expect(r.output).toEqual({ a: "ok" });
    expect(stub.seen).toHaveLength(2);
    expect(Math.max(...clock.slept)).toBeGreaterThanOrEqual(2_500);
    await stub.close();

    stub = await startStub((_s, res) => { res.writeHead(429, { "content-type": "application/json" }); res.end(dayBody); });
    const day = await groqProvider(base, { baseUrl: stub.url, clock: fakeClock() })!.generate(req).catch((e) => e);
    expect(day).toBeInstanceOf(ModelThrottled);
    expect(day).toMatchObject({ kind: "day", status: 429 });
    expect(day.retryAfterMs).toBe(3_723_000);
    expect(day.message).not.toContain("TPD"); // Groq's wording is never kept
    expect(stub.seen).toHaveLength(1);
    await stub.close();

    stub = await startStub((_s, res) => { res.writeHead(429, { "retry-after": "3600" }); res.end("{}"); });
    await expect(groqProvider(base, { baseUrl: stub.url, clock: fakeClock() })!.generate(req)).rejects.toMatchObject({ name: "ModelThrottled", status: 429 });
    expect(stub.seen).toHaveLength(1);
    await stub.close();

    stub = await startStub((_s, res) => { res.writeHead(429, { "retry-after": "0" }); res.end("{}"); });
    await expect(groqProvider(base, { baseUrl: stub.url, clock: fakeClock() })!.generate(req)).rejects.toMatchObject({ status: 429 });
    expect(stub.seen).toHaveLength(3); // the first send and two waits, never a loop
  });

  it("retries one transient 5xx, then gives up with a plain error", async () => {
    let n = 0;
    stub = await startStub((_s, res) => { if (n++ === 0) { res.writeHead(503); res.end("{}"); } else json(res, 200, completion('{"a":"ok"}')); });
    expect((await groqProvider(base, { baseUrl: stub.url, clock: fakeClock() })!.generate(req)).output).toEqual({ a: "ok" });
    await stub.close();
    stub = await startStub((_s, res) => { res.writeHead(503); res.end("{}"); });
    await expect(groqProvider(base, { baseUrl: stub.url, clock: fakeClock() })!.generate(req)).rejects.toMatchObject({ status: 503 });
    expect(stub.seen).toHaveLength(2);
  });
});

describe("inside the agent's own controls", () => {
  const Schema = z.object({ a: z.string().min(1) }).strict();
  const KEYV = "k".repeat(40);
  beforeEach(() => { process.env.MODEL_USAGE_KEY = KEYV; });
  afterEach(() => { delete process.env.MODEL_USAGE_KEY; });
  const rpcStub = () => vi.fn(async (name: string, _args?: unknown) => ({ data: name === "reserve_model_call" ? "res-1" : null, error: null }));

  it("generateStructured validates against the ORIGINAL schema (zod keeps enforcing what was left out of the request)", async () => {
    let n = 0;
    stub = await startStub((_s, res) => json(res, 200, completion(n++ === 0 ? '{"a":""}' : '{"a":"fine"}')));
    const r = await generateStructured({ task: "t.x", system: "s", input: "i", schema: Schema }, groqProvider(base, { baseUrl: stub.url }));
    expect(r.output).toEqual({ a: "fine" });
    expect(stub.seen).toHaveLength(2);
  });

  it("on the paid tier an unpriced model is never called (fail closed); the free tier is priced at $0 and is called", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion('{"a":"x"}')));
    const rpc = rpcStub();
    const p = meteredProvider(groqProvider({ ...base, GROQ_TIER: "paid", GROQ_MODEL: "unpriced/model" }, { baseUrl: stub.url })!, { db: { rpc } as never, orgId: "o", capability: "x.y.z" });
    await expect(p.generate(req)).rejects.toBeInstanceOf(ModelBudgetExceeded);
    expect(stub.seen).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("free usage is recorded at $0 with its real tokens (never presented as paid), still reserved before and settled after every call", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion('{"a":"x"}')));
    const rpc = rpcStub();
    await meteredProvider(groqProvider({ ...base, GROQ_MODEL: "free/model" }, { baseUrl: stub.url })!, { db: { rpc } as never, orgId: "o", capability: "x.y.z" }).generate(req);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["reserve_model_call", "settle_model_call"]);
    expect((rpc.mock.calls[0]![1] as { p_max_cost_micro: number }).p_max_cost_micro).toBe(0);
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_input: 120, p_output: 40, p_outcome: "ok", p_cost_micro: 0 });
    expect(costMicro("groq", "free/model", 120, 40)).toBe(0);
  });

  it("on the paid tier (a future owner decision only) the published price makes every call reserve before and settle after, so the dollar caps bind", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion('{"a":"x"}')));
    const rpc = rpcStub();
    const raw = groqProvider({ ...priced, GROQ_MODEL: "priced/model" }, { baseUrl: stub.url })!;
    await meteredProvider(raw, { db: { rpc } as never, orgId: "o", capability: "x.y.z" }).generate(req);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["reserve_model_call", "settle_model_call"]);
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_input: 120, p_output: 40, p_outcome: "ok", p_cost_micro: costMicro("groq", "priced/model", 120, 40) });
    expect(costMicro("groq", "priced/model", 120, 40)).toBe(Math.ceil(120 * 0.15 + 40 * 0.6));
  });

  it("a 429 or other 4xx is settled at nothing (it never ran); a 500 at the full reservation", async () => {
    for (const [status, expectFull] of [[500, true], [429, false], [400, false]] as const) {
      stub = await startStub((_s, res) => { res.writeHead(status, status === 429 ? { "retry-after": "3600" } : {}); res.end("{}"); });
      const rpc = rpcStub();
      const raw = groqProvider({ ...priced, GROQ_MODEL: `priced/model-${status}` }, { baseUrl: stub.url })!;
      await meteredProvider(raw, { db: { rpc } as never, orgId: "o", capability: "x.y.z" }).generate(req).catch(() => {});
      const reserve = rpc.mock.calls[0]![1] as { p_max_cost_micro: number };
      const settle = rpc.mock.calls[1]![1] as { p_cost_micro: number; p_outcome: string };
      expect(settle.p_outcome).toBe("error");
      expect(settle.p_cost_micro).toBe(expectFull ? reserve.p_max_cost_micro : 0);
      await stub.close();
      stub = null;
    }
  });
});
