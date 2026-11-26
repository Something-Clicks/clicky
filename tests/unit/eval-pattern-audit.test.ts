/**
 * Pattern audit as a guard: a fail-class pattern that a normal, correct answer could trip must not exist unnoticed. The list below
 * is EXACTLY the risks found in the frozen dataset on Nov 26 2026 and documented for the owner's approval in
 * docs/agents/EVALUATION_DATASET_REVIEW.md (with a ready patch). Approving the patch empties this list. Until then the test pins
 * the known set, so a NEW risk fails the test and a fix that is not logged does too.
 */
import { describe, expect, it } from "vitest";

import { auditPatterns, BENIGN_DRAFT, BENIGN_PLAN } from "../../evals/model/audit-patterns";

/** caseId | where | pattern, for every currently known risk. */
const KNOWN_UNRESOLVED: string[] = [
  "T1|content.banned|\\bbest\\b",
  "T2|content.banned|cater",
  "T2|strategy.mustNotRecommend|ship",
  "T3|content.banned|only",
  "T5|content.banned|\\bbest\\b",
  "T6|content.banned|eco",
  "T6|content.banned|\\bbest\\b",
  "T6|note:no-price-war.mustNotRecommend|(discount|coupon|price cut|lower (your |the )?prices?|sale)",
  "T8|content.banned|candid",
  "T2|unknown.forbidden|ship ",
  "T2|unknown.forbidden|cater",
  "T4|unknown.forbidden|cater",
  "T4|unknown.forbidden|deliver",
  "T6|unknown.forbidden|owner[,]? [A-Z][a-z]+",
  "T8|unknown.forbidden|candid",
];

describe("pattern audit", () => {
  it("the benign banks are ordinary sentences (they promise and invent nothing)", () => {
    for (const s of [...BENIGN_PLAN, ...BENIGN_DRAFT]) expect(s).not.toMatch(/guarantee|#1|award|lowest price|\$\d/i);
  });

  it("the risks in the frozen dataset are exactly the documented, known set", () => {
    const found = [...new Set(auditPatterns().map((r) => `${r.caseId}|${r.where}|${r.pattern}`))].sort();
    expect(found).toEqual([...KNOWN_UNRESOLVED].sort());
  });
});
