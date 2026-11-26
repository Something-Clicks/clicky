/**
 * The self-hosted model adapter against a local stand-in server. These tests prove protocol handling, fail-closed
 * configuration, secrecy of the token, limits and cost accounting. They are NOT evidence that any model is good:
 * no model is involved anywhere in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { meteredProvider, ModelBudgetExceeded } from "@/lib/server/agent/metering";
import { costMicro } from "@/lib/server/agent/pricing";
import { generateStructured, getModelProvider, ModelOutputInvalid, registeredProviders } from "@/lib/server/agent/provider";
import { extractJson, readSelfHostedConfig, selfHostedProvider } from "@/lib/server/agent/providers/self-hosted";

import { completion, json, sampleFromSchema, startStub, type Stub } from "../support/model-stub";

const TOKEN = "t".repeat(32);
const env = (stub: Stub, more: Record<string, string> = {}) => ({
  SELF_HOSTED_MODEL_URL: stub.url, SELF_HOSTED_MODEL_TOKEN: TOKEN, SELF_HOSTED_MODEL_ID: "org/test-model", ...more,
});
const req = { task: "business_intelligence.understand", system: "Be careful.", input: "<page>Hello</page>", jsonSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] }, maxOutputTokens: 500 };

let stub: Stub | null = null;
afterEach(async () => { await stub?.close(); stub = null; });

describe("configuration fails closed", () => {
  const base = { SELF_HOSTED_MODEL_URL: "https://models.example.com", SELF_HOSTED_MODEL_TOKEN: TOKEN, SELF_HOSTED_MODEL_ID: "m1" };

  it("needs a valid URL, a 16+ character token and a model id; otherwise the adapter is absent", () => {
    expect(readSelfHostedConfig(base)).not.toBeNull();
    expect(selfHostedProvider({})).toBeNull();
    for (const bad of [
      { ...base, SELF_HOSTED_MODEL_URL: "" }, { ...base, SELF_HOSTED_MODEL_URL: "not a url" }, { ...base, SELF_HOSTED_MODEL_TOKEN: "short" },
      { ...base, SELF_HOSTED_MODEL_TOKEN: "" }, { ...base, SELF_HOSTED_MODEL_ID: "" }, { ...base, SELF_HOSTED_MODEL_ID: "bad id with spaces" },
    ]) expect(readSelfHostedConfig(bad)).toBeNull();
  });

  it("requires https (plain http only for localhost) and refuses credentials, queries and fragments in the URL", () => {
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_MODEL_URL: "http://models.example.com" })).toBeNull();
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_MODEL_URL: "http://localhost:8000" })).not.toBeNull();
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_MODEL_URL: "http://127.0.0.1:8000" })).not.toBeNull();
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_MODEL_URL: "http://10.0.0.5:8000" })).toBeNull();
    for (const u of ["https://user:pw@models.example.com", "https://models.example.com/?key=1", "https://models.example.com/#x", "ftp://models.example.com"])
      expect(readSelfHostedConfig({ ...base, SELF_HOSTED_MODEL_URL: u })).toBeNull();
  });

  it("builds the chat-completions endpoint with or without a /v1 suffix", () => {
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_MODEL_URL: "https://m.example.com" })!.endpoint).toBe("https://m.example.com/v1/chat/completions");
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_MODEL_URL: "https://m.example.com/v1/" })!.endpoint).toBe("https://m.example.com/v1/chat/completions");
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_MODEL_URL: "https://m.example.com/llm" })!.endpoint).toBe("https://m.example.com/llm/v1/chat/completions");
  });

  it("rejects malformed or dangerous extra options instead of ignoring them", () => {
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_EXTRA_BODY: '{"chat_template_kwargs":{"enable_thinking":false}}' })!.extraBody).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    for (const x of ["not json", "[]", '"x"', '{"model":"other"}', '{"messages":[]}', '{"stream":true}', '{"response_format":{}}', '{"max_tokens":999999}', `{"a":"${"x".repeat(2100)}"}`])
      expect(readSelfHostedConfig({ ...base, SELF_HOSTED_EXTRA_BODY: x }), x.slice(0, 30)).toBeNull();
  });

  it("clamps the attempt timeout and takes a price only when both halves are valid positive numbers", () => {
    expect(readSelfHostedConfig(base)!.attemptTimeoutMs).toBe(75_000);
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_ATTEMPT_TIMEOUT_MS: "1" })!.attemptTimeoutMs).toBe(10_000);
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_ATTEMPT_TIMEOUT_MS: "99999999" })!.attemptTimeoutMs).toBe(600_000);
    expect(readSelfHostedConfig(base)!.price).toBeNull();
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_PRICE_INPUT_PER_MTOK: "0.1" })!.price).toBeNull();
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_PRICE_INPUT_PER_MTOK: "-1", SELF_HOSTED_PRICE_OUTPUT_PER_MTOK: "1" })!.price).toBeNull();
    expect(readSelfHostedConfig({ ...base, SELF_HOSTED_PRICE_INPUT_PER_MTOK: "0.1", SELF_HOSTED_PRICE_OUTPUT_PER_MTOK: "0.4" })!.price).toEqual({ input: 0.1, output: 0.4 });
  });
});

describe("provider selection is the only way in, and Production is closed", () => {
  const full = { MARKETING_MODEL_PROVIDER: "self-hosted", SELF_HOSTED_MODEL_URL: "https://m.example.com", SELF_HOSTED_MODEL_TOKEN: TOKEN, SELF_HOSTED_MODEL_ID: "m1" };

  it("is registered, but a configured server alone activates nothing; the provider switch is needed too", () => {
    expect(registeredProviders()).toEqual(["self-hosted"]);
    expect(getModelProvider({})).toBeNull();
    expect(getModelProvider({ ...full, MARKETING_MODEL_PROVIDER: "" })).toBeNull();
    expect(getModelProvider({ ...full, MARKETING_MODEL_PROVIDER: "other" })).toBeNull();
    expect(getModelProvider({ ...full, SELF_HOSTED_MODEL_TOKEN: undefined })).toBeNull();
    expect(getModelProvider(full)?.id).toBe("self-hosted");
  });

  it("never yields a provider in Production, whatever is configured", () => {
    expect(getModelProvider({ ...full, VERCEL_ENV: "production" })).toBeNull();
    expect(getModelProvider({ ...full, VERCEL_ENV: "preview" })?.id).toBe("self-hosted");
  });
});

describe("the request it sends", () => {
  it("posts chat-completions with the system text, the input as the user message, a strict JSON schema, the token as a bearer header and nothing streamed", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion('{"a":"ok"}')));
    const p = selfHostedProvider(env(stub, { SELF_HOSTED_EXTRA_BODY: '{"seed":7}' }))!;
    const out = await p.generate(req);
    const seen = stub.seen[0]!;
    expect(seen.url).toBe("/v1/chat/completions");
    expect(seen.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen.body).toMatchObject({ model: "org/test-model", stream: false, temperature: 0.2, top_p: 0.95, max_tokens: 500, seed: 7 });
    expect(seen.body.messages).toEqual([{ role: "system", content: "Be careful." }, { role: "user", content: "<page>Hello</page>" }]);
    expect(seen.body.response_format).toEqual({ type: "json_schema", json_schema: { name: "business_intelligence_understand", schema: req.jsonSchema, strict: true } });
    expect(out).toMatchObject({ output: { a: "ok" }, model: "stub-model-served", usage: { inputTokens: 120, outputTokens: 40 }, refused: false });
  });

  it("serialises non-text input and applies the shared default token allowance", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion('{"a":"ok"}')));
    await selfHostedProvider(env(stub))!.generate({ ...req, input: { b: [1, 2] }, maxOutputTokens: undefined });
    expect(stub.seen[0]!.body.messages).toMatchObject([{}, { content: '{"b":[1,2]}' }]);
    expect(stub.seen[0]!.body.max_tokens).toBe(16000);
  });
});

describe("answers it handles", () => {
  it("strips a reasoning block and code fences, and treats non-JSON or truncated text as 'not usable' (never a crash)", async () => {
    expect(extractJson('<think>hmm {"a":1}</think>\n{"a":"y"}')).toEqual({ a: "y" });
    expect(extractJson('```json\n{"a":"y"}\n```')).toEqual({ a: "y" });
    expect(extractJson("Sure! Here you go")).toBeNull();
    expect(extractJson('{"a": "unterminated')).toBeNull();
    stub = await startStub((_s, res) => json(res, 200, completion("not json at all")));
    expect((await selfHostedProvider(env(stub))!.generate(req)).output).toBeNull();
    await stub.close();
    stub = await startStub((_s, res) => json(res, 200, { ...completion('{"a":"cut'), choices: [{ message: { content: '{"a":"cut' }, finish_reason: "length" }] }));
    expect((await selfHostedProvider(env(stub))!.generate(req)).output).toBeNull();
  });

  it("reports refusals as refusals", async () => {
    stub = await startStub((_s, res) => json(res, 200, { ...completion(""), choices: [{ message: { content: "", refusal: "I can't help with that." }, finish_reason: "stop" }] }));
    expect(await selfHostedProvider(env(stub))!.generate(req)).toMatchObject({ output: null, refused: true });
    await stub.close();
    stub = await startStub((_s, res) => json(res, 200, { ...completion('{"a":"x"}'), choices: [{ message: { content: '{"a":"x"}' }, finish_reason: "content_filter" }] }));
    expect((await selfHostedProvider(env(stub))!.generate(req)).refused).toBe(true);
  });

  it("estimates usage HIGH when the server omits token counts, so spend is never hidden", async () => {
    stub = await startStub((_s, res) => json(res, 200, { choices: [{ message: { content: '{"a":"hello world"}' }, finish_reason: "stop" }] }));
    const r = await selfHostedProvider(env(stub))!.generate(req);
    expect(r.usage.inputTokens).toBeGreaterThan(500); // the reservation's own conservative estimate (includes its overhead)
    expect(r.usage.outputTokens).toBeGreaterThan(0);
  });
});

describe("errors never leak the token or the server's text, and keep the status the metering layer needs", () => {
  it.each([[400], [401], [429], [500], [503]])("HTTP %i", async (status) => {
    stub = await startStub((_s, res) => json(res, status, { error: { message: `secret internals ${TOKEN}` } }));
    const err = await selfHostedProvider(env(stub))!.generate(req).catch((e) => e);
    expect(err.name).toBe("SelfHostedError");
    expect(err.status).toBe(status);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain("secret internals");
    await stub.close();
    stub = null;
  });

  it("does not follow redirects (the token cannot be sent elsewhere)", async () => {
    let elsewhere = 0;
    const other = await startStub((_s, res) => { elsewhere++; json(res, 200, completion('{"a":"x"}')); });
    stub = await startStub((_s, res) => { res.writeHead(307, { location: `${other.url}/steal` }); res.end(); });
    await expect(selfHostedProvider(env(stub))!.generate(req)).rejects.toBeTruthy();
    expect(elsewhere).toBe(0);
    await other.close();
  });

  it("gives up at the timeout instead of hanging", async () => {
    stub = await startStub(() => { /* never answers */ });
    const t0 = Date.now();
    await expect(selfHostedProvider(env(stub))!.generate({ ...req, timeoutMs: 300 })).rejects.toBeTruthy();
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("refuses an oversized answer", async () => {
    stub = await startStub((_s, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("x".repeat(2_100_000)); });
    await expect(selfHostedProvider(env(stub))!.generate(req)).rejects.toMatchObject({ name: "SelfHostedError" });
  });
});

describe("inside the agent's own controls", () => {
  const Schema = z.object({ facts: z.array(z.object({ field: z.string() })) });

  it("generateStructured validates, retries once on an unusable first answer, and sums usage over both attempts", async () => {
    let n = 0;
    stub = await startStub((_s, res) => json(res, 200, completion(n++ === 0 ? "oops not json" : '{"facts":[{"field":"service"}]}')));
    const r = await generateStructured({ task: "t.x", system: "s", input: "i", schema: Schema }, selfHostedProvider(env(stub))!);
    expect(r.output.facts[0]!.field).toBe("service");
    expect(r.usage).toEqual({ inputTokens: 240, outputTokens: 80 });
    expect(stub.seen).toHaveLength(2);
  });

  it("two unusable answers end in a plain, typed failure", async () => {
    stub = await startStub((_s, res) => json(res, 200, completion("nope")));
    await expect(generateStructured({ task: "t.x", system: "s", input: "i", schema: Schema }, selfHostedProvider(env(stub))!)).rejects.toBeInstanceOf(ModelOutputInvalid);
  });

  it("the request deadline still caps an attempt even though the adapter allows longer ones", async () => {
    stub = await startStub(() => { /* never answers */ });
    const p = selfHostedProvider(env(stub, { SELF_HOSTED_ATTEMPT_TIMEOUT_MS: "600000" }))!;
    expect(p.attemptTimeoutMs).toBe(600_000);
    await expect(generateStructured({ task: "t.x", system: "s", input: "i", schema: Schema, deadlineAt: Date.now() + 5_000 }, p)).rejects.toMatchObject({ reason: "out_of_time" });
    expect(stub.seen).toHaveLength(0); // under the 12 s minimum an attempt is not even started
  });

  describe("metering (the database is a recording stub)", () => {
    const KEY = "k".repeat(40);
    beforeEach(() => { process.env.MODEL_USAGE_KEY = KEY; });
    afterEach(() => { delete process.env.MODEL_USAGE_KEY; });
    const rpcStub = () => vi.fn(async (name: string, _args?: unknown) => ({ data: name === "reserve_model_call" ? "res-1" : null, error: null }));

    it("an unpriced self-hosted model is never called (fail closed)", async () => {
      stub = await startStub((_s, res) => json(res, 200, completion('{"a":"x"}')));
      const rpc = rpcStub();
      const p = meteredProvider(selfHostedProvider(env(stub, { SELF_HOSTED_MODEL_ID: "unpriced-model" }))!, { db: { rpc } as never, orgId: "o", capability: "x.y.z" });
      await expect(p.generate(req)).rejects.toBeInstanceOf(ModelBudgetExceeded);
      expect(stub.seen).toHaveLength(0);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("a measured price makes calls reserve before and settle the actual tokens after", async () => {
      stub = await startStub((_s, res) => json(res, 200, completion('{"a":"x"}')));
      const rpc = rpcStub();
      const raw = selfHostedProvider(env(stub, { SELF_HOSTED_MODEL_ID: "priced-model", SELF_HOSTED_PRICE_INPUT_PER_MTOK: "0.2", SELF_HOSTED_PRICE_OUTPUT_PER_MTOK: "0.8" }))!;
      await meteredProvider(raw, { db: { rpc } as never, orgId: "o", capability: "x.y.z" }).generate(req);
      expect(rpc.mock.calls.map((c) => c[0])).toEqual(["reserve_model_call", "settle_model_call"]);
      const settle = rpc.mock.calls[1]![1] as Record<string, unknown>;
      expect(settle).toMatchObject({ p_input: 120, p_output: 40, p_outcome: "ok", p_cost_micro: costMicro("self-hosted", "priced-model", 120, 40) });
      expect(costMicro("self-hosted", "priced-model", 120, 40)).toBe(Math.ceil(120 * 0.2 + 40 * 0.8));
    });

    it("keeps the adapter's longer attempt allowance when wrapped", () => {
      const raw = selfHostedProvider(env({ url: "http://127.0.0.1:1", seen: [], close: async () => {} }, { SELF_HOSTED_ATTEMPT_TIMEOUT_MS: "200000" }))!;
      expect(meteredProvider(raw, { db: { rpc: rpcStub() } as never, orgId: "o", capability: "x" }).attemptTimeoutMs).toBe(200_000);
    });

    it("a server error is settled at the full reservation (it may have run), a 4xx at nothing (it never ran)", async () => {
      for (const [status, expectFull] of [[500, true], [400, false]] as const) {
        stub = await startStub((_s, res) => json(res, status, {}));
        const rpc = rpcStub();
        const raw = selfHostedProvider(env(stub, { SELF_HOSTED_MODEL_ID: "priced-model-2", SELF_HOSTED_PRICE_INPUT_PER_MTOK: "0.2", SELF_HOSTED_PRICE_OUTPUT_PER_MTOK: "0.8" }))!;
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
});

describe("the stand-in's schema sampler (test helper)", () => {
  it("produces values that satisfy simple schemas", () => {
    expect(sampleFromSchema({ type: "object", properties: { a: { type: "string" }, b: { type: "array" }, c: { enum: ["q", "r"] } }, required: ["a", "b", "c"] })).toEqual({ a: "x", b: [], c: "q" });
  });
});
