/**
 * A stand-in model server that answers each prompt with the IDEAL answer taken from the case's own ground truth.
 * It exists to prove the evaluation machinery end to end: every case can be executed through the real adapter,
 * capabilities, grounding and automatic checks, and a good answer is not wrongly flagged. It is a TEST DOUBLE built from
 * the answer key. It says nothing about any model's intelligence, and no result from it may be presented as model quality.
 */
import type { ServerResponse } from "node:http";

import { categoryOf, type FactField } from "@/lib/business-profile";
import { MODEL_FIELDS } from "@/lib/server/agent/modules/business-understanding";

import type { EvalCase } from "../../evals/model/dataset/types";
import { completion, json, type Seen } from "./model-stub";

export interface Ctx {
  c: EvalCase;
  /** The task the request is for: understanding, findings, plan, draft_meta, draft_page_copy. */
  task: "understanding" | "findings" | "plan" | "draft_meta" | "draft_page_copy";
  pages: { key: string; text: string }[];
  actions: { reference: string; title: string }[];
  notes: string | null;
}

/** Return a replacement answer (object), the string "invalid" (not JSON), "refuse", or undefined to keep the ideal answer. */
export type Override = (ctx: Ctx, ideal: Record<string, unknown>) => Record<string, unknown> | "invalid" | "refuse" | undefined;

const MODEL_FIELD_SET = new Set<string>(MODEL_FIELDS);

function parse(seen: Seen, cases: EvalCase[]): Ctx | null {
  const messages = seen.body.messages as { role: string; content: string }[];
  const user = messages[1]!.content;
  const name = (seen.body.response_format as { json_schema: { name: string } }).json_schema.name;
  const c = cases.find((x) => user.includes(x.business.name) || user.includes(x.business.name.replace(/'/g, "&#39;")));
  const task = name === "business_intelligence_understand" ? "understanding" : name === "marketing_analysis_review" ? "findings" : name === "marketing_strategy_plan" ? "plan" : name === "content_creation_meta" ? "draft_meta" : name === "content_creation_page_copy" ? "draft_page_copy" : null;
  if (!task) return null;
  const pages = [...user.matchAll(/<website_content key="(page\d+)" url="[^"]*">\n([\s\S]*?)\n<\/website_content>/g)].map((m) => ({ key: m[1]!, text: m[2]! }));
  const open = user.match(/<open_actions>([\s\S]*?)<\/open_actions>/)?.[1];
  const actions = open ? (JSON.parse(open) as { reference: string; title: string }[]) : [];
  const notes = user.match(/<owner_notes>([\s\S]*?)<\/owner_notes>/)?.[1] ?? null;
  // Drafts carry only the business name, so match the case by name in the business JSON as well.
  const byDraft = c ?? cases.find((x) => user.includes(JSON.stringify(x.business.name).slice(1, -1)));
  return byDraft ? { c: byDraft, task, pages, actions, notes } : null;
}

const keyOf = (pages: Ctx["pages"], quote: string) => pages.find((p) => p.text.includes(quote))?.key;

function ideal(ctx: Ctx): Record<string, unknown> {
  const { c } = ctx;
  const name = c.business.name;
  if (ctx.task === "understanding") {
    return {
      facts: c.truth.mustPreserve.flatMap((m) => {
        const key = keyOf(ctx.pages, m.quote);
        if (!key) return [];
        // Contact details come from the fixed extraction; the model schema has no field for them, so they ride along as a location detail.
        const field = (MODEL_FIELD_SET.has(m.field) ? m.field : m.field.startsWith("contact_") ? "location" : "business_model") as FactField;
        return [{ category: categoryOf(field), field, value: m.claim, evidence_class: "verified", basis: "", quotes: [{ page_key: key, quote: m.quote }] }];
      }),
    };
  }
  if (ctx.task === "findings") {
    return {
      findings: c.truth.expectedFindings.flatMap((f) => {
        const key = keyOf(ctx.pages, f.quote);
        const kw = f.anyOf[0]!;
        if (!key) return [];
        return [{ slug: f.id.replace(/-/g, "_"), category: "messaging", title: `Add ${kw} to the page`, what_was_observed: `The page makes a point here but shows no ${kw}.`, quotes: [{ page_key: key, quote: f.quote }], evidence_class: "verified", basis: "", why_it_matters: `A visitor looking for ${kw} will not find it.`, recommended_action: `Add ${kw} next to this text.`, expected_benefit: "Visitors can understand this more easily.", impact: "medium", confidence: "high", draftable: "none" }];
      }),
    };
  }
  if (ctx.task === "plan") {
    const note = ctx.notes ? c.notes.find((n) => ctx.notes!.includes(n.text.slice(0, 30))) : undefined;
    const groups = [...c.truth.strategy.mustAddress, ...(note?.mustAddress ?? [])];
    const topics = groups.map((g) => g[0]).join(", ");
    const demote = (title: string) => (c.truth.strategy.mustNotBeFirst.length || c.notes.some((n) => n.mustNotBeFirst?.length)) && /call you with one tap/i.test(title);
    const ordered = [...ctx.actions].sort((a, b) => Number(demote(a.title)) - Number(demote(b.title)));
    const kw = c.truth.mustPreserve[0]!.keywords[0]!;
    return {
      summary: `For ${name}, the plan covers ${topics}.`,
      objectives: [{ objective: `Help ${name} with ${groups[0]![0]}`, based_on: [] }],
      priorities: ordered.slice(0, 8).map((a, i) => ({ action: a.reference, order: i + 1, why_now: `${name} needs this because of ${kw}.`, effort: "small", based_on: [], depends_on: [] })),
      next_steps: [`Work on ${topics}.`],
      questions_for_owner: [`What else should we know about ${name}?`],
      not_now: [],
    };
  }
  const mention = (c.truth.content.mustMention[1] ?? c.truth.content.mustMention[0]!)[0]!;
  if (ctx.task === "draft_meta") return { page_title: `${name} | ${mention}`, meta_description: `${name}: ${mention}. Get in touch to learn more.` };
  return { headline: `${name}: ${mention}`, supporting_line: `Here is what ${name} does.`, call_to_action: "Get in touch", section_heading: `About ${name}`, section_body: `${name} offers ${mention}. Get in touch to find out more.` };
}

export function truthStandIn(cases: EvalCase[], override?: Override) {
  return (seen: Seen, res: ServerResponse) => {
    try {
      answer(seen, res);
    } catch (error) {
      json(res, 500, { error: String(error) }); // never leave a request hanging
    }
  };

  function answer(seen: Seen, res: ServerResponse) {
    const ctx = parse(seen, cases);
    if (!ctx) return json(res, 400, { error: "unrecognised task" });
    const base = ideal(ctx);
    const out = override?.(ctx, base);
    if (out === "invalid") return json(res, 200, completion("Here is my answer in prose, not JSON."));
    if (out === "refuse") return json(res, 200, { ...completion(""), choices: [{ message: { content: "", refusal: "I can't help with that." }, finish_reason: "stop" }] });
    return json(res, 200, completion(JSON.stringify(out ?? base)));
  }
}
