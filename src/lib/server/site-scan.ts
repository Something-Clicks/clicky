import "server-only";

import { parse, type HTMLElement } from "node-html-parser";

import type { FetchedPage } from "./safe-fetch";
import { extractStructuredBusiness, type StructuredBusiness } from "./structured-data";

export interface PageFacts {
  url: string;
  status: number;
  title: string | null;
  metaDescription: string | null;
  h1s: string[];
  headings: string[];
  text: string;
  wordCount: number;
  hasViewport: boolean;
  telLinks: string[];
  /** Email addresses from mailto: links. */
  mailtoLinks: string[];
  phoneInText: string | null;
  imagesTotal: number;
  imagesMissingAlt: number;
  lang: string | null;
  internalLinks: string[];
  /** Visible text of same-site links (navigation labels), by URL. */
  internalLinkTexts: { url: string; text: string }[];
  truncated: boolean;
  /** What the page says about its business in schema.org markup, if anything (deterministic parse). */
  structured: StructuredBusiness | null;
}

export interface SiteScan {
  homepage: PageFacts;
  pages: PageFacts[];
  failures: { url: string; reason: string }[];
}

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();
const PHONE = /(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;

export function extractFacts(page: FetchedPage): PageFacts {
  const root = parse(page.body, { blockTextElements: { script: false, style: false, noscript: false } });
  const base = new URL(page.url);
  const meta = (name: string) =>
    clean(root.querySelector(`meta[name="${name}"]`)?.getAttribute("content")) || null;

  // Machine-readable markup (schema.org) comes from the raw HTML; the visible text below excludes scripts.
  const structured = extractStructuredBusiness(page.body);
  const body = root.querySelector("body") ?? root;
  body.querySelectorAll("script,style,noscript,svg").forEach((el: HTMLElement) => el.remove());
  const text = clean(body.textContent);

  const anchors = root.querySelectorAll("a[href]");
  const links = anchors.map((a) => a.getAttribute("href") ?? "");
  const internal = new Set<string>();
  const linkTexts = new Map<string, string>();
  anchors.forEach((a, i) => {
    try {
      const u = new URL(links[i]!, base);
      if (u.host === base.host && /^https?:$/.test(u.protocol)) {
        u.hash = "";
        if (!/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?)$/i.test(u.pathname)) {
          internal.add(u.toString());
          const label = clean(a.textContent);
          if (label && label.length <= 80 && !linkTexts.has(u.toString())) linkTexts.set(u.toString(), label);
        }
      }
    } catch {
      // ignore malformed links
    }
  });
  const images = root.querySelectorAll("img");

  return {
    url: page.url,
    status: page.status,
    title: clean(root.querySelector("title")?.textContent) || null,
    metaDescription: meta("description"),
    h1s: root.querySelectorAll("h1").map((h) => clean(h.textContent)).filter(Boolean),
    headings: root.querySelectorAll("h2,h3").map((h) => clean(h.textContent)).filter(Boolean).slice(0, 20),
    text: text.slice(0, 6000),
    wordCount: text ? text.split(" ").length : 0,
    hasViewport: Boolean(root.querySelector('meta[name="viewport"]')),
    telLinks: links.filter((h) => h.toLowerCase().startsWith("tel:")),
    mailtoLinks: [...new Set(links.filter((h) => h.toLowerCase().startsWith("mailto:")).map((h) => decodeURIComponent(h.slice(7).split("?")[0]!).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))].slice(0, 5),
    phoneInText: text.match(PHONE)?.[0] ?? null,
    imagesTotal: images.length,
    imagesMissingAlt: images.filter((img) => !img.hasAttribute("alt")).length,
    lang: root.querySelector("html")?.getAttribute("lang") ?? null,
    internalLinks: [...internal].slice(0, 200),
    internalLinkTexts: [...linkTexts].slice(0, 200).map(([url, text]) => ({ url, text })),
    truncated: page.truncated,
    structured,
  };
}

/** Pages a visitor is most likely to look for, in order. */
const PRIORITY = [/contact/i, /service/i, /about/i, /pricing|prices|rates/i, /location|area/i];

export function pickPages(home: PageFacts, limit = 4): string[] {
  const homeUrl = new URL(home.url);
  const candidates = home.internalLinks.filter((u) => {
    const p = new URL(u);
    return p.pathname !== homeUrl.pathname && p.pathname !== "/";
  });
  const scored = candidates.map((u) => {
    const i = PRIORITY.findIndex((re) => re.test(new URL(u).pathname));
    return { u, score: i === -1 ? 99 : i };
  });
  scored.sort((a, b) => a.score - b.score);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { u } of scored) {
    const key = new URL(u).pathname.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
    if (out.length === limit) break;
  }
  return out;
}

export async function scanSite(website: string, fetchPage: (url: string) => Promise<FetchedPage>): Promise<SiteScan> {
  const homepage = extractFacts(await fetchPage(website));
  const failures: SiteScan["failures"] = [];
  const pages: PageFacts[] = [];
  const targets = pickPages(homepage);
  const results = await Promise.allSettled(targets.map((u) => fetchPage(u)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.status < 400) pages.push(extractFacts(r.value));
    else failures.push({ url: targets[i]!, reason: r.status === "rejected" ? String(r.reason?.message ?? r.reason) : `HTTP ${r.value.status}` });
  });
  return { homepage, pages, failures };
}
