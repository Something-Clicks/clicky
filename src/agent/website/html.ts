import { injectionSignals } from '../security/untrusted';

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©' };
export const decode = (s: string): string =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
const strip = (s: string): string => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag: string, name: string): string | undefined => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : undefined;
};

export interface ParsedHtml {
  title?: string; metaDescription?: string; canonical?: string; robotsMeta?: string; lang?: string; viewport: boolean;
  h1: string[]; h2: string[]; h3: string[];
  links: { href: string; text: string; internal: boolean }[];
  navLinks: string[];
  images: { total: number; missingAlt: number };
  jsonLdTypes: string[]; ctas: string[]; formCount: number; phones: string[]; emails: string[];
  text: string; wordCount: number; scriptCount: number; possiblyJsRendered: boolean; injectionSignals: string[];
}

const CTA_RE = /\b(get (a |your )?(free )?(quote|started|estimate)|request|book|schedule|call (us|now)|contact( us)?|start|try|sign up|subscribe|buy|shop|order|download|learn more|free (consultation|trial|quote)|talk to|reserve|apply)\b/i;

export function parseHtml(html: string, baseUrl: string): ParsedHtml {
  const base = new URL(baseUrl);
  const jsonLdTypes: string[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === 'object') {
          const o = n as Record<string, unknown>;
          if (o['@type']) jsonLdTypes.push(...[o['@type']].flat().map(String));
          Object.values(o).forEach(walk);
        }
      };
      walk(JSON.parse(m[1]!));
    } catch { /* malformed JSON-LD is itself an observation but not fatal */ }
  }
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ');

  const metas = [...clean.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (name: string) => { const t = metas.find((x) => (attr(x, 'name') ?? attr(x, 'property'))?.toLowerCase() === name); return t ? attr(t, 'content') : undefined; };
  const linkTags = [...clean.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const canonical = linkTags.find((t) => attr(t, 'rel')?.toLowerCase() === 'canonical');
  const heads = (n: number) => [...clean.matchAll(new RegExp(`<h${n}\\b[^>]*>([\\s\\S]*?)</h${n}>`, 'gi'))].map((m) => strip(m[1]!)).filter(Boolean);

  const toLink = (tag: string, inner: string) => {
    const href = attr(tag, 'href');
    if (!href || /^(javascript:|#|mailto:|tel:|data:)/i.test(href)) return null;
    try { const u = new URL(href, base); u.hash = ''; return { href: u.toString(), text: strip(inner).slice(0, 120), internal: u.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '') }; } catch { return null; }
  };
  const links = [...clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => toLink(m[0]!, m[2]!)).filter((x): x is NonNullable<typeof x> => !!x);
  const navHtml = [...clean.matchAll(/<(nav|header)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]).join(' ');
  const navLinks = [...navHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => toLink(m[0]!, m[2]!)).filter((x): x is NonNullable<typeof x> => !!x && x.internal).map((l) => l.href);

  const imgs = [...clean.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const missingAlt = imgs.filter((t) => { const a = attr(t, 'alt'); return a === undefined || a.trim() === ''; }).length;

  const ctaCandidates = [
    ...[...clean.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => strip(m[1]!)),
    ...[...clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter((m) => /class\s*=\s*["'][^"']*(btn|button|cta)/i.test(m[1]!) || CTA_RE.test(strip(m[2]!))).map((m) => strip(m[2]!)),
    ...[...clean.matchAll(/<input\b[^>]*type=["']submit["'][^>]*>/gi)].map((m) => attr(m[0]!, 'value') ?? ''),
  ].filter((t) => t && t.split(' ').length <= 8 && CTA_RE.test(t));

  const bodyHtml = (clean.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? clean).replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = strip(bodyHtml.replace(/<\/(p|div|li|h\d|section|tr|br)>/gi, '. '));
  const wordCount = text ? text.split(/\s+/).length : 0;
  const phones = [...new Set([...clean.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => decode(m[1]!).trim()))];
  const emails = [...new Set([...clean.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => decode(m[1]!).trim()))];
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0];
  const rootOnly = /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html);

  return {
    title: strip(clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') || undefined,
    metaDescription: meta('description'), canonical: canonical ? attr(canonical, 'href') : undefined,
    robotsMeta: meta('robots'), lang: htmlTag ? attr(htmlTag, 'lang') : undefined, viewport: !!meta('viewport'),
    h1: heads(1), h2: heads(2), h3: heads(3), links, navLinks: [...new Set(navLinks)], images: { total: imgs.length, missingAlt },
    jsonLdTypes: [...new Set(jsonLdTypes)], ctas: [...new Set(ctaCandidates)].slice(0, 12),
    formCount: (clean.match(/<form\b/gi) ?? []).length, phones, emails,
    text: text.slice(0, 20_000), wordCount, scriptCount,
    possiblyJsRendered: rootOnly || (wordCount < 40 && scriptCount >= 3),
    injectionSignals: injectionSignals(text),
  };
}
