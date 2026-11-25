import type { FactField } from "@/lib/business-profile";

import type { StoredPlan } from "./marketing-strategy";

/**
 * Marketing Strategy without a model: a plan built by fixed rules from the open Action Cards, the owner's goal and what
 * the business profile is missing. This is deterministic software, NOT language-model reasoning, and the product says so
 * ("built with fixed rules"). It orders and explains work using the cards' own checked text; it writes no new prose beyond
 * short templated sentences, reads no free-text notes, and invents nothing: every sentence is assembled from a card field,
 * a count, or the owner's goal.
 *
 * Order: impact, then actions that serve the owner's goal, then evidence strength, then confidence, then smaller effort,
 * then the incoming order (so the result is stable). The plan is saved as a proposal; only the owner approves it.
 */
export const RULES_PROVIDER = "something-clicks";
export const RULES_MODEL = "rules-v1";

export interface RulesCard {
  id: string;
  check_key: string | null;
  title: string;
  why_it_matters: string;
  recommended_action: string;
  impact: string;
  confidence: string;
  evidence_class: string;
}

const LEVEL: Record<string, number> = { high: 0, medium: 1, low: 2 };
const EVIDENCE: Record<string, number> = { verified: 0, estimated: 1, inferred: 1, unknown: 2 };
const level = (v: string) => LEVEL[v] ?? 3;

type Effort = "small" | "medium" | "large";
/** How big the change is, by check. Anything not listed (including model-origin cards) is "medium". */
const EFFORT: Record<string, Effort> = {
  "meta.title_missing": "small", "meta.title_length": "small", "meta.description_missing": "small", "content.h1_missing": "small",
  "contact.no_click_to_call": "small", "local.service_area_missing": "small", "mobile.viewport_missing": "medium",
  "content.thin_homepage": "medium", "a11y.images_missing_alt": "medium", "site.no_https": "medium", "pagespeed.performance": "large",
};
const EFFORT_RANK: Record<Effort, number> = { small: 0, medium: 1, large: 2 };
export const effortOf = (checkKey: string | null): Effort => (checkKey ? EFFORT[checkKey] : undefined) ?? "medium";

/** Checks that most directly serve each of the owner's goals. */
const GOAL: Record<string, { label: string; checks: RegExp }> = {
  more_calls: { label: "get more calls and enquiries", checks: /^(contact\.|local\.|content\.(h1|thin))/ },
  get_found: { label: "get found by more customers", checks: /^(meta\.|local\.|content\.h1|pagespeed\.|site\.no_https)/ },
};

const QUESTION: Partial<Record<FactField, string>> = {
  what_it_does: "In one sentence, what does your business do?",
  service: "Which services bring in the most business?",
  audience: "Who is your ideal customer?",
  service_area: "Which areas do you serve?",
  value_proposition: "Why do customers choose you over others?",
  contact_phone: "What phone number should customers call?",
};

const firstSentence = (text: string, max: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  const end = t.search(/[.!?](\s|$)/);
  const s = end > 0 ? t.slice(0, end + 1) : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

export function buildRulesPlan(input: { businessName: string; primaryGoal: string | null; cards: RulesCard[]; missing: FactField[] }): StoredPlan | null {
  if (!input.cards.length) return null;
  const goal = input.primaryGoal ? GOAL[input.primaryGoal] : undefined;
  const serves = (c: RulesCard) => Boolean(goal && c.check_key && goal.checks.test(c.check_key));

  const ordered = input.cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) =>
      level(a.c.impact) - level(b.c.impact) ||
      Number(serves(b.c)) - Number(serves(a.c)) ||
      (EVIDENCE[a.c.evidence_class] ?? 3) - (EVIDENCE[b.c.evidence_class] ?? 3) ||
      level(a.c.confidence) - level(b.c.confidence) ||
      EFFORT_RANK[effortOf(a.c.check_key)] - EFFORT_RANK[effortOf(b.c.check_key)] ||
      a.i - b.i,
    )
    .map((x) => x.c);

  const top = ordered.slice(0, 8);
  const rest = ordered.slice(8, 13);
  const impactWord = (v: string) => (v === "high" ? "High" : v === "low" ? "Low" : "Medium");
  const seen = (c: RulesCard) => (c.evidence_class === "verified" ? "We saw this directly on your website." : c.evidence_class === "unknown" ? "Some information was missing, so check it first." : "This is our best reading of your website.");

  const priorities: StoredPlan["priorities"] = top.map((c, i) => {
    const effort = effortOf(c.check_key);
    const goalClause = serves(c) ? ` It supports your goal to ${goal!.label}.` : "";
    const whyNow = `${impactWord(c.impact)} impact${effort === "small" ? " and a small change" : ""}.${goalClause} ${seen(c)} ${firstSentence(c.why_it_matters, 200)}`.replace(/\s+/g, " ").trim();
    return { card_id: c.id, order: i + 1, why_now: whyNow.slice(0, 500), effort, based_on: serves(c) ? ["goal"] : [], depends_on: [] };
  });

  const name = input.businessName.trim().slice(0, 60) || "your business";
  const first = top[0]!;
  const summary = `${input.cards.length} open action${input.cards.length === 1 ? "" : "s"} for ${name}. Start with “${first.title.slice(0, 120)}”. The order comes from fixed rules (impact, what we saw, the size of the change and your goal), not from a written analysis.`;

  return {
    summary: summary.slice(0, 600),
    objectives: goal ? [{ objective: goal.label[0]!.toUpperCase() + goal.label.slice(1), based_on: ["goal"] }] : [],
    priorities,
    next_steps: top.slice(0, 3).map((c) => `${c.title}: ${firstSentence(c.recommended_action, 220)}`.slice(0, 300)),
    questions: input.missing.map((f) => QUESTION[f]).filter((q): q is string => Boolean(q)).slice(0, 4),
    not_now: rest.map((c) => ({ card_id: c.id, reason: `${impactWord(c.impact)} impact, so it comes after the actions above.` })),
  };
}
