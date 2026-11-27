import { newId, nowIso, uniq } from '../core/util';
import type { CompetitorComparison } from './contracts';
import { CompetitorComparisonSchema, MarketResearchSchema } from './contracts';
import type { StructuredClient } from '../providers/structured';
import type { Usage } from '../providers/usage';
import type { WebsiteScan } from '../domain/models';
import { pagesForPrompt } from './business-intelligence';
import { scanWebsite, type CrawlOptions } from '../website/crawler';

/** Pluggable external research source (web search, Semrush API, ...). Connecting one is an operations-stage step. */
export interface ResearchSource {
  readonly name: string;
  search(query: string): Promise<{ id: string; title: string; url?: string; snippet: string; retrievedAt: string }[]>;
}
export class NullResearchSource implements ResearchSource {
  readonly name = 'none';
  async search() { return []; }
}

export interface CompetitorInput { url: string; name?: string; type?: 'direct' | 'indirect' }

/**
 * Competitor research only ever covers competitors the customer supplied (or that a research source returned).
 * It never invents competitors or claims private data (spec §4.2).
 */
export async function researchCompetitors(
  client: StructuredClient,
  input: { business: Record<string, unknown>; ownScan?: WebsiteScan; competitors: CompetitorInput[]; crawl?: CrawlOptions },
  usage: { current: Usage },
): Promise<{ comparison: CompetitorComparison; scans: { subject: string; scan: WebsiteScan }[]; skipped: { url: string; reason: string }[]; mock: boolean; model: string }> {
  const scans: { subject: string; scan: WebsiteScan }[] = []; const skipped: { url: string; reason: string }[] = [];
  for (const c of input.competitors.slice(0, 5)) {
    const scan = await scanWebsite(c.url, { ...input.crawl, maxPages: 4 });
    if (!scan.pages.length) skipped.push({ url: c.url, reason: scan.failures[0]?.message ?? 'No pages retrieved' }); else scans.push({ subject: c.url, scan });
  }
  if (!scans.length) {
    return { comparison: { competitors: [], differences: [], opportunities: [] }, scans, skipped, mock: false, model: 'none' };
  }
  const res = await client.generate({
    task: 'competitor_comparison', usage, schema: CompetitorComparisonSchema,
    instructions: 'Compare the business with each competitor using ONLY the retrieved competitor pages. Pricing mentions, offers and CTAs must be quoted from the pages. Differences are "verified" only if both sides are evidenced; otherwise "inferred". Do not claim traffic, rankings or private data.',
    input: { business: input.business, ownSite: input.ownScan ? pagesForPrompt(input.ownScan, 1500) : [], competitors: scans.map((s) => ({ url: s.subject, pages: pagesForPrompt(s.scan, 1800) })) },
    untrusted: scans.flatMap((s) => s.scan.pages.filter((p) => p.ok).map((p) => ({ id: p.finalUrl, source: p.finalUrl, text: p.text.slice(0, 4000) }))),
    validate: (v) => {
      const known = new Set(scans.map((s) => s.subject.replace(/\/$/, '')));
      const bad = v.competitors.find((c) => !scans.some((s) => c.url.replace(/\/$/, '').includes(new URL(s.scan.finalUrl ?? s.subject).hostname.replace(/^www\./, '')) || known.has(c.url.replace(/\/$/, ''))));
      return bad ? `Competitor "${bad.url}" was not among the supplied/retrieved competitors. Do not invent competitors.` : null;
    },
  });
  return { comparison: res.data, scans, skipped, mock: res.mock, model: res.model };
}

export async function marketResearch(
  client: StructuredClient,
  input: { business: Record<string, unknown>; library: { id: string; kind: string; title: string; data: unknown; evidence: string; collectedAt: string }[]; source: ResearchSource; notes?: string },
  usage: { current: Usage },
) {
  const queries = uniq([`${input.business.industry ?? ''} marketing trends`, `${input.business.industry ?? ''} customer demand ${input.business.service_areas ?? ''}`].map((s) => s.trim()).filter((s) => s.length > 15));
  const failures: string[] = [];
  const hits = (await Promise.all(queries.map((q) => input.source.search(q).catch((e: Error) => { failures.push(e.message); return []; })))).flat();
  const res = await client.generate({
    task: 'market_research', usage, schema: MarketResearchSchema,
    instructions: 'Summarise market and demand findings strictly from the supplied sources, library entries and customer notes. Each finding cites sourceIds. With no external sources, return findings only as "inferred"/"unknown" hypotheses (never "verified"), and list researchQuestions to answer.',
    input: { business: input.business, library: input.library.slice(0, 20), sources: hits, notes: input.notes ?? '', externalSource: input.source.name },
    untrusted: hits.map((h) => ({ id: h.id, source: h.url ?? h.title, text: h.snippet })),
    validate: (v) => {
      const ids = new Set([...hits.map((h) => h.id), ...input.library.map((l) => l.id), 'customer_notes']);
      const bad = v.findings.find((f) => f.evidenceClass === 'verified' && (!f.sourceIds.length || f.sourceIds.some((s) => !ids.has(s))));
      return bad ? `Finding "${bad.claim}" is marked verified but cites no valid source id. Valid ids: ${[...ids].join(', ')}` : null;
    },
  });
  return { ...res.data, collectedAt: nowIso(), id: newId(), mock: res.mock, model: res.model, externalSource: input.source.name, sourcesUsed: hits.length, sourceErrors: [...new Set(failures)] };
}
