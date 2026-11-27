import { ValidationError } from './core/errors';
import { nowIso } from './core/util';
import type { Finding, PreviewResult, ProfileRow } from './domain/models';
import { modelFindings, ruleFindings, scoreFinding } from './capabilities/analysis';
import { understandBusiness } from './capabilities/business-intelligence';
import type { StructuredClient } from './providers/structured';
import { zeroUsage } from './providers/usage';
import { scanWebsite, type CrawlOptions } from './website/crawler';

const tmpProfile = (fields: Record<string, string | string[]>): ProfileRow => ({
  id: 'preview', businessId: 'preview', version: 1, createdAt: nowIso(), updatedAt: nowIso(),
  fields: Object.fromEntries(Object.entries(fields).map(([k, value]) => [k, { value, provenance: { source: 'ai_inference' as const, evidence: 'inferred' as const, recordedAt: nowIso() }, confirmed: false, updatedAt: nowIso(), conflicts: [], previous: [] }])),
});

/**
 * The anonymous first result: read the real site (few pages), understand the business, surface the most important
 * evidence-backed observations. Uses the same scanners, grounding and rule engine as the full agent, but persists
 * nothing about a business (there is no tenant yet).
 */
export async function runPreviewAnalysis(deps: { llm: StructuredClient; crawl: CrawlOptions }, input: { url: string; zip: string }): Promise<PreviewResult> {
  const scan = await scanWebsite(input.url, { ...deps.crawl, maxPages: 4 });
  if (!scan.pages.length) throw new ValidationError(`We could not read that website (${scan.failures[0]?.message ?? 'no response'}). Check the address and try again.`, 'website_unreachable');
  const usage = { current: zeroUsage() };
  const u = await understandBusiness(deps.llm, { scan, supplied: { zip: input.zip }, existing: {} }, usage);
  const get = (k: string) => u.updates.find((x) => x.key === k)?.value;
  const services = ([get('products_services')].flat().filter(Boolean) as string[]).slice(0, 8);
  const areas = ([get('service_areas')].flat().filter(Boolean) as string[]);
  const profile = tmpProfile({ ...(services.length ? { products_services: services } : {}), ...(areas.length ? { service_areas: areas } : {}) });
  const rules = ruleFindings(scan, profile);
  const m = await modelFindings(deps.llm, { profile, scan, rules }, usage).catch(() => ({ findings: [] as Finding[], dropped: 0, mock: false }));
  const findings = [...rules, ...m.findings].map((f) => ({ f, s: scoreFinding(f).score })).sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.f);
  return {
    business: { name: get('name') as string | undefined, industry: get('industry') as string | undefined, services, areas, valueProposition: get('value_proposition') as string | undefined },
    findings, profileUpdates: u.updates.map((x) => ({ key: x.key, value: x.value, source: x.provenance.source, evidence: x.provenance.evidence, sourceRef: x.provenance.sourceRef })),
    scan, limitations: scan.limitations, mock: (await Promise.resolve(deps.llm.provider.isMock)), pagesRead: scan.pages.length,
  };
}
