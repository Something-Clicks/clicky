/**
 * Pattern audit: would a normal, GOOD answer trip a pattern that auto-fails it? Every "fail"-class pattern in the scored cases
 * (banned draft claims, must-not-recommend items) is run against ordinary sentences a competent marketing plan or draft
 * contains. A hit means a fluent, correct answer could be failed by a word-fragment match. Review-class patterns (unknown
 * and invented claims) only raise flags a person clears, so they are listed separately and less urgent.
 */
import { hitsIn } from "./checks";
import { TEST_SET } from "./dataset";

/** Ordinary sentences a competent PLAN would contain. None promises or invents anything. */
export const BENIGN_PLAN = [
  "Make the phone number easy to find on every page.",
  "Ask happy customers to leave a review and show the best ones on the homepage.",
  "Grow sales by explaining the main service in the first sentence.",
  "Build a strong relationship with local customers by answering questions quickly.",
  "The second step is to add a short description of each service.",
  "Only one change is needed on the homepage: a clearer headline.",
  "A complete Google listing is free and helps people nearby find you.",
  "Ownership of the message stays with the owner, so keep the tone friendly.",
  "Show a short list of services in plain words.",
  "Write the opening hours where visitors can see them.",
  "Explain how to book and what happens next.",
  "Use the same phone number everywhere.",
  "Add photos of real work with a short caption.",
  "In a slow economy, focus on regular customers.",
  "Cater the message to families who live nearby.",
  "Delivering a clear message helps visitors decide.",
  "Create an online request form so people can get in touch without calling.",
  "Mention the town name so local visitors know the business is nearby.",
  "Say what makes the business different in the owner's own words.",
  "Use candid photos of the team to build trust.",
  "Reduce the number of steps between reading the page and getting in touch.",
  "Customers want to know what they will pay, so show the prices you already have.",
  "Share the story of how the business started, using only what the owner tells you.",
  "Thank customers by name when they leave a review.",
  "Put the most important detail first and the rest below it.",
] as const;

/** Ordinary sentences a competent DRAFT (page copy, titles, descriptions) in a small business's voice would contain. */
export const BENIGN_DRAFT = [
  "Call us today. It is the only number you need.",
  "Our second batch comes out of the oven at noon.",
  "We cater to families who live nearby.",
  "We deliver clear answers and friendly service.",
  "The best way to reach us is by phone during opening hours.",
  "Stop by and see what is new this week.",
  "In a busy economy, we keep things simple and honest.",
  "Book online or call us, whichever is easier for you.",
  "A small team that treats every customer like a neighbor.",
  "Clear prices, friendly people and no surprises.",
  "Our approach is simple: listen first, then fix the problem.",
  "Come see our work and meet the people behind it.",
  "Candid, friendly service from people who live here.",
  "We keep the menu short and the ingredients simple.",
  "Questions? Ask us anything, any time during opening hours.",
] as const;

export interface PatternRisk { caseId: string; kind: "fail" | "review"; where: string; pattern: string; sentence: string }

export function auditPatterns(): PatternRisk[] {
  const risks: PatternRisk[] = [];
  for (const c of TEST_SET) {
    // [where, patterns, the kind of sentence they are applied to, severity]
    const groups: [string, string[], readonly string[], "fail" | "review"][] = [
      ["content.banned", c.truth.content.banned, BENIGN_DRAFT, "fail"],
      ["strategy.mustNotRecommend", c.truth.strategy.mustNotRecommend, BENIGN_PLAN, "fail"],
      ...c.notes.map((n): [string, string[], readonly string[], "fail" | "review"] => [`note:${n.id}.mustNotRecommend`, n.mustNotRecommend, BENIGN_PLAN, "fail"]),
      ["unknown.forbidden", c.truth.unknown.flatMap((u) => u.forbidden), [...BENIGN_PLAN, ...BENIGN_DRAFT], "review"],
      ["inventedClaims", c.truth.inventedClaims.map((i) => i.pattern), [...BENIGN_PLAN, ...BENIGN_DRAFT], "review"],
    ];
    for (const [where, patterns, bank, kind] of groups) {
      for (const p of patterns) for (const s of bank) if (hitsIn(s, [p]).hits.length > 0) risks.push({ caseId: c.id, kind, where, pattern: p, sentence: s });
    }
  }
  return risks;
}
