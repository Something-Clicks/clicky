import { z } from "zod";

import type { KnownFact } from "./business-intelligence";
import { hasConcreteAction } from "@/lib/agent-quality";
import { claimProblemIn, findQuote, genericPhraseIn, jsonForPrompt, pagesForModel, UNTRUSTED_CONTENT_RULE, unsupportedNumbers, type SourcePage } from "../grounding";
import { generateStructured, type ModelProvider, type ModelUsage } from "../provider";

/**
 * Marketing Analysis, model-assisted part (§5.2, §6): judgments fixed checks cannot make, about
 * messaging (does the homepage say what the business does, for whom, why choose it), conversion
 * (is the next step clear) and content (are key services covered).
 *
 * The model proposes findings; Something Clicks keeps only those that:
 *  - quote the page they are about (each quote found verbatim, saved as observed evidence);
 *  - follow the evidence classes (verified needs a quote; inferred needs a quote and a basis;
 *    estimated needs a basis; "unknown" is not a finding);
 *  - contain no figures absent from the source and no promises (rankings, guarantees, results);
 *  - do not repeat an issue the fixed checks already found.
 * Kept findings are saved with add_model_findings as Action Cards with origin "model".
 */

const Finding = z
  .object({
    slug: z.string().describe("short snake_case id, e.g. headline_unclear"),
    category: z.enum(["messaging", "conversion", "content"]),
    title: z.string().describe("under 70 characters, starts with a verb"),
    what_was_observed: z.string(),
    quotes: z.array(z.object({ page_key: z.string(), quote: z.string() }).strict()),
    evidence_class: z.enum(["verified", "inferred", "estimated"]),
    basis: z.string().describe("How the finding follows from the quotes. Required for inferred and estimated."),
    why_it_matters: z.string(),
    recommended_action: z.string(),
    expected_benefit: z.string(),
    impact: z.enum(["high", "medium", "low"]),
    confidence: z.enum(["high", "medium", "low"]),
    draftable: z.enum(["homepage_copy", "none"]).describe("homepage_copy when better homepage text would fix it"),
  })
  .strict();

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** True when the finding only repeats what the page says (or labels like "Title:" the fixed checks already report). */
export function restatesEvidence(f: Pick<ModelFindingOutput, "title" | "what_was_observed" | "quotes">): boolean {
  const title = norm(f.title);
  if (!title) return true;
  // A title that starts with an evidence label ("Title: ...") is the page's own text, never a finding.
  if (/^\s*(page title|title|meta description|meta|heading|h1)\s*:/i.test(f.title)) return true;
  if (/^(title|meta description|meta|page title|heading)\b/.test(title) && f.quotes.some((q) => title.includes(norm(q.quote).slice(0, 20)))) return true;
  if (title === norm(f.what_was_observed)) return true;
  // The title is (or is contained in) one of its own quotes: the "finding" is a quotation.
  return f.quotes.some((q) => {
    const quote = norm(q.quote);
    return quote.length >= 8 && (title === quote || quote.includes(title) || (title.includes(quote) && title.length - quote.length < 12));
  });
}

export const ModelFindingsSchema = z.object({ findings: z.array(Finding) }).strict();
export type ModelFindingOutput = z.infer<typeof Finding>;

const SYSTEM = `You are the Marketing Analysis capability of the Something Clicks Marketing Agent. You review a small business's website as a careful marketing advisor would, and report what is worth improving, with evidence.

${UNTRUSTED_CONTENT_RULE}

Look only for things fixed checks cannot judge:
- messaging: does the homepage clearly say what the business does, for whom, where, and why choose it?
- conversion: is the next step clear and easy (call, book, get a quote)? Are there obstacles?
- content: are the main services explained? Is important information missing or inconsistent?
Do not report: page titles, meta descriptions, mobile settings, HTTPS, speed, image descriptions, tap-to-call links, thin pages or service area (fixed checks already cover them, listed in <already_found>).

Rules:
- Every finding quotes the page it is about: copy exact words (page_key = the key attribute). Quote what is there; if the problem is something missing, quote the nearby text that shows it is missing.
- evidence_class: "verified" when the quote shows the problem directly; "inferred" when it is your interpretation (explain in basis); "estimated" only with stated assumptions.
- Never invent figures, rankings, traffic, conversion rates, revenue or results. Never promise outcomes. Benefits describe what becomes clearer or easier.
- A business detail marked disputed:true has sources that disagree and the owner has not decided: do not treat it as true.
- Plain, friendly words for an owner with no marketing background. One or two sentences per field.
- Meaningful business problems over cosmetic ones. At most 5 findings; none if the site is already clear.
- Use what <business> says the business is, but judge only what the website shows.`;

export interface ModelFindings {
  evidence: { key: string; url: string; excerpt: string; observation: string }[];
  cards: Record<string, unknown>[];
  rejected: { title: string; reason: string }[];
  model: string;
  provider: string;
  usage: ModelUsage;
}

export function groundFindings(raw: ModelFindingOutput[], pages: SourcePage[], alreadyFound: string[]): Omit<ModelFindings, "model" | "provider" | "usage"> {
  const evidence: ModelFindings["evidence"] = [];
  const cards: ModelFindings["cards"] = [];
  const rejected: ModelFindings["rejected"] = [];
  const seenAdvice = new Set<string>();
  const source = pages.map((p) => p.text).join("\n");
  const slugs = new Set<string>();
  const already = new Set(alreadyFound.map((t) => t.toLowerCase()));
  for (const f of raw.slice(0, 5)) {
    const reject = (reason: string) => rejected.push({ title: f.title, reason });
    const texts = [f.title, f.what_was_observed, f.why_it_matters, f.recommended_action, f.expected_benefit];
    const problem = texts.map(claimProblemIn).find(Boolean);
    if (problem) {
      reject(problem);
      continue;
    }
    if (texts.some((t) => unsupportedNumbers(t, source).length)) {
      reject("figure_not_in_source");
      continue;
    }
    if (texts.some(genericPhraseIn)) {
      reject("generic_advice");
      continue;
    }
    if (already.has(f.title.toLowerCase())) {
      reject("duplicate_of_check");
      continue;
    }
    // A finding is a judgement about the page, not the page's own words. Reject one whose title just restates its quote or its
    // own observation, one about the page title or description (fixed checks own those), or the same boilerplate repeated.
    if (restatesEvidence(f)) {
      reject("restates_evidence");
      continue;
    }

    const found = f.quotes.map((q) => ({ q, page: findQuote(pages, q.page_key, q.quote) })).filter((x) => x.page).slice(0, 3);
    const basis = f.basis.trim().slice(0, 1000);
    if ((f.evidence_class === "verified" || f.evidence_class === "inferred") && !found.length) {
      reject("quote_not_found");
      continue;
    }
    if ((f.evidence_class === "inferred" || f.evidence_class === "estimated") && !basis) {
      reject("basis_missing");
      continue;
    }
    // A recommendation says what to change. "The homepage should be reviewed" is not one.
    if (!hasConcreteAction(f.recommended_action)) {
      reject("not_actionable");
      continue;
    }
    // Boilerplate repeated across findings (the same reason and action under different titles) is one finding at most.
    const advice = norm(`${f.why_it_matters} ${f.recommended_action}`);
    if (seenAdvice.has(advice)) {
      reject("repeated_text");
      continue;
    }
    seenAdvice.add(advice);
    const slug = (f.slug.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "finding").slice(0, 50);
    if (slugs.has(slug)) continue;
    slugs.add(slug);
    const keys = found.map(({ q, page }, i) => {
      const key = `${slug}_${i}`;
      evidence.push({ key, url: page!.url, excerpt: q.quote.trim().slice(0, 1000), observation: f.what_was_observed.slice(0, 1000) });
      return key;
    });
    cards.push({
      check_key: `model.${slug}`,
      title: f.title.slice(0, 160),
      explanation: f.what_was_observed.slice(0, 1000),
      why_it_matters: f.why_it_matters.slice(0, 1000),
      recommended_action: f.recommended_action.slice(0, 1000),
      expected_benefit: f.expected_benefit.slice(0, 600),
      impact_priority: f.impact,
      confidence: f.confidence,
      evidence_class: f.evidence_class,
      evidence_basis: f.evidence_class === "verified" ? null : basis,
      ai_capable: f.draftable === "homepage_copy",
      execution_type: f.draftable === "homepage_copy" ? "page_copy" : "manual",
      evidence_keys: keys,
    });
  }
  return { evidence, cards, rejected };
}

export async function analyzeWithModel(
  provider: ModelProvider,
  input: { pages: SourcePage[]; businessName: string; known: KnownFact[]; alreadyFound: string[]; deadlineAt?: number },
): Promise<ModelFindings> {
  const business = { name: input.businessName, details: input.known.map((k) => ({ [k.field]: k.value, confirmed_by_owner: k.confirmed, ...(k.disputed ? { disputed: true } : {}) })) };
  const r = await generateStructured(
    {
      task: "marketing_analysis.review",
      system: SYSTEM,
      input: `<business>${jsonForPrompt(business)}</business>\n<already_found>${jsonForPrompt(input.alreadyFound)}</already_found>\n${pagesForModel(input.pages)}`,
      schema: ModelFindingsSchema,
      maxOutputTokens: 5000,
      deadlineAt: input.deadlineAt,
    },
    provider,
  );
  return { ...groundFindings(r.output.findings, input.pages, input.alreadyFound), model: r.model, provider: r.provider, usage: r.usage };
}
