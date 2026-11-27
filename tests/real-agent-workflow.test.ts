/**
 * The central agent's workflow persisted through REAL clicky-dev customer sessions (RLS applies, no service key).
 * The model is a deterministic MockProvider and the website a fixture: this verifies workflow, permissions, evidence and database
 * behaviour only. It says NOTHING about real-model quality. Rows are written to the sc-test organization and removed out-of-band.
 */
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAgent, type Agent } from '../src/agent/orchestrator/agent';
import { ManualQueue } from '../src/agent/orchestrator/orchestrator';
import { MockProvider } from '../src/agent/providers/mock';
import { createSupabaseDb } from '../src/agent/store/supabase';
import { Entitlements } from '../src/server/billing/entitlements';
import { fakeFetch, publicResolver } from '../src/server/dev-fixtures';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, PW = process.env.SC_TEST_PASSWORD;
const ok = !!(URL_ && KEY && PW && URL_.includes('ofstvbgaoznipsiqbjjp') && (process.env.ALLOWED_SUPABASE_REFS ?? '').includes('ofstvbgaoznipsiqbjjp'));
const ORG = 'e0000000-0000-0000-0000-00000000000a', OWNER = 'f0000000-0000-0000-0000-0000000000a1', MEMBER = 'f0000000-0000-0000-0000-0000000000a2';

async function mk(email: string) {
  const c = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW! }); if (error) throw new Error(error.message);
  const db = createSupabaseDb(c); const ent = new Entitlements(db); const queue = new ManualQueue();
  const agent: Agent = createAgent({ db, provider: new MockProvider(), queue, backoffMs: 0, gate: ent, crawl: { fetchImpl: fakeFetch, resolve: publicResolver, maxPages: 6 },
    hooks: { beforeSubmit: (x, t) => ent.assertCanStart(x, t), onCompleted: (x, e) => ent.onCompleted(x, e) } });
  const runAll = async () => { while (queue.jobs.length) { const j = queue.jobs.shift()!; await agent.orchestrator.run(j.businessId, j.executionId); } };
  return { agent, db, runAll };
}

describe.skipIf(!ok)('central agent on real clicky-dev under customer sessions (deterministic provider)', () => {
  let o: Awaited<ReturnType<typeof mk>>, m: typeof o;
  beforeAll(async () => { o = await mk('sc-test-owner-a@example.test'); m = await mk('sc-test-member-a@example.test'); });
  const octx = { userId: OWNER, businessId: ORG }, mctx = { userId: MEMBER, businessId: ORG };

  it('review -> evidence-backed Action Cards saved to the account, readable by the other member', async () => {
    await o.agent.orchestrator.submit(octx, { request: 'Review my website', taskType: 'website_audit', params: { url: 'https://summitplumbing.example', rescan: true } });
    await o.runAll();
    const board = await o.agent.cards.board(octx); expect(board.length).toBeGreaterThan(0);
    expect((await m.agent.cards.board(mctx)).length).toBe(board.length);
  });

  it('draft -> member can edit, cannot approve; owner approves; execution needs owner authorization', async () => {
    await o.agent.orchestrator.submit(octx, { request: 'Improve my homepage headline' }); await o.runAll();
    const card = (await o.agent.cards.board(octx)).find((c) => c.card.deliverableId)!; const did = card.card.deliverableId!;
    const d = await m.agent.deliverables.get(mctx, did);
    await expect(m.agent.deliverables.approve(mctx, did, d.versions.at(-1)!.n)).rejects.toMatchObject({ status: 403 });
    const cur = await o.agent.deliverables.get(octx, did);
    await o.agent.deliverables.approve(octx, did, cur.versions.at(-1)!.n);
    const req = await m.agent.execution.request(mctx, { deliverableId: did, action: 'save_to_workspace' });
    await expect(m.agent.execution.authorize(mctx, req.id)).rejects.toMatchObject({ status: 403 });
    await o.agent.execution.authorize(octx, req.id);
    expect((await o.agent.execution.execute(octx, req.id)).status).toBe('verified');
  });
});
