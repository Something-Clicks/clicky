import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { setup } from './helpers/fixtures';
import { Entitlements } from '../src/server/billing/entitlements';
import { FREE_USES, PLAN_FEATURES, QUOTAS } from '../src/server/billing/plans';
import { MockProvider } from '../src/agent/providers/mock';

const PRICES = { marketingReport: 'price_report', assistantMonthly: 'price_am', assistantAnnual: 'price_ay', studioMonthly: 'price_sm', studioAnnual: 'price_sy', suiteMonthly: 'price_um', suiteAnnual: 'price_uy' };
vi.mock('../src/server/env', () => ({ env: { stripeWebhookSecret: 'whsec_test', stripePrices: { marketingReport: 'price_report', assistantMonthly: 'price_am', assistantAnnual: 'price_ay', studioMonthly: 'price_sm', studioAnnual: 'price_sy', suiteMonthly: 'price_um', suiteAnnual: 'price_uy' } }, isProd: false }));
const { handleWebhook, planForPrice, priceFor } = await import('../src/server/billing/stripe');
const sign = (payload: string) => Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
const ev = (id: string, type: string, object: unknown) => JSON.stringify({ id, object: 'event', type, data: { object } });
const use = (ent: Entitlements, ctx: { userId: string; businessId: string }, n: number, task = 'website_audit') => Promise.all(Array.from({ length: n }, (_, i) => ent.recordUse(ctx, { executionId: `x${i}${Math.random()}`, task })));

describe('free-use rules (business plan)', () => {
  it('3 free uses total; starting a run consumes nothing; only a saved, completed output counts', async () => {
    const { ent, owner } = await setup({ plan: 'free' });
    expect((await ent.status(owner)).freeRemaining).toBe(FREE_USES); await ent.assertCanStart(owner, 'website_audit'); expect((await ent.status(owner)).freeRemaining).toBe(3);
    await use(ent, owner, 3); const s = await ent.status(owner); expect(s.freeRemaining).toBe(0); expect(s.features).toEqual([]);
    await expect(ent.assertCanStart(owner, 'website_audit')).rejects.toMatchObject({ code: 'usage_limit' });
    await expect(ent.require(owner, 'drafts_basic')).rejects.toMatchObject({ code: 'usage_limit' });
  });
  it('recording the same run twice counts once', async () => { const { ent, owner } = await setup({ plan: 'free' }); await ent.recordUse(owner, { executionId: 'same', task: 'website_audit' }); await ent.recordUse(owner, { executionId: 'same', task: 'website_audit' }); expect((await ent.status(owner)).freeUsed).toBe(1); });
  it('failed, blocked and needs-input attempts never count (full orchestrator wiring)', async () => {
    const s = await setup({ plan: 'free', provider: new MockProvider({ failTimes: 99 }) });
    const run = await s.agent.orchestrator.submit(s.owner, { request: 'Review my website' }); const [done] = await s.runAll(); expect(done!.status).toBe('failed'); expect(run.id).toBe(done!.id); expect((await s.ent.status(s.owner)).freeUsed).toBe(0);
    const needs = await s.agent.orchestrator.submit(s.owner, { request: 'Evaluate our latest marketing results' }); expect(needs.status).toMatch(/needs_input|failed/); expect((await s.ent.status(s.owner)).freeUsed).toBe(0);
  });
  it('a run never counts against itself: with one free use left, that final run still gets its drafts', async () => {
    const s = await setup({ plan: 'free' }); for (let i = 0; i < 2; i++) await s.ent.recordUse(s.owner, { executionId: `u${i}`, task: 'website_audit' });
    const e = await s.agent.orchestrator.submit(s.owner, { request: 'Write an FAQ about water heater repair' }); const [r] = await s.runAll();
    expect(r!.status).toBe('succeeded'); expect(r!.id).toBe(e.id); expect(r!.state.deliverableIds).toHaveLength(1); expect(r!.limitations.join(' ')).not.toMatch(/not part of your plan/);
    expect((await s.ent.status(s.owner)).freeRemaining).toBe(0); // and it is now spent
  });
  it('in-flight runs reserve allowance so parallel requests cannot overshoot', async () => {
    const { ent, owner, db } = await setup({ plan: 'free' });
    for (let i = 0; i < 3; i++) await db.workflows.insert({ businessId: owner.businessId, userId: owner.userId, request: 'r', taskType: 'website_audit', params: {}, requiredCapabilities: [], status: 'queued', steps: [], state: {}, questions: [], limitations: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 }, models: [], approvalRequirements: [], idempotencyKey: 'k' + i, mock: false });
    await expect(ent.assertCanStart(owner, 'website_audit')).rejects.toMatchObject({ code: 'usage_limit' });
  });
});

describe('plans', () => {
  it('each plan unlocks a strict superset of the one below it (one agent, more capabilities)', () => {
    const order = ['report', 'assistant', 'studio', 'suite'] as const;
    for (let i = 1; i < order.length; i++) for (const f of PLAN_FEATURES[order[i - 1]!]) expect(PLAN_FEATURES[order[i]!]).toContain(f);
    expect(PLAN_FEATURES.suite.length).toBeGreaterThan(PLAN_FEATURES.studio.length); expect(PLAN_FEATURES.studio.length).toBeGreaterThan(PLAN_FEATURES.assistant.length); expect(PLAN_FEATURES.assistant.length).toBeGreaterThan(PLAN_FEATURES.report.length);
    expect(QUOTAS.assistant.drafts).toBe(20); expect(QUOTAS.studio.drafts).toBe(80); expect(QUOTAS.suite.drafts).toBe(250);
  });
  it('subscription status drives the plan: active unlocks, canceled falls back to free allowances only', async () => {
    const { ent, owner, db } = await setup({ plan: 'studio' }); expect((await ent.status(owner)).plan).toBe('studio'); expect(await ent.has(owner, 'campaigns')).toBe(true);
    const b = (await db.billing.list(owner.businessId))[0]!; await db.billing.update(owner.businessId, b.id, { subscription: { ...b.subscription!, status: 'canceled' } });
    expect(await ent.has(owner, 'campaigns')).toBe(false); expect(await ent.has(owner, 'drafts_basic')).toBe(true); // free uses remain
    await use(ent, owner, 3); await expect(ent.require(owner, 'drafts_basic')).rejects.toMatchObject({ code: 'usage_limit' });
  });
  it('Marketing Report credit funds exactly one website review and nothing else', async () => {
    const { ent, owner, db } = await setup({ plan: 'report' }); await use(ent, owner, 3, 'content_request');
    expect(await ent.has(owner, 'website_review')).toBe(true); expect(await ent.has(owner, 'drafts_basic')).toBe(false);
    await expect(ent.require(owner, 'drafts_basic')).rejects.toMatchObject({ code: 'plan_required' }); await ent.assertCanStart(owner, 'website_audit');
    await ent.recordUse(owner, { executionId: 'rev', task: 'website_audit' }); expect((await db.billing.list(owner.businessId))[0]!.reportCredits).toBe(0);
    await expect(ent.assertCanStart(owner, 'website_audit')).rejects.toMatchObject({ code: 'usage_limit' });
  });
  it('drafts are metered per period for subscribers; reviews are not', async () => {
    const { ent, owner } = await setup({ plan: 'assistant' });
    for (let i = 0; i < 20; i++) await ent.recordUse(owner, { executionId: `d${i}`, task: 'x', kind: 'draft' });
    expect(await ent.draftsRemaining(owner)).toBe(0); await ent.assertCanStart(owner, 'website_audit'); // reviews still allowed
    expect((await ent.status(owner)).draftsUsed).toBe(20);
  });
});

describe('Stripe: four products, one webhook', () => {
  it('maps every configured price to its plan; unknown prices grant nothing; checkout price lookup is config-only', () => {
    expect(planForPrice('price_am')).toBe('assistant'); expect(planForPrice('price_ay')).toBe('assistant'); expect(planForPrice('price_sm')).toBe('studio'); expect(planForPrice('price_sy')).toBe('studio'); expect(planForPrice('price_um')).toBe('suite'); expect(planForPrice('price_uy')).toBe('suite');
    expect(planForPrice('price_report')).toBeUndefined(); expect(planForPrice('price_evil')).toBeUndefined(); expect(planForPrice(undefined)).toBeUndefined();
    expect(priceFor('marketing_report')).toBe(PRICES.marketingReport); expect(priceFor('marketing_studio', 'year')).toBe('price_sy'); expect(priceFor('marketing_suite')).toBe('price_um'); expect(priceFor('marketing_assistant', 'year')).toBe('price_ay');
  });
  it('rejects missing/invalid signatures and writes nothing', async () => {
    const { db } = await setup(); const body = ev('evt_1', 'checkout.session.completed', { metadata: { userId: 'u', businessId: 'b', product: 'marketing_report' }, mode: 'payment', payment_status: 'paid' });
    await expect(handleWebhook(db, body, null, 'whsec_test')).rejects.toMatchObject({ code: 'bad_signature' }); await expect(handleWebhook(db, body, 't=1,v1=bad', 'whsec_test')).rejects.toMatchObject({ code: 'bad_signature' });
    expect(await db.billing.listAcross({})).toHaveLength(0);
  });
  it('a paid Marketing Report grants exactly one credit; replays and unpaid sessions grant nothing more', async () => {
    const { db, owner } = await setup(); const meta = { userId: owner.userId, businessId: owner.businessId, product: 'marketing_report' };
    const body = ev('evt_2', 'checkout.session.completed', { customer: 'cus_1', mode: 'payment', payment_status: 'paid', metadata: meta });
    expect(await handleWebhook(db, body, sign(body), 'whsec_test')).toMatchObject({ handled: true }); expect(await handleWebhook(db, body, sign(body), 'whsec_test')).toMatchObject({ duplicate: true });
    const unpaid = ev('evt_3', 'checkout.session.completed', { customer: 'cus_1', mode: 'payment', payment_status: 'unpaid', metadata: meta }); await handleWebhook(db, unpaid, sign(unpaid), 'whsec_test');
    expect((await db.billing.list(owner.businessId))[0]).toMatchObject({ reportCredits: 1, stripeCustomerId: 'cus_1' });
  });
  const sub = (price: string, status = 'active', who = { userId: 'u1', businessId: 'b1' }) => ({ id: 'sub_9', customer: 'cus_9', status, cancel_at_period_end: false, metadata: who, items: { data: [{ price: { id: price, recurring: { interval: price.endsWith('y') ? 'year' : 'month' } }, current_period_start: 1_780_000_000, current_period_end: 1_782_600_000 }] } });
  it('subscriptions for each product grant that plan; upgrades and cancellations are applied; non-catalog prices are ignored', async () => {
    const { db } = await setup(); const send = async (id: string, type: string, o: unknown) => { const b = ev(id, type, o); return handleWebhook(db, b, sign(b), 'whsec_test'); };
    await send('e1', 'customer.subscription.created', sub('price_am')); expect((await db.billing.list('b1'))[0]!.subscription).toMatchObject({ plan: 'assistant', interval: 'month', status: 'active' });
    await send('e2', 'customer.subscription.updated', sub('price_sy')); expect((await db.billing.list('b1'))[0]!.subscription).toMatchObject({ plan: 'studio', interval: 'year' });
    await send('e3', 'customer.subscription.updated', sub('price_um')); expect((await db.billing.list('b1'))[0]!.subscription!.plan).toBe('suite');
    await send('e4', 'customer.subscription.deleted', sub('price_um')); expect((await db.billing.list('b1'))[0]!.subscription!.status).toBe('canceled');
    expect(await send('e5', 'customer.subscription.created', sub('price_unknown', 'active', { userId: 'u2', businessId: 'b2' }))).toMatchObject({ handled: false }); expect(await db.billing.list('b2')).toHaveLength(0);
  });
});
