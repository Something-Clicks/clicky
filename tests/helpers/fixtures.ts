import { createAgent, type Agent } from '../../src/agent/orchestrator/agent';
import { ManualQueue } from '../../src/agent/orchestrator/orchestrator';
import { createBusiness } from '../../src/agent/profile/bootstrap';
import { MockProvider } from '../../src/agent/providers/mock';
import { createInMemoryDb } from '../../src/agent/store/db';
import type { LLMProvider } from '../../src/agent/providers/types';

import { fakeFetch, publicResolver } from '../../src/server/dev-fixtures';
export { SITE, fakeFetch, publicResolver } from '../../src/server/dev-fixtures';

import { Entitlements } from '../../src/server/billing/entitlements';
import type { PlanGate } from '../../src/agent/plans';

export type TestPlan = 'open' | 'free' | 'report' | 'assistant' | 'studio' | 'suite';
/** `plan: 'open'` = no plan limits (agent library tests). Any other value wires the REAL billing-backed gate and seeds that plan. */
export async function setup(opts: { provider?: LLMProvider; plan?: TestPlan; discovery?: import('../../src/agent/research/discovery').Discovery } = {}) {
  const db = createInMemoryDb(); const queue = new ManualQueue(); const plan = opts.plan ?? 'open';
  const ent = new Entitlements(db); const gate: PlanGate | undefined = plan === 'open' ? undefined : ent;
  const agent: Agent = createAgent({ db, provider: opts.provider ?? new MockProvider(), queue, discovery: opts.discovery, backoffMs: 0, gate, crawl: { fetchImpl: fakeFetch, resolve: publicResolver, maxPages: 6 },
    hooks: plan === 'open' ? undefined : { beforeSubmit: (c, t) => ent.assertCanStart(c, t), onCompleted: (c, x) => ent.onCompleted(c, x) } });
  const owner = await createBusiness(db, agent.audit, 'user-owner', { name: 'Summit Plumbing', website: 'https://summitplumbing.example' });
  if (plan === 'report') await db.billing.insert({ businessId: owner.businessId, userId: owner.userId, reportCredits: 1 });
  if (['assistant', 'studio', 'suite'].includes(plan)) await db.billing.insert({ businessId: owner.businessId, userId: owner.userId, reportCredits: 0, subscription: { id: 'sub_t', plan: plan as 'assistant', interval: 'month', status: 'active', currentPeriodStart: new Date(Date.now() - 86400000).toISOString(), currentPeriodEnd: new Date(Date.now() + 29 * 86400000).toISOString(), cancelAtPeriodEnd: false } });
  const runAll = async () => { const out = []; while (queue.jobs.length) { const j = queue.jobs.shift()!; out.push(await agent.orchestrator.run(j.businessId, j.executionId)); } return out; };
  const addMember = (userId: string, role: 'member') => db.members.insert({ businessId: owner.businessId, userId, role });
  return { db, agent, queue, owner, runAll, addMember, ent };
}
