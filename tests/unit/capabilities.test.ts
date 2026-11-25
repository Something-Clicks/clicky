/**
 * Capability modules of the Something Clicks Marketing Agent, tested one by one (specification §2.2).
 * Inputs are hand-written page facts and fixture HTML; no model and no network.
 */
import { describe, expect, it } from "vitest";

import type { StoredFact } from "@/lib/business-profile";
import { claimProblem, classFromKinds } from "@/lib/evidence";
import { CAPABILITIES, type CapabilityId } from "@/lib/server/agent/capabilities";
import { BUILT, MODULES } from "@/lib/server/agent/modules";
import { CORE_FIELDS, formatPhone, propose, understand } from "@/lib/server/agent/modules/business-intelligence";
import { classifyFindings, findingCategory, marketingAnalysis } from "@/lib/server/agent/modules/marketing-analysis";
import { performanceIntelligence } from "@/lib/server/agent/modules/performance-intelligence";
import { seoIntelligence } from "@/lib/server/agent/modules/seo-intelligence";
import { expectDone } from "@/lib/server/agent/modules/types";
import { websiteIntelligence } from "@/lib/server/agent/modules/website-intelligence";
import type { FetchedPage } from "@/lib/server/safe-fetch";
import { extractFacts, type SiteScan } from "@/lib/server/site-scan";

const page = (url: string, body: string, status = 200): FetchedPage => ({ url, status, contentType: "text/html", body, truncated: false, redirects: [] });
const HOME = `<!doctype html><html><head><title>Sunrise Plumbing</title></head><body>
  <nav><a href="/services/drain-cleaning">Drain Cleaning</a><a href="/services/water-heaters">Water Heater Repair</a>
  <a href="/services/">Services</a><a href="/services/learn">Learn more</a><a href="/about">About</a></nav>
  <h1>Plumbing in Salt Lake City</h1><a href="tel:+18015550123">Call us</a> <a href="mailto:Hello@Sunrise.example?subject=Hi">Email</a>
  <p>${"We fix leaks and clear drains. ".repeat(30)}</p></body></html>`;
const psiMissing = async () => ({ ok: false as const, reason: "PageSpeed Insights is busy right now." });
const scanOf = (html: string): SiteScan => ({ homepage: extractFacts(page("https://sunrise.example/", html)), pages: [], failures: [] });
const profile = { businessName: "Sunrise Plumbing", website: "https://sunrise.example/", serviceArea: "Salt Lake City", primaryGoal: "more_calls" };

describe("the capability registry", () => {
  it("has a module for every capability in the specification", () => {
    expect(Object.keys(MODULES).sort()).toEqual((Object.keys(CAPABILITIES) as CapabilityId[]).sort());
    for (const [id, m] of Object.entries(MODULES)) expect(m.id).toBe(id);
  });

  it("unbuilt capabilities report blocked with a reason and never return output", async () => {
    for (const id of Object.keys(MODULES) as CapabilityId[]) {
      if (BUILT.includes(id)) continue;
      const r = await MODULES[id].run(undefined as never);
      expect(r.status, id).toBe("blocked");
      expect((r as { reason: string }).reason, id).toMatch(/model provider|integration|not built/);
    }
  });
});

describe("evidence classes", () => {
  it("derive from evidence kinds, strongest first", () => {
    expect(classFromKinds(["missing", "measured"])).toBe("verified");
    expect(classFromKinds(["estimated", "missing"])).toBe("estimated");
    expect(classFromKinds([])).toBe("unknown");
  });

  it("enforce the same rules as the database", () => {
    expect(claimProblem({ evidence_class: "verified", cited_kinds: ["missing"], basis: null })).toBe("verified_without_direct_evidence");
    expect(claimProblem({ evidence_class: "verified", cited_kinds: [], basis: null, owner_supplied: true })).toBeNull();
    expect(claimProblem({ evidence_class: "inferred", cited_kinds: ["observed"], basis: " " })).toBe("inferred_without_basis");
    expect(claimProblem({ evidence_class: "inferred", cited_kinds: [], basis: "x" })).toBe("inferred_without_evidence");
    expect(claimProblem({ evidence_class: "estimated", cited_kinds: [], basis: null })).toBe("estimated_without_basis");
    expect(claimProblem({ evidence_class: "unknown", cited_kinds: [], basis: null })).toBeNull();
  });
});

describe("Website Intelligence", () => {
  it("retrieves the homepage and key pages and says what it reviewed", async () => {
    const r = expectDone(await websiteIntelligence.run({ website: "https://sunrise.example/", fetchPage: async (u) => page(u, HOME), pageSpeed: psiMissing }), "wi");
    expect(r.output.pagesReviewed).toBeGreaterThan(1);
    expect(r.detail).toMatch(/Reviewed \d pages; mobile speed not available\./);
  });

  it("refuses a homepage that returns an error", async () => {
    await expect(websiteIntelligence.run({ website: "https://sunrise.example/", fetchPage: async (u) => page(u, "nope", 404), pageSpeed: psiMissing })).rejects.toThrow(/returned an error \(404\)/);
  });
});

describe("Marketing Analysis and SEO Intelligence", () => {
  it("categorizes findings and gives each an evidence class from its evidence", async () => {
    const site = { scan: scanOf("<html><body><p>Hi</p></body></html>"), psi: await psiMissing(), pagesReviewed: 1 };
    const a = expectDone(await marketingAnalysis.run({ site, business: { businessName: "Sunrise", serviceArea: null, primaryGoal: null } }), "ma").output;
    expect(a.findings.length).toBeGreaterThan(2);
    for (const f of a.findings) {
      expect(["seo", "technical", "conversion", "content", "local"]).toContain(f.category);
      expect(["verified", "unknown"]).toContain(f.evidence_class);
    }
    expect(a.ranked.map((r) => r.check_key).sort()).toEqual(a.findings.map((f) => f.check_key).sort());
    const seo = expectDone(await seoIntelligence.run({ analysis: a }), "seo").output;
    expect(seo.findings.every((f) => f.category === "seo")).toBe(true);
    expect(seo.findings.map((f) => f.check_key)).toContain("meta.title_missing");
    expect(seo.keyword_data).toBe("not_connected");
  });

  it("maps check families to categories", () => {
    expect([findingCategory("meta.title_missing"), findingCategory("mobile.viewport_missing"), findingCategory("contact.no_click_to_call"), findingCategory("local.service_area_missing")])
      .toEqual(["seo", "technical", "conversion", "local"]);
    const [f] = classifyFindings([{ check_key: "meta.x", evidence_keys: ["a", "b"] } as never], [{ key: "a", kind: "missing" }, { key: "b", kind: "observed" }]);
    expect(f!.evidence_class).toBe("verified");
  });
});

describe("Business Intelligence", () => {
  it("proposes contact details (verified) and services (inferred, with a basis) from the website", () => {
    const facts = propose(scanOf(HOME));
    expect(facts.map((f) => [f.field, f.value, f.evidence_class])).toEqual([
      ["contact_phone", "(801) 555-0123", "verified"],
      ["contact_email", "hello@sunrise.example", "verified"],
      ["service", "Drain Cleaning", "inferred"],
      ["service", "Water Heater Repair", "inferred"],
    ]);
    const svc = facts.find((f) => f.field === "service")!;
    expect(svc.basis).toMatch(/links to a page at \/services\/drain-cleaning labeled "Drain Cleaning"/);
    expect(svc.evidence[0]).toMatchObject({ kind: "observed", url: "https://sunrise.example/" });
    for (const f of facts) expect(claimProblem({ evidence_class: f.evidence_class, cited_kinds: f.evidence.map((e) => e.kind), basis: f.basis })).toBeNull();
  });

  it("falls back to a phone number in the page text; formats North American numbers", () => {
    expect(propose(scanOf("<html><body><p>Call 801.555.0199 today.</p></body></html>"))).toMatchObject([{ field: "contact_phone", value: "(801) 555-0199", evidence_class: "verified" }]);
    expect(formatPhone("tel:+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });

  it("proposes nothing it cannot support", () => {
    expect(propose(scanOf("<html><body><p>Welcome.</p><a href='/services/'>Services</a></body></html>"))).toEqual([]);
  });

  const stored = (over: Partial<StoredFact>): StoredFact => ({
    id: "f", category: "business", field: "service", value: "Drain cleaning", source: "website", evidence_class: "inferred", basis: "b",
    evidence: [], status: "proposed", observed_at: "2026-11-01T00:00:00Z", confirmed_at: null, ...over,
  });

  it("understands the business: owner and confirmed facts first, stale website facts never treated as current", () => {
    const now = new Date("2026-11-25T00:00:00Z");
    const u = understand(profile, [
      stored({ id: "1" }),
      stored({ id: "2", field: "audience", category: "customer", value: "Homeowners", status: "confirmed", evidence_class: "verified", source: "owner" }),
      stored({ id: "3", field: "what_it_does", value: "Old description", observed_at: "2026-01-01T00:00:00Z" }),
      stored({ id: "4", value: "Pool cleaning", status: "rejected" }),
      stored({ id: "5", field: "value_proposition", category: "brand", value: null, evidence_class: "unknown" }),
    ], now);
    expect(u.known.map((k) => [k.field, k.value, k.confirmed])).toEqual([
      ["service_area", "Salt Lake City", true], ["goal", "Get more calls and enquiries", true], ["audience", "Homeowners", true], ["service", "Drain cleaning", false],
    ]);
    expect(u.stale).toEqual([{ field: "what_it_does", value: "Old description", observed_at: "2026-01-01T00:00:00Z" }]);
    expect(u.missing).toEqual(["what_it_does", "value_proposition", "contact_phone"]);
    expect(CORE_FIELDS).toHaveLength(6);
  });

  it("runs as a module: proposals count as current knowledge until the owner reviews them", async () => {
    const r = expectDone(await MODULES.business_intelligence.run({ profile, scan: scanOf(HOME) }), "bi");
    expect(r.output.proposals).toHaveLength(4);
    expect(r.output.understanding.missing).toEqual(["what_it_does", "audience", "value_proposition"]);
    expect(r.detail).toMatch(/4 proposed from the website, awaiting the owner/);
  });
});

describe("Performance Intelligence", () => {
  it("summarizes what happened to completed and approved work", async () => {
    const r = expectDone(await performanceIntelligence.run({ cards: [
      { status: "done", verification: "fixed" }, { status: "approved", verification: "still_found" }, { status: "done", verification: null }, { status: "new", verification: null },
    ] }), "pi").output;
    expect(r).toEqual({ completed_or_approved: 3, verified_fixed: 1, still_found: 1, awaiting_check: 1, traffic_data: "not_connected" });
  });
});
