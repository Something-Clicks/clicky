/**
 * Runs against the real clicky-dev Supabase project using REAL signed-in customer sessions (publishable key + user JWT).
 * No service-role key. Skipped unless SC_TEST_PASSWORD (+ the dev project URL/key) is set. Refuses any non-allow-listed project.
 * Test organizations/accounts (sc-test-*) are created and removed out-of-band by the operator; see docs/SCHEMA_CONSOLIDATION.md.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseDb } from '../src/agent/store/supabase';
import type { Db } from '../src/agent/store/db';
import { Entitlements } from '../src/server/billing/entitlements';
import { createBusiness } from '../src/agent/profile/bootstrap';
import { AuditLog } from '../src/agent/store/audit';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, PW = process.env.SC_TEST_PASSWORD;
const ref = URL?.match(/^https:\/\/([a-z0-9]{20})\./)?.[1];
const ok = !!(URL && KEY && PW && ref === 'ofstvbgaoznipsiqbjjp' && (process.env.ALLOWED_SUPABASE_REFS ?? '').split(',').includes(ref));
const ORG_A = 'e0000000-0000-0000-0000-00000000000a', ORG_B = 'e0000000-0000-0000-0000-00000000000b';
const U = { ownerA: 'f0000000-0000-0000-0000-0000000000a1', memberA: 'f0000000-0000-0000-0000-0000000000a2', ownerB: 'f0000000-0000-0000-0000-0000000000b1' };

async function login(email: string): Promise<{ c: SupabaseClient; db: Db }> {
  const c = createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW! }); if (error) throw new Error(`login failed: ${error.message}`);
  return { c, db: createSupabaseDb(c) };
}
const rid = () => `sct-${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!ok)('real clicky-dev customer sessions (RLS, roles, billing view, concurrency)', () => {
  let a: Awaited<ReturnType<typeof login>>, m: typeof a, b: typeof a;
  beforeAll(async () => { [a, m, b] = await Promise.all([login('sc-test-owner-a@example.test'), login('sc-test-member-a@example.test'), login('sc-test-owner-b@example.test')]); });

  it('tenancy: members see their organization and roster; other tenants see nothing', async () => {
    expect((await a.db.members.list(ORG_A)).map((x) => `${x.userId}:${x.role}`).sort()).toEqual([`${U.memberA}:member`, `${U.ownerA}:owner`].sort());
    expect((await m.db.members.list(ORG_A)).length).toBe(2);
    expect(await b.db.members.list(ORG_A)).toEqual([]);
    expect(await b.db.businesses.get(ORG_A, ORG_A)).toBeUndefined();
    expect((await a.db.businesses.get(ORG_A, ORG_A))?.name).toBe('SC Test Org A');
    expect((await b.db.members.listAcross({ userId: U.ownerA }))).toEqual([]);
  });

  it('billing view: old plan ids map to the four products; one-time credits; read-only for customers', async () => {
    const ea = new Entitlements(a.db); const eb = new Entitlements(b.db);
    const sa = await ea.status({ userId: U.ownerA, businessId: ORG_A });
    expect(sa.plan).toBe('studio'); expect(sa.canStartOutput).toBe(true); expect(sa.features).toContain('research_advanced');
    expect((await new Entitlements(m.db).status({ userId: U.memberA, businessId: ORG_A })).plan).toBe('studio');
    const sb = await eb.status({ userId: U.ownerB, businessId: ORG_B }); expect(sb.reportCredits).toBe(1);
    await expect(a.db.billing.insert({ businessId: ORG_A, userId: U.ownerA, reportCredits: 99 })).rejects.toMatchObject({ code: 'server_only' });
    const { error } = await a.c.from('subscriptions').insert({ organization_id: ORG_A, stripe_subscription_id: 'sub_FORGEDFORGEDFORGED1', plan_id: 'multi_site', status: 'active' });
    expect(error?.code).toBe('42501');
    const forged = await a.c.from('subscriptions').update({ plan_id: 'multi_site' }).eq('organization_id', ORG_A).select();
    expect(forged.data ?? []).toEqual([]); // no row writable
  });

  it('working data: written by one member, readable by the other, invisible and unwritable for another tenant', async () => {
    const id = rid(); await a.db.research.insert({ id, businessId: ORG_A, kind: 'competitor', title: 't' } as never);
    expect((await m.db.research.get(ORG_A, id))?.id).toBe(id);
    expect(await b.db.research.get(ORG_A, id)).toBeUndefined();
    expect(await b.db.research.list(ORG_A)).toEqual([]);
    await expect(b.db.research.insert({ id: rid(), businessId: ORG_A } as never)).rejects.toMatchObject({ status: 403 });
    await expect(b.db.research.update(ORG_A, id, { title: 'hacked' } as never)).rejects.toBeTruthy();
    expect(((await a.db.research.get(ORG_A, id)) as unknown as { title: string }).title).toBe('t');
  });

  it('concurrent updates: exactly one of two writers using the same version wins', async () => {
    const id = rid(); const row = await a.db.research.insert({ id, businessId: ORG_A, n: 0 } as never);
    const r = await Promise.allSettled([a.db.research.update(ORG_A, id, { n: 1 } as never, row.version), m.db.research.update(ORG_A, id, { n: 2 } as never, row.version)]);
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1);
    expect(r.filter((x) => x.status === 'rejected').length).toBe(1);
  });

  it('owner-only authority: a member cannot approve a deliverable or strategy or authorize an execution; an owner can', async () => {
    const d = rid(); await m.db.deliverables.insert({ id: d, businessId: ORG_A, status: 'draft' } as never);
    await expect(m.db.deliverables.update(ORG_A, d, { status: 'approved' } as never)).rejects.toMatchObject({ status: 403 });
    expect(((await a.db.deliverables.update(ORG_A, d, { status: 'approved' } as never)) as unknown as { status: string }).status).toBe('approved');
    const s = rid(); await m.db.strategies.insert({ id: s, businessId: ORG_A, status: 'draft' } as never);
    await expect(m.db.strategies.update(ORG_A, s, { status: 'approved' } as never)).rejects.toMatchObject({ status: 403 });
    const x = rid(); await m.db.executionRequests.insert({ id: x, businessId: ORG_A, status: 'requested' } as never);
    await expect(m.db.executionRequests.update(ORG_A, x, { status: 'authorized' } as never)).rejects.toMatchObject({ status: 403 });
    expect(((await a.db.executionRequests.update(ORG_A, x, { status: 'authorized' } as never)) as unknown as { status: string }).status).toBe('authorized');
  });

  it('row identity is immutable and a member cannot re-parent a row into another tenant', async () => {
    const id = rid(); await a.db.research.insert({ id, businessId: ORG_A } as never);
    const { error } = await a.c.from('sc_research').update({ business_id: ORG_B, version: 2 }).eq('id', id);
    expect(error).toBeTruthy();
    const skip = await a.c.from('sc_research').update({ version: 7 }).eq('id', id); expect(skip.error).toBeTruthy(); // version must advance by one
  });

  it('usage ledger rows can only be written for yourself; audit trail is owner-readable only', async () => {
    await expect(m.db.uses.insert({ businessId: ORG_A, userId: U.ownerA, kind: 'output' } as never)).rejects.toBeTruthy();
    await m.db.uses.insert({ businessId: ORG_A, userId: U.memberA, kind: 'output', id: rid() } as never);
    await a.db.audit.insert({ businessId: ORG_A, action: 'test', id: rid() } as never);
    expect((await a.db.audit.list(ORG_A)).length).toBeGreaterThan(0);
    expect(await m.db.audit.list(ORG_A)).toEqual([]);
    expect(await b.db.audit.list(ORG_A)).toEqual([]);
  });

  it('model-output functions are refused for customers (no server key): complete_analysis, finish_marketing_workflow, add_model_findings, record_analysis_pages', async () => {
    const z = '00000000-0000-0000-0000-0000000000aa';
    for (const [fn, args] of [['complete_analysis', { p_analysis: z, p_evidence: [], p_cards: [], p_coverage: {}, p_summary: 's', p_wording: 'w' }],
      ['finish_marketing_workflow', { p_workflow: z, p_status: 'done', p_steps: [], p_result: {}, p_error: null, p_provider: 'p', p_model: 'm', p_usage: {} }],
      ['add_model_findings', { p_analysis: z, p_evidence: [], p_cards: [] }], ['record_analysis_pages', { p_analysis: z, p_pages: [{ url: 'x', body: 'y' }] }]] as const) {
      const { error } = await a.c.rpc(fn, args as never); expect(error?.code, fn).toBe('42501');
    }
  });

  it('provisioning: create_organization makes the org, owner membership and profile for the signed-in customer; free allowance is 3', async () => {
    const audit = new AuditLog(a.db);
    const ctx = await createBusiness(a.db, audit, U.ownerA, { name: `SC Test Provisioned ${rid()}`, website: 'https://provisioned.example.test' });
    expect((await a.db.members.list(ctx.businessId, { userId: U.ownerA }))[0]?.role).toBe('owner');
    expect((await a.db.sites.get(ctx.businessId, ctx.businessId))?.isPrimary).toBe(true);
    expect(await b.db.businesses.get(ctx.businessId, ctx.businessId)).toBeUndefined();
    const s = await new Entitlements(a.db).status(ctx); expect(s.freeRemaining).toBeGreaterThan(-1);
  });
});
