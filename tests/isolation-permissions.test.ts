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
  it('a member can work (run, edit, decide cards) but cannot approve, authorize or manage members', async () => {
    const { agent, owner, addMember, card } = await seeded(); await addMember('m', 'member'); const m = { userId: 'm', businessId: owner.businessId }; const did = card.card.deliverableId!;
    await agent.cards.board(m); const d = await agent.deliverables.get(m, did); const blocks = d.versions[0]!.blocks;
    await agent.deliverables.edit(m, did, { blocks });
    await expect(agent.deliverables.approve(m, did, 2)).rejects.toMatchObject({ status: 403 });
    await agent.deliverables.approve(owner, did, (await agent.deliverables.get(owner, did)).versions.at(-1)!.n);
    const req = await agent.execution.request(m, { deliverableId: did, action: 'save_to_workspace' });
    await expect(agent.execution.authorize(m, req.id)).rejects.toMatchObject({ status: 403 });
    await expect(agent.execution.execute(m, req.id)).rejects.toMatchObject({ status: 403 });
    await agent.execution.authorize(owner, req.id); expect((await agent.execution.execute(owner, req.id)).status).toBe('verified');
  });
  it('a non-member sees nothing; only an owner can manage members', async () => {
    const { agent, owner, addMember } = await seeded(); await addMember('m', 'member');
    const nobody = { userId: 'nobody', businessId: owner.businessId };
    await expect(agent.orchestrator.submit(nobody, { request: 'Review my website' })).rejects.toMatchObject({ status: 403 });
    expect(await agent.authz.can('m', owner.businessId, 'manage_members')).toBe(false); expect(await agent.authz.can(owner.userId, owner.businessId, 'manage_members')).toBe(true);
  });
});
