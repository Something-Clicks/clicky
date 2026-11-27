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
import { adminClient } from './supabase/clients';
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

export function getContainer(): Container {
  if (g.__sc) return g.__sc;
  if (!supabaseConfigured && !env.devMode) throw new Error('Supabase is not configured. Set the NEXT_PUBLIC_SUPABASE_* and SUPABASE_SERVICE_ROLE_KEY variables (or DEV_MODE=1 for local development).');
  const db = supabaseConfigured ? createSupabaseDb(adminClient()) : createInMemoryDb();
  const entitlements = new Entitlements(db);
  let agent!: Agent;
  const queue = new AfterQueue((b, e) => agent.orchestrator.run(b, e));
  agent = createAgent({
    db, provider: pickProvider(), queue, gate: entitlements, crawl: env.devMode && process.env.DEV_FIXTURE_SITES === '1' && !env.isProd ? { fetchImpl: fakeFetch, resolve: publicResolver } : undefined, emailSender: emailSender(), meter: new UsageMeter({}, { maxCostUsdPerRun: 2, maxTokensPerRun: 400_000 }),
    hooks: { beforeSubmit: (ctx, t) => entitlements.assertCanStart(ctx, t), onCompleted: (ctx, x) => entitlements.onCompleted(ctx, x) },
  });
  return (g.__sc = { db, agent, entitlements, previews: new PreviewService(db, agent, entitlements) });
}
