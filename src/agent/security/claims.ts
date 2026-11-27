import { normalizeText } from '../core/util';
import type { ClaimFlag } from '../domain/models';

interface Pattern { type: string; severity: ClaimFlag['severity']; re: RegExp; message: string }

const PATTERNS: Pattern[] = [
  { type: 'testimonial', severity: 'high', re: /[“"][^”"]{25,}[”"]\s*[—–-]\s*[A-Z][a-z]+/g, message: 'Looks like a customer testimonial. Testimonials must be supplied by the customer, never generated.' },
  { type: 'testimonial', severity: 'high', re: /\b(what our (customers|clients) (say|are saying)|five[- ]star review|rated \d(\.\d)? ?(\/|out of) ?5)\b/gi, message: 'Reviews/ratings must be real and supplied.' },
  { type: 'award', severity: 'high', re: /\b(award[- ]winning|voted (the )?best|best of [A-Z]\w+|winner of)\b/gi, message: 'Awards must be real and supplied.' },
  { type: 'credential', severity: 'high', re: /\b(certified|accredited|licensed|bonded|insured|bbb[- ]accredited)\b/gi, message: 'Certifications/licences must be supplied by the customer.' },
  { type: 'guarantee', severity: 'high', re: /\b(guarantee[ds]?|money[- ]back|risk[- ]free|100% satisf\w+)\b/gi, message: 'Guarantees are commitments the customer must approve.' },
  { type: 'statistic', severity: 'high', re: /\b\d+(\.\d+)?\s?%/g, message: 'Percentage claim without a supplied source.' },
  { type: 'statistic', severity: 'high', re: /\b\d[\d,]*\+?\s+(happy |satisfied )?(customers|clients|businesses|projects|homes|patients)\b/gi, message: 'Customer-count claim without a supplied source.' },
  { type: 'statistic', severity: 'high', re: /\b(\d+\+?|over \d+|more than \d+)\s+years\b/gi, message: 'Years-in-business claim without a supplied source.' },
  { type: 'statistic', severity: 'medium', re: /\$\s?\d[\d,]*(\.\d+)?/g, message: 'Price/dollar figure not found in supplied information.' },
  { type: 'ranking', severity: 'high', re: /(#\s?1\b|\bnumber (one|1)\b|\bpage (one|1) of google\b|\branks? #?\d+\b)/gi, message: 'Ranking claim cannot be supported.' },
  { type: 'superlative', severity: 'medium', re: /\b(the best|best in (the )?\w+|leading|top[- ]rated|#1|unmatched|unrivaled)\b/gi, message: 'Unsupported superlative.' },
  { type: 'outcome_promise', severity: 'high', re: /\b(double|triple|10x)\s+(your\s+)?(revenue|sales|leads|traffic)|guaranteed results\b/gi, message: 'Outcome promise cannot be supported.' },
];

const NEGATED = /(\b(no|not|never|cannot|nor|neither|without)\b|n['’]t\b)[^.!?]*$/i;

/**
 * Detects claims a model must not fabricate. A claim is "supported" only if its literal text
 * appears in the supplied facts corpus (profile facts, retrieved website text, customer input).
 */
export function detectUnsupportedClaims(text: string, supportedCorpus: string, blockKey?: string): ClaimFlag[] {
  const corpus = normalizeText(supportedCorpus);
  const flags: ClaimFlag[] = [];
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    for (const m of text.matchAll(new RegExp(p.re.source, p.re.flags))) {
      const lit = normalizeText(m[0]);
      if (corpus.includes(lit)) continue;
      // "No one can guarantee rankings" disclaims a guarantee; it does not make one. Only the plain-negation case is exempted.
      if (p.type === 'guarantee' && /guarantee/i.test(m[0]) && NEGATED.test(text.slice(Math.max(0, (m.index ?? 0) - 45), m.index ?? 0))) continue;
      const k = `${p.type}:${lit}`;
      if (seen.has(k)) continue;
      seen.add(k);
      flags.push({ type: p.type, severity: p.severity, excerpt: m[0], message: p.message, blockKey });
    }
  }
  return flags;
}

export function checkBrandTerms(text: string, avoid: string[], blockKey?: string): ClaimFlag[] {
  const t = normalizeText(text);
  return avoid
    .filter((w) => w.trim() && new RegExp(`\\b${w.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))
    .map((w) => ({ type: 'brand_avoid_term', severity: 'medium' as const, excerpt: w, message: `Uses a term the brand asked to avoid: "${w}".`, blockKey }));
}
