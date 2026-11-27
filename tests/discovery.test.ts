/** Unit tests for the discovery/research plumbing: response parsing, failure handling, labelling. They do NOT prove the live sources work (see docs). */
import { describe, expect, it } from 'vitest';
import { NullDiscovery, PublicDiscovery, type Discovery } from '../src/agent/research/discovery';
import { CompositeSource, DuckDuckGoSource, isOwnWebsite, OpenStreetMapSource, osmTagsFor, parseDuckDuckGo, SourceError, type FetchLike } from '../src/agent/research/sources';
import { setup } from './helpers/fixtures';

const resp = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => body });
const osmFetch = (log: string[] = []): FetchLike => async (url, init) => {
  log.push(url);
  if (url.includes('/search?') && !init?.method) return resp(url.includes('extratags') ? [{ osm_type: 'node', osm_id: 7, name: 'Summit Plumbing', display_name: 'Summit Plumbing, Denver, CO', type: 'plumber', extratags: { website: 'https://rivalplumbing.example/contact' } }] : [{ lat: '39.7', lon: '-104.9', boundingbox: ['39.6', '39.9', '-105.1', '-104.7'], display_name: 'Denver' }]);
  if (init?.method === 'POST' && url.includes('overpass')) return resp({ elements: [
    { type: 'node', id: 1, lat: 39.7, lon: -104.9, tags: { name: 'Rival Plumbing', website: 'rivalplumbing.example', craft: 'plumber', 'addr:street': 'Main St', 'addr:housenumber': '5' } },
    { type: 'node', id: 2, tags: { name: 'No Site Plumbing', craft: 'plumber' } },
    { type: 'way', id: 3, center: { lat: 1, lon: 2 }, tags: { name: 'Rival Plumbing Annex', 'contact:website': 'https://www.rivalplumbing.example/annex' } },
    { type: 'node', id: 4, tags: { name: 'Summit Plumbing', website: 'https://summitplumbing.example' } },
    { type: 'node', id: 5, tags: { name: 'On Yelp', website: 'https://www.yelp.com/biz/x' } },
  ] });
  return resp('', 404);
};

describe('categories and filters', () => {
  it('maps common industries to OpenStreetMap tags and leaves unknown ones to web search', () => {
    expect(osmTagsFor('Residential plumbing')).toEqual([['craft', 'plumber'], ['shop', 'plumber']]); expect(osmTagsFor('Dental clinic')?.[0]).toEqual(['amenity', 'dentist']); expect(osmTagsFor('Quantum consulting')).toBeUndefined();
  });
  it('directories and social networks are never treated as a business’s own website', () => {
    for (const u of ['https://www.yelp.com/biz/a', 'https://facebook.com/x', 'https://www.angi.com/y', 'https://en.wikipedia.org/wiki/Z']) expect(isOwnWebsite(u)).toBe(false);
    for (const u of ['https://rivalplumbing.example', 'https://dentistx.com', 'https://boxco.co']) expect(isOwnWebsite(u)).toBe(true);
  });
});
describe('OpenStreetMap source', () => {
  it('lists businesses that publish a website, de-duplicated by host, with provenance', async () => {
    const r = await new OpenStreetMapSource(osmFetch()).findBusinesses({ industry: 'plumbing', place: 'Denver, CO' });
    expect(r.map((c) => c.website)).toEqual(['https://rivalplumbing.example', 'https://summitplumbing.example', 'https://www.yelp.com']);
    expect(r[0]).toMatchObject({ name: 'Rival Plumbing', via: 'OpenStreetMap', ref: 'osm:node/1', address: '5 Main St' });
  });
  it('does not query for industries it has no category for, and surfaces HTTP failures', async () => {
    const log: string[] = []; expect(await new OpenStreetMapSource(osmFetch(log)).findBusinesses({ industry: 'quantum consulting', place: 'Denver' })).toEqual([]); expect(log).toEqual([]);
    await expect(new OpenStreetMapSource(async () => resp('busy', 429)).geocode('x')).rejects.toThrow(/OpenStreetMap: HTTP 429/);
    await expect(new OpenStreetMapSource(async () => { throw new TypeError('fetch failed', { cause: new Error('connect refused by network policy') }); }).geocode('x')).rejects.toThrow(/network policy/);
  });
  it('finds a business website from its name', async () => { const r = await new OpenStreetMapSource(osmFetch()).findWebsite({ name: 'Summit Plumbing', place: 'Denver' }); expect(r[0]).toMatchObject({ website: 'https://rivalplumbing.example', via: 'OpenStreetMap' }); });
});
describe('web search parsing and composition', () => {
  const HTML = `<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frivalplumbing.example%2F&amp;rut=abc">Rival Plumbing &amp; Heating</a></h2><a class="result__snippet" href="x">Same-day <b>plumbers</b> in Denver</a></div>
    <div class="result"><a class="result__a" href="https://www.yelp.com/biz/foo">Foo on Yelp</a><a class="result__snippet" href="y">Reviews</a></div>`;
  it('parses result titles, destination urls and snippets', () => {
    const h = parseDuckDuckGo(HTML, 'T'); expect(h).toHaveLength(2); expect(h[0]).toMatchObject({ title: 'Rival Plumbing & Heating', url: 'https://rivalplumbing.example/', snippet: 'Same-day plumbers in Denver' });
  });
  it('a failing source does not hide a working one; all failing is an error, not an empty result', async () => {
    const ok = new DuckDuckGoSource(async () => resp(HTML)); const bad = new DuckDuckGoSource(async () => resp('x', 503));
    expect((await new CompositeSource([bad, ok]).search('q')).length).toBe(2);
    await expect(new CompositeSource([bad, bad]).search('q')).rejects.toBeInstanceOf(SourceError);
  });
});
describe('PublicDiscovery', () => {
  it('finds competitors from listings, excludes the customer’s own site and directories, and reports failures', async () => {
    const d = new PublicDiscovery(new OpenStreetMapSource(osmFetch()), new DuckDuckGoSource(async () => resp('x', 503)));
    const r = await d.competitors({ industry: 'plumbing', place: 'Denver', ownUrl: 'summitplumbing.example', limit: 5 });
    expect(r.candidates.map((c) => c.website)).toEqual(['https://rivalplumbing.example']); expect(r.sources).toEqual(['OpenStreetMap']); expect(r.errors.join()).toMatch(/DuckDuckGo: HTTP 503/);
  });
  it('reports when nothing could be reached instead of inventing candidates', async () => {
    const down: FetchLike = async () => { throw new Error('blocked'); };
    const r = await new PublicDiscovery(new OpenStreetMapSource(down), new DuckDuckGoSource(down)).competitors({ industry: 'plumbing', place: 'Denver' });
    expect(r.candidates).toEqual([]); expect(r.errors.length).toBe(2);
  });
});
describe('the agent discovers competitors by itself', () => {
  const found: Discovery = { name: 'test-discovery', async competitors() { return { candidates: [{ name: 'Rival Plumbing', website: 'https://rivalplumbing.example', via: 'OpenStreetMap', ref: 'osm:node/1' }], sources: ['OpenStreetMap'], errors: [] }; }, async findWebsite() { return { candidates: [], sources: [], errors: [] }; } };
  it('competitor research with no URLs uses discovered candidates, labels them, and saves the comparison', async () => {
    const s = await setup({ plan: 'studio', discovery: found });
    await s.agent.profiles.applyUpdates(s.owner, [{ key: 'industry', value: 'Plumbing', provenance: { source: 'customer_confirmed', evidence: 'verified' } }, { key: 'service_areas', value: ['Denver, CO'], provenance: { source: 'customer_confirmed', evidence: 'verified' } }], { type: 'user', id: s.owner.userId });
    await s.agent.orchestrator.submit(s.owner, { request: 'Research my competitors', params: {} }); const [r] = await s.runAll();
    expect(r!.status).toBe('succeeded'); expect(r!.limitations.join(' ')).toMatch(/discovered automatically \(OpenStreetMap\).*not been confirmed by you.*rivalplumbing\.example/);
    const lib = await s.agent.db.research.list(s.owner.businessId, { kind: 'competitor' }); expect(lib[0]!.title).toMatch(/discovered automatically/);
  });
  it('without a discovery source the agent still asks for competitors and never guesses', async () => {
    const s = await setup({ plan: 'studio', discovery: new NullDiscovery() });
    await expect(s.agent.orchestrator.submit(s.owner, { request: 'Research my competitors', params: {} })).resolves.toMatchObject({ status: 'needs_input' });
  });
});
