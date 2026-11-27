import { afterEach, describe, expect, it } from 'vitest';
import { createBusiness } from '../src/agent/profile/bootstrap';
import { setClock } from '../src/agent/core/util';
import { queueScheduledReviews } from '../src/server/scheduled';
import { setup, SITE } from './helpers/fixtures';

afterEach(() => setClock(null));
const orig = structuredClone(SITE);
afterEach(() => { for (const k of Object.keys(SITE)) delete SITE[k]; Object.assign(SITE, structuredClone(orig)); });
const usage = () => ({ current: { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 } });

async function suite() {
  const s = await setup({ plan: 'suite' });
  const second = await s.agent.sites.add(s.owner, { name: 'Rival Branch', url: 'rivalplumbing.example' }); const ctx2 = { ...s.owner, siteId: second.id };
  return { ...s, second, ctx2 };
}

describe('multiple websites: each site is its own workspace on one shared account', () => {
  it('findings, drafts, scans, profile facts and runs are kept per website and never leak between them', async () => {
    const { agent, owner, ctx2, runAll, db } = await suite();
    await agent.orchestrator.submit(owner, { request: 'Review my website', taskType: 'website_audit' }); await agent.orchestrator.submit(ctx2, { request: 'Review my website', taskType: 'website_audit' });
    for (const r of await runAll()) expect(r.status).toBe('succeeded');
    const a = await agent.cards.board(owner), b = await agent.cards.board(ctx2); expect(a.length).toBeGreaterThan(0); expect(b.length).toBeGreaterThan(0);
    expect(a.every((c) => (c.siteId ?? c.businessId) === owner.businessId)).toBe(true); expect(b.every((c) => c.siteId === ctx2.siteId)).toBe(true);
    expect(new Set(a.map((c) => c.id)).size + new Set(b.map((c) => c.id)).size).toBe(a.length + b.length);
    expect((await agent.cards.boardAllSites(owner)).length).toBe(a.length + b.length);
    expect((await agent.deliverables.list(owner)).every((d) => (d.siteId ?? d.businessId) === owner.businessId)).toBe(true); expect((await agent.deliverables.list(ctx2)).every((d) => d.siteId === ctx2.siteId)).toBe(true);
    // each site was scanned from its own URL
    const scans = await db.scans.list(owner.businessId, { label: 'own_site' }); expect(scans.map((x) => new URL(x.scan.finalUrl!).hostname).sort()).toEqual(['rivalplumbing.example', 'summitplumbing.example']);
    // site facts live in the site profile; the primary profile is untouched by the second site
    const shared = await agent.profiles.getInternal(owner.businessId); const eff2 = await agent.profiles.effective(ctx2);
    expect(JSON.stringify(shared.fields.products_services?.value)).toMatch(/Water heater repair/); expect(JSON.stringify(shared.fields.products_services?.value)).not.toMatch(/Flat-rate/);
    expect(JSON.stringify(eff2.fields.products_services?.value)).toMatch(/Flat-rate drain cleaning/);
    // runs are scoped too
    expect((await agent.orchestrator.list(owner)).every((w) => (w.siteId ?? w.businessId) === owner.businessId)).toBe(true);
  });
  it('shared brand applies to every site, and a site can override it without changing the others', async () => {
    const { agent, owner, ctx2, second } = await suite();
    await agent.brand.setBrand(owner, 'shared', [{ key: 'avoid_terms', value: ['cheap'] }, { key: 'tone', value: 'Plain and friendly' }]);
    expect((await agent.profiles.effective(ctx2)).fields.tone!.value).toBe('Plain and friendly');
    await agent.brand.setBrand(owner, second.id, [{ key: 'tone', value: 'Direct' }]);
    expect((await agent.profiles.effective(ctx2)).fields.tone!.value).toBe('Direct'); expect((await agent.profiles.effective(owner)).fields.tone!.value).toBe('Plain and friendly');
    await expect(agent.brand.setBrand(owner, 'shared', [{ key: 'pricing', value: 'x' }])).rejects.toThrow(/not a brand field/);
  });
  it('drafts follow each site’s brand: a word that site avoids is never written into its drafts, while other sites are unaffected', async () => {
    const { agent, owner, ctx2, second, runAll } = await suite(); await agent.brand.setBrand(owner, second.id, [{ key: 'avoid_terms', value: ['drain'] }]);
    await agent.orchestrator.submit(ctx2, { request: 'Write an email about our services' }); await agent.orchestrator.submit(owner, { request: 'Write an email about our services' });
    const [forSite2, forPrimary] = await runAll();
    expect(forSite2!.status).toBe('failed'); expect(forSite2!.error!.code).toBe('invalid_model_output'); expect(forSite2!.error!.message).toMatch(/avoided|avoid/i); // refused rather than stored
    expect(await agent.deliverables.list(ctx2)).toHaveLength(0);
    expect(forPrimary!.status).toBe('succeeded'); expect((await agent.deliverables.list(owner)).length).toBe(1);
  });
  it('a forged or foreign site id is rejected everywhere', async () => {
    const { agent, db, owner } = await suite(); const other = await createBusiness(db, agent.audit, 'user-other', { name: 'Other Co', website: 'rivalplumbing.example' });
    await expect(agent.orchestrator.submit({ ...owner, siteId: other.businessId }, { request: 'Review my website', taskType: 'website_audit' })).rejects.toMatchObject({ code: 'site_unavailable' });
    expect(await agent.cards.board({ ...owner, siteId: other.businessId })).toEqual([]);
    await expect(agent.sites.get(owner, other.businessId)).rejects.toMatchObject({ status: 404 });
    await expect(agent.sites.add({ userId: 'user-other', businessId: owner.businessId }, { name: 'x', url: 'x.example' })).rejects.toMatchObject({ status: 403 });
  });
  it('only people with the right role can add sites or locations', async () => {
    const { agent, owner, addMember } = await suite(); await addMember('v', 'viewer'); const v = { userId: 'v', businessId: owner.businessId };
    await expect(agent.sites.add(v, { name: 'x', url: 'x.example' })).rejects.toMatchObject({ status: 403 }); await expect(agent.sites.addLocation(v, owner.businessId, { name: 'L' })).rejects.toMatchObject({ status: 403 });
    await expect(agent.sites.remove(v, owner.businessId)).rejects.toMatchObject({ status: 403 }); await expect(agent.sites.remove(owner, owner.businessId)).rejects.toMatchObject({ code: 'primary_site' });
  });
});

describe('brand consistency across websites and locations', () => {
  it('finds avoided words, missing contact numbers, unmentioned locations and diverging voice, each with evidence', async () => {
    const { agent, owner, ctx2, second, runAll } = await suite();
    await agent.brand.setBrand(owner, 'shared', [{ key: 'avoid_terms', value: ['Flat-rate'] }, { key: 'key_messages', value: ['Fast, friendly, fair'] }]);
    const prim = (await agent.sites.list(owner))[0]!; await agent.sites.addLocation(owner, prim.id, { name: 'Salt Lake Shop', city: 'Salt Lake City', zip: '84101', phone: '(801) 555-0142' });
    await agent.sites.addLocation(owner, second.id, { name: 'Ogden Branch', city: 'Ogden', zip: '84401', phone: '(801) 555-7777' });
    await agent.orchestrator.submit(owner, { request: 'Review my website', taskType: 'website_audit' }); await agent.orchestrator.submit(ctx2, { request: 'Review my website', taskType: 'website_audit' }); await runAll();
    const rep = await agent.brand.report(owner); const titles = rep.sites.flatMap((s) => s.findings.map((f) => f.title));
    expect(titles.some((t) => /Rival Branch: Uses a word the brand avoids \("Flat-rate"\)/.test(t))).toBe(true);
    const avoid = rep.sites.find((s) => s.name === 'Rival Branch')!.findings.find((f) => /avoids/.test(f.title))!; expect(avoid.evidence[0]!.kind).toBe('quote'); expect(avoid.evidence[0]!.text.toLowerCase()).toContain('flat-rate'); expect(avoid.evidenceClass).toBe('verified');
    expect(titles.some((t) => /Ogden Branch.*not found on the site/.test(t))).toBe(true); expect(titles.some((t) => /Ogden Branch is not mentioned/.test(t))).toBe(true);
    expect(titles.some((t) => /Salt Lake Shop/.test(t) && /Phone/.test(t))).toBe(false); // that number IS on the site (tel: link / text) → no false alarm
    expect(titles.some((t) => /None of the shared key messages/.test(t))).toBe(true);
    // turns into cards on the right sites, once
    const n = await agent.brand.createCards(owner); expect(n).toBeGreaterThan(0); expect(await agent.brand.createCards(owner)).toBe(0);
    expect((await agent.cards.board(ctx2)).some((c) => /Flat-rate/.test(c.card.title))).toBe(true); expect((await agent.cards.board(owner)).some((c) => /Flat-rate/.test(c.card.title))).toBe(false);
    expect((await agent.cards.board(ctx2)).find((c) => /Flat-rate/.test(c.card.title))!.card.category).toBe('marketing_consistency');
  });
  it('says plainly which sites it could not check', async () => {
    const { agent, owner } = await suite(); const rep = await agent.brand.report(owner); expect(rep.limitations.join(' ')).toMatch(/has not been reviewed yet/); expect(rep.sites.every((s) => !s.scanned)).toBe(true);
  });
});

describe('progress tracking (Marketing Assistant and up)', () => {
  const FIX = () => { for (const u of ['https://summitplumbing.example/', 'https://summitplumbing.example/about']) { const p = SITE[u]!; p.body = p.body.replace('<head>', '<head><meta name="description" content="Plumbing in Salt Lake City, UT.">'); if (!/<title>/.test(p.body)) p.body = p.body; } };
  it('a later review marks issues that are no longer detected as resolved, and reopens them if they come back', async () => {
    const { agent, owner, runAll } = await setup({ plan: 'assistant' });
    await agent.orchestrator.submit(owner, { request: 'Review my website', params: { noDrafts: true } }); await runAll();
    const before = (await agent.cards.board(owner)).find((c) => /no meta description/.test(c.card.title))!; expect(before.card.status).toBe('new');
    FIX(); await agent.orchestrator.submit(owner, { request: 'Review my website', params: { rescan: true, noDrafts: true } }); const [r2] = await runAll(); expect(r2!.status).toBe('succeeded'); expect(r2!.state.resolvedCount).toBeGreaterThan(0);
    const after = await agent.cards.get(owner, before.id); expect(after.card.status).toBe('resolved'); expect(after.decisions.at(-1)!.note).toMatch(/no longer detected/i);
    const p = await agent.progress.summary(owner); expect(p.resolved).toBeGreaterThan(0); expect(p.reviews).toHaveLength(2); expect(p.reviews[0]!.resolved).toBeGreaterThan(0); expect(p.percentDone).toBeGreaterThan(0); expect(p.resolvedItems.some((x) => x.id === before.id)).toBe(true);
    // the problem returns → the same card reopens (no duplicate)
    for (const u of ['https://summitplumbing.example/', 'https://summitplumbing.example/about']) SITE[u]!.body = SITE[u]!.body.replace(/<meta name="description"[^>]*>/, '');
    const n = (await agent.cards.board(owner)).length; await agent.orchestrator.submit(owner, { request: 'Review my website', params: { rescan: true, noDrafts: true, notes: 'again' } }); await runAll();
    expect((await agent.cards.get(owner, before.id)).card.status).toBe('new'); expect((await agent.cards.board(owner)).length).toBe(n);
  });
  it('never auto-resolves work the customer approved on a model/performance basis, and ignores partial scans', async () => {
    const { agent, owner, runAll } = await setup({ plan: 'assistant' }); await agent.orchestrator.submit(owner, { request: 'Review my website', params: { noDrafts: true } }); await runAll();
    const modelCards = (await agent.cards.board(owner)).filter((c) => c.card.origin === 'model'); SITE['https://summitplumbing.example/services']!.status = 500; // a page now fails → scan has failures → no reconcile
    await agent.orchestrator.submit(owner, { request: 'Review my website', params: { rescan: true, noDrafts: true } }); const [r] = await runAll(); expect(r!.state.resolvedCount).toBeUndefined();
    for (const c of modelCards) expect((await agent.cards.get(owner, c.id)).card.status).not.toBe('resolved');
  });
});

describe('regular website reviews', () => {
  it('queues a fresh review (no drafts) for active subscribers when the last one is old, and not otherwise', async () => {
    const { agent, db, ent, owner, runAll } = await setup({ plan: 'assistant' });
    await db.businesses.update(owner.businessId, owner.businessId, {}); // ensure business exists
    expect(await queueScheduledReviews(db, agent, ent)).toMatchObject({ queued: 1 }); const [r] = await runAll(); expect(r!.status).toBe('succeeded'); expect(r!.request).toBe('Scheduled website review'); expect(await db.deliverables.list(owner.businessId)).toHaveLength(0);
    expect(await queueScheduledReviews(db, agent, ent)).toMatchObject({ queued: 0 }); // too soon
    setClock(() => new Date(Date.now() + 8 * 86400000)); expect(await queueScheduledReviews(db, agent, ent)).toMatchObject({ queued: 1 });
  });
  it('does nothing for Marketing Report buyers, free users or canceled subscriptions', async () => {
    for (const plan of ['report', 'free'] as const) { const t = await setup({ plan }); expect(await queueScheduledReviews(t.db, t.agent, t.ent)).toMatchObject({ queued: 0 }); }
    const t = await setup({ plan: 'assistant' }); const b = (await t.db.billing.list(t.owner.businessId))[0]!; await t.db.billing.update(t.owner.businessId, b.id, { subscription: { ...b.subscription!, status: 'canceled' } });
    expect(await queueScheduledReviews(t.db, t.agent, t.ent)).toMatchObject({ queued: 0 });
  });
  it('a Marketing Suite subscriber gets every website reviewed', async () => {
    const { agent, db, ent, runAll, owner } = await suite(); void owner; expect(await queueScheduledReviews(db, agent, ent)).toMatchObject({ queued: 2 }); for (const r of await runAll()) expect(r.status).toBe('succeeded');
  });
});
void usage;
