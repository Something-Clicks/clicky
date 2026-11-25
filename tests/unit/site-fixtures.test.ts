/**
 * The whole deterministic agent (scan → structured data → findings → business details → ranking → rules-based plan) on four
 * realistic fixture sites with KNOWN ground truth. This is automated testing on fixtures, not real websites: it proves the
 * extraction, labelling and no-invention rules, and says nothing about how the agent does on sites it has never seen.
 * Real sites: `SITECHECK_URLS=... pnpm sitecheck` (evals/sitecheck).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkSite, toMarkdown, type SiteReport } from "../../evals/sitecheck/run";
import type { FetchedPage } from "@/lib/server/safe-fetch";

const html = (name: string) => readFileSync(join(__dirname, "..", "fixtures", "sites", name), "utf8");
const serve = (name: string) => async (url: string): Promise<FetchedPage> => {
  const path = new URL(url).pathname;
  const root = path === "/" || path === "";
  return { url, status: root ? 200 : 404, contentType: "text/html", body: root ? html(name) : "", truncated: false, redirects: [] };
};
const noSpeed = async () => ({ ok: false as const, reason: "not measured in tests" });
const run = (name: string, host: string, goal: string | null = null) =>
  checkSite(`https://${host}/`, { businessName: host, serviceArea: null, primaryGoal: goal }, { fetchPage: serve(name), pageSpeed: noSpeed });
const pageText = (r: SiteReport) => [r.scan!.homepage, ...r.scan!.pages].map((p) => p.text).join("\n");
const DESCRIPTIVE = /^(Structured data on the page lists|Tap-to-call link|Email link|Link "|Phone number in the page text)/;

describe("plumber with structured data and plain claims", () => {
  it("finds the plain facts, labels their source, and quotes the site's own words exactly", async () => {
    const r = await run("plumber.html", "sunrise-plumbing.example", "more_calls");
    expect(r.ok).toBe(true);
    const f = (field: string) => r.facts.filter((x) => x.field === field);
    expect(f("contact_phone").map((x) => x.value)).toContain("(801) 555-0123");
    expect(f("contact_email").map((x) => x.value)).toEqual(["hello@sunrise-plumbing.example"]);
    expect(f("location")[0]!.value).toBe("12 Main St, Provo, UT 84601");
    expect(f("service_area").map((x) => x.value)).toEqual(["Provo", "Orem"]);
    expect(f("service").map((x) => x.value)).toEqual(["Drain cleaning", "Water heater repair"]);
    // Every quoted sentence really is on the page; every other source says what was observed.
    for (const fact of r.facts) {
      expect(fact.evidence.length, `${fact.field} has evidence`).toBeGreaterThan(0);
      for (const e of fact.evidence) {
        expect(e.kind).toBe("observed");
        if (!DESCRIPTIVE.test(e.excerpt ?? "")) expect(pageText(r)).toContain(e.excerpt!);
      }
    }
    const claims = r.facts.filter((x) => x.field === "trust_signal" || x.field === "competitive_advantage");
    expect(claims.every((x) => x.value!.startsWith("The site states:") || x.value!.startsWith("The site shows a rating"))).toBe(true);
    expect(claims.map((x) => x.value).join(" ")).toMatch(/family-owned company serving Utah County since 2009/);
  });

  it("quotes are single sentences from one block of the page, never navigation or headings glued on", async () => {
    for (const [file, host] of [["plumber.html", "sunrise-plumbing.example"], ["claims-heavy.html", "texas-best-roofing.example"]] as const) {
      const r = await run(file, host);
      const quotes = r.facts.filter((x) => x.field === "trust_signal" || x.field === "competitive_advantage").map((x) => x.evidence[0]!.excerpt!).filter((q) => !DESCRIPTIVE.test(q));
      expect(quotes.length).toBeGreaterThan(0);
      for (const q of quotes) {
        expect(q, q).not.toMatch(/About Contact|Drain cleaning Water heater|Texas Award-winning/); // nav / heading text from beside the sentence
        expect((q.match(/[.!?]\s+[A-Z]/g) ?? []).length, `one sentence: ${q}`).toBe(0);
      }
    }
  });

  it("does not claim anything the page does not say", async () => {
    const r = await run("plumber.html", "sunrise-plumbing.example");
    const everything = JSON.stringify(r.facts);
    for (const invented of ["24/7", "award", "years of experience", "BBB", "insured and bonded", "free quote"]) expect(everything.toLowerCase()).not.toContain(invented.toLowerCase());
    expect(r.missing).toEqual(expect.arrayContaining(["audience", "value_proposition"])); // unknown stays unknown
    expect(r.missing).not.toContain("contact_phone");
  });

  it("ranks findings with class and confidence, and the plan points only at real findings in a stable order", async () => {
    const r = await run("plumber.html", "sunrise-plumbing.example", "more_calls");
    for (const f of r.findings) {
      expect(["verified", "inferred", "estimated", "unknown"]).toContain(f.evidence_class);
      expect(["high", "medium", "low"]).toContain(f.confidence);
      expect(f.evidence.length).toBeGreaterThan(0);
    }
    const ids = new Set(r.findings.map((f) => f.id));
    expect(r.plan!.priorities.every((p) => ids.has(p.card_id))).toBe(true);
    expect(JSON.stringify((await run("plumber.html", "sunrise-plumbing.example", "more_calls")).plan)).toBe(JSON.stringify(r.plan));
    expect(r.plan!.questions).toEqual(expect.arrayContaining(["Who is your ideal customer?"]));
  });
});

describe("thin one-page site", () => {
  it("finds no contact details, says what is unknown, and still produces honest findings and a plan", async () => {
    const r = await run("thin-onepager.html", "joes-lawn.example");
    expect(r.facts.filter((x) => ["contact_phone", "contact_email", "location", "service_area", "pricing"].includes(x.field))).toEqual([]);
    expect(r.missing).toEqual(expect.arrayContaining(["what_it_does", "service", "audience", "service_area", "value_proposition", "contact_phone"]));
    const keys = r.findings.map((f) => f.check_key);
    expect(keys).toEqual(expect.arrayContaining(["content.h1_missing", "mobile.viewport_missing", "content.thin_homepage", "meta.description_missing"]));
    expect(r.plan!.priorities.length).toBeGreaterThan(0);
    expect(r.plan!.questions.length).toBeGreaterThan(0);
  });
});

describe("a site full of claims, with an instruction hidden in its text", () => {
  it("reports claims as the site's claims (quoted, never as verified facts about the world) and ignores the instruction", async () => {
    const r = await run("claims-heavy.html", "texas-best-roofing.example");
    const claims = r.facts.filter((x) => x.field === "trust_signal" || x.field === "competitive_advantage");
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      expect(c.value!.startsWith("The site states:") || c.value!.startsWith("The site shows")).toBe(true);
      expect(pageText(r)).toContain(c.evidence[0]!.excerpt!);
    }
    const all = JSON.stringify(r.facts) + JSON.stringify(r.plan);
    expect(all).not.toMatch(/only roofer|10,000 customers|Ignore all previous/i);
    // Nothing is stated as a plain verified fact about being first or best.
    expect(r.facts.filter((x) => /number one|#1|best/i.test(x.value ?? "") && !x.value!.startsWith("The site states:"))).toEqual([]);
  });
});

describe("image-only site", () => {
  it("proposes nothing it cannot see, lists the unknowns, and reports the missing image descriptions", async () => {
    const r = await run("images-only.html", "bloom-studio.example");
    expect(r.facts).toEqual([]);
    expect(r.missing.length).toBeGreaterThanOrEqual(5);
    expect(r.findings.map((f) => f.check_key)).toEqual(expect.arrayContaining(["a11y.images_missing_alt", "content.thin_homepage"]));
  });
});

describe("the report a person checks by hand", () => {
  it("names every proposed detail with its kind and quote, and marks site claims as unchecked", async () => {
    const md = toMarkdown([await run("plumber.html", "sunrise-plumbing.example")]);
    expect(md).toMatch(/claim the site makes \(not checked\)/);
    expect(md).toMatch(/Not found on the site \(unknown\):/);
    expect(md).toMatch(/Correct\?/);
  });

  it("reports a site that cannot be scanned as such, never as an empty success", async () => {
    const bad = await checkSite("https://down.example/", { businessName: "x", serviceArea: null, primaryGoal: null }, { fetchPage: async () => { throw new Error("connect failed"); }, pageSpeed: noSpeed });
    expect(bad.ok).toBe(false);
    expect(bad.facts).toEqual([]);
  });
});
