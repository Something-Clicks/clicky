import type { ResearchSource } from '../capabilities/market-research';
import { isOwnWebsite, OpenStreetMapSource, SourceError, type BusinessCandidate } from './sources';

export interface DiscoveryResult { candidates: BusinessCandidate[]; sources: string[]; errors: string[] }
/** Finds businesses and websites on its own from public sources. Candidates are leads, never facts: they are labelled with where they came from. */
export interface Discovery {
  readonly name: string;
  competitors(q: { industry: string; place: string; ownUrl?: string; limit?: number }): Promise<DiscoveryResult>;
  findWebsite(q: { name: string; place?: string }): Promise<DiscoveryResult>;
}
export class NullDiscovery implements Discovery {
  readonly name = 'none';
  async competitors() { return { candidates: [], sources: [], errors: ['No discovery source is configured'] }; }
  async findWebsite() { return { candidates: [], sources: [], errors: ['No discovery source is configured'] }; }
}
const host = (u: string) => new URL(u).hostname.replace(/^www\./, '');

export class PublicDiscovery implements Discovery {
  readonly name: string;
  constructor(private readonly osm: OpenStreetMapSource, private readonly search?: ResearchSource) { this.name = ['OpenStreetMap', search?.name].filter(Boolean).join('+'); }

  async competitors(q: { industry: string; place: string; ownUrl?: string; limit?: number }): Promise<DiscoveryResult> {
    const limit = q.limit ?? 5; const own = q.ownUrl ? safeHost(q.ownUrl) : undefined; const errors: string[] = []; const sources: string[] = []; const out: BusinessCandidate[] = [];
    const add = (c: BusinessCandidate) => { if (!c.website || !isOwnWebsite(c.website) || host(c.website) === own || out.some((o) => host(o.website!) === host(c.website!))) return; out.push(c); };
    try { const r = await this.osm.findBusinesses({ industry: q.industry, place: q.place, limit: 25 }); if (r.length) sources.push('OpenStreetMap'); r.forEach(add); } catch (e) { errors.push((e as Error).message); }
    if (out.length < limit && this.search) {
      try {
        const hits = await this.search.search(`${q.industry} ${q.place}`); if (hits.length) sources.push(this.search.name);
        for (const h of hits) if (h.url) add({ name: h.title, website: new URL(h.url).origin, via: this.search.name, ref: h.url });
      } catch (e) { errors.push((e as Error).message); }
    }
    return { candidates: out.slice(0, limit), sources, errors };
  }

  async findWebsite(q: { name: string; place?: string }): Promise<DiscoveryResult> {
    const errors: string[] = []; const sources: string[] = []; const out: BusinessCandidate[] = [];
    try { const r = await this.osm.findWebsite(q); if (r.length) sources.push('OpenStreetMap'); out.push(...r); } catch (e) { errors.push((e as Error).message); }
    if (this.search) {
      try {
        const hits = await this.search.search([q.name, q.place].filter(Boolean).join(' '));
        if (hits.length) sources.push(this.search.name);
        for (const h of hits) if (h.url && isOwnWebsite(h.url) && !out.some((o) => host(o.website!) === host(h.url!))) out.push({ name: h.title, website: new URL(h.url).origin, via: this.search.name, ref: h.url });
      } catch (e) { errors.push((e as Error).message); }
    }
    return { candidates: out.slice(0, 6), sources, errors };
  }
}
const safeHost = (u: string) => { try { return host(/^https?:/i.test(u) ? u : `https://${u}`); } catch { return undefined; } };
export { SourceError };
