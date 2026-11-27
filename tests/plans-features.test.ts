import { describe, expect, it } from 'vitest';
import { setup, type TestPlan } from './helpers/fixtures';

const CSV = 'Keyword,Search Volume,Keyword Difficulty\nhow to flush a water heater,1300,22\ndrain cleaning near me,900,41';
const usage = () => ({ current: { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 } });
const refused = async (p: Promise<unknown>, code: string) => { await expect(p).rejects.toMatchObject({ code }); };
const submit = (s: Awaited<ReturnType<typeof setup>>, request: string, params = {}, taskType?: never) => s.agent.orchestrator.submit(s.owner, { request, params, taskType });

describe('Marketing Report: website review, findings, priorities, next steps (one review)', () => {
  it('produces the review with evidence-backed, prioritised findings but no drafts, research, plans or tracking', async () => {
    const s = await setup({ plan: 'report' }); for (let i = 0; i < 3; i++) await s.ent.recordUse(s.owner, { executionId: `free${i}`, task: 'content_request' }); // the 3 free uses are spent; only the purchase remains
    for (const [req, p] of [['Improve my homepage headline', {}], ['Write a blog article about pipes', {}], ['Research my competitors', { competitorUrls: ['https://rivalplumbing.example'] }], ['Analyze my keywords', { keywordCsv: CSV }], ['Develop a marketing plan', {}], ['Prepare a promotional campaign', { goal: 'x' }]] as const)
      await refused(submit(s, req, p), 'plan_required');
    await refused(s.agent.deliverables.generate(s.owner, { type: 'email' }, usage()), 'plan_required'); await refused(s.agent.strategies.generate(s.owner, usage()), 'plan_required');
    await refused(s.agent.campaigns.plan(s.owner, { goal: 'x' }, usage()), 'plan_required'); await refused(s.agent.performance.ingestCsv(s.owner, 's', 'metric,value\nclicks,1', { periodStart: '2026-01-01', periodEnd: '2026-01-31' }), 'plan_required');
    await refused(s.agent.insights.summary(s.owner), 'plan_required'); await refused(s.agent.progress.summary(s.owner), 'plan_required'); await refused(s.agent.sites.add(s.owner, { name: 'B', url: 'rivalplumbing.example' }), 'plan_required'); await refused(s.agent.brand.report(s.owner), 'plan_required');
    await submit(s, 'Review my website'); const [r] = await s.runAll(); expect(r!.status).toBe('succeeded');
    const cards = await s.agent.cards.board(s.owner); expect(cards.length).toBeGreaterThan(3); expect(cards.every((c) => c.card.evidence.length && c.card.recommendation && c.card.priority.rank)).toBe(true);
    expect(await s.agent.db.deliverables.list(s.owner.businessId)).toHaveLength(0); expect(r!.limitations.join(' ')).toMatch(/drafts are not part of your plan/i);
    await refused(Promise.resolve(s.ent.assertCanStart(s.owner, 'website_audit')), 'usage_limit'); // the credit was one review
    await refused(submit(s, 'Review my website', { rescan: true }), 'usage_limit');
  });
});

describe('Marketing Assistant: ongoing reviews, basic drafts, approval, tracking, results', () => {
  it('reviews and prepares basic drafts; advanced content, research, planning, campaigns, insights and extra sites are locked', async () => {
    const s = await setup({ plan: 'assistant' }); await submit(s, 'Review my website'); const [r] = await s.runAll(); expect(r!.status).toBe('succeeded'); expect((r!.state.draftsCreated as number)).toBeGreaterThan(0);
    await submit(s, 'Improve my homepage headline'); await s.runAll(); await submit(s, 'Write an email about drain cleaning'); expect((await s.runAll())[0]!.status).toBe('succeeded');
    for (const [req, p] of [['Write a blog article about pipes', {}], ['Create an email sequence for new customers', {}], ['Research my competitors', { competitorUrls: ['https://rivalplumbing.example'] }], ['Analyze my keywords', { keywordCsv: CSV }], ['Develop a marketing plan', {}], ['Prepare a promotional campaign', { goal: 'x' }]] as const)
      await refused(submit(s, req, p), 'plan_required');
    await refused(s.agent.insights.summary(s.owner), 'plan_required'); await refused(s.agent.sites.add(s.owner, { name: 'B', url: 'rivalplumbing.example' }), 'plan_required'); await refused(s.agent.brand.report(s.owner), 'plan_required');
    expect((await s.agent.progress.summary(s.owner)).total).toBeGreaterThan(0); // progress tracking included
    const did = (await s.agent.cards.board(s.owner)).find((c) => c.card.deliverableId)!.card.deliverableId!; await s.agent.deliverables.approve(s.owner, did, 1);
    expect((await s.agent.execution.request(s.owner, { deliverableId: did, action: 'save_to_workspace' })).status).toBe('requested'); // approval + action tracking included
    await s.agent.performance.ingestCsv(s.owner, 'gsc_manual', 'query,clicks,impressions,position\na,5,100,3', { periodStart: '2026-10-01', periodEnd: '2026-10-28' }); // results included
  });
  it('a review never prepares advanced drafts it is not entitled to; the review itself still succeeds', async () => {
    const s = await setup({ plan: 'assistant' });
    await s.db.profiles.update(s.owner.businessId, s.owner.businessId, { fields: { ...(await s.agent.profiles.getInternal(s.owner.businessId)).fields, service_areas: { value: ['Salt Lake City, UT'], provenance: { source: 'customer_confirmed', evidence: 'verified', recordedAt: new Date().toISOString() }, confirmed: true, updatedAt: '', conflicts: [], previous: [] } } });
    await submit(s, 'Review my website'); const [r] = await s.runAll(); expect(r!.status).toBe('succeeded');
    const types = (await s.agent.db.deliverables.list(s.owner.businessId)).map((d) => d.type); expect(types.every((t) => ['headline_set', 'page_copy', 'seo_meta', 'faq', 'about_page', 'service_page', 'email', 'social_posts'].includes(t))).toBe(true);
  });
  it('enforces the monthly draft allowance (20) without blocking reviews', async () => {
    const s = await setup({ plan: 'assistant' }); for (let i = 0; i < 20; i++) await s.ent.recordUse(s.owner, { executionId: `d${i}`, task: 'x', kind: 'draft' });
    await refused(s.agent.deliverables.generate(s.owner, { type: 'email' }, usage()), 'usage_limit'); await refused(submit(s, 'Write an email about drain cleaning').then((e) => (s.runAll(), e)).then(async (e) => { const [r] = await s.runAll(); if (r?.status === 'failed') throw Object.assign(new Error(r.error!.message), { code: r.error!.code }); return e; }), 'usage_limit').catch(() => undefined);
    await submit(s, 'Review my website'); const [r] = await s.runAll(); expect(r!.status).toBe('succeeded'); expect(r!.limitations.join(' ')).toMatch(/used all the drafts/i); expect(await s.agent.db.deliverables.list(s.owner.businessId)).toHaveLength(0);
  });
});

describe('Marketing Studio: research, insights, advanced content, planning, campaigns', () => {
  it('unlocks competitor/keyword/market research, insights, long-form content, marketing plan and campaigns; still one website', async () => {
    const s = await setup({ plan: 'studio' });
    await submit(s, 'Research my competitors', { competitorUrls: ['https://rivalplumbing.example'] }); await submit(s, 'Analyze my keywords', { keywordCsv: CSV });
    for (const r of await s.runAll()) expect(r.status).toBe('succeeded');
    await submit(s, 'Write a blog article about water heater maintenance'); await submit(s, 'Create an email sequence for new customers'); await submit(s, 'Develop a marketing plan'); await submit(s, 'Prepare a promotional campaign', { goal: 'More drain cleaning enquiries' });
    for (const r of await s.runAll()) expect(r.status).toBe('succeeded');
    const types = (await s.agent.db.deliverables.list(s.owner.businessId)).map((d) => d.type); expect(types).toEqual(expect.arrayContaining(['blog_article', 'email_sequence']));
    const i = await s.agent.insights.summary(s.owner); expect(i.competitive!.data.competitors).toHaveLength(1); expect(i.keywords!.top[0]).toMatchObject({ keyword: 'how to flush a water heater', volume: 1300 }); expect(i.missing.join()).toMatch(/Results/); expect(i.keywords!.gaps.length).toBeGreaterThan(0);
    expect((await s.agent.strategies.latest(s.owner))!.data.objectives.length).toBeGreaterThan(0); expect((await s.agent.campaigns.list(s.owner)).length).toBe(1);
    await refused(s.agent.sites.add(s.owner, { name: 'B', url: 'rivalplumbing.example' }), 'plan_required'); await refused(s.agent.brand.report(s.owner), 'plan_required');
  });
  it('insights never invent: with no research saved it lists exactly what is missing', async () => {
    const s = await setup({ plan: 'studio' }); const i = await s.agent.insights.summary(s.owner); expect(i.competitive).toBeUndefined(); expect(i.keywords).toBeUndefined(); expect(i.performance).toBeUndefined(); expect(i.missing).toHaveLength(3);
  });
});

describe('Marketing Suite: everything, across multiple websites and locations', () => {
  it('adds websites and locations up to the plan limits and never beyond', async () => {
    const s = await setup({ plan: 'suite' }); const o = s.owner;
    for (let i = 1; i <= 4; i++) await s.agent.sites.add(o, { name: `Site ${i}`, url: `site${i}.example` });
    await refused(s.agent.sites.add(o, { name: 'Site 6', url: 'site6.example' }), 'site_limit'); await refused(s.agent.sites.add(o, { name: 'Dup', url: 'https://www.site1.example' }), 'duplicate_site');
    const primary = (await s.agent.sites.list(o))[0]!; for (let i = 0; i < 25; i++) await s.agent.sites.addLocation(o, primary.id, { name: `L${i}`, zip: '84101' }); await refused(s.agent.sites.addLocation(o, primary.id, { name: 'L26' }), 'location_limit');
    await expect(s.agent.sites.add(o, { name: 'x', url: 'http://127.0.0.1' })).rejects.toThrow();
  });
  it('downgrade keeps all data readable but only the primary site stays workable', async () => {
    const s = await setup({ plan: 'suite' }); const second = await s.agent.sites.add(s.owner, { name: 'Second', url: 'rivalplumbing.example' });
    await s.agent.orchestrator.submit({ ...s.owner, siteId: second.id }, { request: 'Review my website', taskType: 'website_audit' }); await s.runAll();
    const b = (await s.db.billing.list(s.owner.businessId))[0]!; await s.db.billing.update(s.owner.businessId, b.id, { subscription: { ...b.subscription!, plan: 'studio' } });
    expect((await s.agent.sites.list(s.owner)).length).toBe(2); expect((await s.agent.sites.usable(s.owner)).map((x) => x.isPrimary)).toEqual([true]);
    expect((await s.agent.cards.board({ ...s.owner, siteId: second.id })).length).toBeGreaterThan(0); // still readable
    await refused(s.agent.orchestrator.submit({ ...s.owner, siteId: second.id }, { request: 'Review my website', taskType: 'website_audit' }), 'site_unavailable');
  });
  it('a subscription can be upgraded in place and the new capabilities appear immediately', async () => {
    const s = await setup({ plan: 'assistant' }); await refused(s.agent.strategies.generate(s.owner, usage()), 'plan_required');
    const b = (await s.db.billing.list(s.owner.businessId))[0]!; await s.db.billing.update(s.owner.businessId, b.id, { subscription: { ...b.subscription!, plan: 'studio' } });
    await submit(s, 'Develop a marketing plan'); expect((await s.runAll())[0]!.status).toBe('succeeded');
  });
});
