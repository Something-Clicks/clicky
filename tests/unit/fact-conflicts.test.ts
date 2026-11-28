/**
 * Conflicting-fact detection (spec §14). Fixtures only: no model. The cases that must NOT be flagged matter as much as the ones that are.
 */
import { describe, expect, it } from "vitest";

import type { FactField, StoredFact } from "@/lib/business-profile";
import { understand } from "@/lib/server/agent/modules/business-intelligence";
import { detectConflicts, sameValue } from "@/lib/server/agent/modules/fact-conflicts";

let n = 0;
const fact = (field: FactField, value: string, over: Partial<StoredFact> = {}): StoredFact => ({
  id: `f${++n}`, category: "business", field, value, source: "website", evidence_class: "verified", basis: null, evidence: [],
  status: "proposed", observed_at: "2026-11-01T00:00:00Z", confirmed_at: null, ...over,
});
const none = { serviceArea: null as string | null };

describe("sameValue", () => {
  it("phones agree whatever the formatting", () => expect(sameValue("contact_phone", "(512) 555-0142", "+1 512-555-0142")).toBe(true));
  it("different phones disagree", () => expect(sameValue("contact_phone", "(512) 555-0142", "(512) 555-0199")).toBe(false));
  it("emails compare case-insensitively", () => expect(sameValue("contact_email", "Hi@Shop.com", "hi@shop.com")).toBe(true));
  it("a place and a wider mention of it agree; disjoint places disagree", () => {
    expect(sameValue("service_area", "Austin", "Austin and Round Rock")).toBe(true);
    expect(sameValue("service_area", "Austin, Texas", "Serving Austin")).toBe(true);
    expect(sameValue("service_area", "Austin", "Denver and Boulder")).toBe(false);
  });
});

describe("detectConflicts", () => {
  it("flags an owner-confirmed phone against a different phone found on the website, as confirmed_vs_new, with a plain question", () => {
    const c = detectConflicts({ profile: none, facts: [fact("contact_phone", "(512) 555-0142", { source: "owner", status: "confirmed" }), fact("contact_phone", "(512) 555-0199")] });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ field: "contact_phone", kind: "confirmed_vs_new" });
    expect(c[0]!.claims.map((x) => x.value).sort()).toEqual(["(512) 555-0142", "(512) 555-0199"]);
    expect(c[0]!.question).toMatch(/Which one should customers call\?/);
  });

  it("flags the owner's profile service area against a different one the website states", () => {
    const c = detectConflicts({ profile: { serviceArea: "Austin" }, facts: [fact("service_area", "Denver and Boulder")] });
    expect(c.map((x) => x.field)).toEqual(["service_area"]);
    expect(c[0]!.claims.map((x) => x.source).sort()).toEqual(["profile", "website"]);
  });

  it("flags a phone shown on the homepage now that differs from the stored one", () => {
    const c = detectConflicts({ profile: none, facts: [fact("contact_phone", "(512) 555-0142", { status: "confirmed", source: "owner" })], selfSignals: { phone: "(512) 555-7777", observed_at: "2026-11-20T00:00:00Z" } });
    expect(c[0]).toMatchObject({ field: "contact_phone", kind: "confirmed_vs_new" });
  });

  it("two unconfirmed proposals that disagree are 'unconfirmed'; two confirmed ones are the most serious", () => {
    expect(detectConflicts({ profile: none, facts: [fact("location", "12 Oak St, Austin"), fact("location", "9 Pine Rd, Denver")] })[0]!.kind).toBe("unconfirmed");
    const both = detectConflicts({ profile: none, facts: [fact("contact_email", "a@x.com", { status: "confirmed" }), fact("contact_email", "b@y.com", { status: "confirmed" })] });
    expect(both[0]!.kind).toBe("confirmed_vs_confirmed");
  });

  it("does NOT flag agreement, many-valued fields, rejected or unknown facts", () => {
    const facts = [
      fact("contact_phone", "(512) 555-0142"), fact("contact_phone", "512.555.0142", { source: "owner", status: "confirmed" }),
      fact("service", "Drain cleaning"), fact("service", "Water heater repair"), fact("trust_signal", "Licensed"), fact("trust_signal", "Insured"),
      fact("contact_email", "old@x.com", { status: "rejected" }), fact("contact_email", "new@x.com"),
      fact("location", "", { value: null, evidence_class: "unknown", basis: "not stated" }), fact("location", "12 Oak St"),
    ];
    expect(detectConflicts({ profile: { serviceArea: "Austin" }, facts: [...facts, fact("service_area", "Austin and Round Rock")] })).toEqual([]);
  });

  it("orders the most serious first", () => {
    const c = detectConflicts({
      profile: none,
      facts: [fact("location", "12 Oak St, Austin"), fact("location", "9 Pine Rd, Denver"), fact("contact_email", "a@x.com", { status: "confirmed" }), fact("contact_email", "b@y.com", { status: "confirmed" })],
    });
    expect(c.map((x) => x.kind)).toEqual(["confirmed_vs_confirmed", "unconfirmed"]);
  });
});

describe("understand() carries conflicts into everything the agent says", () => {
  const profile = { businessName: "Acme", website: "https://acme.example", serviceArea: null, primaryGoal: null };
  it("marks disputed details so prompts never state them as fact, and leaves undisputed ones unmarked", () => {
    const u = understand(profile, [fact("contact_phone", "(512) 555-0142", { source: "owner", status: "confirmed" }), fact("contact_phone", "(512) 555-0199"), fact("service", "Plumbing")]);
    expect(u.conflicts).toHaveLength(1);
    expect(u.known.filter((k) => k.field === "contact_phone").every((k) => k.disputed === true)).toBe(true);
    expect(u.known.find((k) => k.field === "service")).not.toHaveProperty("disputed");
  });
  it("is empty (and adds nothing to what prompts see) when sources agree", () => {
    const u = understand(profile, [fact("contact_phone", "(512) 555-0142")]);
    expect(u.conflicts).toEqual([]);
    expect(JSON.stringify(u.known)).not.toContain("disputed");
  });
});
