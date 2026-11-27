/**
 * Evaluation harness (specification §17): runs fixed marketing tasks against a controlled test business and reports the metrics
 * to compare when changing model providers, prompts or workflows.
 *
 *   npm run eval                         # uses the deterministic MOCK (a plumbing check, NOT a quality measurement)
 *   LLM_BASE_URL=... LLM_MODEL=... LLM_API_KEY=... npm run eval   # measures a real model on the same tasks
 *
 * The test business is the fixture site in src/server/dev-fixtures.ts. Real-website validation is a separate, manual step.
 */
import { createAgent } from '../src/agent/orchestrator/agent';
import { ManualQueue } from '../src/agent/orchestrator/orchestrator';
import { createBusiness } from '../src/agent/profile/bootstrap';
import { providerFromEnv } from '../src/agent/providers/openai-compatible';
import { MockProvider } from '../src/agent/providers/mock';
import { createInMemoryDb } from '../src/agent/store/db';
import { normalizeText } from '../src/agent/core/util';
import { fakeFetch, publicResolver } from '../src/server/dev-fixtures';

const real = providerFromEnv(); const provider = real ?? new MockProvider();
const db = createInMemoryDb(); const queue = new ManualQueue();
const agent = createAgent({ db, provider, queue, backoffMs: 500, crawl: { fetchImpl: fakeFetch, resolve: publicResolver } });
const owner = await createBusiness(db, agent.audit, 'eval-user', { name: 'Summit Plumbing', website: 'https://summitplumbing.example' });

const TASKS: { name: string; request: string; params?: object }[] = [
  { name: 'website review', request: 'Review my website and tell me what to fix' },
  { name: 'homepage headline', request: 'Improve my homepage headline' },
  { name: 'competitor research', request: 'Research my competitors', params: { competitorUrls: ['https://rivalplumbing.example'] } },
  { name: 'marketing plan', request: 'Develop a marketing plan' },
  { name: 'campaign', request: 'Prepare a promotional campaign', params: { goal: 'More drain cleaning enquiries' } },
  { name: 'blog article', request: 'Write a blog article about water heater maintenance' },
];
const rows: Record<string, string | number>[] = [];
for (const t of TASKS) {
  const t0 = Date.now(); let status = 'error', cost = 0, calls = 0;
  try { const e = await agent.orchestrator.submit(owner, { request: t.request, params: t.params as never }); const j = queue.jobs.shift(); if (j) { const r = await agent.orchestrator.run(j.businessId, j.executionId); status = r.status; cost = r.usage.costUsd; calls = r.usage.calls; } else status = e.status; }
  catch (err) { status = `refused: ${(err as Error).message.slice(0, 40)}`; }
  rows.push({ task: t.name, status, 'model calls': calls, 'cost $': Number(cost.toFixed(4)), 'seconds': Number(((Date.now() - t0) / 1000).toFixed(1)) });
}
const cards = await agent.cards.board(owner); const scan = (await db.scans.list(owner.businessId, { label: 'own_site' }))[0]!.scan; const corpus = normalizeText(scan.pages.map((p) => p.text + ' ' + (p.title ?? '') + ' ' + p.h1.join(' ')).join(' '));
const quotes = cards.flatMap((c) => c.card.evidence.filter((e) => e.kind === 'quote')); const grounded = quotes.filter((q) => corpus.includes(normalizeText(q.text)));
const ds = await agent.deliverables.list(owner); const flagged = ds.flatMap((d) => agent.deliverables.current(d).flags);
console.log(`\nProvider: ${provider.name}${provider.isMock ? '  (MOCK: this checks the plumbing, not model quality)' : ''}\n`); console.table(rows);
console.table([{
  'action cards': cards.length, 'cards with evidence %': Math.round((cards.filter((c) => c.card.evidence.length).length / Math.max(1, cards.length)) * 100),
  'quotes grounded in site %': Math.round((grounded.length / Math.max(1, quotes.length)) * 100), 'drafts': ds.length, 'unsupported-claim flags left in drafts': flagged.length,
  'verified cards': cards.filter((c) => c.card.evidenceClass === 'verified').length, 'inferred cards': cards.filter((c) => c.card.evidenceClass === 'inferred').length,
}]);
console.log('Not measured here (needs human review): recommendation usefulness, brand-voice match, customer approval/rejection patterns.');
