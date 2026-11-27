import type { ResearchSource } from '../capabilities/market-research';
import { uniq } from '../core/util';

/**
 * Public research and discovery sources. None needs an API key or a paid account:
 *  - OpenStreetMap (Nominatim + Overpass): real, openly licensed business listings with website tags, by category and place.
 *  - DuckDuckGo HTML results: general web search (keyless).
 *  - SearXNG: any self-hosted/public instance you point SEARXNG_URL at.
 * Every call can fail (network policy, rate limits); failures are surfaced to the caller, never turned into invented results.
 */
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; method?: string; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;
export class SourceError extends Error { constructor(readonly source: string, message: string) { super(`${source}: ${message}`); } }

const UA = 'SomethingClicksResearch/1.0 (marketing research assistant; contact via site owner)';
async function get(f: FetchLike, source: string, url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}, ms = 25_000): Promise<string> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await f(url, { ...init, headers: { 'user-agent': UA, accept: '*/*', ...init.headers }, signal: ac.signal });
    if (!r.ok) throw new SourceError(source, `HTTP ${r.status}`);
    return await r.text();
  } catch (e) { if (e instanceof SourceError) throw e; throw new SourceError(source, (e as Error).name === 'AbortError' ? 'timed out' : ((e as Error).cause as Error | undefined)?.message ?? (e as Error).message); }
  finally { clearTimeout(t); }
}

export interface BusinessCandidate { name: string; website?: string; address?: string; phone?: string; category?: string; via: string; ref: string; lat?: number; lon?: number }

/** Free-text industry -> OpenStreetMap tags. Only well-known categories; an unknown industry falls back to web search. */
export const OSM_CATEGORIES: { match: RegExp; tags: [string, string][] }[] = [
  { match: /plumb/i, tags: [['craft', 'plumber'], ['shop', 'plumber']] },
  { match: /hvac|heating|air.?condition|furnace/i, tags: [['craft', 'hvac']] },
  { match: /electric/i, tags: [['craft', 'electrician']] },
  { match: /roof/i, tags: [['craft', 'roofer']] },
  { match: /landscap|lawn|garden/i, tags: [['craft', 'gardener']] },
  { match: /paint/i, tags: [['craft', 'painter']] },
  { match: /carpent|woodwork/i, tags: [['craft', 'carpenter']] },
  { match: /clean(ing|er)|maid|janitor/i, tags: [['shop', 'dry_cleaning'], ['craft', 'cleaning']] },
  { match: /dent(ist|al)/i, tags: [['amenity', 'dentist']] },
  { match: /veterin|vet clinic|animal hospital/i, tags: [['amenity', 'veterinary']] },
  { match: /doctor|clinic|medical|physician/i, tags: [['amenity', 'doctors'], ['amenity', 'clinic']] },
  { match: /chiropract|physio|therap/i, tags: [['healthcare', 'physiotherapist'], ['healthcare', 'chiropractor']] },
  { match: /lawyer|attorney|law firm|legal/i, tags: [['office', 'lawyer']] },
  { match: /account|bookkeep|tax prep/i, tags: [['office', 'accountant']] },
  { match: /real.?estate|realtor|estate agent/i, tags: [['office', 'estate_agent']] },
  { match: /insurance/i, tags: [['office', 'insurance']] },
  { match: /restaurant|dining|bistro|grill/i, tags: [['amenity', 'restaurant']] },
  { match: /cafe|coffee/i, tags: [['amenity', 'cafe']] },
  { match: /bakery|bakeries/i, tags: [['shop', 'bakery']] },
  { match: /hair|salon|barber/i, tags: [['shop', 'hairdresser'], ['shop', 'beauty']] },
  { match: /gym|fitness|crossfit|yoga|pilates/i, tags: [['leisure', 'fitness_centre'], ['leisure', 'sports_centre']] },
  { match: /auto|car repair|mechanic|garage|tire/i, tags: [['shop', 'car_repair'], ['shop', 'tyres']] },
  { match: /florist|flower/i, tags: [['shop', 'florist']] },
  { match: /photograph/i, tags: [['craft', 'photographer'], ['shop', 'photo']] },
  { match: /pet (store|shop|grooming)|groom/i, tags: [['shop', 'pet'], ['shop', 'pet_grooming']] },
  { match: /school|tutor|academy|daycare|child.?care/i, tags: [['amenity', 'school'], ['amenity', 'kindergarten']] },
  { match: /hotel|inn|lodging|b&b|bed and breakfast/i, tags: [['tourism', 'hotel'], ['tourism', 'guest_house']] },
  { match: /pharmacy|drug store/i, tags: [['amenity', 'pharmacy']] },
  { match: /furniture/i, tags: [['shop', 'furniture']] },
  { match: /jewel/i, tags: [['shop', 'jewelry']] },
  { match: /moving|mover|storage/i, tags: [['shop', 'storage_rental'], ['office', 'moving_company']] },
];
export const osmTagsFor = (industry: string) => OSM_CATEGORIES.find((c) => c.match.test(industry))?.tags;

const normSite = (w?: string) => { if (!w) return undefined; const v = w.trim().split(/[;,\s]+/)[0]!; if (!v) return undefined; try { return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).origin; } catch { return undefined; } };

/** Nominatim's usage policy allows at most one request per second; also keeps us clear of upstream rate limits. */
let lastNominatim = 0;
const throttle = async (ms = 1100) => { const wait = lastNominatim + ms - Date.now(); lastNominatim = Math.max(Date.now(), lastNominatim) + (wait > 0 ? wait : 0); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); };

export class OpenStreetMapSource {
  readonly name = 'OpenStreetMap';
  /** Overpass is run by volunteers on several public mirrors; try each in turn (a mirror that resets or rate-limits us is skipped). */
  constructor(private readonly f: FetchLike = fetch as unknown as FetchLike, private readonly nominatim = 'https://nominatim.openstreetmap.org', private readonly overpass: string | string[] = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {}
  private async overpassQuery(q: string): Promise<string> {
    const errs: string[] = [];
    for (const ep of [this.overpass].flat()) { try { return await get(this.f, this.name, ep, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, 40_000); } catch (e) { errs.push(`${new URL(ep).hostname}: ${(e as Error).message.replace(/^OpenStreetMap: /, '')}`); } }
    throw new SourceError(this.name, `Overpass unreachable (${errs.join('; ')})`);
  }

  async geocode(place: string): Promise<{ lat: number; lon: number; bbox: [number, number, number, number]; display: string } | undefined> {
    await throttle();
    const body = await get(this.f, this.name, `${this.nominatim}/search?${new URLSearchParams({ q: place, format: 'jsonv2', limit: '1' })}`);
    const r = (JSON.parse(body) as { lat: string; lon: string; boundingbox: string[]; display_name: string }[])[0]; if (!r) return undefined;
    const [s, n, w, e] = r.boundingbox.map(Number) as [number, number, number, number]; return { lat: Number(r.lat), lon: Number(r.lon), bbox: [s, w, n, e], display: r.display_name };
  }
  /** Businesses of a category in a place that publish a website, as listed (by volunteers) in OpenStreetMap. */
  async findBusinesses(q: { industry: string; place: string; limit?: number }): Promise<BusinessCandidate[]> {
    const tags = osmTagsFor(q.industry); if (!tags) return [];
    const g = await this.geocode(q.place); if (!g) return [];
    // cap the box so a country-sized result cannot request the whole planet
    const [s, w, n, e] = g.bbox; const dy = Math.min(n - s, 0.5), dx = Math.min(e - w, 0.7); const cy = (s + n) / 2, cx = (w + e) / 2;
    const box = [cy - dy / 2, cx - dx / 2, cy + dy / 2, cx + dx / 2].map((v) => v.toFixed(5)).join(',');
    const parts = tags.flatMap(([k, v]) => [`nwr["${k}"="${v}"]["website"](${box});`, `nwr["${k}"="${v}"]["contact:website"](${box});`]).join('');
    const body = await this.overpassQuery(`[out:json][timeout:25];(${parts});out center tags 60;`);
    const els = (JSON.parse(body) as { elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] }).elements ?? [];
    const out: BusinessCandidate[] = [];
    for (const el of els) {
      const t = el.tags ?? {}; const site = normSite(t.website ?? t['contact:website']); if (!t.name || !site) continue;
      const addr = [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' ') || undefined;
      out.push({ name: t.name, website: site, address: addr, phone: t.phone ?? t['contact:phone'], category: tags.map((x) => x[1]).join('/'), via: this.name, ref: `osm:${el.type}/${el.id}`, lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon });
    }
    const seen = new Set<string>(); return out.filter((c) => { const h = new URL(c.website!).hostname.replace(/^www\./, ''); if (seen.has(h)) return false; seen.add(h); return true; }).slice(0, q.limit ?? 15);
  }
  /** Find a business's own website from its name and place. */
  async findWebsite(q: { name: string; place?: string }): Promise<BusinessCandidate[]> {
    await throttle();
    const body = await get(this.f, this.name, `${this.nominatim}/search?${new URLSearchParams({ q: [q.name, q.place].filter(Boolean).join(', '), format: 'jsonv2', limit: '8', extratags: '1', addressdetails: '1', namedetails: '1' })}`);
    const rows = JSON.parse(body) as { osm_type: string; osm_id: number; name?: string; display_name: string; extratags?: Record<string, string>; category?: string; type?: string }[];
    return rows.flatMap((r) => { const site = normSite(r.extratags?.website ?? r.extratags?.['contact:website']); return site ? [{ name: r.name ?? q.name, website: site, address: r.display_name, phone: r.extratags?.phone, category: r.type, via: this.name, ref: `osm:${r.osm_type}/${r.osm_id}` } as BusinessCandidate] : []; });
  }
}

export interface WebHit { id: string; title: string; url?: string; snippet: string; retrievedAt: string }
const unesc = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
/** Parses DuckDuckGo's HTML result page. Exported for tests of the parser itself. */
export function parseDuckDuckGo(html: string, now = new Date().toISOString()): WebHit[] {
  const out: WebHit[] = []; const anchors = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
  anchors.forEach((m, i) => {
    const tag = m[0].match(/href="([^"]+)"/); if (!tag) return;
    let href = tag[1]!.replace(/&amp;/g, '&'); const u = href.match(/[?&]uddg=([^&]+)/); if (u) href = decodeURIComponent(u[1]!); if (href.startsWith('//')) href = `https:${href}`;
    if (!/^https?:\/\//i.test(href)) return;
    const between = html.slice(m.index! + m[0].length, anchors[i + 1]?.index ?? html.length);
    const sn = between.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td|span)>/);
    out.push({ id: `web:${out.length + 1}`, title: unesc(m[1] ?? ''), url: href, snippet: unesc(sn?.[1] ?? ''), retrievedAt: now });
  });
  return out;
}
export class DuckDuckGoSource implements ResearchSource {
  readonly name = 'DuckDuckGo';
  constructor(private readonly f: FetchLike = fetch as unknown as FetchLike, private readonly base = 'https://html.duckduckgo.com/html/') {}
  async search(query: string) { return parseDuckDuckGo(await get(this.f, this.name, this.base, { method: 'POST', body: new URLSearchParams({ q: query }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } })).slice(0, 10); }
}
export class SearxngSource implements ResearchSource {
  readonly name = 'SearXNG';
  constructor(private readonly base: string, private readonly f: FetchLike = fetch as unknown as FetchLike) {}
  async search(query: string) {
    const j = JSON.parse(await get(this.f, this.name, `${this.base.replace(/\/$/, '')}/search?${new URLSearchParams({ q: query, format: 'json' })}`)) as { results?: { title: string; url: string; content?: string }[] };
    const now = new Date().toISOString(); return (j.results ?? []).slice(0, 10).map((r, i) => ({ id: `web:${i + 1}`, title: r.title, url: r.url, snippet: r.content ?? '', retrievedAt: now }));
  }
}
/** Tries each source in order and merges what comes back; throws only when every source failed (so "nothing found" and "could not search" stay distinct). */
export class CompositeSource implements ResearchSource {
  constructor(private readonly sources: ResearchSource[]) {}
  get name() { return this.sources.map((s) => s.name).join('+') || 'none'; }
  async search(query: string) {
    const hits: WebHit[] = []; const errors: string[] = []; let answered = 0;
    for (const s of this.sources) { try { hits.push(...(await s.search(query))); answered++; } catch (e) { errors.push((e as Error).message); } }
    if (!answered && errors.length) throw new SourceError(this.name, errors.join('; '));
    const seen = new Set<string>(); return hits.filter((h) => { const k = h.url ?? h.id; if (seen.has(k)) return false; seen.add(k); return true; }).map((h, i) => ({ ...h, id: `web:${i + 1}` }));
  }
}

/** Directories, social networks and marketplaces are not competitors' own websites. */
const NOT_OWN_SITE = /(^|\.)(yelp|facebook|instagram|linkedin|twitter|x|tiktok|youtube|pinterest|reddit|yellowpages|angi|angieslist|homeadvisor|thumbtack|bbb|mapquest|tripadvisor|nextdoor|houzz|porch|expertise|manta|superpages|google|bing|wikipedia|amazon|ebay|etsy|zillow|realtor|healthgrades|zocdoc|avvo|justia|findlaw|groupon|indeed|glassdoor|crunchbase|opentable|doordash|ubereats|grubhub|apple|duckduckgo)\./i;
export const isOwnWebsite = (url: string) => { try { return !NOT_OWN_SITE.test(`${new URL(url).hostname.replace(/^www\./, '')}.`); } catch { return false; } };
export { uniq };
