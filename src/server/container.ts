import 'server-only';
import { after } from 'next/server';
import { createAgent, type Agent } from '@/agent/orchestrator/agent';
import type { JobQueue } from '@/agent/orchestrator/orchestrator';
import { providerFromEnv } from '@/agent/providers/openai-compatible';
import { MockProvider } from '@/agent/providers/mock';
import type { LLMProvider } from '@/agent/providers/types';
import { UsageMeter } from '@/agent/providers/usage';
import { ProviderError } from '@/agent/core/errors';
import { createInMemoryDb, type Db } from '@/agent/store/db';
import { createSupabaseDb } from '@/agent/store/supabase';
import { Entitlements } from './billing/entitlements';
import { emailSender } from './email';
import { env, supabaseConfigured } from './env';
import { PreviewService } from './previews';
import { customerClient } from './supabase/clients';
import { AppError } from '@/agent/core/errors';
import { PublicDiscovery } from '@/agent/research/discovery';
import { CompositeSource, DuckDuckGoSource, OpenStreetMapSource, SearxngSource } from '@/agent/research/sources';
import { fakeFetch, publicResolver } from './dev-fixtures';

/** Runs queued work after the response is sent (Vercel `after`). Swap for Trigger.dev/cron by implementing JobQueue. */
class AfterQueue implements JobQueue {
  constructor(private readonly run: (b: string, e: string) => Promise<unknown>) {}
  enqueue(j: { businessId: string; executionId: string }) {
    const task = () => this.run(j.businessId, j.executionId).catch((e) => console.error('workflow run failed', e));
    try { after(task); } catch { void task(); }
  }
}
class UnconfiguredProvider implements LLMProvider {
  readonly name = 'unconfigured'; readonly isMock = false;
  async complete(): Promise<never> { throw new ProviderError('No AI model is connected yet (set LLM_BASE_URL and LLM_MODEL).', false); }
}
/** Real provider from env; the mock only outside production and only when explicitly requested; otherwise an explicit "not connected" provider. */
export function pickProvider(): LLMProvider {
  const real = providerFromEnv(); if (real) return real;
  if (env.llmProvider === 'mock' && !env.isProd) return new MockProvider();
  return new UnconfiguredProvider();
}

export interface Container { db: Db; agent: Agent; entitlements: Entitlements; previews: PreviewService }
const g = globalThis as unknown as { __sc?: Container };

/** Public, keyless discovery and research sources (OpenStreetMap, DuckDuckGo, optional SearXNG). Set DISCOVERY=off to disable. */
export function researchSources() {
  if (process.env.DISCOVERY === 'off') return {};
  // DuckDuckGo's HTML endpoint blocks automated clients and its terms do not offer a public API, so it is opt-in only (DISCOVERY_WEB=duckduckgo).
  const search = new CompositeSource([...(process.env.SEARXNG_URL ? [new SearxngSource(process.env.SEARXNG_URL)] : []), ...(process.env.DISCOVERY_WEB === 'duckduckgo' ? [new DuckDuckGoSource()] : [])]);
  return { researchSource: search, discovery: new PublicDiscovery(new OpenStreetMapSource(), search) };
}
function build(db: Db): Container {
  const entitlements = new Entitlements(db);
  let agent!: Agent;
  const queue = new AfterQueue((b, e) => agent.orchestrator.run(b, e));
  agent = createAgent({
    db, provider: pickProvider(), queue, gate: entitlements, ...researchSources(), crawl: env.devMode && process.env.DEV_FIXTURE_SITES === '1' && !env.isProd ? { fetchImpl: fakeFetch, resolve: publicResolver } : undefined, emailSender: emailSender(), meter: new UsageMeter({}, { maxCostUsdPerRun: 2, maxTokensPerRun: 400_000 }),
    hooks: { beforeSubmit: (ctx, t) => entitlements.assertCanStart(ctx, t), onCompleted: (ctx, x) => entitlements.onCompleted(ctx, x) },
  });
  return { db, agent, entitlements, previews: new PreviewService(db, agent, entitlements) };
}

/**
 * The container for the CURRENT request. With Supabase configured, every database call is made with the signed-in customer's own
 * session (publishable key + their access token), so row-level security decides what they can see and change. Background work
 * started from this request keeps using that same session. Without Supabase (DEV_MODE only) an in-memory store is used.
 */
export async function getContainer(): Promise<Container> {
  if (supabaseConfigured) {
    const c = await customerClient();
    if (!c) throw new AppError('unauthenticated', 'Sign in to continue', 401);
    return build(createSupabaseDb(c.client));
  }
  if (!env.devMode) throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or DEV_MODE=1 for local development).');
  return (g.__sc ??= build(createInMemoryDb()));
}

/**
 * Work that has no customer session (Stripe webhooks, scheduled reviews across tenants, anonymous previews) must write to rows no
 * customer owns, which needs a protected server credential. This app does not hold one, so with Supabase configured these
 * operations are refused explicitly instead of silently bypassing row-level security.
 */
export async function getServerContainer(): Promise<Container> {
  if (supabaseConfigured) throw new AppError('server_credential_required', 'This operation needs a protected server credential that is not configured', 503);
  return getContainer();
}
