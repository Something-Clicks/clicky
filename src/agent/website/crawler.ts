import { nowIso, sleep, uniq } from '../core/util';
import type { PageRecord, ScanFailure, WebsiteScan } from '../domain/models';
import { parseHtml } from './html';
import { safeFetch, type SafeFetchOptions } from './safe-fetch';
import { parseSafeUrl } from './url-guard';

export type PageType = 'home' | 'about' | 'services' | 'products' | 'pricing' | 'contact' | 'location' | 'blog' | 'resource' | 'landing' | 'other';

const TYPE_RULES: [PageType, RegExp, number][] = [
  ['services', /(services?|what-we-do|solutions|offerings|treatments|repair|installation)/i, 90],
  ['products', /(products?|shop|store|catalog|collections?)/i, 85],
  ['pricing', /(pricing|prices?|plans|rates|packages|cost)/i, 80],
  ['about', /(about|our-story|who-we-are|team|company)/i, 75],
  ['contact', /(contact|get-in-touch|quote|book|appointment|schedule)/i, 78],
  ['location', /(locations?|areas?-we-serve|service-areas?|serving|near-me|-(tx|ca|ny|fl|ut|wa|or|az|co)\b)/i, 60],
  ['resource', /(resources?|guides?|faq|help|learn|case-stud)/i, 40],
  ['blog', /(blog|news|articles?|insights|posts?)/i, 35],
  ['landing', /(lp|landing|offer|promo|special)/i, 30],
];
export function classifyPage(url: string, home: string): PageType {
  const u = new URL(url);
  if (u.pathname === '/' || u.pathname === '' || url === home) return 'home';
  const hay = u.pathname + ' ';
  return TYPE_RULES.find(([, re]) => re.test(hay))?.[0] ?? 'other';
}
const scoreOf = (t: PageType): number => (TYPE_RULES.find(([x]) => x === t)?.[2] ?? 10);

export interface CrawlOptions extends SafeFetchOptions {
  maxPages?: number; delayMs?: number; respectRobots?: boolean; sleepImpl?: (ms: number) => Promise<void>;
}

function parseRobots(txt: string): { disallow: string[]; sitemaps: string[]; crawlDelay?: number } {
  const disallow: string[] = []; const sitemaps: string[] = []; let applies = false; let crawlDelay: number | undefined; let sawSpecific = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const i = line.indexOf(':'); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(); const v = line.slice(i + 1).trim();
    if (k === 'user-agent') { const ua = v.toLowerCase(); applies = ua === '*' ? !sawSpecific : ua.includes('somethingclicks'); if (ua.includes('somethingclicks')) sawSpecific = true; }
    else if (k === 'sitemap') sitemaps.push(v);
    else if (applies && k === 'disallow' && v) disallow.push(v);
    else if (applies && k === 'crawl-delay') crawlDelay = Math.min(5000, Number(v) * 1000) || undefined;
  }
  return { disallow, sitemaps, crawlDelay };
}
const allowed = (path: string, dis: string[]): boolean => !dis.some((d) => path.startsWith(d.replace(/\*$/, '')));

function toRecord(url: string, home: string, r: Awaited<ReturnType<typeof safeFetch>>): PageRecord {
  const p = r.body ? parseHtml(r.body, r.finalUrl) : undefined;
  return {
    url, finalUrl: r.finalUrl, type: classifyPage(r.finalUrl, home), status: r.status, ok: r.ok,
    title: p?.title, metaDescription: p?.metaDescription, canonical: p?.canonical, robotsMeta: p?.robotsMeta, lang: p?.lang, viewport: p?.viewport,
    h1: p?.h1 ?? [], h2: p?.h2 ?? [], h3: p?.h3 ?? [], text: p?.text ?? '', wordCount: p?.wordCount ?? 0,
    images: p?.images ?? { total: 0, missingAlt: 0 }, links: p?.links ?? [], navLinks: p?.navLinks ?? [], jsonLdTypes: p?.jsonLdTypes ?? [],
    ctas: p?.ctas ?? [], formCount: p?.formCount ?? 0, phones: p?.phones ?? [], emails: p?.emails ?? [], scriptCount: p?.scriptCount ?? 0,
    possiblyJsRendered: p?.possiblyJsRendered ?? false, injectionSignals: p?.injectionSignals ?? [], redirects: r.redirects, elapsedMs: r.elapsedMs,
  };
}

/** Priority-limited, polite, SSRF-safe discovery crawl. Never attempts to crawl a whole site. */
export async function scanWebsite(startUrl: string, o: CrawlOptions = {}): Promise<WebsiteScan> {
  const maxPages = o.maxPages ?? 8;
  const sleeper = o.sleepImpl ?? sleep;
  const scan: WebsiteScan = {
    startUrl, scannedAt: nowIso(), completeness: 'failed', pages: [], failures: [], limitations: [],
    robots: { fetched: false, disallowedSkipped: [], sitemaps: [] },
    tested: { htmlRetrieved: false, mobileRendering: false, brokenLinks: false, coreWebVitals: false, javascriptRendering: false },
  };
  let start: URL;
  try { start = parseSafeUrl(startUrl); } catch (e) { scan.failures.push({ url: startUrl, code: 'invalid_url', message: (e as Error).message }); return scan; }
  scan.startUrl = start.toString(); // always a normalised absolute URL, even if the customer typed a bare domain

  const home = await safeFetch(start.toString(), o);
  if (!home.ok) {
    scan.failures.push({ url: start.toString(), code: home.failure!.code, message: home.failure!.message });
    scan.limitations.push(home.failure!.code === 'bot_protection'
      ? 'The site blocked automated retrieval, so nothing about its content can be stated as verified.'
      : `The homepage could not be retrieved (${home.failure!.message}).`);
    return scan;
  }
  scan.finalUrl = home.finalUrl;
  const homeRec = toRecord(start.toString(), home.finalUrl, home);
  homeRec.type = 'home';
  scan.pages.push(homeRec);
  scan.tested.htmlRetrieved = true;

  let disallow: string[] = []; let delay = o.delayMs ?? 0;
  if (o.respectRobots !== false) {
    const rb = await safeFetch(new URL('/robots.txt', home.finalUrl).toString(), { ...o, acceptAnyText: true });
    if (rb.ok && rb.body) {
      const p = parseRobots(rb.body); disallow = p.disallow; scan.robots = { fetched: true, disallowedSkipped: [], sitemaps: p.sitemaps };
      if (p.crawlDelay) delay = Math.max(delay, p.crawlDelay);
    }
  }

  const homeHost = new URL(home.finalUrl).hostname.replace(/^www\./, '');
  const seen = new Set<string>([homeRec.finalUrl, start.toString()]);
  const candidates = new Map<string, number>();
  const consider = (p: PageRecord) => {
    for (const l of p.links) {
      if (!l.internal || new URL(l.href).hostname.replace(/^www\./, '') !== homeHost || /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|css|js)$/i.test(l.href)) continue;
      if (seen.has(l.href)) continue;
      const t = classifyPage(l.href, home.finalUrl);
      const inNav = homeRec.navLinks.includes(l.href) ? 15 : 0;
      candidates.set(l.href, Math.max(candidates.get(l.href) ?? 0, scoreOf(t) + inNav - new URL(l.href).pathname.split('/').length));
    }
  };
  consider(homeRec);

  const perTypeCap: Partial<Record<PageType, number>> = { blog: 1, resource: 1, landing: 1, other: 1, location: 2 };
  const typeCount: Partial<Record<PageType, number>> = {};
  while (scan.pages.length < maxPages && candidates.size) {
    const [url] = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0]!;
    candidates.delete(url);
    if (seen.has(url)) continue;
    const t = classifyPage(url, home.finalUrl);
    if ((typeCount[t] ?? 0) >= (perTypeCap[t] ?? 3)) continue;
    seen.add(url);
    if (!allowed(new URL(url).pathname, disallow)) { scan.robots.disallowedSkipped.push(url); continue; }
    if (delay) await sleeper(delay);
    const r = await safeFetch(url, o);
    if (!r.ok) { scan.failures.push({ url, code: r.failure!.code, message: r.failure!.message }); if (r.failure!.code === 'rate_limited' || r.failure!.code === 'bot_protection') { scan.limitations.push(`Stopped crawling after ${r.failure!.code} on ${url}.`); break; } continue; }
    seen.add(r.finalUrl);
    const rec = toRecord(url, home.finalUrl, r);
    typeCount[rec.type as PageType] = (typeCount[rec.type as PageType] ?? 0) + 1;
    scan.pages.push(rec);
    consider(rec);
  }

  if (candidates.size) scan.limitations.push(`Crawl was limited to ${maxPages} priority pages; ${candidates.size} other internal pages were not examined.`);
  if (scan.pages.some((p) => p.possiblyJsRendered)) scan.limitations.push('Some pages appear to render content with JavaScript. Only the initial HTML was read, so their visible content may be incomplete.');
  if (scan.robots.disallowedSkipped.length) scan.limitations.push(`${scan.robots.disallowedSkipped.length} page(s) skipped because robots.txt disallows them.`);
  if (home.truncated) scan.limitations.push('The homepage was larger than the retrieval size cap and was truncated.');
  scan.limitations.push('Mobile rendering, Core Web Vitals, broken-link checks and JavaScript-rendered content were NOT tested; nothing in this scan establishes them.');
  scan.limitations = uniq(scan.limitations);
  scan.completeness = scan.failures.length || candidates.size ? 'partial' : 'complete';
  return scan;
}

export type { ScanFailure };
