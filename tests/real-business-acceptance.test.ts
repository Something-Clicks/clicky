/**
 * Acceptance on SAVED REAL-MODEL OUTPUT: reopen the Something Clicks review (real website, real Qwen model, written by the customer
 * session to clicky-dev) through real customer sessions and exercise the Action Card workflow server-side. Mutates the saved data
 * (edits one draft, approves it, rejects another). Needs REAL_BUSINESS_ORG; skipped otherwise.
 */
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAgent } from '../src/agent/orchestrator/agent';
import { ManualQueue } from '../src/agent/orchestrator/orchestrator';
import { createSupabaseDb } from '../src/agent/store/supabase';
import { Entitlements } from '../src/server/billing/entitlements';

const ORG = process.env.REAL_BUSINESS_ORG; const PW = process.env.SC_TEST_PASSWORD; const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const ok = !!(ORG && PW && URL_?.includes('ofstvbgaoznipsiqbjjp') && KEY);
const U = { owner: 'f0000000-0000-0000-0000-0000000000c1', member: 'f0000000-0000-0000-0000-0000000000a2', other: 'f0000000-0000-0000-0000-0000000000b1' };
async function as(email: string) {
  const c = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); const { error } = await c.auth.signInWithPassword({ email, password: PW! }); if (error) throw error;
  const db = createSupabaseDb(c); const ent = new Entitlements(db);
  return { db, agent: createAgent({ db, provider: { name: 'none', isMock: false, complete: async () => { throw new Error('no model in this test'); } } as never, queue: new ManualQueue(), gate: ent }) };
}
describe.skipIf(!ok)('Action Card workflow on saved real-model output', () => {
  let o: Awaited<ReturnType<typeof as>>, m: typeof o, x: typeof o;
  const octx = { userId: U.owner, businessId: ORG! }, mctx = { userId: U.member, businessId: ORG! }, xctx = { userId: U.other, businessId: ORG! };
  beforeAll(async () => { o = await as('sc-test-new@example.test'); m = await as('sc-test-member-a@example.test'); x = await as('sc-test-owner-b@example.test'); });

  it('reopens the saved findings and drafts, each finding with evidence, a recommendation and confidence', async () => {
    const board = await o.agent.cards.board(octx); expect(board.length).toBeGreaterThanOrEqual(10);
    for (const c of board) { expect(c.card.evidence.length, c.card.title).toBeGreaterThan(0); expect(c.card.recommendation.length).toBeGreaterThan(10); expect(['high', 'medium', 'low']).toContain(c.card.confidence); }
    const drafts = await o.agent.deliverables.list(octx); expect(drafts.length).toBeGreaterThanOrEqual(2); expect(drafts.every((d) => d.status === 'in_review' || d.status === 'approved' || d.status === 'rejected')).toBe(true);
  });
  it('the saved profile separates verified facts from inferences', async () => {
    const p = await o.agent.profiles.get(octx); const fields = Object.values((p as unknown as { fields: Record<string, { provenance: { evidence: string } }> }).fields); const cls = new Set(fields.map((f) => f.provenance.evidence));
    expect(fields.length).toBeGreaterThan(10); expect(cls.has('verified') || cls.has('inferred')).toBe(true);
  });
  it('another customer cannot open this business’s findings, drafts or profile; a member can read', async () => {
    await expect(x.agent.cards.board(xctx)).rejects.toMatchObject({ status: 403 }); await expect(x.agent.deliverables.list(xctx)).rejects.toMatchObject({ status: 403 }); await expect(x.agent.profiles.get(xctx)).rejects.toMatchObject({ status: 403 });
    expect((await m.agent.cards.board(mctx)).length).toBeGreaterThan(0);
  });
  it('edit -> member cannot approve -> owner approves; reject path; approval is server-enforced', async () => {
    const drafts = (await o.agent.deliverables.list(octx)).filter((d) => d.status === 'in_review'); expect(drafts.length).toBeGreaterThanOrEqual(2);
    const [a, b] = [drafts[0]!, drafts[1]!];
    const cur = await m.agent.deliverables.get(mctx, a.id); const blocks = cur.versions.at(-1)!.blocks.map((bl, i) => (i === 0 ? { ...bl, text: `${bl.text} (edited by member)` } : bl));
    const edited = await m.agent.deliverables.edit(mctx, a.id, { blocks, note: 'member edit' }); expect(edited.versions.length).toBe(cur.versions.length + 1);
    await expect(m.agent.deliverables.approve(mctx, a.id, edited.versions.at(-1)!.n)).rejects.toMatchObject({ status: 403 });
    const approved = await o.agent.deliverables.approve(octx, a.id, edited.versions.at(-1)!.n); expect(approved.status).toBe('approved');
    await expect(m.agent.deliverables.reject(mctx, b.id, 'x')).rejects.toMatchObject({ status: 403 });
    expect((await o.agent.deliverables.reject(octx, b.id, 'Not on brand')).status).toBe('rejected');
    const reopened = await o.agent.deliverables.get(octx, a.id); expect(reopened.status).toBe('approved'); expect(JSON.stringify(reopened.versions.at(-1)!.blocks)).toContain('edited by member');
  });
});
