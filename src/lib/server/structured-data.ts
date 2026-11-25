/**
 * Website Intelligence: what a page says about its business in its own machine-readable markup (schema.org JSON-LD).
 * Deterministic parsing, no model. Every value is plain text copied from the markup, trimmed and length-limited;
 * nothing is inferred. A site without such markup simply yields null.
 */
export interface StructuredBusiness {
  name: string | null;
  telephone: string | null;
  email: string | null;
  address: string | null;
  areaServed: string[];
  priceRange: string | null;
  rating: { value: string; count: string | null } | null;
  services: string[];
}

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: Json): Json[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const text = (v: Json, max = 200): string | null => {
  const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
  const t = s.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const nameOf = (v: Json): string | null => (isObj(v) ? text(v.name) : text(v));

/** All JSON-LD nodes of a document, with @graph flattened. Invalid JSON is skipped. */
const LD_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Reads the raw HTML (the page parser used for the visible text drops script contents on purpose). */
function nodes(html: string): Record<string, Json>[] {
  const out: Record<string, Json>[] = [];
  const visit = (v: Json, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(v)) return v.slice(0, 50).forEach((x) => visit(x, depth + 1));
    if (!isObj(v)) return;
    out.push(v);
    if (v["@graph"]) visit(v["@graph"], depth + 1);
  };
  let count = 0;
  for (const m of html.matchAll(LD_SCRIPT)) {
    if (++count > 10) break;
    const raw = m[1] ?? "";
    if (raw.length > 200_000) continue;
    try {
      visit(JSON.parse(raw), 0);
    } catch {
      // not valid JSON: ignore
    }
  }
  return out;
}

const BUSINESSLIKE = /business|store|shop|service|contractor|plumber|electrician|restaurant|dentist|salon|clinic|organization|company|repair|cleaner|landscap|roofer|hvac|attorney|lawyer|accountant|agency/i;

export function extractStructuredBusiness(html: string): StructuredBusiness | null {
  const candidates = nodes(html).filter((n) => {
    const types = asArray(n["@type"]).map((t) => String(t));
    return types.some((t) => BUSINESSLIKE.test(t)) && text(n.name) !== null;
  });
  if (!candidates.length) return null;
  // The node that says the most about the business wins.
  const score = (n: Record<string, Json>) => ["telephone", "address", "areaServed", "aggregateRating", "hasOfferCatalog", "makesOffer", "priceRange"].filter((k) => n[k] !== undefined).length;
  const n = [...candidates].sort((a, b) => score(b) - score(a))[0]!;

  const addr = asArray(n.address)[0];
  const address = isObj(addr)
    ? [text(addr.streetAddress), text(addr.addressLocality), [text(addr.addressRegion), text(addr.postalCode)].filter(Boolean).join(" ") || null].filter(Boolean).join(", ") || null
    : text(addr);
  const areaServed = [...new Set(asArray(n.areaServed).map(nameOf).filter((s): s is string => Boolean(s)))].slice(0, 6);

  const r = isObj(n.aggregateRating) ? n.aggregateRating : null;
  const ratingValue = r ? text(r.ratingValue, 10) : null;
  const rating = r && ratingValue && /^\d+(\.\d+)?$/.test(ratingValue) ? { value: ratingValue, count: (() => { const c = text(r.reviewCount ?? r.ratingCount, 10); return c && /^\d+$/.test(c) ? c : null; })() } : null;

  const offered: string[] = [];
  const addOffer = (o: Json) => {
    if (!isObj(o)) return;
    const name = nameOf(o.itemOffered) ?? text(o.name);
    if (name) offered.push(name);
    asArray(o.itemListElement).forEach(addOffer);
  };
  asArray(n.makesOffer).forEach(addOffer);
  asArray(n.hasOfferCatalog).forEach(addOffer);
  const services = [...new Set(offered.map((s) => s.slice(0, 80)))].slice(0, 8);

  const result: StructuredBusiness = {
    name: text(n.name),
    telephone: text(n.telephone, 40),
    email: (() => { const e = text(n.email, 120)?.toLowerCase().replace(/^mailto:/, ""); return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null; })(),
    address,
    areaServed,
    priceRange: text(n.priceRange, 30),
    rating,
    services,
  };
  const hasAnything = result.telephone || result.email || result.address || result.areaServed.length || result.priceRange || result.rating || result.services.length;
  return hasAnything ? result : null;
}
