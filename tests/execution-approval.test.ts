import { describe, expect, it } from 'vitest';
import type { ExecutionAdapter } from '../src/agent/capabilities/execution';
import { setup } from './helpers/fixtures';

async function approved() {
  const s = await setup(); await s.agent.orchestrator.submit(s.owner, { request: 'Improve my homepage headline' }); await s.runAll();
  const card = (await s.agent.cards.board(s.owner)).find((c) => c.card.deliverableId)!; const did = card.card.deliverableId!;
  return { ...s, card, did };
}

describe('approval and execution enforcement (server-side)', () => {
  it('cannot request an action for an unapproved draft', async () => {
    const { agent, owner, did } = await approved();
    await expect(agent.execution.request(owner, { deliverableId: did, action: 'save_to_workspace' })).rejects.toMatchObject({ code: 'not_approved' });
  });
  it('draft → approve → request → authorize → execute → verify are separate recorded events', async () => {
    const { agent, owner, did } = await approved();
    await agent.deliverables.approve(owner, did, 1);
    const r = await agent.execution.request(owner, { deliverableId: did, action: 'save_to_workspace' }); expect(r.status).toBe('requested');
    await expect(agent.execution.execute(owner, r.id)).rejects.toMatchObject({ code: 'not_authorized' }); // a request is not permission
    await agent.execution.authorize(owner, r.id); const done = await agent.execution.execute(owner, r.id);
    expect(done.status).toBe('verified'); expect(done.result!.verified).toBe(true);
    const acts = (await agent.audit.list(owner.businessId)).map((a) => a.action);
    for (const a of ['deliverable.created', 'deliverable.approved', 'execution.requested', 'execution.authorized', 'execution.verified']) expect(acts).toContain(a);
  });
  it('never lets the agent spend, bill, modify accounts, contract or commit to third parties', async () => {
    const { agent, owner, did } = await approved(); await agent.deliverables.approve(owner, did, 1);
    for (const action of ['spend_ad_budget', 'change_billing', 'modify_account', 'make_contract_promise', 'commit_third_party_service'] as const)
      await expect(agent.execution.request(owner, { deliverableId: did, action })).rejects.toMatchObject({ code: 'forbidden_action' });
    expect((await agent.audit.list(owner.businessId)).filter((a) => a.action === 'execution.blocked')).toHaveLength(5);
  });
  it('publishing/sending actions are unavailable until a real integration is connected (nothing is faked)', async () => {
    const { agent, owner, did } = await approved(); await agent.deliverables.approve(owner, did, 1);
    for (const action of ['publish_website', 'send_email_campaign', 'schedule_social_post'] as const)
      await expect(agent.execution.request(owner, { deliverableId: did, action })).rejects.toMatchObject({ code: 'integration_unavailable' });
    expect(agent.execution.availableActions().sort()).toEqual(['download_export', 'record_activity', 'save_to_workspace']);
  });
  it('editing after approval invalidates approval and any pending request', async () => {
    const { agent, owner, did } = await approved(); await agent.deliverables.approve(owner, did, 1);
    const r = await agent.execution.request(owner, { deliverableId: did, action: 'save_to_workspace' }); await agent.execution.authorize(owner, r.id);
    const d = await agent.deliverables.get(owner, did); await agent.deliverables.edit(owner, did, { blocks: d.versions[0]!.blocks.map((b) => (b.key === 'cta' ? { ...b, text: 'Changed after approval' } : b)) });
    await expect(agent.execution.execute(owner, r.id)).rejects.toMatchObject({ code: 'approval_stale' });
    await expect(agent.execution.request(owner, { deliverableId: did, action: 'save_to_workspace' })).rejects.toMatchObject({ code: 'not_approved' });
  });
  it('only the current version can be approved', async () => {
    const { agent, owner, did } = await approved(); const d = await agent.deliverables.get(owner, did);
    await agent.deliverables.edit(owner, did, { blocks: d.versions[0]!.blocks });
    await expect(agent.deliverables.approve(owner, did, 1)).rejects.toMatchObject({ code: 'stale_version' });
  });
  it('prevents duplicate execution: repeated requests dedupe, repeated/concurrent execute runs the adapter once', async () => {
    const { agent, owner, did } = await approved(); await agent.deliverables.approve(owner, did, 1);
    let runs = 0; const slow: ExecutionAdapter = { action: 'record_activity', safeToRetry: false, async execute() { runs++; await new Promise((r) => setTimeout(r, 30)); return { detail: 'ok' }; }, async verify() { return { ok: true, detail: 'v' }; } };
    agent.execution.register(slow);
    const a = await agent.execution.request(owner, { deliverableId: did, action: 'record_activity' }); const b = await agent.execution.request(owner, { deliverableId: did, action: 'record_activity' }); expect(b.id).toBe(a.id);
    await agent.execution.authorize(owner, a.id);
    const results = await Promise.allSettled([agent.execution.execute(owner, a.id), agent.execution.execute(owner, a.id), agent.execution.execute(owner, a.id)]);
    expect(runs).toBe(1); expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect((await agent.execution.execute(owner, a.id)).status).toBe('verified'); expect(runs).toBe(1);
  });
  it('records real failures, never marks them successful, and retries only when safe and limited', async () => {
    const { agent, owner, did } = await approved(); await agent.deliverables.approve(owner, did, 1);
    let n = 0; agent.execution.register({ action: 'save_to_workspace', safeToRetry: true, async execute() { n++; if (n < 3) throw new Error('integration down'); return { detail: 'ok' }; }, async verify() { return { ok: true, detail: 'v' }; } });
    const r = await agent.execution.request(owner, { deliverableId: did, action: 'save_to_workspace' }); await agent.execution.authorize(owner, r.id);
    const f = await agent.execution.execute(owner, r.id); expect(f.status).toBe('failed'); expect(f.error!.message).toBe('integration down'); expect(f.result).toBeUndefined();
    expect((await agent.cards.get(owner, (await agent.cards.board(owner)).find((c) => c.card.deliverableId === did)!.id)).card.status).toBe('failed');
    expect((await agent.execution.retry(owner, r.id)).status).toBe('failed'); expect((await agent.execution.retry(owner, r.id)).status).toBe('verified');
    agent.execution.register({ action: 'record_activity', safeToRetry: false, async execute() { throw new Error('boom'); }, async verify() { return { ok: true, detail: '' }; } });
    const r2 = await agent.execution.request(owner, { deliverableId: did, action: 'record_activity' }); await agent.execution.authorize(owner, r2.id); await agent.execution.execute(owner, r2.id);
    await expect(agent.execution.retry(owner, r2.id)).rejects.toMatchObject({ code: 'not_retryable' });
  });
  it('record_activity is customer-attested and never reported as verified publishing', async () => {
    const { agent, owner, did } = await approved(); await agent.deliverables.approve(owner, did, 1);
    const r = await agent.execution.request(owner, { deliverableId: did, action: 'record_activity', target: { url: 'https://summitplumbing.example/' } }); await agent.execution.authorize(owner, r.id);
    const done = await agent.execution.execute(owner, r.id); expect(done.status).toBe('executed'); expect(done.result!.verified).toBe(false); expect(done.result!.detail).toMatch(/customer-attested/i);
  });
  it('test email goes only to the authorizing user and only through the sender interface', async () => {
    const sent: { to: string }[] = []; const { agent, owner, did } = await approved(); await agent.deliverables.approve(owner, did, 1);
    const { testEmailAdapter } = await import('../src/agent/capabilities/execution'); agent.execution.register(testEmailAdapter(agent.db, { async send(m) { sent.push(m); return { id: 'msg_1' }; } }));
    const bad = await agent.execution.request(owner, { deliverableId: did, action: 'send_transactional_email', target: { to: 'victim@elsewhere.com' } }); await agent.execution.authorize(owner, bad.id);
    expect((await agent.execution.execute(owner, bad.id, { actorEmail: 'owner@summit.test' })).status).toBe('failed'); expect(sent).toHaveLength(0);
    const ok = await agent.execution.request(owner, { deliverableId: did, action: 'send_transactional_email', target: { to: 'owner@summit.test' } }); await agent.execution.authorize(owner, ok.id);
    expect((await agent.execution.execute(owner, ok.id, { actorEmail: 'owner@summit.test' })).status).toBe('verified'); expect(sent).toEqual([expect.objectContaining({ to: 'owner@summit.test' })]);
  });
  it('claims the agent invented must be acknowledged by a person before approval', async () => {
    const { agent, owner, did } = await approved(); const d = await agent.deliverables.get(owner, did);
    const edited = await agent.deliverables.edit(owner, did, { blocks: d.versions[0]!.blocks.map((b) => (b.key === 'subheadline' ? { ...b, text: 'Award-winning plumbers with 25 years in business.' } : b)) });
    expect(edited.versions[1]!.flags.some((f) => f.severity === 'high')).toBe(true);
    await expect(agent.deliverables.approve(owner, did, 2)).rejects.toMatchObject({ code: 'unresolved_flags' });
    await agent.deliverables.acknowledgeFlags(owner, did, edited.versions[1]!.flags.filter((f) => f.severity === 'high').map((f) => f.excerpt));
    expect((await agent.deliverables.approve(owner, did, 2)).status).toBe('approved');
  });
});
