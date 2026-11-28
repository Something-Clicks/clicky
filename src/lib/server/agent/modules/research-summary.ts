import { z } from "zod";

import { claimProblemIn, jsonForPrompt, plainForPrompt, UNTRUSTED_CONTENT_RULE, unsupportedNumbers } from "../grounding";
import { generateStructured, type ModelProvider, type ModelUsage } from "../provider";

/**
 * Research summary (spec §4, gate G3): the model reads what was ACTUALLY observed (the owner's homepage and the competitor
 * homepages we read, plus any keyword rows the owner imported) and writes a few plain points about the competitive picture.
 * The model never searches and never knows anything the sources below do not say, so every point must cite source ids that exist
 * in the input, say only what those sources support, and is labelled "inferred" (never verified). Points that cite nothing, cite an
 * unknown source, make a promise, or use a number that is not in the sources are dropped and counted. The statement of what was
 * NOT researched is fixed text, not model output, and is always present.
 */

export interface ResearchSource {
  /** Short id the model cites: "own", a competitor host, or "kw:<n>". */
  id: string;
  label: string;
  kind: "own_homepage" | "competitor_homepage" | "keywords";
  /** Plain observed facts, one per line ("Shows a phone number: yes"). */
  facts: string[];
  /** Why this competitor is on the list (from discovery or "named by the owner"), when known. */
  origin?: string;
}

const KINDS = ["gap", "strength", "opportunity", "caution"] as const;
const Schema = z.object({
  points: z.array(z.object({ statement: z.string(), kind: z.enum(KINDS), sources: z.array(z.string()) }).strict()),
}).strict();

export interface ResearchPoint { statement: string; kind: (typeof KINDS)[number]; sources: string[]; evidence_class: "inferred" }
export interface ResearchSummary {
  points: ResearchPoint[];
  /** Points the checks dropped, by reason (never shown as findings). */
  dropped: Record<string, number>;
  /** Fixed text: what this summary is not. */
  limits: string[];
  model: string;
  provider: string;
  usage: ModelUsage;
}

export const RESEARCH_LIMITS = [
  "This summary uses only the homepages we read and any keyword data you imported. Nothing else.",
  "We did not look up traffic, rankings, ad spend or customer reviews for anyone. Points are our reading of what the pages visibly show, not measurements.",
  "A competitor on this list is a starting point from a similar search or map listing, not proof they compete for your customers.",
];

const SYSTEM = `You are the Market Research capability of the Something Clicks Marketing Agent. You write a short, honest summary of how a small business's website compares with other local websites, for the owner.

${UNTRUSTED_CONTENT_RULE}

Rules:
- <sources> is everything you know. Each source has an id. Use nothing else: no outside knowledge about these businesses or their markets.
- Write 2 to 5 points. Each point is one or two plain sentences and cites the ids of the sources it rests on in "sources" (at least one, and only ids that appear in <sources>).
- kind: "gap" (others show something the business's homepage does not), "strength" (the business shows something others do not), "opportunity" (a specific, small thing worth doing, grounded in a gap or in the keyword data), "caution" (a reason not to over-read the data, such as a competitor that could not be read).
- A competitor's homepage shows only what is listed for it. Never say a competitor is better, bigger, cheaper or more popular, and never state traffic, rankings, prices, reviews or results unless a source says so.
- Never use a number that is not in <sources>. Never promise results.
- Plain words for a business owner. No jargon.`;

/** The input the model sees, plus the text its numbers are checked against. */
export function summaryInput(businessName: string, sources: ResearchSource[]) {
  const shown = sources.map((s) => ({ id: s.id, kind: s.kind, name: s.label, ...(s.origin ? { why_listed: s.origin } : {}), observed: s.facts }));
  return { shown, text: [businessName, ...sources.flatMap((s) => [s.label, s.origin ?? "", ...s.facts])].join("\n") };
}

export async function summarizeResearch(provider: ModelProvider, input: { businessName: string; sources: ResearchSource[]; deadlineAt?: number }): Promise<ResearchSummary> {
  const { shown, text } = summaryInput(input.businessName, input.sources);
  const ids = new Set(input.sources.map((s) => s.id));
  const r = await generateStructured(
    {
      task: "market_research.summarize",
      system: SYSTEM,
      input: `<business>${plainForPrompt(input.businessName)}</business>\n<sources>${jsonForPrompt(shown)}</sources>`,
      schema: Schema,
      maxOutputTokens: 1400,
      deadlineAt: input.deadlineAt,
    },
    provider,
  );
  const dropped: Record<string, number> = {};
  const drop = (why: string) => { dropped[why] = (dropped[why] ?? 0) + 1; };
  const points: ResearchPoint[] = [];
  for (const p of r.output.points) {
    const statement = p.statement.replace(/\s+/g, " ").trim();
    if (statement.length < 15 || statement.length > 400) { drop("length"); continue; }
    const cited = [...new Set(p.sources.map((s) => s.trim()))];
    if (cited.length === 0) { drop("no_source"); continue; }
    if (cited.some((c) => !ids.has(c))) { drop("unknown_source"); continue; }
    if (claimProblemIn(statement)) { drop("promise_or_leak"); continue; }
    if (unsupportedNumbers(statement, text).length) { drop("number_not_in_sources"); continue; }
    // A competitor claim must rest on a competitor or keyword source, never on the business's own page alone.
    if (/\b(competitors?|others?|they|their)\b/i.test(statement) && cited.every((c) => c === "own")) { drop("about_others_cites_only_own"); continue; }
    points.push({ statement, kind: p.kind, sources: cited, evidence_class: "inferred" });
    if (points.length === 5) break;
  }
  return { points, dropped, limits: RESEARCH_LIMITS, model: r.model, provider: r.provider, usage: r.usage };
}
