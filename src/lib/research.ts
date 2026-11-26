/**
 * Market research from public pages (no model): what a business's homepage visibly shows, so the owner can see
 * where the sites they named do something theirs doesn't. Every signal is observed on the public homepage
 * (evidence class "verified" as observed); "mentions" means the words appear on the page, not that the claim is true.
 * Pure functions: no network, safe to run anywhere.
 */
import type { PageFacts } from "@/lib/server/site-scan";

export const SIGNAL_KEYS = ["phone", "clickToCall", "serviceArea", "reviews", "pricing", "structuredData"] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export interface SiteSignals {
  phone: boolean;
  clickToCall: boolean;
  serviceArea: boolean;
  reviews: boolean;
  pricing: boolean;
  structuredData: boolean;
  title: string | null;
  wordCount: number;
  navLinks: number;
}

export const SIGNAL_LABEL: Record<SignalKey, { shows: string; gap: string }> = {
  phone: { shows: "shows a phone number", gap: "a phone number on the homepage" },
  clickToCall: { shows: "has a tap-to-call link", gap: "a tap-to-call phone link" },
  serviceArea: { shows: "says where it works", gap: "a line saying where you work" },
  reviews: { shows: "mentions reviews or testimonials", gap: "reviews or testimonials" },
  pricing: { shows: "mentions prices or a free quote", gap: "prices or a free-quote offer" },
  structuredData: { shows: "gives search engines its business details", gap: "business details in the page's search markup" },
};

const AREA = /\b(serving|service areas?|areas? we serve|we serve|proudly serv\w+)\b/i;
const REVIEWS = /\b(reviews?|testimonials?|rated|\d(\.\d)? stars?)\b/i;
const PRICING = /\$\s?\d|\b(pricing|prices|free (estimates?|quotes?))\b/i;

export function siteSignals(home: PageFacts): SiteSignals {
  const text = home.text;
  return {
    phone: home.telLinks.length > 0 || home.phoneInText !== null,
    clickToCall: home.telLinks.length > 0,
    serviceArea: AREA.test(text),
    reviews: REVIEWS.test(text),
    pricing: PRICING.test(text),
    structuredData: home.structured !== null,
    title: home.title,
    wordCount: home.wordCount,
    navLinks: Math.min(home.internalLinkTexts.length, 99),
  };
}

/** Reads stored signals defensively (the database only checks that it is an object). */
export function readSignals(value: unknown): SiteSignals | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const out = { title: typeof v.title === "string" ? v.title : null, wordCount: Number(v.wordCount) || 0, navLinks: Number(v.navLinks) || 0 } as SiteSignals;
  for (const k of SIGNAL_KEYS) out[k] = v[k] === true;
  return out;
}

export interface ComparisonRow {
  key: SignalKey;
  yours: boolean;
  /** Hosts of the compared sites that show it. */
  showing: string[];
  compared: number;
  /** They show it, you don't. */
  gap: boolean;
}

export function compareSignals(own: SiteSignals | null, competitors: { host: string; signals: SiteSignals }[]): ComparisonRow[] {
  if (!own) return [];
  return SIGNAL_KEYS.map((key) => {
    const showing = competitors.filter((c) => c.signals[key]).map((c) => c.host);
    return { key, yours: own[key], showing, compared: competitors.length, gap: !own[key] && showing.length > 0 };
  });
}
