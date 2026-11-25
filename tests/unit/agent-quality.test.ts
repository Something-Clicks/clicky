/**
 * Quality screening rules (src/lib/agent-quality.ts). The inputs are hand-written examples of good and
 * poor agent output; they test that the screening rules catch what they claim to catch. They are NOT
 * model output and say nothing about how good any model is.
 */
import { describe, expect, it } from "vitest";

import { DIMENSIONS, reviewQuality, type ReviewFact, type ReviewFinding, type ReviewInput } from "@/lib/agent-quality";

const fact = (over: Partial<ReviewFact> = {}): ReviewFact => ({
  category: "business", field: "service", value: "Drain cleaning", source: "model", evidence_class: "verified", basis: null,
  evidence: [{ kind: "observed", url: "https://s.example/", excerpt: "We clear drains for homes across Salt Lake County" }], status: "proposed", ...over,
});
const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  title: "Say which drains you clear in the headline", explanation: "The homepage headline says 'Plumbing you can count on' but not which jobs you do.",
  why_it_matters: "Visitors deciding whether you handle blocked drains should see it before they scroll.",
  recommended_action: "Rewrite the headline to name drain cleaning and Salt Lake County.", impact: "high", confidence: "medium",
  evidence_class: "inferred", evidence_basis: "The headline names no service.", origin: "model", evidence: ["Plumbing you can count on"], ...over,
});
const base = (over: Partial<ReviewInput> = {}): ReviewInput => ({ businessName: "Sunrise Plumbing", facts: [fact()], findings: [finding()], plan: null, ...over });
const kinds = (r: ReturnType<typeof reviewQuality>) => r.flags.map((f) => f.kind);

describe("reviewQuality", () => {
  it("scores well-grounded, specific, actionable output highly with no problems", () => {
    const r = reviewQuality(base());
    expect(r.flags.filter((f) => f.severity === "problem")).toEqual([]);
    for (const d of DIMENSIONS) expect(r.scores[d], d).toBe(100);
    expect(r.overall).toBe(100);
  });

  it("returns null, not a flattering score, when there is nothing to judge", () => {
    const r = reviewQuality(base({ facts: [], findings: [] }));
    expect(Object.values(r.scores).every((s) => s === null)).toBe(true);
    expect(r.overall).toBeNull();
  });

  it("flags verified or inferred facts with no evidence, and inferences with no basis", () => {
    const r = reviewQuality(base({ facts: [
      fact({ evidence: [] }),
      fact({ field: "audience", value: "Homeowners", evidence_class: "inferred", basis: " " }),
    ] }));
    expect(kinds(r)).toEqual(expect.arrayContaining(["no_evidence", "missing_basis"]));
    expect(r.scores.evidence).toBeLessThan(100);
    expect(r.scores.factual_accuracy).toBeLessThan(100);
  });

  it("flags promises and figures the evidence does not support, in facts, findings and the plan", () => {
    const r = reviewQuality(base({
      facts: [fact({ field: "competitive_advantage", value: "Guaranteed same-day service", evidence: [{ excerpt: "We come out quickly" }] }), fact({ field: "pricing", value: "From $49", evidence: [{ excerpt: "Call for a quote" }] })],
      findings: [finding({ why_it_matters: "This will double your calls and put you in the top 3." })],
      plan: { summary: "You will rank first on Google.", priorities: [], next_steps: [] },
    }));
    const problems = r.flags.filter((f) => f.severity === "problem");
    expect(problems.some((f) => f.area === "fact" && f.kind === "unsupported_claim")).toBe(true);
    expect(problems.some((f) => f.area === "fact" && f.kind === "unsupported_figure")).toBe(true);
    expect(problems.some((f) => f.area === "finding" && f.kind === "unsupported_claim")).toBe(true);
    expect(problems.some((f) => f.area === "plan" && f.kind === "unsupported_claim")).toBe(true);
  });

  it("allows a promise word in a trust signal that reports what the site says", () => {
    const r = reviewQuality(base({ facts: [fact({ field: "trust_signal", value: "The site advertises a satisfaction guarantee", evidence: [{ excerpt: "Every job has a satisfaction guarantee" }] })] }));
    expect(kinds(r)).not.toContain("unsupported_claim");
  });

  it("flags model findings without quoted evidence", () => {
    const r = reviewQuality(base({ findings: [finding({ evidence: [] })] }));
    expect(kinds(r)).toContain("no_evidence");
    expect(r.scores.evidence).toBeLessThan(100);
  });

  it("flags generic advice, advice that names nothing of this business, thin explanations and vague actions", () => {
    const r = reviewQuality(base({ findings: [finding({
      title: "Grow", explanation: "Be better.", why_it_matters: "It helps.",
      recommended_action: "Leverage best practices to take your business to the next level.", evidence: ["x text here"],
    })] }));
    expect(kinds(r)).toEqual(expect.arrayContaining(["generic", "not_specific", "not_actionable"]));
    expect(r.scores.marketing_usefulness).toBe(0);
    expect(r.scores.actionability).toBe(0);
    expect(r.scores.business_relevance).toBe(0);
  });

  it("judges a plan: specific reasons and concrete steps score; generic ones are flagged", () => {
    const good = reviewQuality(base({ plan: {
      summary: "Sunrise Plumbing serves homeowners in Salt Lake County.",
      priorities: [{ card_id: "1", order: 1, why_now: "Homeowners call first, so the phone number in the headline comes before anything else.", effort: "small", based_on: ["audience"] }],
      next_steps: ["Put your phone number at the top of the homepage."],
    } }));
    expect(good.flags.filter((f) => f.area === "plan")).toEqual([]);
    const poor = reviewQuality(base({ plan: {
      summary: "Grow your business with best practices.",
      priorities: [{ card_id: "1", order: 1, why_now: "Build your brand.", effort: "small", based_on: [] }],
      next_steps: [],
    } }));
    expect(poor.flags.filter((f) => f.area === "plan").map((f) => f.kind)).toEqual(expect.arrayContaining(["generic", "not_specific", "not_actionable"]));
  });

  it("lists problems before warnings", () => {
    const r = reviewQuality(base({ facts: [fact({ evidence: [] })], findings: [finding({ recommended_action: "Improve things" })] }));
    const sev = r.flags.map((f) => f.severity);
    expect(sev.indexOf("warning")).toBeGreaterThan(sev.lastIndexOf("problem"));
  });
});
