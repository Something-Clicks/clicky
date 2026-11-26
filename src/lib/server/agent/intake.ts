import { WORKFLOWS, type WorkflowKind } from "./workflows";

/**
 * Understanding a customer request (§12.1 "receive customer requests, identify the task type").
 *
 * Fixed rules, not a language model: the request text is matched against phrases for each kind of work, and the kind with
 * the strongest match wins. When nothing matches, or two kinds match equally, the agent does not guess: it asks the
 * customer to choose (§14 "ask for clarification when necessary"). The text is untrusted data: it only selects among the
 * six workflows and is never executed or passed on as instructions. Web addresses in it are extracted for research.
 *
 * When a model is connected later, it can replace `scoreKinds` behind the same result type; workflows do not change.
 */
export interface RequestUnderstanding {
  kind: WorkflowKind | null;
  confidence: "high" | "medium" | "low";
  /** The phrases that decided it (shown in the workflow record). */
  matched: string[];
  /** Kinds to offer when the request is unclear. */
  options: WorkflowKind[];
  /** Website addresses found in the request (for comparing with other sites). */
  urls: string[];
  method: "rules";
}

const PATTERNS: Record<WorkflowKind, { re: RegExp; weight: number }[]> = {
  homepage_headline: [
    { re: /\bhead(line|ing)s?\b/, weight: 3 },
    { re: /\bhome ?page\b/, weight: 1 },
    { re: /\b(tag ?line|slogan|hero|above the fold|first thing (people|visitors) see)\b/, weight: 2 },
    { re: /\b(rewrite|reword|improve|better|stronger|punchier)\b.*\b(head(line|ing)|title|tag ?line)\b/, weight: 2 },
  ],
  competitor_research: [
    { re: /\bcompetit(or|ors|ion|ive)\b/, weight: 3 },
    { re: /\b(rival|rivals|other (businesses|companies|sites|websites))\b/, weight: 2 },
    { re: /\b(compare|comparison|versus|vs\.?)\b/, weight: 2 },
    { re: /\b(market research|who else|stack up)\b/, weight: 2 },
  ],
  marketing_plan: [
    { re: /\b(marketing )?(plan|strategy|roadmap)\b/, weight: 3 },
    { re: /\b(priorit(y|ies|ize|ise)|what (should|do) (i|we) (do|focus on|work on)|where (do|should) (i|we) start|next steps?)\b/, weight: 2 },
    { re: /\b(objectives?|goals?)\b/, weight: 1 },
  ],
  promotional_campaign: [
    { re: /\b(campaign|promotion|promote|promo)\b/, weight: 3 },
    { re: /\b(special offer|offer|sale|discount|launch|announce)\b/, weight: 2 },
    { re: /\b(reviews?|google business profile|gbp)\b/, weight: 1 },
  ],
  results_review: [
    { re: /\b(results?|performance|perform(ed|ing)?)\b/, weight: 3 },
    { re: /\b(working|worked|did it work|is it working|measure|metrics?|numbers|report|reporting)\b/, weight: 2 },
    { re: /\b(traffic|visits|calls|leads|enquir(y|ies)|inquir(y|ies)|clicks|impressions)\b/, weight: 2 },
  ],
  website_review: [
    { re: /\b(check|audit|review|scan|analy[sz]e|look at)\b.*\b(site|website|web site|pages?)\b/, weight: 3 },
    { re: /\b(what('s| is) wrong|fix|issues?|problems?)\b/, weight: 1 },
    { re: /\b(seo|search engine|google ranking|get found)\b/, weight: 2 },
  ],
};

const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s,;]*)?)/gi;

/** Website addresses written in the request, deduplicated, at most 5. Validation happens later (safe-fetch). */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const u = m[1]!.replace(/[.)\]]+$/, "");
    // Plain words with a dot inside a sentence ("e.g.") are not addresses.
    if (!/[a-z0-9-]+\.[a-z]{2,}/i.test(u) || /^(e\.g|i\.e)$/i.test(u)) continue;
    if (!out.some((o) => o.toLowerCase() === u.toLowerCase())) out.push(u);
    if (out.length === 5) break;
  }
  return out;
}

export function scoreKinds(text: string): { kind: WorkflowKind; score: number; matched: string[] }[] {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  return (Object.keys(PATTERNS) as WorkflowKind[])
    .map((kind) => {
      const matched: string[] = [];
      let score = 0;
      for (const p of PATTERNS[kind]) {
        const m = t.match(p.re);
        if (m) { score += p.weight; matched.push(m[0].trim()); }
      }
      return { kind, score, matched };
    })
    .sort((a, b) => b.score - a.score);
}

export const MAX_REQUEST_CHARS = 1000;

export function understandRequest(raw: string): RequestUnderstanding {
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_REQUEST_CHARS);
  const urls = extractUrls(text);
  const ranked = scoreKinds(text);
  const [first, second] = ranked;
  // Named websites with no other signal: the customer wants to compare with them.
  if (first!.score === 0 && urls.length) {
    return { kind: "competitor_research", confidence: "medium", matched: ["website addresses"], options: [], urls, method: "rules" };
  }
  if (first!.score === 0) {
    return { kind: null, confidence: "low", matched: [], options: ["website_review", "marketing_plan", "homepage_headline", "competitor_research", "promotional_campaign", "results_review"], urls, method: "rules" };
  }
  if (second && second.score === first!.score) {
    return { kind: null, confidence: "low", matched: [...first!.matched, ...second.matched], options: [first!.kind, second.kind], urls, method: "rules" };
  }
  const margin = first!.score - (second?.score ?? 0);
  return {
    kind: first!.kind,
    confidence: first!.score >= 3 && margin >= 2 ? "high" : "medium",
    matched: first!.matched,
    options: [],
    urls,
    method: "rules",
  };
}

/** Plain words for each kind, for the "did you mean" choice. */
export const REQUEST_CHOICES: Record<WorkflowKind, string> = {
  website_review: "Check my website",
  homepage_headline: "Improve my homepage headline",
  competitor_research: "Compare with other businesses",
  marketing_plan: "Make a plan for what to do next",
  promotional_campaign: "Prepare a step-by-step promotion",
  results_review: "Review my results",
};

export const requestLabel = (k: WorkflowKind) => WORKFLOWS[k].label;
