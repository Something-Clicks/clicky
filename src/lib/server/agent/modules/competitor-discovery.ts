import { parse } from "node-html-parser";

/**
 * Competitor discovery (spec §4): finds public websites of businesses that look similar to the owner's, from two open, keyless
 * sources, and SAYS WHERE EACH ONE CAME FROM. Owner decision (Nov 28 2026): discovery is automatic, with evidence and attribution.
 *
 *  1. OpenStreetMap (Nominatim to place the service area, Overpass for nearby businesses of the matching kind that publish a
 *     website). Data © OpenStreetMap contributors (ODbL); the usage policies ask for an identifying User-Agent and no more than
 *     about one request a second, which this module keeps.
 *  2. DuckDuckGo's HTML results for one or two short searches built from the business's own confirmed or proposed details.
 *
 * What it does NOT do: it never says a business IS a competitor (it appeared in a search or a map listing for a similar kind of
 * business near the same place: evidence class "inferred", with that stated as the basis), never reads a page (reading is the
 * owner-approved scan that follows), never returns traffic, rankings or keyword figures, and never sends the business name,
 * email or any customer data anywhere: only a place name and a short service phrase leave the server.
 * Directories, social networks and marketplaces are dropped (they are not competitors, they are where competitors list).
 * Every request goes to a fixed, short list of hosts; no address in a result is fetched here.
 */

export const OSM_ATTRIBUTION = "Map data © OpenStreetMap contributors (ODbL)";
const USER_AGENT = "SomethingClicks-MarketResearch/1.0 (+https://somethingclicks.com)";

const HOSTS = {
  nominatim: "nominatim.openstreetmap.org",
  overpass: ["overpass-api.de", "overpass.private.coffee", "overpass.kumi.systems"],
  search: "html.duckduckgo.com",
} as const;

/** Places that list businesses rather than being one. Matched against the registrable-looking host. */
const NOT_COMPETITORS = /(^|\.)(yelp|facebook|instagram|twitter|x|linkedin|youtube|tiktok|pinterest|nextdoor|reddit|angi|angieslist|homeadvisor|thumbtack|yellowpages|yp|bbb|manta|mapquest|foursquare|tripadvisor|google|bing|yahoo|duckduckgo|wikipedia|amazon|ebay|etsy|craigslist|indeed|glassdoor|houzz|porch|expertise|buildzoom|trustpilot|sitejabber|chamberofcommerce|localsearch|superpages|citysearch|opentable|groupon|apple|microsoft|github|medium|wordpress|blogspot|wixsite|weebly|squarespace|homeguide|networx|fixr|bobvila|thisoldhouse|forbes|consumeraffairs|costhelper|hirerush|bark|taskrabbit|servicemagic|nerdwallet|usnews|cnet|nytimes|washingtonpost|quora|zillow|realtor|redfin|trulia|healthgrades|zocdoc|webmd|vitals|ratemds|opentable|doordash|ubereats|grubhub|seamless|sba|score)\.[a-z.]+$/i;
/** Government and school sites list and regulate businesses; they do not compete with them. */
const PUBLIC_SECTOR = /\.(gov|edu|mil)(\.[a-z]{2})?$/i;

export interface DiscoveryInput {
  /** The owner's own website, excluded from the results. */
  ownWebsite: string;
  /** City or area the business serves, as the owner wrote it. Required: without a place there is nothing local to find. */
  serviceArea: string | null;
  /** Short phrases for what the business does (confirmed or proposed services, what it does). At most 3 are used. */
  services: string[];
  /** Hosts the owner already compares with (not suggested again). */
  alreadyComparing?: string[];
  /** Web search is the more fragile and less clearly permitted source (automated use of a search page); false uses map listings only. Default true. */
  webSearch?: boolean;
}

export interface DiscoverySource {
  kind: "openstreetmap" | "web_search";
  /** A page a person can open to see the same listing or search. */
  url: string;
  /** What this source said, in the source's words, trimmed. */
  title: string;
  snippet: string | null;
  /** Where in this source's results it appeared (search position), or how far from the place (map listing). */
  detail: string;
}

export interface Candidate {
  host: string;
  /** The site's address (origin only). The scan that follows reads its homepage. */
  url: string;
  name: string | null;
  sources: DiscoverySource[];
  /** Always "inferred": appearing in a similar search or map listing is not proof of competing. */
  evidence_class: "inferred";
  basis: string;
  score: number;
}

export interface DiscoveryResult {
  candidates: Candidate[];
  queries: { search: string[]; placeQuery: string | null; osmKind: string | null };
  /** Plain statements of what was and was not done, shown to the owner. */
  limits: string[];
  attribution: string[];
  /** Per source: ran, found how many, or why not. */
  sourceStatus: { source: "openstreetmap" | "web_search"; status: "ok" | "none" | "failed" | "skipped"; found: number; note: string | null }[];
}

export interface DiscoveryDeps {
  /** GET a fixed-host URL; returns the body or throws. Injected in tests; the real one enforces the host list. */
  get?: (url: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
}

/** What kind of business it is, in OpenStreetMap tags, from the words the business uses for itself. Only kinds OSM tags well. */
const OSM_KINDS: { match: RegExp; tag: string; label: string }[] = [
  { match: /plumb|drain|pipe|water heater/i, tag: '["craft"="plumber"]', label: "plumbers" },
  { match: /roof/i, tag: '["craft"="roofer"]', label: "roofers" },
  { match: /electric/i, tag: '["craft"="electrician"]', label: "electricians" },
  { match: /hvac|heating|air.?condition|furnace/i, tag: '["craft"="hvac"]', label: "heating and cooling businesses" },
  { match: /landscap|lawn|garden|tree (care|service)/i, tag: '["craft"="gardener"]', label: "landscapers" },
  { match: /paint(er|ing)/i, tag: '["craft"="painter"]', label: "painters" },
  { match: /carpent|cabinet|woodwork/i, tag: '["craft"="carpenter"]', label: "carpenters" },
  { match: /clean(er|ing)? (service|company)|maid|janitor/i, tag: '["office"="cleaning"]', label: "cleaning services" },
  { match: /dentist|dental/i, tag: '["amenity"="dentist"]', label: "dentists" },
  { match: /veterin|animal hospital/i, tag: '["amenity"="veterinary"]', label: "vets" },
  { match: /hair|salon|barber/i, tag: '["shop"~"hairdresser|barber"]', label: "hair salons" },
  { match: /bakery|bake/i, tag: '["shop"="bakery"]', label: "bakeries" },
  { match: /cafe|coffee/i, tag: '["amenity"="cafe"]', label: "cafes" },
  { match: /restaurant|dining|catering/i, tag: '["amenity"="restaurant"]', label: "restaurants" },
  { match: /florist|flower/i, tag: '["shop"="florist"]', label: "florists" },
  { match: /auto (repair|service)|mechanic|garage/i, tag: '["shop"="car_repair"]', label: "auto repair shops" },
  { match: /photograph/i, tag: '["craft"="photographer"]', label: "photographers" },
];

const hostOf = (u: string) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };
const originOf = (u: string) => { try { const x = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`); return x.protocol === "http:" || x.protocol === "https:" ? `${x.protocol}//${x.hostname}/` : null; } catch { return null; } };
const clean = (s: string | undefined | null, max = 200) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** A short phrase (2-4 words) from a service description, for a search. Never the business name. */
export function servicePhrase(raw: string): string {
  return clean(raw, 80).replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 4).join(" ").toLowerCase();
}

export function searchQueries(services: string[], place: string): string[] {
  const phrases = [...new Set(services.map(servicePhrase).filter((p) => p.length >= 3))].slice(0, 2);
  return phrases.map((p) => `${p} ${clean(place, 60)}`);
}

/** Real fetch limited to the three fixed hosts above (no redirects, size cap, timeout). */
export const fixedHostGet = async (url: string): Promise<string> => {
  const u = new URL(url);
  const ok = u.protocol === "https:" && (u.hostname === HOSTS.nominatim || u.hostname === HOSTS.search || (HOSTS.overpass as readonly string[]).includes(u.hostname));
  if (!ok) throw new Error("host_not_allowed");
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/json" }, redirect: "manual", signal: AbortSignal.timeout(25_000), cache: "no-store" });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`status_${res.status}`); }
  const text = await res.text();
  if (text.length > 1_500_000) throw new Error("too_large");
  return text;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── OpenStreetMap ────────────────────────────────────────────────────────────────────────────────────────────────

interface Place { lat: number; lon: number; label: string }

export async function geocode(place: string, get: (u: string) => Promise<string>): Promise<Place | null> {
  const url = `https://${HOSTS.nominatim}/search?format=jsonv2&limit=1&q=${encodeURIComponent(clean(place, 100))}`;
  const rows = JSON.parse(await get(url)) as { lat?: string; lon?: string; display_name?: string }[];
  const r = rows[0];
  const lat = Number(r?.lat), lon = Number(r?.lon);
  return r && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, label: clean(r.display_name, 120) } : null;
}

interface OsmElement { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export async function osmBusinesses(place: Place, tag: string, get: (u: string) => Promise<string>): Promise<{ element: OsmElement; km: number }[]> {
  const q = `[out:json][timeout:20];nwr${tag}["website"](around:30000,${place.lat},${place.lon});out tags center 40;`;
  let lastError: unknown = null;
  for (const host of HOSTS.overpass) {
    try {
      const body = JSON.parse(await get(`https://${host}/api/interpreter?data=${encodeURIComponent(q)}`)) as { elements?: OsmElement[] };
      return (body.elements ?? []).flatMap((e) => {
        const at = e.center ?? (typeof e.lat === "number" && typeof e.lon === "number" ? { lat: e.lat, lon: e.lon } : null);
        return at ? [{ element: e, km: km(place, at) }] : [];
      });
    } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error("overpass_unavailable");
}

// ── Web search (DuckDuckGo HTML) ─────────────────────────────────────────────────────────────────────────────────

export interface SearchHit { url: string; title: string; snippet: string | null; position: number }

/** Reads result links from DuckDuckGo's HTML page. Result links are wrapped as //duckduckgo.com/l/?uddg=<real address>. */
export function parseSearchResults(html: string): SearchHit[] {
  const root = parse(html);
  const hits: SearchHit[] = [];
  for (const el of root.querySelectorAll(".result")) {
    if (el.classList.contains("result--ad")) continue;
    const a = el.querySelector("a.result__a");
    const href = a?.getAttribute("href");
    if (!a || !href) continue;
    let target: string | null = null;
    try {
      const u = new URL(href, "https://duckduckgo.com");
      target = u.hostname.endsWith("duckduckgo.com") ? u.searchParams.get("uddg") : u.toString();
    } catch { target = null; }
    if (!target) continue;
    hits.push({ url: target, title: clean(a.text, 140), snippet: clean(el.querySelector(".result__snippet")?.text, 240) || null, position: hits.length + 1 });
  }
  return hits;
}

// ── Putting it together ──────────────────────────────────────────────────────────────────────────────────────────

export async function discoverCompetitors(input: DiscoveryInput, deps: DiscoveryDeps = {}): Promise<DiscoveryResult> {
  const get = deps.get ?? fixedHostGet;
  const sleep = deps.sleep ?? defaultSleep;
  const own = hostOf(input.ownWebsite);
  const exclude = new Set([own, ...(input.alreadyComparing ?? []).map(hostOf)].filter((h): h is string => Boolean(h)));
  const result: DiscoveryResult = {
    candidates: [], queries: { search: [], placeQuery: null, osmKind: null }, sourceStatus: [], attribution: [],
    limits: [
      "These are businesses that appeared in a public web search or a map listing for a similar kind of business near you. That's a starting point, not proof they compete with you.",
      "We haven't read their sites yet, and we have no traffic, ranking or keyword figures for them.",
      "Nothing here is saved until you choose which ones to compare.",
    ],
  };
  const place = clean(input.serviceArea, 100);
  if (!place || input.services.length === 0) {
    result.sourceStatus.push({ source: "web_search", status: "skipped", found: 0, note: place ? "No confirmed or suggested services to search for yet." : "Add your service area first: without a place there's nothing local to find." });
    return result;
  }

  const found = new Map<string, Candidate>();
  const add = (url: string, name: string | null, source: DiscoverySource, weight: number) => {
    const origin = originOf(url);
    const host = hostOf(url);
    if (!origin || !host || exclude.has(host) || NOT_COMPETITORS.test(host) || PUBLIC_SECTOR.test(host) || host.includes("localhost")) return;
    const c = found.get(host) ?? { host, url: origin, name: null, sources: [], evidence_class: "inferred" as const, basis: "", score: 0 };
    if (!c.sources.some((s) => s.kind === source.kind && s.url === source.url)) c.sources.push(source);
    c.name = c.name ?? name;
    c.score += weight;
    found.set(host, c);
  };

  // 1. OpenStreetMap: only when the services map to a kind OSM tags reliably.
  const kind = input.services.map((s) => OSM_KINDS.find((k) => k.match.test(s))).find(Boolean) ?? null;
  result.queries.osmKind = kind?.label ?? null;
  if (!kind) {
    result.sourceStatus.push({ source: "openstreetmap", status: "skipped", found: 0, note: "We don't have a reliable map category for this kind of business, so only web search was used." });
  } else {
    try {
      result.queries.placeQuery = place;
      const at = await geocode(place, get);
      if (!at) {
        result.sourceStatus.push({ source: "openstreetmap", status: "none", found: 0, note: `We couldn't place "${place}" on the map.` });
      } else {
        await sleep(1_100); // the usage policy: about one request a second
        const rows = (await osmBusinesses(at, kind.tag, get)).sort((a, b) => a.km - b.km);
        let n = 0;
        for (const { element, km: d } of rows) {
          const website = element.tags?.website ?? element.tags?.["contact:website"];
          if (!website) continue;
          const before = found.size;
          add(website, clean(element.tags?.name, 100) || null, {
            kind: "openstreetmap", url: `https://www.openstreetmap.org/${element.type ?? "node"}/${element.id ?? ""}`,
            title: clean(element.tags?.name, 100) || "Unnamed listing", snippet: `Listed on the map as ${kind.label.replace(/s$/, "")}`, detail: `${d < 10 ? d.toFixed(1) : Math.round(d)} km from ${at.label.split(",")[0]}`,
          }, 2 + (d < 10 ? 1 : 0));
          if (found.size > before) n += 1;
        }
        result.attribution.push(OSM_ATTRIBUTION);
        result.sourceStatus.push({ source: "openstreetmap", status: n ? "ok" : "none", found: n, note: n ? null : "No nearby listings with a website." });
      }
    } catch {
      result.sourceStatus.push({ source: "openstreetmap", status: "failed", found: 0, note: "The map service didn't answer. Try again later." });
    }
  }

  // 2. Web search: one or two short queries.
  const queries = input.webSearch === false ? [] : searchQueries(input.services, place);
  result.queries.search = queries;
  if (input.webSearch === false) {
    result.sourceStatus.push({ source: "web_search", status: "skipped", found: 0, note: "Web search is switched off, so only map listings were used." });
  } else if (queries.length === 0) {
    result.sourceStatus.push({ source: "web_search", status: "skipped", found: 0, note: "The services we know are too vague to search for." });
  } else {
    let n = 0;
    let failed = 0;
    let slowedDown = false;
    // DuckDuckGo answers an automated request it dislikes with a 200/202 "anomaly" page and no results. Wait longer and try once more.
    const search = async (q: string): Promise<SearchHit[]> => {
      const url = `https://${HOSTS.search}/html/?q=${encodeURIComponent(q)}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const html = await get(url);
        const hits = parseSearchResults(html);
        if (hits.length || !/anomaly/i.test(html)) return hits;
        slowedDown = true;
        await sleep(6_000);
      }
      throw new Error("rate_limited");
    };
    for (const q of queries) {
      try {
        await sleep(1_500);
        const hits = await search(q);
        for (const h of hits.slice(0, 12)) {
          const before = found.size;
          add(h.url, null, { kind: "web_search", url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`, title: h.title, snippet: h.snippet, detail: `Result ${h.position} for “${q}”` }, h.position <= 5 ? 1.5 : 1);
          if (found.size > before) n += 1;
        }
      } catch { failed += 1; }
    }
    result.sourceStatus.push({ source: "web_search", status: failed === queries.length ? "failed" : n ? "ok" : "none", found: n, note: failed === queries.length ? (slowedDown ? "The search service asked us to slow down. Try again in a few minutes." : "The search service didn't answer. Try again later.") : n ? null : "Nothing usable came back." });
  }

  const ranked = [...found.values()].map((c) => {
    const kinds = new Set(c.sources.map((s) => s.kind));
    // Appearing in BOTH a map listing and a search is the strongest signal we have.
    const score = c.score + (kinds.size > 1 ? 2 : 0);
    const basis = c.sources.map((s) => (s.kind === "openstreetmap" ? `Listed on OpenStreetMap (${s.detail})` : `${s.detail} in a public web search`)).join("; ");
    return { ...c, score, basis };
  }).sort((a, b) => b.score - a.score || a.host.localeCompare(b.host));
  result.candidates = ranked.slice(0, 8);
  return result;
}
