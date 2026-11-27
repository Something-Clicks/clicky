import { describe, expect, it } from 'vitest';
import { createBusiness } from '../src/agent/profile/bootstrap';
import { setup } from './helpers/fixtures';

async function seeded() {
  const s = await setup(); await s.agent.orchestrator.submit(s.owner, { request: 'Improve my homepage headline' }); await s.runAll();
  const board = await s.agent.cards.board(s.owner); const card = board.find((c) => c.card.deliverableId)!; return { ...s, card };
}

describe('tenant isolation', () => {
  it("another business's owner cannot read or touch any of this business's data", async () => {
    const { agent, db, owner, card } = await seeded();
    const other = await createBusiness(db, agent.audit, 'user-other', { name: 'Other Co' });
    const spoof = { userId: 'user-other', businessId: owner.businessId }; // forged ctx pointing at someone else's tenant
    await expect(agent.profiles.get(spoof)).rejects.toMatchObject({ status: 403 });
    await expect(agent.cards.board(spoof)).rejects.toMatchObject({ status: 403 });
    await expect(agent.cards.get(spoof, card.id)).rejects.toMatchObject({ status: 403 });
    await expect(agent.deliverables.get(spoof, card.card.deliverableId!)).rejects.toMatchObject({ status: 403 });
    await expect(agent.deliverables.approve(spoof, card.card.deliverableId!, 1)).rejects.toMatchObject({ status: 403 });
    await expect(agent.orchestrator.submit(spoof, { request: 'Review my website' })).rejects.toMatchObject({ status: 403 });
    await expect(agent.execution.authorize(spoof, 'x')).rejects.toMatchObject({ status: 403 });
    await expect(agent.performance.ingestCsv(spoof, 's', 'metric,value\nclicks,1', { periodStart: '2026-01-01', periodEnd: '2026-01-31' })).rejects.toMatchObject({ status: 403 });
    // legit ctx of the other tenant, asking for this tenant's ids: not found (table access is tenant-scoped by construction)
    await expect(agent.cards.get(other, card.id)).rejects.toMatchObject({ status: 404 });
    await expect(agent.deliverables.get(other, card.card.deliverableId!)).rejects.toMatchObject({ status: 404 });
    expect(await agent.cards.board(other)).toEqual([]);
    const ctxData = await agent.context.build(other, ['business', 'research', 'cards', 'history', 'performance']);
    expect(JSON.stringify(ctxData)).not.toMatch(/Summit|Water heater/);
  });
});

describe('role permissions', () => {
  it('viewer can read but not run, edit, approve, ingest or authorize', async () => {
    const { agent, owner, addMember, card } = await seeded(); await addMember('v', 'viewer'); const v = { userId: 'v', businessId: owner.businessId }; const did = card.card.deliverableId!;
    await agent.cards.board(v); await agent.deliverables.get(v, did);
    const d = await agent.deliverables.get(v, did); const blocks = d.versions[0]!.blocks;
    await expect(agent.orchestrator.submit(v, { request: 'Review my website' })).rejects.toMatchObject({ status: 403 });
    await expect(agent.deliverables.edit(v, did, { blocks })).rejects.toMatchObject({ status: 403 });
    await expect(agent.deliverables.approve(v, did, 1)).rejects.toMatchObject({ status: 403 });
    await expect(agent.cards.decide(v, card.id, 'dismiss')).rejects.toMatchObject({ status: 403 });
    await expect(agent.profiles.applyUpdates(v, [{ key: 'pricing', value: 'x', provenance: { source: 'customer_confirmed', evidence: 'verified' } }], { type: 'user', id: 'v' })).rejects.toMatchObject({ status: 403 });
  });
  it('editor can approve content but cannot authorize execution; admin can', async () => {
    const { agent, owner, addMember, card } = await seeded(); await addMember('e', 'editor'); await addMember('a', 'admin');
    const e = { userId: 'e', businessId: owner.businessId }, a = { userId: 'a', businessId: owner.businessId }; const did = card.card.deliverableId!;
    await agent.deliverables.approve(e, did, 1);
    const req = await agent.execution.request(e, { deliverableId: did, action: 'save_to_workspace' });
    await expect(agent.execution.authorize(e, req.id)).rejects.toMatchObject({ status: 403 });
    await expect(agent.execution.execute(e, req.id)).rejects.toMatchObject({ status: 403 });
    await agent.execution.authorize(a, req.id); expect((await agent.execution.execute(a, req.id)).status).toBe('verified');
  });
  it('only an owner can manage members; the permission matrix has no model-reachable grant', async () => {
    const { agent, owner, addMember } = await seeded(); await addMember('a', 'admin');
    expect(await agent.authz.can('a', owner.businessId, 'manage_members')).toBe(false); expect(await agent.authz.can(owner.userId, owner.businessId, 'manage_members')).toBe(true);
  });
});
