import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleProvider, providerFromEnv, stripReasoning } from '../src/agent/providers/openai-compatible';
import { StructuredClient } from '../src/agent/providers/structured';

const reply = (content: string | null, o: { finish?: string; status?: number } = {}) => new Response(JSON.stringify({ model: 'm-served', choices: [{ message: { content }, finish_reason: o.finish ?? 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7 } }), { status: o.status ?? 200, headers: { 'content-type': 'application/json' } });
function server(handler: (body: any, init: RequestInit, url: string) => Response) { const seen: { url: string; body: any; headers: Record<string, string> }[] = []; const f = (async (url: string, init: RequestInit) => { const body = JSON.parse(init.body as string); seen.push({ url, body, headers: init.headers as Record<string, string> }); return handler(body, init, url); }) as unknown as typeof fetch; return { f, seen }; }
const req = { task: 'marketing_analysis', system: 'sys', instructions: 'do it', input: { a: 1 }, jsonSchema: { type: 'object', properties: { n: { type: 'number' } } } };

describe('OpenAI-compatible provider (hosted or self-hosted models)', () => {
  it('sends the schema as constrained decoding when configured, and as a prompt hint otherwise', async () => {
    const a = server(() => reply('{"n":1}')); await new OpenAICompatibleProvider({ baseUrl: 'http://gpu.internal:8000/v1/', model: 'qwen', structured: 'json_schema', fetchImpl: a.f }).complete(req);
    expect(a.seen[0]!.url).toBe('http://gpu.internal:8000/v1/chat/completions'); expect(a.seen[0]!.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'marketing_analysis', schema: req.jsonSchema } });
    expect(a.seen[0]!.body.messages[1].content).not.toContain('Return JSON matching');
    const b = server(() => reply('{"n":1}')); await new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: b.f }).complete(req);
    expect(b.seen[0]!.body.response_format).toEqual({ type: 'json_object' }); expect(b.seen[0]!.body.messages[1].content).toContain('Return JSON matching');
    const d = server(() => reply('{"n":1}')); await new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: 'm', structured: 'json_object_schema', fetchImpl: d.f }).complete(req);
    expect(d.seen[0]!.body.response_format).toMatchObject({ type: 'json_object', schema: expect.any(Object) });
    const c = server(() => reply('{}')); await new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: 'm', structured: 'none', fetchImpl: c.f }).complete(req); expect(c.seen[0]!.body.response_format).toBeUndefined();
  });
  it('merges deployment options (e.g. disable thinking) but can never override the model or messages', async () => {
    const s = server(() => reply('{}')); await new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: 'real', extraBody: { chat_template_kwargs: { enable_thinking: false }, model: 'evil', messages: [] }, fetchImpl: s.f }).complete(req);
    expect(s.seen[0]!.body.chat_template_kwargs).toEqual({ enable_thinking: false }); expect(s.seen[0]!.body.model).toBe('real'); expect(s.seen[0]!.body.messages).toHaveLength(2);
  });
  it('sends an API key only when configured, and never puts it in the body', async () => {
    const s = server(() => reply('{}')); await new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: 'm', apiKey: 'k-123', fetchImpl: s.f }).complete(req); expect(s.seen[0]!.headers.authorization).toBe('Bearer k-123'); expect(JSON.stringify(s.seen[0]!.body)).not.toContain('k-123');
    const t = server(() => reply('{}')); await new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: t.f }).complete(req); expect(t.seen[0]!.headers.authorization).toBeUndefined();
  });
  it('strips reasoning blocks; an unterminated reasoning block means no answer', () => {
    expect(stripReasoning('<think>let me think {"n":9}</think>\n{"n":1}')).toBe('{"n":1}'); expect(stripReasoning('{"n":1}')).toBe('{"n":1}'); expect(stripReasoning('<think>still thinking {"n":1}')).toBe('');
  });
  it('reports usage and the served model name', async () => { const s = server(() => reply('{"n":1}')); const r = await new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: s.f }).complete(req); expect(r).toMatchObject({ model: 'm-served', usage: { inputTokens: 11, outputTokens: 7 } }); });
  it('classifies failures: 429/5xx/timeouts retryable, 4xx and truncation not', async () => {
    const run = (h: () => Response | Promise<Response>) => new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: (async () => h()) as never }).complete(req);
    await expect(run(() => reply('{}', { status: 429 }))).rejects.toMatchObject({ retryable: true }); await expect(run(() => reply('{}', { status: 503 }))).rejects.toMatchObject({ retryable: true });
    await expect(run(() => reply('{}', { status: 401 }))).rejects.toMatchObject({ retryable: false }); await expect(run(() => reply('{"n"', { finish: 'length' }))).rejects.toThrow(/ran out of output space/);
    await expect(run(() => reply(null))).rejects.toThrow(/no usable content/); await expect(run(() => { throw new Error('ECONNREFUSED'); })).rejects.toMatchObject({ retryable: true });
  });
  it('end to end with the structured client: a model that answers with reasoning + fenced JSON, then bad JSON, recovers', async () => {
    const answers = ['<think>hmm</think>```json\n{"n":"x"}\n```', '<think>ok</think>{"n":3}']; const s = server(() => reply(answers.shift()!));
    const c = new StructuredClient(new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: s.f }), { maxAttempts: 3 }); const r = await c.generate({ task: 't', instructions: '', input: {}, schema: z.object({ n: z.number() }) });
    expect(r.data.n).toBe(3); expect(r.attempts).toBe(2); expect(s.seen[1]!.body.messages[1].content).toContain('previous answer was rejected');
  });
  it('configures from the environment and rejects malformed settings', () => {
    expect(providerFromEnv({})).toBeUndefined(); expect(providerFromEnv({ LLM_BASE_URL: 'http://x/v1', LLM_MODEL: 'qwen', LLM_STRUCTURED: 'json_schema', LLM_EXTRA_BODY: '{"a":1}' })!.name).toBe('openai-compatible:qwen');
    expect(() => providerFromEnv({ LLM_BASE_URL: 'http://x/v1', LLM_MODEL: 'm', LLM_STRUCTURED: 'bogus' })).toThrow(/LLM_STRUCTURED/); expect(() => providerFromEnv({ LLM_BASE_URL: 'http://x/v1', LLM_MODEL: 'm', LLM_EXTRA_BODY: '{nope' })).toThrow(/valid JSON/);
  });
});

import { FailoverProvider } from '../src/agent/providers/failover';
import { modalEndpointKey } from '../src/agent/providers/openai-compatible';
import { ProviderError } from '../src/agent/core/errors';
const okP = (name: string) => ({ name, isMock: false, async complete() { return { text: '{"n":1}', model: name, usage: { inputTokens: 1, outputTokens: 1 } }; } });
const failP = (name: string, e: Error) => ({ name, isMock: false, calls: 0, async complete() { this.calls++; throw e; } });
describe('hosted GPU primary with local fallback', () => {
  it('uses the primary when healthy and reports which model answered', async () => {
    expect((await new FailoverProvider(okP('modal'), okP('local')).complete(req)).model).toBe('modal');
  });
  it('falls back only on infrastructure failures, then skips the dead primary during the cool-down', async () => {
    let t = 0; const p = failP('modal', new ProviderError('connect timeout')); const seen: string[] = [];
    const f = new FailoverProvider(p, okP('local'), { coolDownMs: 1000, now: () => t, onFallback: (w) => seen.push(w) });
    expect((await f.complete(req)).model).toBe('local'); expect((await f.complete(req)).model).toBe('local'); expect(p.calls).toBe(1); expect(seen).toHaveLength(1);
    t = 2000; await f.complete(req); expect(p.calls).toBe(2);
  });
  it('does not fall back on a rejected request (non-retryable) or a caller abort', async () => {
    await expect(new FailoverProvider(failP('modal', new ProviderError('bad key', false)), okP('local')).complete(req)).rejects.toThrow('bad key');
    const ac = new AbortController(); ac.abort();
    await expect(new FailoverProvider(failP('modal', new ProviderError('x')), okP('local')).complete(req, ac.signal)).rejects.toThrow('x');
  });
  it('providerFromEnv: Modal primary + local fallback, key derived from the Modal token secret and sent as a bearer token', async () => {
    const e = { MODAL_LLM_URL: 'https://ws--clicky-qwen.modal.run/', MODAL_TOKEN_SECRET: 'as-secret-123', LLM_BASE_URL: 'http://127.0.0.1:8081/v1', LLM_MODEL: 'local' };
    expect(providerFromEnv(e)!.name).toMatch(/\|fallback:/); expect(providerFromEnv({ ...e, LLM_BASE_URL: undefined })!.name).toMatch(/^openai-compatible/); expect(providerFromEnv({ LLM_BASE_URL: e.LLM_BASE_URL, LLM_MODEL: 'local' })!.name).not.toMatch(/fallback/);
    expect(modalEndpointKey('as-secret-123')).toMatch(/^[0-9a-f]{64}$/); expect(modalEndpointKey('a')).not.toBe(modalEndpointKey('b'));
    const a = server(() => reply('{"n":1}')); const key = modalEndpointKey('as-secret-123');
    await new OpenAICompatibleProvider({ baseUrl: 'https://ws--clicky-qwen.modal.run/v1', apiKey: key, model: 'qwen3-4b-instruct-2507', fetchImpl: a.f }).complete(req);
    expect(a.seen[0]!.headers.authorization ?? a.seen[0]!.headers.Authorization).toBe(`Bearer ${key}`);
  });
});
