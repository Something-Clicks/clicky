/**
 * Business Intelligence and Marketing Strategy that run WITHOUT any language model.
 * These prove deterministic extraction and ordering rules on fixture pages and cards. They say nothing about model
 * quality (no model is involved anywhere in this file).
 */
import { describe, expect, it } from "vitest";

import { propose, trustStatements } from "@/lib/server/agent/modules/business-intelligence";
import { buildRulesPlan, effortOf, type RulesCard } from "@/lib/server/agent/modules/rules-strategy";
import { extractFacts, type SiteScan } from "@/lib/server/site-scan";

const page = (body: string, url = "https://sunrise.example/") => extractFacts({ url, status: 200, contentType: "text/html", body, truncated: false, redirects: [] });
const scanOf = (home: string): SiteScan => ({ homepage: page(home), pages: [], failures: [] });

const LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "Sunrise" },
    {
      "@type": ["LocalBusiness", "Plumber"], name: "Sunrise Plumbing", telephone: "+1-801-555-0123", email: "mailto:Hello@Sunrise.example",
      address: { "@type": "PostalAddress", streetAddress: "12 Main St", addressLocality: "Provo", addressRegion: "UT", postalCode: "84601" },
      areaServed: [{ "@type": "City", name: "Provo" }, "Orem"], priceRange: "$$",
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.8", reviewCount: "112" },
      hasOfferCatalog: { "@type": "OfferCatalog", itemListElement: [{ "@type": "Offer", itemOffered: { "@type": "Service", name: "Drain cleaning" } }, { "@type": "Offer", itemOffered: { name: "Water heater repair" } }] },
    },
  ],
};
const HOME = `<html><head><title>Sunrise Plumbing</title><script type="application/ld+json">${JSON.stringify(LD)}</script></head>
<body><h1>Plumbing in Provo</h1>
<p>We are a family-owned company serving Utah County since 2009. Our plumbers are licensed and insured. Call us any time.</p>
<p>Every repair comes with a one-year warranty. We offer free estimates on all jobs.</p>
<p>Click here to read more about leaving a review.</p></body></html>`;

describe("structured website data", () => {
  it("is read from schema.org markup, including @graph, and only plain values are kept", () => {
    const s = page(HOME).structured!;
    expect(s).toMatchObject({
      name: "Sunrise Plumbing", telephone: "+1-801-555-0123", email: "hello@sunrise.example", address: "12 Main St, Provo, UT 84601",
      areaServed: ["Provo", "Orem"], priceRange: "$$", rating: { value: "4.8", count: "112" }, services: ["Drain cleaning", "Water heater repair"],
    });
  });

  it("is null for pages without markup, with broken JSON, or with markup that says nothing about a business", () => {
    expect(page("<html><body><h1>Hi</h1></body></html>").structured).toBeNull();
    expect(page('<html><head><script type="application/ld+json">{ not json</script></head><body/></html>').structured).toBeNull();
    expect(page('<html><head><script type="application/ld+json">{"@type":"Article","name":"A post"}</script></head><body/></html>').structured).toBeNull();
  });

  it("rejects a non-numeric rating and a malformed email instead of storing them", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "LocalBusiness", name: "X", telephone: "555", email: "not an email", aggregateRating: { ratingValue: "great", reviewCount: "many" } })}</script></head><body/></html>`;
    const s = page(html).structured!;
    expect(s.rating).toBeNull();
    expect(s.email).toBeNull();
  });

  it("the scripts do not leak into the page text", () => {
    expect(page(HOME).text).not.toContain("PostalAddress");
  });
});

describe("Business Intelligence proposals without a model", () => {
  const facts = propose(scanOf(HOME));
  const byField = (f: string) => facts.filter((x) => x.field === f);

  it("proposes the site's own structured details as verified, each with an observed source", () => {
    expect(byField("contact_phone").map((f) => f.value)).toContain("(801) 555-0123");
    expect(byField("contact_email")[0]!.value).toBe("hello@sunrise.example");
    expect(byField("location")[0]!.value).toBe("12 Main St, Provo, UT 84601");
    expect(byField("service_area").map((f) => f.value)).toEqual(["Provo", "Orem"]);
    expect(byField("service").map((f) => f.value)).toEqual(["Drain cleaning", "Water heater repair"]);
    for (const f of facts.filter((x) => x.evidence.some((e) => e.excerpt?.startsWith("Structured data")))) {
      expect(f.evidence_class).toBe("verified");
      expect(f.source).toBe("website");
      expect(f.evidence[0]).toMatchObject({ kind: "observed", url: "https://sunrise.example/" });
    }
  });

  it("states a site's rating as the site's own figure, not as a verified review score", () => {
    const rating = byField("trust_signal").find((f) => f.value!.includes("4.8"))!;
    expect(rating.value).toMatch(/its own figure; we have not checked it/);
  });

  it("trust statements are the site's own sentences, quoted exactly from the page text", () => {
    const home = page(HOME);
    const found = trustStatements([home]);
    expect(found.length).toBeGreaterThanOrEqual(4);
    for (const f of found) {
      const quote = f.evidence[0]!.excerpt!;
      expect(home.text).toContain(quote);
      expect(f.value).toBe(`The site states: “${quote}”`);
      expect(f.evidence_class).toBe("verified");
    }
    const values = found.map((f) => f.value!).join(" | ");
    expect(values).toMatch(/family-owned/);
    expect(values).toMatch(/licensed and insured/);
    expect(values).toMatch(/one-year warranty/);
    expect(found.find((f) => /free estimates/.test(f.value!))!.field).toBe("competitive_advantage");
  });

  it("does not turn a bare 'review' mention or a navigation phrase into a trust signal", () => {
    expect(trustStatements([page("<html><body><p>Click here to read more about leaving a review for us today.</p></body></html>")])).toEqual([]);
  });

  it("never exceeds the database's limits (50 proposals, 500 characters a value, evidence list of at most 10)", () => {
    const long = `<html><body>${Array.from({ length: 60 }, (_, i) => `<p>We are licensed and insured in county number ${i} for all work.</p>`).join("")}</body></html>`;
    const all = propose(scanOf(long));
    expect(all.length).toBeLessThanOrEqual(50);
    expect(all.filter((f) => f.field === "trust_signal").length).toBeLessThanOrEqual(5);
    for (const f of all) {
      expect(f.value!.length).toBeLessThanOrEqual(500);
      expect(f.evidence.length).toBeLessThanOrEqual(10);
    }
  });
});

describe("Marketing Strategy by fixed rules", () => {
  const card = (id: string, check_key: string, impact: string, over: Partial<RulesCard> = {}): RulesCard => ({
    id, check_key, title: `Title ${id}`, why_it_matters: "Visitors on phones cannot call you. That loses enquiries.", recommended_action: "Add a call button. Test it on a phone.",
    impact, confidence: "high", evidence_class: "verified", ...over,
  });

  it("returns nothing when there is nothing open", () => {
    expect(buildRulesPlan({ businessName: "X", primaryGoal: null, cards: [], missing: [] })).toBeNull();
  });

  it("orders by impact first, then the owner's goal, then evidence, confidence and the size of the change", () => {
    const cards = [
      card("slow", "pagespeed.performance", "high"),
      card("title", "meta.title_missing", "high"),
      card("call", "contact.no_click_to_call", "high"),
      card("alt", "a11y.images_missing_alt", "low"),
      card("desc", "meta.description_missing", "medium"),
    ];
    const calls = buildRulesPlan({ businessName: "Sunrise", primaryGoal: "more_calls", cards, missing: [] })!;
    expect(calls.priorities.map((p) => p.card_id)).toEqual(["call", "title", "slow", "desc", "alt"]);
    const found = buildRulesPlan({ businessName: "Sunrise", primaryGoal: "get_found", cards, missing: [] })!;
    // Same impact: the small change comes before the large one, and goal-serving actions lead.
    expect(found.priorities.map((p) => p.card_id).slice(0, 3)).toEqual(["title", "slow", "call"]);
    expect(buildRulesPlan({ businessName: "Sunrise", primaryGoal: null, cards, missing: [] })!.objectives).toEqual([]);
  });

  it("is stable and deterministic: the same input gives the same plan", () => {
    const cards = [card("a", "meta.title_missing", "high"), card("b", "content.h1_missing", "high")];
    const input = { businessName: "Sunrise", primaryGoal: "get_found", cards, missing: [] as never[] };
    expect(JSON.stringify(buildRulesPlan(input))).toBe(JSON.stringify(buildRulesPlan(input)));
  });

  it("says it is rules, names the goal only when an action serves it, and asks only about what is missing", () => {
    const plan = buildRulesPlan({ businessName: "Sunrise", primaryGoal: "more_calls", cards: [card("call", "contact.no_click_to_call", "high"), card("alt", "a11y.images_missing_alt", "high")], missing: ["audience", "service_area", "goal" as never] })!;
    expect(plan.summary).toMatch(/fixed rules/);
    expect(plan.priorities[0]!.why_now).toMatch(/supports your goal to get more calls/);
    expect(plan.priorities[1]!.why_now).not.toMatch(/your goal/);
    expect(plan.questions).toEqual(["Who is your ideal customer?", "Which areas do you serve?"]);
  });

  it("only says an action supports a goal when the link is direct (calls: contact and local checks, not a thin homepage)", () => {
    const plan = buildRulesPlan({ businessName: "Sunrise", primaryGoal: "more_calls", cards: [card("thin", "content.thin_homepage", "high"), card("call", "contact.no_click_to_call", "high")], missing: [] })!;
    expect(plan.priorities.find((p) => p.card_id === "thin")!.why_now).not.toMatch(/your goal/);
    expect(plan.priorities.find((p) => p.card_id === "call")!.why_now).toMatch(/your goal/);
  });

  it("fits the database's plan shape: sizes, at most 8 priorities, 5 later items, dependencies empty, only given card ids", () => {
    const cards = Array.from({ length: 20 }, (_, i) => card(`c${i}`, i % 2 ? "meta.title_missing" : "pagespeed.performance", i % 3 ? "high" : "low", { title: "T".repeat(300), why_it_matters: "W".repeat(900) + ".", recommended_action: "R".repeat(900) + "." }));
    const plan = buildRulesPlan({ businessName: "N".repeat(200), primaryGoal: "get_found", cards, missing: ["what_it_does", "service", "audience", "service_area", "value_proposition", "contact_phone"] })!;
    const ids = new Set(cards.map((c) => c.id));
    expect(plan.summary.length).toBeLessThanOrEqual(600);
    expect(plan.priorities).toHaveLength(8);
    expect(plan.not_now).toHaveLength(5);
    expect(plan.next_steps.length).toBeLessThanOrEqual(5);
    expect(plan.questions.length).toBeLessThanOrEqual(4);
    expect(plan.objectives.length).toBeLessThanOrEqual(3);
    for (const p of plan.priorities) {
      expect(ids.has(p.card_id)).toBe(true);
      expect(p.why_now.length).toBeLessThanOrEqual(500);
      expect(p.depends_on).toEqual([]);
    }
    for (const s of plan.next_steps) expect(s.length).toBeLessThanOrEqual(300);
    expect(new Set([...plan.priorities.map((p) => p.card_id), ...plan.not_now.map((n) => n.card_id)]).size).toBe(13);
  });

  it("effort comes from the check, defaulting to medium (including for cards without a check)", () => {
    expect(effortOf("meta.title_missing")).toBe("small");
    expect(effortOf("pagespeed.performance")).toBe("large");
    expect(effortOf(null)).toBe("medium");
    expect(effortOf("something.new")).toBe("medium");
  });
});

describe("page text keeps blocks apart (found by the independent-review packets)", () => {
  it("minified HTML with no whitespace between tags does not run words together", () => {
    const f = page("<html><head><title>T</title></head><body><h1>Services</h1><ul><li>Cleanings</li><li>Fillings</li><li>Crowns</li></ul><p>We welcome new patients.</p><p>Call us.<br>Today.</p></body></html>");
    expect(f.text).toBe("Services Cleanings Fillings Crowns We welcome new patients. Call us. Today.");
    expect(f.text).not.toMatch(/ServicesCleanings|CleaningsFillings/);
    expect(f.wordCount).toBe(11);
  });

  it("inline markup inside a sentence is not split", () => {
    expect(page("<p>We are <b>family</b>-owned and <a href='/x'>local</a>.</p>").text).toBe("We are family-owned and local.");
  });
});
