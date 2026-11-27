import { hashContent, normalizeText } from '../core/util';
import type { AnalysisCategory, DeliverableType, EvidenceClass, Level } from '../domain/enums';
import type { EvidenceItem, Finding, PageRecord, WebsiteScan } from '../domain/models';
import type { StructuredClient } from '../providers/structured';
import type { Usage } from '../providers/usage';
import { ProfileService } from '../profile/service';
import type { ProfileRow } from '../domain/models';
import { MarketingAnalysisSchema, type CompetitorComparison } from './contracts';
import { pageCorpus, pagesForPrompt } from './business-intelligence';
import type { ContentGap, LocalSeoResult } from './seo-intelligence';

type Partialize = Omit<Finding, 'origin' | 'dependsOn' | 'missingInfo'> & { dependsOn?: string[]; missingInfo?: string[] };
const F = (f: Partialize, ruleId: string): Finding => ({ origin: 'rule', ruleId, dependsOn: [], missingInfo: [], ...f });
const q = (source: string, text: string): EvidenceItem => ({ kind: 'quote', source, text });
const obs = (source: string, text: string): EvidenceItem => ({ kind: 'observation', source, text });
const missing = (source: string, text: string): EvidenceItem => ({ kind: 'missing', source, text });

const ownPages = (scan: WebsiteScan) => scan.pages.filter((p) => p.ok);
const listUrls = (ps: PageRecord[], n = 5) => ps.slice(0, n).map((p) => p.finalUrl);

/** Deterministic checks. Only claims about what the retrieved HTML actually shows; limitations stated, never extrapolated. */
export function ruleFindings(scan: WebsiteScan, profile?: ProfileRow): Finding[] {
  const out: Finding[] = [];
  const pages = ownPages(scan);
  if (!pages.length) return out;
  const home = pages[0]!;
  const jsRisk = home.possiblyJsRendered;
  const hostName = profile ? ProfileService.text(profile, 'name') : undefined;
  const services = ProfileService.list(profile ?? ({ fields: {} } as ProfileRow), 'products_services');
  const areas = ProfileService.list(profile ?? ({ fields: {} } as ProfileRow), 'service_areas').filter((a) => !/^ZIP \d+/.test(a));

  if (jsRisk) out.push(F({
    key: 'js_rendered', category: 'website_effectiveness', title: 'Homepage content may be loaded with JavaScript',
    observed: `The homepage HTML contains only ${home.wordCount} words of readable text but ${home.scriptCount} scripts.`, where: [home.finalUrl],
    evidence: [obs(home.finalUrl, `${home.wordCount} words in initial HTML; ${home.scriptCount} script tags.`)],
    whyItMatters: 'Search engines and AI tools may see less of the page than visitors do, and this analysis can only judge what was in the initial HTML.',
    affected: 'Search visibility and this analysis', consequence: 'Findings about missing content on this site may be false negatives.', confidence: 'medium', impact: 'medium', evidenceClass: 'inferred',
    missingInfo: ['A rendered-page test (not performed) would confirm what visitors and crawlers see.'],
    recommendation: 'Confirm key headings, copy and links are present in server-rendered HTML.', effort: 'unknown',
  }, 'js_rendered'));

  const noCta = !home.ctas.length && !home.formCount;
  if (noCta) out.push(F({
    key: 'home_no_cta', category: 'conversion', title: 'Homepage has no clear call to action',
    observed: 'No button, form or action link (e.g. "Get a quote", "Book", "Contact") was found in the homepage HTML.', where: [home.finalUrl],
    evidence: [missing(home.finalUrl, `0 call-to-action elements and 0 forms detected among ${home.links.length} links.`)],
    whyItMatters: 'Visitors who are interested need an obvious next step.', affected: 'Prospective customers on the homepage', consequence: 'Interested visitors may leave without contacting the business.',
    confidence: jsRisk ? 'low' : 'high', impact: 'high', evidenceClass: jsRisk ? 'inferred' : 'verified', missingInfo: jsRisk ? ['Page may render CTAs with JavaScript.'] : [],
    recommendation: 'Add a primary call to action above the fold that names the next step.', effort: 'low', deliverableType: 'headline_set',
  }, 'home_no_cta'));
  else if (home.ctas.length && home.ctas.every((c) => /^(learn more|read more|click here)$/i.test(c))) out.push(F({
    key: 'home_weak_cta', category: 'conversion', title: 'Homepage calls to action are generic',
    observed: `The only calls to action found are: ${home.ctas.map((c) => `"${c}"`).join(', ')}.`, where: [home.finalUrl], evidence: home.ctas.slice(0, 3).map((c) => q(home.finalUrl, c)),
    whyItMatters: 'Generic labels do not say what happens next.', affected: 'Prospective customers', consequence: 'Lower likelihood of an enquiry.', confidence: 'medium', impact: 'medium', evidenceClass: 'verified',
    recommendation: 'Replace generic labels with action-specific ones tied to the main service.', effort: 'low', deliverableType: 'headline_set',
  }, 'home_weak_cta'));

  const noContact = !pages.some((p) => p.phones.length || p.emails.length || p.type === 'contact' || /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/.test(p.text));
  if (noContact) out.push(F({
    key: 'no_contact', category: 'conversion', title: 'No contact details or contact page found',
    observed: 'No phone number, email address or contact page was found on the scanned pages.', where: listUrls(pages),
    evidence: [missing(home.finalUrl, `Checked ${pages.length} page(s) for tel:/mailto: links, phone patterns and a contact page.`)],
    whyItMatters: 'Customers who want to reach the business directly cannot.', affected: 'Prospective customers', consequence: 'Lost enquiries, especially from mobile visitors.',
    confidence: pages.length >= 3 ? 'high' : 'medium', impact: 'high', evidenceClass: 'verified', missingInfo: pages.length < 3 ? ['Only a few pages were scanned; a contact page may exist elsewhere.'] : [],
    recommendation: 'Show phone/email and a contact route in the header and footer and add a contact page.', effort: 'low', deliverableType: 'page_copy',
  }, 'no_contact'));

  const noTitle = pages.filter((p) => !p.title);
  if (noTitle.length) out.push(F({
    key: 'missing_titles', category: 'seo_structure', title: 'Some pages have no title tag',
    observed: `Pages without a <title>: ${listUrls(noTitle).join(', ')}.`, where: listUrls(noTitle), evidence: noTitle.slice(0, 3).map((p) => missing(p.finalUrl, 'No <title> element found.')),
    whyItMatters: 'Titles are a primary signal for search results and browser tabs.', affected: 'Search visibility', consequence: 'Search engines will generate a title that may not reflect the page.',
    confidence: 'high', impact: 'high', evidenceClass: 'verified', recommendation: 'Write a unique, descriptive title for each page.', effort: 'low', deliverableType: 'seo_meta',
  }, 'missing_titles'));
  const longTitle = pages.filter((p) => p.title && p.title.length > 65);
  if (longTitle.length) out.push(F({
    key: 'long_titles', category: 'seo_structure', title: 'Some page titles are likely truncated in search results',
    observed: `Titles over 65 characters: ${longTitle.map((p) => `"${p.title}" (${p.title!.length})`).join('; ')}.`, where: listUrls(longTitle),
    evidence: longTitle.slice(0, 3).map((p) => q(p.finalUrl, p.title!)), whyItMatters: 'Long titles are cut off, hiding the key message.', affected: 'Search result click-through', consequence: 'Truncated listings may be less compelling.',
    confidence: 'medium', impact: 'low', evidenceClass: 'verified', recommendation: 'Shorten titles to about 60 characters, leading with the main service.', effort: 'low', deliverableType: 'seo_meta',
  }, 'long_titles'));
  const noMeta = pages.filter((p) => !p.metaDescription);
  if (noMeta.length) out.push(F({
    key: 'missing_meta', category: 'seo_structure', title: 'Some pages have no meta description',
    observed: `Pages without a meta description: ${listUrls(noMeta).join(', ')}.`, where: listUrls(noMeta), evidence: noMeta.slice(0, 3).map((p) => missing(p.finalUrl, 'No meta description found.')),
    whyItMatters: 'The description is the text most often shown under a result.', affected: 'Search result click-through', consequence: 'Search engines will pick arbitrary page text.',
    confidence: 'high', impact: 'medium', evidenceClass: 'verified', recommendation: 'Write a 120-160 character description with a reason to click.', effort: 'low', deliverableType: 'seo_meta',
  }, 'missing_meta'));
  const titles = pages.filter((p) => p.title).map((p) => normalizeText(p.title!));
  const dupTitle = titles.length !== new Set(titles).size;
  if (dupTitle) out.push(F({
    key: 'duplicate_titles', category: 'seo_structure', title: 'Multiple pages share the same title',
    observed: 'At least two scanned pages have identical titles.', where: listUrls(pages), evidence: pages.filter((p) => p.title).slice(0, 4).map((p) => q(p.finalUrl, p.title!)),
    whyItMatters: 'Identical titles make pages compete and are unclear in results.', affected: 'Search visibility', consequence: 'Weaker ranking signals per page.', confidence: 'high', impact: 'medium', evidenceClass: 'verified',
    recommendation: 'Give every page a unique title describing its specific topic.', effort: 'low', deliverableType: 'seo_meta',
  }, 'duplicate_titles'));

  const badH1 = pages.filter((p) => p.h1.length !== 1 && p.type !== 'other');
  if (badH1.length) out.push(F({
    key: 'h1_issues', category: 'seo_structure', title: 'Pages are missing a single main heading (H1)',
    observed: badH1.slice(0, 4).map((p) => `${p.finalUrl} has ${p.h1.length} H1 element(s)`).join('; ') + '.', where: listUrls(badH1),
    evidence: badH1.slice(0, 3).map((p) => obs(p.finalUrl, `${p.h1.length} H1 headings${p.h1.length ? `: ${p.h1.map((h) => `"${h}"`).join(', ')}` : ''}`)),
    whyItMatters: 'A single clear H1 tells visitors and search engines what the page is about.', affected: 'Visitors and search engines', consequence: 'Page topic is less clear.',
    confidence: jsRisk ? 'low' : 'medium', impact: 'medium', evidenceClass: jsRisk ? 'inferred' : 'verified', recommendation: 'Use exactly one H1 per page stating the page topic and benefit.', effort: 'low', deliverableType: 'page_copy',
  }, 'h1_issues'));

  if (home.wordCount > 0 && home.wordCount < 150 && !jsRisk) out.push(F({
    key: 'thin_home', category: 'messaging', title: 'Homepage says very little about the business',
    observed: `The homepage has about ${home.wordCount} words of body text.`, where: [home.finalUrl], evidence: [obs(home.finalUrl, `${home.wordCount} words: "${home.text.slice(0, 160)}"`)],
    whyItMatters: 'Visitors need enough information to understand the offer and trust the business.', affected: 'Prospective customers and search engines', consequence: 'Visitors may leave without understanding what is offered.',
    confidence: 'medium', impact: 'high', evidenceClass: 'verified', recommendation: 'Expand the homepage to explain the main services, who they are for, and why choose the business.', effort: 'medium', deliverableType: 'page_copy',
  }, 'thin_home'));

  if (!pages.some((p) => p.type === 'services' || p.type === 'products') && !home.navLinks.some((u) => /service|product|what-we/i.test(u))) out.push(F({
    key: 'no_service_pages', category: 'content_gaps', title: 'No dedicated service or product pages found',
    observed: `None of the ${pages.length} scanned pages is a service/product page and navigation does not link to one.`, where: listUrls(pages),
    evidence: [missing(home.finalUrl, `Scanned ${pages.length} page(s); none classified as services/products.`)],
    whyItMatters: 'Each core service needs its own page to be found in search and to convert.', affected: 'Customers searching for a specific service', consequence: 'Searches for individual services are unlikely to find the business.',
    confidence: scan.completeness === 'complete' ? 'medium' : 'low', impact: 'high', evidenceClass: 'inferred',
    missingInfo: ['Crawl was limited; a services page may exist beyond the scanned set.'], recommendation: services.length ? `Create a dedicated page for each core service, starting with "${services[0]}".` : 'Create a dedicated page for each core service.', effort: 'medium', deliverableType: 'service_page',
  }, 'no_service_pages'));

  const imgs = pages.reduce((a, p) => ({ t: a.t + p.images.total, m: a.m + p.images.missingAlt }), { t: 0, m: 0 });
  if (imgs.t >= 4 && imgs.m / imgs.t > 0.4) out.push(F({
    key: 'alt_text', category: 'seo_structure', title: 'Many images have no alternative text',
    observed: `${imgs.m} of ${imgs.t} images on scanned pages have no alt text.`, where: listUrls(pages), evidence: [{ kind: 'metric', source: home.finalUrl, text: `${imgs.m}/${imgs.t} images without alt` }],
    whyItMatters: 'Alt text supports accessibility and image search.', affected: 'Visitors using screen readers; image search', consequence: 'Reduced accessibility.', confidence: 'high', impact: 'low', evidenceClass: 'verified',
    recommendation: 'Add concise descriptive alt text to meaningful images.', effort: 'low',
  }, 'alt_text'));

  const noindex = pages.filter((p) => /noindex/i.test(p.robotsMeta ?? ''));
  if (noindex.length) out.push(F({
    key: 'noindex', category: 'search_visibility', title: 'Pages are blocked from search indexing',
    observed: `${noindex.length} scanned page(s) carry a noindex robots directive: ${listUrls(noindex).join(', ')}.`, where: listUrls(noindex), evidence: noindex.map((p) => q(p.finalUrl, `robots: ${p.robotsMeta}`)),
    whyItMatters: 'Pages with noindex will not appear in search results.', affected: 'Search visibility', consequence: 'Those pages cannot attract organic search traffic.', confidence: 'high', impact: 'high', evidenceClass: 'verified',
    missingInfo: ['Whether this is intentional (e.g. staging or thank-you pages).'], recommendation: 'Confirm noindex is intended; remove it from pages that should be found.', effort: 'low',
  }, 'noindex'));

  if (pages.some((p) => !p.viewport)) out.push(F({
    key: 'no_viewport', category: 'website_effectiveness', title: 'Some pages lack a mobile viewport declaration',
    observed: `Pages without a viewport meta tag: ${listUrls(pages.filter((p) => !p.viewport)).join(', ')}. (Mobile rendering itself was not tested.)`, where: listUrls(pages.filter((p) => !p.viewport)),
    evidence: [missing(home.finalUrl, 'No <meta name="viewport"> in HTML.')], whyItMatters: 'Without it mobile browsers may show a desktop-sized page.', affected: 'Mobile visitors', consequence: 'Possible poor mobile experience (untested).',
    confidence: 'medium', impact: 'medium', evidenceClass: 'inferred', missingInfo: ['No mobile rendering test was run.'], recommendation: 'Add a responsive viewport tag and test on a phone.', effort: 'low',
  }, 'no_viewport'));

  if (home.redirects.length > 1) out.push(F({
    key: 'redirect_chain', category: 'website_effectiveness', title: 'Homepage passes through multiple redirects',
    observed: `Reaching the homepage took ${home.redirects.length} redirects: ${home.redirects.map((r) => `${r.status} → ${r.to}`).join(', ')}.`, where: [home.url], evidence: home.redirects.map((r) => obs(r.from, `${r.status} redirect to ${r.to}`)),
    whyItMatters: 'Redirect chains slow loading and dilute link signals.', affected: 'All visitors', consequence: 'Slightly slower first load.', confidence: 'high', impact: 'low', evidenceClass: 'verified', recommendation: 'Redirect directly to the final URL in one step.', effort: 'low',
  }, 'redirect_chain'));

  if (hostName && home.title && !normalizeText(home.title).includes(normalizeText(hostName).split(' ')[0]!)) out.push(F({
    key: 'brand_not_in_title', category: 'marketing_consistency', title: 'Business name is missing from the homepage title',
    observed: `Homepage title is "${home.title}"; the business is "${hostName}".`, where: [home.finalUrl], evidence: [q(home.finalUrl, home.title)],
    whyItMatters: 'Name searches and brand recognition rely on consistent naming.', affected: 'Existing and referred customers', consequence: 'Weaker brand recall in search results.', confidence: 'medium', impact: 'low', evidenceClass: 'verified',
    recommendation: 'Include the business name in the homepage title.', effort: 'low', deliverableType: 'seo_meta',
  }, 'brand_not_in_title'));

  if (areas.length && !scan.pages.some((p) => p.jsonLdTypes.length)) out.push(F({
    key: 'no_structured_data', category: 'local_visibility', title: 'No business structured data found',
    observed: `The business serves ${areas.join(', ')} but no JSON-LD structured data was found on scanned pages.`, where: [home.finalUrl], evidence: [missing(home.finalUrl, '0 JSON-LD blocks across scanned pages.')],
    whyItMatters: 'Structured data helps search engines understand location and services.', affected: 'Local search visibility', consequence: 'Fewer rich local results.', confidence: 'medium', impact: 'medium', evidenceClass: 'verified',
    recommendation: 'Add LocalBusiness structured data with name, address, phone, hours and service areas.', effort: 'low',
  }, 'no_structured_data'));

  if (home.injectionSignals.length) out.push(F({
    key: 'injection_text', category: 'website_effectiveness', title: 'Homepage text contains instructions aimed at AI tools',
    observed: `Signals detected: ${home.injectionSignals.join(', ')}. The text was treated as data and ignored by the agent.`, where: [home.finalUrl], evidence: [obs(home.finalUrl, home.injectionSignals.join(', '))],
    whyItMatters: 'Such text can be a sign of a compromised page or unwanted hidden content.', affected: 'Site owner', consequence: 'Possible security or reputation issue.', confidence: 'low', impact: 'medium', evidenceClass: 'inferred',
    recommendation: 'Review the page source for unexpected hidden text.', effort: 'low',
  }, 'injection_text'));
  return out;
}

export function localSeoFindings(local: LocalSeoResult, scan: WebsiteScan): Finding[] {
  const src = scan.finalUrl ?? scan.startUrl; const out: Finding[] = [];
  for (const c of local.checks) {
    if (c.status !== 'fail' || c.id === 'structured_data') continue;
    const m: Record<string, { t: string; w: string; r: string; d?: DeliverableType }> = {
      phone_visible: { t: 'Phone number not visible on scanned pages', w: 'Local customers often call first.', r: 'Show a clickable phone number in the header and footer.' },
      address_visible: { t: 'Business address not found on scanned pages', w: 'A visible address supports local trust and local search.', r: 'Publish the full business address (or service area) in the footer and contact page.' },
      service_area_in_titles_headings: { t: 'Service areas are not reflected in page titles or headings', w: 'People search with place names.', r: 'Mention the main service area in titles and headings of service pages.', d: 'seo_meta' },
      location_pages: { t: 'No dedicated pages for the service areas', w: 'Dedicated location pages can target place-specific searches.', r: 'Create one useful page per priority service area.', d: 'local_landing_page' },
    };
    const x = m[c.id]; if (!x) continue;
    out.push(F({ key: `local_${c.id}`, category: 'local_visibility', title: x.t, observed: c.detail, where: [src], evidence: [obs(src, c.detail)], whyItMatters: x.w, affected: 'Local customers', consequence: 'Less local visibility and fewer local enquiries.',
      confidence: 'medium', impact: c.id === 'location_pages' ? 'medium' : 'medium', evidenceClass: 'verified', missingInfo: ['Google Business Profile and citations were not verified.'], recommendation: x.r, effort: 'medium', deliverableType: x.d }, `local_${c.id}`));
  }
  return out;
}

export function gapFindings(gaps: ContentGap[], source: string): Finding[] {
  return gaps.slice(0, 5).map((g) => F({
    key: `gap_${hashContent(g.keyword).slice(0, 8)}`, category: 'content_gaps', title: g.coverage === 'weak' ? `"${g.keyword}" is not in any page title or main heading` : `No page targets "${g.keyword}"`,
    observed: g.reason, where: [], evidence: [{ kind: 'metric', source, text: `"${g.keyword}"${g.volume !== undefined ? `, monthly volume ${g.volume} (supplied data)` : ''}${g.difficulty !== undefined ? `, difficulty ${g.difficulty}` : ''}, intent: ${g.intent}` }],
    whyItMatters: 'People are searching for this and no page on the site is built to answer it.', affected: 'Searchers with this intent', consequence: 'The site is unlikely to appear for this search.', confidence: 'medium', impact: (g.volume ?? 0) >= 200 ? 'high' : 'medium', evidenceClass: 'verified',
    missingInfo: ['Search data was supplied via import; current rankings for this term are unknown unless provided.'], recommendation: g.intent === 'informational' ? `Publish a helpful article answering "${g.keyword}".` : `Create or optimise a page targeting "${g.keyword}".`, effort: 'medium',
    deliverableType: g.intent === 'informational' ? 'blog_outline' : 'service_page',
  }, 'keyword_gap'));
}

export function competitorFindings(c: CompetitorComparison): Finding[] {
  return c.opportunities.slice(0, 3).map((o, i) => F({
    key: `comp_${hashContent(o.opportunity).slice(0, 8)}`, category: 'competitive_positioning', title: o.opportunity.slice(0, 120), observed: o.basis, where: c.competitors.map((x) => x.url),
    evidence: [obs(c.competitors[0]?.url ?? 'competitors', o.basis)], whyItMatters: 'A visible difference from competitors helps customers choose.', affected: 'Prospective customers comparing options', consequence: 'Without a clear difference the business competes on price or proximity.',
    confidence: o.evidenceClass === 'verified' ? 'medium' : 'low', impact: 'medium', evidenceClass: o.evidenceClass, recommendation: o.opportunity, effort: 'medium', deliverableType: i === 0 ? 'headline_set' : undefined,
  }, 'competitor'));
}

/** Model interpretation (messaging / positioning / value proposition). Evidence is grounded against retrieved text. */
export function groundFinding(f: Finding, corpus: string): Finding | null {
  const norm = normalizeText(corpus);
  const ev = f.evidence.filter((e) => e.kind !== 'quote' || (normalizeText(e.text).length >= 6 && norm.includes(normalizeText(e.text))));
  const dropped = f.evidence.length - ev.length;
  const supported = ev.some((e) => e.kind === 'quote' || e.kind === 'metric' || e.kind === 'missing' || e.kind === 'observation');
  if (!supported) return null;
  let cls: EvidenceClass = f.evidenceClass; let conf: Level = f.confidence;
  if (cls === 'verified' && (dropped > 0 || !ev.some((e) => e.kind === 'quote' || e.kind === 'metric' || e.kind === 'missing'))) { cls = 'inferred'; conf = conf === 'high' ? 'medium' : conf; }
  return { ...f, evidence: ev, evidenceClass: cls, confidence: conf, missingInfo: dropped ? [...f.missingInfo, `${dropped} cited quote(s) could not be matched to retrieved text and were removed.`] : f.missingInfo };
}

export async function modelFindings(
  client: StructuredClient,
  input: { profile: ProfileRow; scan?: WebsiteScan; rules: Finding[]; comparison?: CompetitorComparison; extraSupplied?: string; performance?: unknown },
  usage: { current: Usage },
): Promise<{ findings: Finding[]; dropped: number; mock: boolean }> {
  const corpus = (input.scan ? pageCorpus(input.scan) : '') + ' ' + (input.extraSupplied ?? '');
  const res = await client.generate({
    task: 'marketing_analysis', usage, schema: MarketingAnalysisSchema,
    untrusted: (input.scan?.pages ?? []).filter((p) => p.ok).slice(0, 6).map((p) => ({ id: p.finalUrl, source: p.finalUrl, text: p.text.slice(0, 3000) })),
    instructions: `Identify the most important MARKETING problems (messaging clarity, value proposition, differentiation, brand positioning, customer fit, content quality). Do not repeat the rule findings already listed. Each finding needs the full structure: what was observed, where, evidence (quote = EXACT text copied from the pages), why it matters, who is affected, likely consequence, confidence, impact, missing information, recommendation. Evidence "verified" requires an exact quote. Never invent metrics, rankings, traffic or revenue effects. At most 5 findings; prefer important over cosmetic.`,
    input: { profile: ProfileService.summarize(input.profile), pages: input.scan ? pagesForPrompt(input.scan, 2500) : [], ruleFindingTitles: input.rules.map((r) => r.title), competitors: input.comparison, performance: input.performance },
  });
  let dropped = 0; const findings: Finding[] = [];
  for (const m of res.data.findings) {
    const f = groundFinding({ ...m, key: `m_${hashContent(m.title).slice(0, 10)}`, dependsOn: [], origin: 'model' }, corpus);
    if (f) findings.push(f); else dropped++;
  }
  return { findings, dropped, mock: res.mock };
}

// ---------------- Prioritisation (spec §7.2) ----------------
const L = { high: 1, medium: 0.6, low: 0.3 } as const;
const EV = { verified: 1, inferred: 0.6, estimated: 0.4, unknown: 0.2 } as const;
const EFFORT = { low: 1, medium: 0.6, high: 0.25, unknown: 0.5 } as const;
/** Category weight for a typical small business with a website but unknown acquisition funnel. */
const RELEVANCE: Record<AnalysisCategory, number> = {
  conversion: 1, messaging: 0.95, brand_positioning: 0.85, website_effectiveness: 0.7, content_gaps: 0.8, local_visibility: 0.85,
  search_visibility: 0.8, seo_structure: 0.6, content_quality: 0.7, competitive_positioning: 0.7, marketing_consistency: 0.5, customer_acquisition: 0.9,
};
export interface Score { score: number; parts: Record<string, number> }
/** Value & urgency dominate; cheap, well-evidenced work beats sophisticated, expensive work. Confidence is separate from impact. */
export function scoreFinding(f: Finding, objectives: string[] = []): Score {
  const value = L[f.impact];
  const objBoost = objectives.some((o) => normalizeText(o).split(' ').some((w) => w.length > 4 && normalizeText(f.title + ' ' + f.category.replace('_', ' ')).includes(w))) ? 0.1 : 0;
  const relevance = Math.min(1, RELEVANCE[f.category] + objBoost);
  const evidence = EV[f.evidenceClass] * (f.confidence === 'high' ? 1 : f.confidence === 'medium' ? 0.85 : 0.65);
  const urgency = f.impact === 'high' && (f.category === 'conversion' || f.category === 'search_visibility') ? 1 : f.impact === 'high' ? 0.7 : 0.4;
  const effort = EFFORT[f.effort]; const deps = f.dependsOn.length ? Math.max(0.4, 1 - 0.2 * f.dependsOn.length) : 1;
  const cost = 1; // all recommended work is low-cost (no ad spend is ever recommended by rule)
  const time = effort;
  const parts = { value, relevance, evidence, urgency, effort, deps, cost, time };
  const score = 100 * (0.3 * value + 0.15 * relevance + 0.15 * evidence + 0.12 * urgency + 0.13 * effort + 0.05 * deps + 0.05 * cost + 0.05 * time);
  return { score: Math.round(score * 10) / 10, parts };
}
export const priorityLabel = (s: number): 'critical' | 'high' | 'medium' | 'low' => (s >= 82 ? 'critical' : s >= 70 ? 'high' : s >= 55 ? 'medium' : 'low');
