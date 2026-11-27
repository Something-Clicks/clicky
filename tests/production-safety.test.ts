import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '../src/agent/providers/mock';
import { setup } from './helpers/fixtures';

const setEnv = (o: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.resetModules(); vi.doUnmock('next/server'); });

describe('mock / fixture / simulated output can never become real customer results', () => {
  it('the mock provider refuses to run in production', async () => {
    setEnv({ NODE_ENV: 'production', ALLOW_MOCK_IN_PRODUCTION: undefined });
    await expect(new MockProvider().complete({ task: 'classify_request', system: '', instructions: '', input: {} })).rejects.toThrow(/cannot run in production/);
  });
  it('DEV_MODE (in-memory data + cookie auth) is refused at startup in production', async () => {
    setEnv({ NODE_ENV: 'production', DEV_MODE: '1' }); vi.resetModules();
    await expect(import('../src/server/env')).rejects.toThrow(/DEV_MODE must never be enabled in production/);
  });
  it('provider selection: never the mock in production, even if LLM_PROVIDER=mock; "not connected" without real config', async () => {
    vi.doMock('next/server', () => ({ after: (f: () => void) => f() }));
    setEnv({ NODE_ENV: 'production', DEV_MODE: undefined, LLM_PROVIDER: 'mock', LLM_BASE_URL: undefined, LLM_MODEL: undefined }); vi.resetModules();
    const prod = (await import('../src/server/container')).pickProvider(); expect(prod.isMock).toBe(false); expect(prod.name).toBe('unconfigured');
    await expect(prod.complete({ task: 't', system: '', instructions: '', input: {} })).rejects.toThrow(/No AI model is connected/);
    setEnv({ NODE_ENV: 'development', LLM_PROVIDER: 'mock' }); vi.resetModules(); expect((await import('../src/server/container')).pickProvider().isMock).toBe(true);
    setEnv({ NODE_ENV: 'production', LLM_PROVIDER: undefined, LLM_BASE_URL: 'https://models.internal/v1', LLM_MODEL: 'm' }); vi.resetModules(); expect((await import('../src/server/container')).pickProvider().name).toMatch(/^openai-compatible/);
  });
  it('the app refuses to start in production without Supabase configured (no silent in-memory data)', async () => {
    vi.doMock('next/server', () => ({ after: (f: () => void) => f() }));
    setEnv({ NODE_ENV: 'production', DEV_MODE: undefined, NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }); vi.resetModules();
    const m = await import('../src/server/container'); expect(() => m.getContainer()).toThrow(/Supabase is not configured/);
  });
  it('a mock-generated draft or strategy cannot be approved or actioned if it ever exists in production', async () => {
    const { agent, owner, runAll } = await setup(); await agent.orchestrator.submit(owner, { request: 'Develop a marketing plan' }); await runAll();
    await agent.orchestrator.submit(owner, { request: 'Improve my homepage headline' }); await runAll();
    const did = (await agent.cards.board(owner)).find((c) => c.card.deliverableId)!.card.deliverableId!; const s = (await agent.strategies.latest(owner))!;
    expect((await agent.deliverables.get(owner, did)).versions[0]!.mock).toBe(true); expect(s.mock).toBe(true);
    setEnv({ NODE_ENV: 'production' });
    await expect(agent.deliverables.approve(owner, did, 1)).rejects.toMatchObject({ code: 'mock_content' });
    await expect(agent.strategies.approve(owner, s.id)).rejects.toMatchObject({ code: 'mock_content' });
    setEnv({ NODE_ENV: 'test' }); await agent.deliverables.approve(owner, did, 1); // allowed in dev/test only
    setEnv({ NODE_ENV: 'production' }); await expect(agent.execution.request(owner, { deliverableId: did, action: 'save_to_workspace' })).rejects.toMatchObject({ code: 'mock_content' });
  });
  it('no execution adapter claims to publish or send on the customer’s behalf; fixture sites exist only behind DEV_MODE', async () => {
    const { agent } = await setup(); expect(agent.execution.availableActions().every((a) => ['save_to_workspace', 'download_export', 'record_activity'].includes(a))).toBe(true);
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/server/container.ts', 'utf8')); expect(src).toMatch(/env\.devMode && process\.env\.DEV_FIXTURE_SITES === '1' && !env\.isProd/);
  });
  it('the anonymous preview is off by default in production', async () => {
    setEnv({ NODE_ENV: 'production', ANONYMOUS_PREVIEW_ENABLED: undefined, DEV_MODE: undefined }); vi.resetModules(); expect((await import('../src/server/env')).env.anonymousPreview).toBe(false);
    setEnv({ ANONYMOUS_PREVIEW_ENABLED: 'true' }); vi.resetModules(); expect((await import('../src/server/env')).env.anonymousPreview).toBe(true);
  });
});

describe('development builds can only use allow-listed Supabase projects', () => {
  const REF = 'ofstvbgaoznipsiqbjjp';
  const load = async (env: Record<string, string | undefined>) => { setEnv({ NODE_ENV: 'development', DEV_MODE: undefined, ...env }); vi.resetModules(); return import('../src/server/env'); };
  it('refuses a project that is not listed, or any project when the list is empty', async () => {
    await expect(load({ NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`, ALLOWED_SUPABASE_REFS: undefined })).rejects.toThrow(/not listed in ALLOWED_SUPABASE_REFS/);
    await expect(load({ NEXT_PUBLIC_SUPABASE_URL: 'https://ysmwnxvyjougetdlpnba.supabase.co', ALLOWED_SUPABASE_REFS: REF })).rejects.toThrow(/not listed/);
    await expect(load({ NEXT_PUBLIC_SUPABASE_URL: 'https://evil.example.com', ALLOWED_SUPABASE_REFS: REF })).rejects.toThrow(/not listed/);
  });
  it('accepts exactly the allow-listed project; Supabase-less dev builds are unaffected', async () => {
    expect((await load({ NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`, ALLOWED_SUPABASE_REFS: `other,${REF}` })).supabaseRef()).toBe(REF);
    await expect(load({ NEXT_PUBLIC_SUPABASE_URL: undefined, ALLOWED_SUPABASE_REFS: undefined })).resolves.toBeDefined();
  });
  it('modules holding secrets are marked server-only', async () => {
    const fs = await import('node:fs');
    for (const f of ['supabase/clients.ts', 'env.ts', 'billing/stripe.ts', 'email.ts', 'container.ts']) expect(fs.readFileSync(`src/server/${f}`, 'utf8').startsWith("import 'server-only';")).toBe(true);
  });
});
