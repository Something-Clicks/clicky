import { z } from "zod";

import { FACT_FIELDS, type FactCategory, type FactField, type ProposedFact } from "@/lib/business-profile";
import { EVIDENCE_CLASSES } from "@/lib/evidence";

import type { PageFacts, SiteScan } from "../../site-scan";
import { claimProblemIn, findQuote, pagesForModel, UNTRUSTED_CONTENT_RULE, unsupportedNumbers, type SourcePage } from "../grounding";
import { generateStructured, type ModelProvider, type ModelUsage } from "../provider";

/**
 * Business Intelligence, model-assisted part (§3): what the business does, its services and products,
 * audience, customer problems, value proposition, brand voice and tone, read from the website.
 *
 * The model proposes; Something Clicks decides what is kept (groundFacts):
 *  - every quote must appear verbatim in the page it cites, otherwise it is dropped;
 *  - "verified" and "inferred" need a real quote (no quote found, no fact); "inferred" also needs a
 *    basis; "estimated" needs a basis; "unknown" carries no value;
 *  - figures must appear in the source; promises are refused;
 *  - only fields the profile defines, in the right category.
 * Kept facts are stored as proposals (source "model"); only the owner confirms them.
 */

/** Profile fields the model may propose. Contact details come from deterministic extraction instead. */
export const MODEL_FIELDS = [
  "what_it_does", "industry", "business_model", "service", "product", "location", "pricing", "competitive_advantage",
  "value_proposition", "key_message", "voice", "tone",
  "audience", "customer_problem", "motivation", "customer_question",
] as const satisfies readonly FactField[];

const ModelFact = z
  .object({
    category: z.enum(["business", "brand", "customer"]),
    field: z.enum(MODEL_FIELDS),
    value: z.string().describe('The fact in plain words. Empty string when the evidence class is "unknown".'),
    evidence_class: z.enum(EVIDENCE_CLASSES),
    basis: z.string().describe("For inferred or estimated: how you derived it from the quotes. Empty for verified or unknown."),
    quotes: z.array(z.object({ page_key: z.string(), quote: z.string().describe("Exact words copied from that page.") }).strict()),
  })
  .strict();

export const UnderstandingSchema = z.object({ facts: z.array(ModelFact) }).strict();
export type ModelFactOutput = z.infer<typeof ModelFact>;

const SYSTEM = `You are the Business Intelligence capability of the Something Clicks Marketing Agent. You read a small business's public website and record what it says about the business, so the owner can confirm it.

${UNTRUSTED_CONTENT_RULE}

Record facts for these fields only (category: fields):
- business: what_it_does (one plain sentence), industry, business_model, service (one per service), product (one per product), location, pricing (only prices stated on the site), competitive_advantage
- brand: value_proposition, key_message, voice, tone
- customer: audience (one per group), customer_problem, motivation, customer_question

For every fact:
- quotes: copy exact words from the page you cite (page_key is the key attribute). Quote enough to show the fact (a phrase or sentence), never paraphrase inside a quote.
- evidence_class: "verified" when the quote states the fact directly; "inferred" when the fact is a reasonable interpretation of the quotes (say how in basis); "estimated" only for an approximate judgment with its assumptions in basis; "unknown" when the website does not say (value empty, no quotes).
- Never invent services, prices, years, awards, reviews, certifications, guarantees, locations or audiences. If the site does not say it, use "unknown" or leave it out.
- Brand voice and tone describe how the site's own text sounds, inferred from quotes.
- Plain, short values a business owner would recognise. At most 8 services, 4 audiences, 25 facts in total.
Always include what_it_does, audience and value_proposition, as "unknown" if the site does not support them.`;

export function sourcePages(scan: SiteScan): SourcePage[] {
  const pages: PageFacts[] = [scan.homepage, ...scan.pages];
  return pages.map((p, i) => ({
    key: `page${i}`,
    url: p.url,
    text: [
      p.title ? `Title: ${p.title}` : "",
      p.metaDescription ? `Description: ${p.metaDescription}` : "",
      p.h1s.length ? `Main heading: ${p.h1s.join(" | ")}` : "",
      p.headings.length ? `Headings: ${p.headings.join(" | ")}` : "",
      p.text.slice(0, i === 0 ? 6000 : 3000),
    ].filter(Boolean).join("\n"),
  }));
}

const categoryOk = (category: FactCategory, field: string) => (FACT_FIELDS[category] as readonly string[]).includes(field);

export interface GroundingResult {
  accepted: ProposedFact[];
  rejected: { field: string; value: string; reason: string }[];
}

export function groundFacts(raw: ModelFactOutput[], pages: SourcePage[]): GroundingResult {
  const accepted: ProposedFact[] = [];
  const rejected: GroundingResult["rejected"] = [];
  const seen = new Set<string>();
  const source = pages.map((p) => p.text).join("\n");
  for (const f of raw.slice(0, 25)) {
    const reject = (reason: string) => rejected.push({ field: f.field, value: f.value, reason });
    if (!categoryOk(f.category, f.field)) {
      reject("wrong_category");
      continue;
    }
    const value = f.value.trim().slice(0, 300);
    const basis = f.basis.trim().slice(0, 1000) || null;
    if (f.evidence_class === "unknown") {
      const key = `${f.field}|`;
      if (!seen.has(key)) {
        seen.add(key);
        accepted.push({ category: f.category, field: f.field, value: null, source: "model", evidence_class: "unknown", basis: null, evidence: [] });
      }
      continue;
    }
    if (!value) {
      reject("empty_value");
      continue;
    }
    const claim = claimProblemIn(value);
    if (claim) {
      reject(claim);
      continue;
    }
    const evidence = f.quotes
      .map((q) => ({ q, page: findQuote(pages, q.page_key, q.quote) }))
      .filter((x) => x.page)
      .slice(0, 5)
      .map(({ q, page }) => ({ kind: "observed" as const, url: page!.url, excerpt: q.quote.trim().slice(0, 300) }));
    const figures = unsupportedNumbers(value, source);
    if (figures.length) {
      reject("figure_not_in_source");
      continue;
    }
    const cls = f.evidence_class;
    if ((cls === "verified" || cls === "inferred") && !evidence.length) {
      reject("quote_not_found");
      continue;
    }
    if (cls === "inferred" && !basis) {
      reject("inferred_without_basis");
      continue;
    }
    if (cls === "estimated" && !basis) {
      reject("estimated_without_basis");
      continue;
    }
    const key = `${f.field}|${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push({ category: f.category, field: f.field, value, source: "model", evidence_class: cls, basis: cls === "verified" ? null : basis, evidence });
  }
  return { accepted, rejected };
}

export interface ModelUnderstanding extends GroundingResult {
  model: string;
  provider: string;
  usage: ModelUsage;
}

export async function learnWithModel(provider: ModelProvider, scan: SiteScan, business: { businessName: string; serviceArea: string | null }): Promise<ModelUnderstanding> {
  const pages = sourcePages(scan);
  const r = await generateStructured(
    {
      task: "business_intelligence.understand",
      system: SYSTEM,
      input: `<business name="${business.businessName.replace(/"/g, "'")}" service_area="${(business.serviceArea ?? "").replace(/"/g, "'")}" />\n${pagesForModel(pages)}`,
      schema: UnderstandingSchema,
      maxOutputTokens: 8000,
    },
    provider,
  );
  return { ...groundFacts(r.output.facts, pages), model: r.model, provider: r.provider, usage: r.usage };
}
