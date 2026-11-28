/**
 * The Groq adapter against a local stand-in server. These tests prove protocol handling, fail-closed configuration,
 * secrecy of the key, the fixed address, the schema preparation, rate-limit handling and cost accounting. They are NOT
 * evidence that any model is good, and they do not show that Groq accepts these requests: no model and no Groq call is
 * involved anywhere in this file. That is checked only by `pnpm modelcheck` with a real key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { meteredProvider, ModelBudgetExceeded } from "@/lib/server/agent/metering";
import { costMicro } from "@/lib/server/agent/pricing";
import { generateStructured, getModelProvider, registeredProviders } from "@/lib/server/agent/provider";
import { GROQ_ENDPOINT, groqProvider, readGroqConfig } from "@/lib/server/agent/providers/groq";
import { groqStrictSchema } from "@/lib/server/agent/providers/groq-schema";

import { completion, json, startStub, type Stub } from "../support/model-stub";

interface Node { type?: string; required?: string[]; additionalProperties?: unknown; $schema?: unknown; enum?: string[]; items?: Node; minLength?: unknown; properties: Record<string, Node> }

const KEY = "gsk_" + "a".repeat(40);
const base = { GROQ_API_KEY: KEY, GROQ_MODEL: "openai/gpt-oss-120b" };
const priced = { ...base, GROQ_PRICE_INPUT_PER_MTOK: "0.15", GROQ_PRICE_OUTPUT_PER_MTOK: "0.6" };
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

  it("takes strict mode by default, a reasoning effort only when valid, and a price only when both halves are valid", () => {
    expect(readGroqConfig(base)).toMatchObject({ strict: true, reasoningEffort: null, price: null, attemptTimeoutMs: 60_000 });
    expect(readGroqConfig({ ...base, GROQ_STRICT: "0" })!.strict).toBe(false);
    expect(readGroqConfig({ ...base, GROQ_REASONING_EFFORT: "Low" })!.reasoningEffort).toBe("low");
    expect(readGroqConfig({ ...base, GROQ_REASONING_EFFORT: "extreme" })).toBeNull();
    expect(readGroqConfig({ ...base, GROQ_ATTEMPT_TIMEOUT_MS: "99999999" })!.attemptTimeoutMs).toBe(300_000);
    expect(readGroqConfig({ ...base, GROQ_PRICE_INPUT_PER_MTOK: "0.1" })!.price).toBeNull();
    expect(readGroqConfig({ ...base, GROQ_PRICE_INPUT_PER_MTOK: "-1", GROQ_PRICE_OUTPUT_PER_MTOK: "1" })!.price).toBeNull();
    expect(readGroqConfig(priced)!.price).toEqual({ input: 0.15, output: 0.6 });
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

  it("sends best-effort mode when strict is switched off, and no reasoning field by default", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion('{"a":"ok"}')));
    await groqProvider({ ...base, GROQ_STRICT: "0" }, { baseUrl: stub.url })!.generate(req);
    expect((stub.seen[0]!.body.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(false);
    expect(stub.seen[0]!.body).not.toHaveProperty("reasoning_effort");
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

  it("waits out ONE short 429 (Retry-After) inside the deadline, then answers; a long wait is a plain 429 failure", async () => {
    let n = 0;
    stub = await startStub((_s, res) => {
      if (n++ === 0) { res.writeHead(429, { "retry-after": "0", "content-type": "application/json" }); res.end("{}"); } else json(res, 200, completion('{"a":"ok"}'));
    });
    const r = await groqProvider(base, { baseUrl: stub.url })!.generate(req);
    expect(r.output).toEqual({ a: "ok" });
    expect(stub.seen).toHaveLength(2);
    await stub.close();
    stub = await startStub((_s, res) => { res.writeHead(429, { "retry-after": "3600" }); res.end("{}"); });
    await expect(groqProvider(base, { baseUrl: stub.url })!.generate(req)).rejects.toMatchObject({ status: 429 });
    expect(stub.seen).toHaveLength(1);
    await stub.close();
    stub = await startStub((_s, res) => { res.writeHead(429, { "retry-after": "0" }); res.end("{}"); });
    await expect(groqProvider(base, { baseUrl: stub.url })!.generate(req)).rejects.toMatchObject({ status: 429 });
    expect(stub.seen).toHaveLength(2); // exactly one wait, never a loop
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

  it("an unpriced Groq model is never called (fail closed)", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion('{"a":"x"}')));
    const rpc = rpcStub();
    const p = meteredProvider(groqProvider({ ...base, GROQ_MODEL: "unpriced/model" }, { baseUrl: stub.url })!, { db: { rpc } as never, orgId: "o", capability: "x.y.z" });
    await expect(p.generate(req)).rejects.toBeInstanceOf(ModelBudgetExceeded);
    expect(stub.seen).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the shadow price makes every call reserve before and settle after, so the existing dollar caps bind on the free tier too", async () => {
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
