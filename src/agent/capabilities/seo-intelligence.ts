import { normalizeText, uniq } from '../core/util';
import type { EvidenceClass } from '../domain/enums';
import type { PageRecord, WebsiteScan } from '../domain/models';
import { csvToObjects, toNumber } from './csv';

export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational' | 'local';
export interface KeywordRow {
  keyword: string;
  /** Measured fields exist only when supplied by an import; never filled by the model. */
  volume?: number; difficulty?: number; cpc?: number; position?: number; url?: string; competitorPosition?: number;
  intent: SearchIntent; geoModifier?: string;
  measured: boolean; source: string;
}
export interface KeywordImport { rows: KeywordRow[]; skipped: number; source: string; warnings: string[] }

const STOP = new Set(['a', 'an', 'the', 'in', 'on', 'for', 'to', 'of', 'and', 'or', 'near', 'me', 'my', 'best', 'top', 'how', 'what', 'is', 'are', 'do', 'does', 'can', 'cost', 'price', 'prices']);
const US_CITY_HINT = /\b(in|near)\s+([a-z][a-z .'-]{2,30})$|\b([a-z][a-z .'-]{2,25}),?\s+(ut|tx|ca|ny|fl|wa|or|az|co|il|ga|nc|oh|mi|pa|nv|id|nm)\b/i;

export function classifyIntent(k: string, localTerms: string[] = []): SearchIntent {
  const t = k.toLowerCase();
  if (/\bnear me\b|\bnearby\b/.test(t) || US_CITY_HINT.test(t) || localTerms.some((a) => a.length > 2 && t.includes(a.toLowerCase()))) return 'local';
  if (/\b(buy|order|hire|book|quote|schedule|cheap|discount|coupon|pricing|price|cost of)\b/.test(t)) return 'transactional';
  if (/\b(best|top|vs|versus|review|reviews|compare|alternatives?|affordable)\b/.test(t)) return 'commercial';
  if (/\b(how|what|why|when|guide|tips|ideas|examples?|checklist|diy|does|can)\b/.test(t)) return 'informational';
  if (/\b(login|sign in|\.com)\b/.test(t)) return 'navigational';
  return 'commercial';
}

/** Parses a Semrush (or similar) CSV export supplied by the customer or an operator. Values are 'measured'. */
/** `localTerms` = the business's own service-area names, so place-name searches are recognised as local intent. */
export function importKeywordCsv(csv: string, source = 'semrush_manual_import', localTerms: string[] = []): KeywordImport {
  const objs = csvToObjects(csv); const rows: KeywordRow[] = []; let skipped = 0; const warnings: string[] = [];
  if (!objs.length) return { rows, skipped: 0, source, warnings: ['CSV had no data rows'] };
  const first = objs[0]!;
  if (!('keyword' in first) && !('phrase' in first) && !('query' in first) && !('top_queries' in first)) warnings.push('No "Keyword"/"Phrase"/"Query" column found; nothing was imported.');
  for (const o of objs) {
    const kw = (o.keyword ?? o.phrase ?? o.query ?? o.top_queries ?? '').trim();
    if (!kw || kw.length > 200) { skipped++; continue; }
    const geo = kw.match(US_CITY_HINT);
    rows.push({
      keyword: kw.toLowerCase(), volume: toNumber(o.search_volume ?? o.volume ?? o.impressions), difficulty: toNumber(o.keyword_difficulty ?? o.kd ?? o.difficulty),
      cpc: toNumber(o.cpc), position: toNumber(o.position ?? o.current_position ?? o.avg_position), url: o.url || o.current_url || undefined,
      competitorPosition: toNumber(o.competitor_position),
      intent: classifyIntent(kw, localTerms), geoModifier: geo ? (geo[2] ?? geo[3])?.trim() : localTerms.find((a) => a.length > 2 && kw.toLowerCase().includes(a.toLowerCase())), measured: true, source,
    });
  }
  return { rows, skipped, source, warnings };
}

const tokens = (k: string) => normalizeText(k).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
export function clusterKeywords(rows: KeywordRow[]): { topic: string; keywords: string[]; intents: SearchIntent[]; totalVolume?: number }[] {
  const freq = new Map<string, number>();
  for (const r of rows) for (const t of new Set(tokens(r.keyword))) freq.set(t, (freq.get(t) ?? 0) + 1);
  const groups = new Map<string, KeywordRow[]>();
  for (const r of rows) {
    const head = tokens(r.keyword).sort((a, b) => (freq.get(b)! - freq.get(a)!) || a.localeCompare(b))[0] ?? r.keyword;
    (groups.get(head) ?? groups.set(head, []).get(head)!).push(r);
  }
  return [...groups.entries()].map(([topic, rs]) => {
    const vols = rs.map((r) => r.volume).filter((v): v is number => v !== undefined);
    return { topic, keywords: rs.map((r) => r.keyword), intents: uniq(rs.map((r) => r.intent)), totalVolume: vols.length ? vols.reduce((a, b) => a + b, 0) : undefined };
  }).sort((a, b) => b.keywords.length - a.keywords.length);
}

const pageHay = (p: PageRecord) => normalizeText([p.title, p.metaDescription, ...p.h1, ...p.h2, p.text.slice(0, 4000)].filter(Boolean).join(' '));
export interface ContentGap { keyword: string; volume?: number; difficulty?: number; intent: SearchIntent; reason: string; evidence: EvidenceClass; coverage: 'none' | 'weak' }

/** Gap = a supplied keyword whose meaningful terms are not covered by any scanned page's title/headings/body. */
export function findContentGaps(rows: KeywordRow[], scan: WebsiteScan): ContentGap[] {
  const pages = scan.pages.filter((p) => p.ok);
  const out: ContentGap[] = [];
  for (const r of rows) {
    const t = tokens(r.keyword); if (!t.length) continue;
    const scores = pages.map((p) => { const h = pageHay(p); const inTitle = normalizeText([p.title, ...p.h1].join(' ')); return { all: t.every((w) => h.includes(w)), title: t.every((w) => inTitle.includes(w)) }; });
    if (scores.some((s) => s.title)) continue;
    out.push({
      keyword: r.keyword, volume: r.volume, difficulty: r.difficulty, intent: r.intent,
      coverage: scores.some((s) => s.all) ? 'weak' : 'none',
      reason: scores.some((s) => s.all) ? 'Terms appear in body text on some page, but no scanned page targets them in its title or main heading.' : 'No scanned page mentions these terms together.',
      evidence: pages.length ? 'verified' : 'unknown',
    });
  }
  return out.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
}

export interface LocalSeoResult { checks: { id: string; status: 'pass' | 'fail' | 'not_verifiable'; detail: string; evidence: EvidenceClass }[]; }
/** Local SEO checks limited to what a website scan can verify; Google Business Profile etc. are marked not verifiable. */
export function analyzeLocalSeo(scan: WebsiteScan, serviceAreas: string[]): LocalSeoResult {
  const home = scan.pages[0]; const checks: LocalSeoResult['checks'] = [];
  const push = (id: string, status: 'pass' | 'fail' | 'not_verifiable', detail: string, evidence: EvidenceClass = 'verified') => checks.push({ id, status, detail, evidence });
  if (!home) return { checks: [{ id: 'scan', status: 'not_verifiable', detail: 'No pages were retrieved.', evidence: 'unknown' }] };
  const ldTypes = scan.pages.flatMap((p) => p.jsonLdTypes);
  const local = ldTypes.some((t) => /LocalBusiness|Store|Restaurant|ProfessionalService|HomeAndConstructionBusiness|Dentist|Physician|Attorney|Organization/i.test(t));
  push('structured_data', ldTypes.some((t) => /LocalBusiness|Store|Restaurant|ProfessionalService|HomeAndConstructionBusiness|Dentist|Physician|Attorney/i.test(t)) ? 'pass' : 'fail',
    local ? 'Business structured data (JSON-LD) found.' : 'No LocalBusiness-style JSON-LD found in the scanned pages.');
  const phone = scan.pages.some((p) => p.phones.length || /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/.test(p.text));
  push('phone_visible', phone ? 'pass' : 'fail', phone ? 'A phone number is present on scanned pages.' : 'No phone number found in scanned page content.');
  const addr = scan.pages.some((p) => /\b\d{2,6}\s+[A-Z][\w .]+\s(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way|Ct)\b/.test(p.text));
  push('address_visible', addr ? 'pass' : 'fail', addr ? 'A street address pattern appears in page content.' : 'No street address found in scanned page content (may be image-based or on an unscanned page).');
  if (serviceAreas.length) {
    const hay = normalizeText(scan.pages.map((p) => [p.title, ...p.h1, ...p.h2, p.finalUrl].join(' ')).join(' '));
    const missing = serviceAreas.filter((a) => !hay.includes(normalizeText(a.split(',')[0]!)));
    push('service_area_in_titles_headings', missing.length ? 'fail' : 'pass', missing.length ? `Service areas not found in any scanned title/heading/URL: ${missing.join(', ')}` : 'All listed service areas appear in titles, headings or URLs.');
    const dedicated = serviceAreas.filter((a) => scan.pages.some((p) => p.type === 'location' && normalizeText(p.finalUrl + ' ' + (p.title ?? '')).includes(normalizeText(a.split(',')[0]!))));
    push('location_pages', dedicated.length ? 'pass' : 'fail', dedicated.length ? `Dedicated pages found for: ${dedicated.join(', ')}` : 'No dedicated location/service-area pages found among scanned pages.');
  }
  push('google_business_profile', 'not_verifiable', 'Google Business Profile, reviews and local citations cannot be verified from website content; supply them or connect an authorised source.', 'unknown');
  return { checks };
}
