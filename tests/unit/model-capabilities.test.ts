/**
 * Model-assisted capabilities: grounding and validation that Something Clicks applies to model output.
 *
 * The "model" here is a hand-written TEST DOUBLE that returns fixed answers. These tests prove how the
 * Marketing Agent checks, accepts and rejects model output. They say NOTHING about the quality of any
 * real model's answers; that needs real calls (see docs/agents/MARKETING_AGENT.md, "Verification").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { claimProblemIn, findQuote, unsupportedNumbers, type SourcePage } from "@/lib/server/agent/grounding";
import { businessIntelligence } from "@/lib/server/agent/modules/business-intelligence";
import { groundFacts, sourcePages, type ModelFactOutput } from "@/lib/server/agent/modules/business-understanding";
import { checkDraft, ContentRejected, createContent } from "@/lib/server/agent/modules/content-creation";
import { MODULES } from "@/lib/server/agent/modules";
import { groundFindings, type ModelFindingOutput } from "@/lib/server/agent/modules/marketing-analysis-model";
import { expectDone } from "@/lib/server/agent/modules/types";
import { registerPrice } from "@/lib/server/agent/pricing";
import type { ModelProvider } from "@/lib/server/agent/provider";
import { extractFacts, type SiteScan } from "@/lib/server/site-scan";

const HOME = `<html><head><title>Sunrise Plumbing | Salt Lake City</title></head><body>
  <h1>Plumbing you can count on</h1><p>We clear drains and repair water heaters for homes across Salt Lake County.
  Family owned since 2009. Call (801) 555-0123 to book.</p></body></html>`;
const scan: SiteScan = { homepage: extractFacts({ url: "https://sunrise.example/", status: 200, contentType: "text/html", body: HOME, truncated: false, redirects: [] }), pages: [], failures: [] };
const pages: SourcePage[] = sourcePages(scan);

/** TEST DOUBLE: returns the given outputs in order. Not a model. */
const double = (...outputs: unknown[]): ModelProvider => ({
  id: "test-double",
  generate: vi.fn(async () => ({ output: outputs.shift(), model: "test-double", usage: { inputTokens: 10, outputTokens: 5 } })),
});
// Metering refuses unpriced models, so this double is given a made-up price (still a test double: no network, not a model).
registerPrice("test-double", "test-model", { input: 2, output: 10 });
const pricedDouble = (...outputs: unknown[]): ModelProvider => ({
  id: "test-double", model: "test-model",
  generate: vi.fn(async () => ({ output: outputs.shift(), model: "test-model", usage: { inputTokens: 10, outputTokens: 5 } })),
});

const fact = (over: Partial<ModelFactOutput>): ModelFactOutput => ({
  category: "business", field: "service", value: "Drain cleaning", evidence_class: "verified", basis: "",
  quotes: [{ page_key: "page0", quote: "We clear drains" }], ...over,
});

describe("deeper business understanding (grounding of positioning, trust, price, objections)", () => {
  const trust = (over: Partial<ModelFactOutput>) => fact({ field: "trust_signal", value: "The site states it has been family owned since 2009", quotes: [{ page_key: "page0", quote: "Family owned since 2009" }], ...over });

  it("keeps trust signals and positioning that quote the page, with the basis for inferences", () => {
    const r = groundFacts([
      trust({}),
      fact({ category: "brand", field: "positioning", value: "A local, family-run alternative for home plumbing", evidence_class: "inferred", basis: "Stresses family ownership and local service.", quotes: [{ page_key: "page0", quote: "Family owned since 2009" }] }),
      fact({ category: "customer", field: "decision_factor", value: "Reliability", evidence_class: "inferred", basis: "The headline stresses dependability.", quotes: [{ page_key: "page0", quote: "Plumbing you can count on" }] }),
    ], pages);
    expect(r.rejected).toEqual([]);
    expect(r.accepted.map((f) => [f.field, f.evidence_class])).toEqual([["trust_signal", "verified"], ["positioning", "inferred"], ["decision_factor", "inferred"]]);
  });

  it("refuses positioning, price and objections without a quote or basis (no guessing from the industry)", () => {
    const r = groundFacts([
      fact({ category: "brand", field: "positioning", value: "The premium choice", evidence_class: "inferred", basis: "", quotes: [{ page_key: "page0", quote: "We clear drains" }] }),
      fact({ field: "price_positioning", value: "Premium", evidence_class: "inferred", basis: "Plumbers are premium.", quotes: [{ page_key: "page0", quote: "luxury pricing" }] }),
      fact({ category: "customer", field: "objection", value: "Worried about cost", evidence_class: "verified", quotes: [] }),
    ], pages);
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["inferred_without_basis", "quote_not_found", "quote_not_found"]);
  });

  it("allows a promise word in a trust signal only when the page itself says it; never in other fields", () => {
    const page: SourcePage[] = [{ key: "page0", url: "https://s.example/", text: "Every job comes with a satisfaction guarantee." }];
    const q = [{ page_key: "page0", quote: "satisfaction guarantee" }];
    const ok = groundFacts([trust({ value: "The site advertises a satisfaction guarantee", quotes: q })], page);
    expect(ok.accepted).toHaveLength(1);
    const notOnPage = groundFacts([trust({ value: "The site advertises a satisfaction guarantee", quotes: [{ page_key: "page0", quote: "Every job comes" }] })], page);
    expect(notOnPage.rejected.map((x) => x.reason)).toEqual(["promise"]);
    // the page's own promise word does not excuse a different, bigger claim in the stored value
    const bigger = groundFacts([trust({ value: "Award-winning, the #1 plumber in town", quotes: q })], page);
    expect(bigger.rejected.map((x) => x.reason)).toEqual(["promise"]);
    const otherField = groundFacts([fact({ field: "competitive_advantage", value: "Satisfaction guaranteed", quotes: q })], page);
    expect(otherField.rejected.map((x) => x.reason)).toEqual(["promise"]);
  });
});

describe("grounding", () => {
  it("finds quotes only in the page they cite, ignoring case and spacing", () => {
    expect(findQuote(pages, "page0", "we  CLEAR drains")?.url).toBe("https://sunrise.example/");
    expect(findQuote(pages, "page1", "We clear drains")).toBeNull();
    expect(findQuote(pages, "page0", "We fix roofs")).toBeNull();
    expect(findQuote(pages, "page0", "We")).toBeNull();
  });

  it("flags figures that are not in the source and promises", () => {
    expect(unsupportedNumbers("Since 2009, call (801) 555-0123", pages[0]!.text)).toEqual([]);
    expect(unsupportedNumbers("Over 500 happy customers [your phone number]", pages[0]!.text)).toEqual(["500"]);
    expect(claimProblemIn("We guarantee results")).toBe("promise");
    expect(claimProblemIn("Rank #1 on Google")).toBe("promise");
    expect(claimProblemIn("Fast, friendly drain cleaning")).toBeNull();
  });
});

describe("Business Intelligence: grounding model facts", () => {
  it("keeps grounded facts and drops facts whose quotes are not on the page, invented figures, promises and bad fields", () => {
    const r = groundFacts([
      fact({}),
      fact({ field: "what_it_does", value: "Plumbing for homes in Salt Lake County", evidence_class: "inferred", basis: "Homepage text.", quotes: [{ page_key: "page0", quote: "for homes across Salt Lake County" }] }),
      fact({ category: "customer", field: "audience", value: "Homeowners", evidence_class: "verified", basis: "They mention homes.", quotes: [{ page_key: "page0", quote: "homeowners love us" }] }),
      fact({ field: "service", value: "Roof repair", quotes: [{ page_key: "page0", quote: "We repair roofs" }] }),
      fact({ field: "competitive_advantage", value: "Family owned for 30 years", quotes: [{ page_key: "page0", quote: "Family owned since 2009" }] }),
      fact({ field: "competitive_advantage", value: "Guaranteed same-day service", quotes: [{ page_key: "page0", quote: "Call (801) 555-0123" }] }),
      fact({ category: "brand", field: "service", value: "x" }),
      fact({ category: "brand", field: "value_proposition", value: "ignored", evidence_class: "unknown", quotes: [] }),
      fact({ field: "pricing", value: "", evidence_class: "inferred", basis: "x" }),
    ], pages);
    expect(r.accepted.map((f) => [f.field, f.value, f.evidence_class])).toEqual([
      ["service", "Drain cleaning", "verified"],
      ["what_it_does", "Plumbing for homes in Salt Lake County", "inferred"],
      ["value_proposition", null, "unknown"],
    ]);
    expect(r.accepted[0]!.evidence).toEqual([{ kind: "observed", url: "https://sunrise.example/", excerpt: "We clear drains" }]);
    expect(r.accepted.every((f) => f.source === "model")).toBe(true);
    expect(r.rejected.map((x) => x.reason)).toEqual(["quote_not_found", "quote_not_found", "figure_not_in_source", "promise", "wrong_category", "empty_value"]);
  });

  it("runs inside the Business Intelligence module and records model use; a failure is recorded, not hidden", async () => {
    const ok = expectDone(await businessIntelligence.run({
      profile: { businessName: "Sunrise Plumbing", website: "https://sunrise.example/", serviceArea: null, primaryGoal: null },
      scan, provider: double({ facts: [fact({}), fact({ category: "customer", field: "audience", value: "Homeowners", evidence_class: "inferred", basis: "Mentions homes.", quotes: [{ page_key: "page0", quote: "for homes" }] })] }),
    }), "bi").output;
    expect(ok.proposals.map((p) => [p.field, p.source])).toEqual([["contact_phone", "website"], ["trust_signal", "website"], ["service", "model"], ["audience", "model"]]);
    expect(ok.model).toMatchObject({ provider: "test-double", accepted: 2, rejected: [] });
    expect(ok.understanding.missing).toEqual(["what_it_does", "service_area", "value_proposition"]);

    const failed = expectDone(await businessIntelligence.run({
      profile: { businessName: "Sunrise", website: "https://sunrise.example/", serviceArea: null, primaryGoal: null },
      scan, provider: double({ wrong: true }, { still: "wrong" }),
    }), "bi").output;
    expect(failed.model).toMatchObject({ failed: expect.stringContaining("ModelOutputInvalid") });
    expect(failed.proposals.map((p) => p.source)).toEqual(["website", "website"]) // a failed model call keeps the deterministic proposals (phone, the site's own trust statement);
  });
});

const finding = (over: Partial<ModelFindingOutput>): ModelFindingOutput => ({
  slug: "headline_unclear", category: "messaging", title: "Say what you do in your headline",
  what_was_observed: "The headline does not name a service.", quotes: [{ page_key: "page0", quote: "Plumbing you can count on" }],
  evidence_class: "inferred", basis: "The main heading names no service or place.", why_it_matters: "Visitors decide quickly whether you can help them.",
  recommended_action: "Name your main service and area in the headline.", expected_benefit: "Visitors understand what you do sooner.",
  impact: "high", confidence: "medium", draftable: "homepage_copy", ...over,
});

describe("Marketing Analysis: grounding model findings", () => {
  it("turns grounded findings into Action Card payloads with quoted evidence", () => {
    const r = groundFindings([finding({})], pages, []);
    expect(r.cards).toEqual([expect.objectContaining({
      check_key: "model.headline_unclear", evidence_class: "inferred", evidence_basis: "The main heading names no service or place.",
      ai_capable: true, execution_type: "page_copy", evidence_keys: ["headline_unclear_0"],
    })]);
    expect(r.evidence).toEqual([{ key: "headline_unclear_0", url: "https://sunrise.example/", excerpt: "Plumbing you can count on", observation: "The headline does not name a service." }]);
  });

  it("drops findings with invented figures, promises, missing quotes or basis, and repeats of fixed checks", () => {
    const r = groundFindings([
      finding({ slug: "f", evidence_class: "estimated", quotes: [], basis: "Assumes most visitors arrive on the homepage.", draftable: "none" }),
      finding({ slug: "a", why_it_matters: "You lose 40% of visitors." }),
      finding({ slug: "b", expected_benefit: "Guaranteed more calls." }),
      finding({ slug: "c", quotes: [{ page_key: "page0", quote: "not on the page" }] }),
      finding({ slug: "d", basis: "" }),
    ], pages, []);
    expect(r.rejected.map((x) => x.reason)).toEqual(["figure_not_in_source", "promise", "quote_not_found", "basis_missing"]);
    expect(groundFindings([finding({ recommended_action: "Leverage best practices to improve your SEO." })], pages, []).rejected.map((x) => x.reason)).toEqual(["generic_advice"]);
    expect(groundFindings([finding({ title: "Add a page title" })], pages, ["Add a page title"]).rejected.map((x) => x.reason)).toEqual(["duplicate_of_check"]);
    expect(groundFindings(Array.from({ length: 7 }, (_, i) => finding({ slug: `s${i}`, why_it_matters: `Reason ${"abcdefg"[i]}.`, recommended_action: `Name your main service ${"abcdefg"[i]} in the headline.` })), pages, []).cards).toHaveLength(5);
    expect(r.cards).toEqual([expect.objectContaining({ check_key: "model.f", evidence_class: "estimated", execution_type: "manual", evidence_keys: [] })]);
  });
});

describe("Content Creation", () => {
  const input = {
    kind: "meta" as const, businessName: "Sunrise Plumbing",
    known: [{ field: "service" as const, label: "Service", value: "Drain cleaning", source: "owner" as const, evidence_class: "verified" as const, confirmed: true }],
    card: { title: "Add a page title", explanation: "x", recommendedAction: "x" },
    evidence: [{ url: "https://sunrise.example/", observation: "Your homepage has no title.", excerpt: null }],
    ownerNotes: "Mention Salt Lake City",
  };

  it("keeps a draft that passes the content rules, with labels", async () => {
    const d = await createContent(double({ page_title: "Drain Cleaning in Salt Lake City | Sunrise Plumbing", meta_description: "Drain cleaning from Sunrise Plumbing. Call [your phone number] to book." }), input);
    expect(d.fields).toEqual([
      { key: "page_title", label: "Page title", text: "Drain Cleaning in Salt Lake City | Sunrise Plumbing" },
      { key: "meta_description", label: "Meta description", text: "Drain cleaning from Sunrise Plumbing. Call [your phone number] to book." },
    ]);
    expect(d.provider).toBe("test-double");
  });

  it("refuses invented figures, promises, empty parts and runaway length", () => {
    const src = "Sunrise Plumbing\nDrain cleaning";
    expect(() => checkDraft("meta", { page_title: "Serving 500 homes | Sunrise", meta_description: "x" }, src)).toThrow(ContentRejected);
    expect(() => checkDraft("meta", { page_title: "Guaranteed results | Sunrise", meta_description: "x" }, src)).toThrow(/promise/);
    expect(() => checkDraft("meta", { page_title: " ", meta_description: "x" }, src)).toThrow(/incomplete/);
    expect(() => checkDraft("meta", { page_title: "x".repeat(200), meta_description: "x" }, src)).toThrow(/too long/);
  });

  it("is blocked, not faked, when no provider is configured", async () => {
    const r = await MODULES.content_creation.run(input);
    expect(r).toEqual({ status: "blocked", reason: expect.stringMatching(/No model provider/) });
  });
});

describe("orchestrator with model-assisted findings (test double provider)", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/server/agent/provider");
    vi.resetModules();
    delete process.env.FEATURE_MODEL_FINDINGS;
    delete process.env.MODEL_USAGE_KEY;
    delete process.env.FEATURE_BUSINESS_PROFILE;
  });

  it("saves grounded model findings only when the modelFindings switch is on, and records model usage", async () => {
    const answers = () => [
      { facts: [fact({})] },
      { findings: [finding({})] },
    ];
    for (const on of [true, false]) {
      vi.resetModules();
      const outs = answers();
      vi.doMock("@/lib/server/agent/provider", async (orig) => ({ ...(await orig<object>()), getModelProvider: () => pricedDouble(...outs) }));
      process.env.MODEL_USAGE_KEY = "k".repeat(40);
      process.env.FEATURE_BUSINESS_PROFILE = "1"; // the business-details step runs; model findings are what the switch toggles
      if (on) process.env.FEATURE_MODEL_FINDINGS = "1";
      else delete process.env.FEATURE_MODEL_FINDINGS;
      // resetModules reloaded the price table: declare the test double's made-up price in the fresh copy.
      (await import("@/lib/server/agent/pricing")).registerPrice("test-double", "test-model", { input: 2, output: 10 });
      const { runWebsiteReview } = await import("@/lib/server/agent/orchestrator");
      const rpc = vi.fn(async (name: string, _args?: unknown) => ({ data: name === "start_marketing_workflow" ? "wf" : name === "reserve_model_call" ? "reservation-1" : name === "add_model_findings" ? 1 : 0, error: null }));
      const out = await runWebsiteReview({ rpc } as never, { orgId: "o1", analysisId: "a1", business: { businessName: "Sunrise Plumbing", serviceArea: null, primaryGoal: null, website: "https://sunrise.example/" } }, {
        fetchPage: async (u) => ({ url: u, status: 200, contentType: "text/html", body: HOME, truncated: false, redirects: [] }),
        pageSpeed: async () => ({ ok: false as const, reason: "busy" }),
      });
      const names = rpc.mock.calls.map((c) => c[0]);
      expect(names.includes("add_model_findings"), `switch ${on}`).toBe(on);
      const finish = rpc.mock.calls.find((c) => c[0] === "finish_marketing_workflow")![1] as Record<string, unknown>;
      expect(finish).toMatchObject({ p_status: "prepared", p_provider: "test-double", p_model: "test-model" });
      expect(names.filter((n) => n === "reserve_model_call").length, "one reservation per model call").toBe(on ? 2 : 1);
      expect(names.filter((n) => n === "settle_model_call").length, "each reservation settled").toBe(on ? 2 : 1);
      if (on) expect(out.steps.find((s) => s.step === "analyze_marketing_model")).toMatchObject({ status: "done" });
    }
  });
});

describe("Marketing Analysis: findings that only restate the page (seen from a real 1.5B model run on a real site)", () => {
  // The model returned five of these, each quoting the page and repeating the same boilerplate; each passed the quote check.
  const junk = (title: string, quote: string) => finding({
    slug: `t_${title.length}`, title, what_was_observed: title, quotes: [{ page_key: "page0", quote }], evidence_class: "verified", basis: "",
    why_it_matters: "The title is clear and directly states the business's name and what they do.", recommended_action: "The title should be replaced with a more concise description.",
  });
  const real = [{ key: "page0", url: "https://sunrise.example/", title: "Sunrise", text: "Plumbing you can count on. Plumbing you can count on.", headings: [], links: [] }] as never;

  it("drops a finding whose title is its own quote, labelled 'Title:', or the whole observation", () => {
    const r = groundFindings([junk("Title: Plumbing you can count on", "Plumbing you can count on"), junk("Plumbing you can count on", "Plumbing you can count on")], real, []);
    expect(r.cards).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["restates_evidence", "restates_evidence"]);
  });

  it("drops a labelled title even when its quote is other text, and an action that says nothing to change (the finding the real model kept)", () => {
    const kept = finding({
      slug: "about", title: "Title: About | Something Clicks", evidence_class: "verified", basis: "",
      what_was_observed: "The homepage clearly states that the business is called Something Clicks.",
      why_it_matters: "The homepage messaging is clear and straightforward.",
      recommended_action: "The homepage should be reviewed to ensure that the messaging is consistent.",
    });
    expect(groundFindings([kept], pages, []).rejected.map((x) => x.reason)).toEqual(["restates_evidence"]);
    expect(groundFindings([{ ...kept, title: "Clarify the about page" }], pages, []).rejected.map((x) => x.reason)).toEqual(["not_actionable"]);
  });

  it("drops the same boilerplate repeated across findings", () => {
    const a = finding({ slug: "a", title: "Name your main service up top" });
    const b = finding({ slug: "b", title: "Add a clear next step" });
    const r = groundFindings([a, b], pages, []);
    expect(r.cards.map((c) => c.check_key)).toEqual(["model.a"]);
    expect(r.rejected).toEqual([{ title: "Add a clear next step", reason: "repeated_text" }]);
  });

  it("still keeps a genuine finding", () => {
    expect(groundFindings([finding({})], pages, []).cards).toHaveLength(1);
  });
});
