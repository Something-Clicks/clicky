import { describe, expect, it } from 'vitest';
import { setup } from './helpers/fixtures';

describe('website audit workflow (Phases 1-3 end to end)', () => {
  it('understands the business from the real site, makes evidence-backed cards and prepares editable deliverables', async () => {
    const { agent, owner, runAll } = await setup();
    const exec = await agent.orchestrator.submit(owner, { request: 'Review my website and tell me what to fix' });
    expect(exec.taskType).toBe('website_audit');
    const [done] = await runAll();
    expect(done!.status).toBe('succeeded');
    expect(done!.mock).toBe(true);

    // Business Profile: facts came from the site with provenance; assumptions are labelled.
    const profile = await agent.profiles.get(owner);
    expect(profile.fields.products_services!.value).toEqual(expect.arrayContaining(['Water heater repair', 'Drain cleaning']));
    expect(profile.fields.products_services!.provenance.source).toBe('website');
    expect(profile.fields.service_areas!.value).toEqual(['Salt Lake City, UT']);
    expect(profile.fields.industry!.provenance.source).toBe('ai_inference'); // never presented as fact
    expect(profile.fields.name!.confirmed).toBe(true); // customer-confirmed name not overwritten

    // Action Cards: structured, evidence-backed, prioritised.
    const cards = await agent.cards.board(owner);
    expect(cards.length).toBeGreaterThan(3);
    const titles = cards.map((c) => c.card.title);
    expect(titles).toContain('Homepage calls to action are generic');
    expect(titles.some((t) => /meta description/i.test(t))).toBe(true);
    expect(titles).toContain('Homepage headline does not name the main service');
    for (const c of cards) { expect(c.card.evidence.length).toBeGreaterThan(0); expect(c.card.recommendation).toBeTruthy(); expect(['verified', 'inferred', 'estimated', 'unknown']).toContain(c.card.evidenceClass); }
    const ranks = cards.map((c) => c.card.priority.rank); expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // quote evidence is exact text from the scan
    const headline = cards.find((c) => c.card.title.startsWith('Homepage headline'))!;
    expect(headline.card.evidence[0]).toMatchObject({ kind: 'quote', text: 'Welcome' });
    // honest about what was not tested
    expect(done!.limitations.join(' ')).toMatch(/NOT tested/);
    expect(done!.limitations.join(' ')).toMatch(/keyword data was supplied/i);

    // Phase 3: real deliverables were prepared for the top cards and are editable with version history.
    const dids = done!.state.deliverableIds as string[];
    expect(dids.length).toBeGreaterThan(0);
    const d = await agent.deliverables.get(owner, dids[0]!);
    expect(d.versions[0]!.blocks.length).toBeGreaterThan(1);
    const edited = await agent.deliverables.edit(owner, d.id, { blocks: d.versions[0]!.blocks.map((b) => (b.key === 'cta' ? { ...b, text: 'Call Summit Plumbing today' } : b)), note: 'owner tweak' });
    expect(edited.versions).toHaveLength(2); expect(edited.versions[1]!.author).toBe('user-owner');
  });

  it('does not duplicate cards or runs when the same request is repeated', async () => {
    const { agent, owner, runAll, queue } = await setup();
    const a = await agent.orchestrator.submit(owner, { request: 'Review my website' });
    const b = await agent.orchestrator.submit(owner, { request: 'Review my website' });
    expect(b.id).toBe(a.id); expect(queue.jobs).toHaveLength(1);
    await runAll();
    const n = (await agent.cards.board(owner)).length;
    const c = await agent.orchestrator.submit(owner, { request: 'Review my website', params: { rescan: true } });
    await runAll(); expect(c.id).not.toBe(a.id);
    expect((await agent.cards.board(owner)).length).toBe(n);
  });
});
