/**
 * Content breadth (spec §8): FAQ, article and brief as campaign channels. Rules only, on hand-written outputs: the same checks
 * that protect every other draft (no promises, no invented figures, sensible length, nothing empty) apply to the new types, and
 * the playbook places them after the page they point to. Real model output is checked by the evaluation, not here.
 */
import { describe, expect, it } from "vitest";

import { CHANNEL_LABEL, planCampaigns, promoteService, type CampaignInput } from "@/lib/campaigns";
import { checkTaskDraft, ContentRejected, isChannelKind } from "@/lib/server/agent/modules/content-creation";

const faqOut = { q1: "How much does drain cleaning cost?", a1: "It depends on the job, so [your price or free quote].", q2: "How soon can you come?", a2: "[your usual lead time]", q3: "Do you serve Plano?", a3: "Yes, Sunrise Plumbing serves Plano.", q4: "How do I book?", a4: "Call [your phone number]." };
const SOURCE = "Sunrise Plumbing drain cleaning Plano";

describe("the new channels are known everywhere a channel is", () => {
  it("are valid draft channels with plain labels", () => {
    for (const c of ["faq", "blog_post", "content_brief"] as const) { expect(isChannelKind(c)).toBe(true); expect(CHANNEL_LABEL[c].length).toBeGreaterThan(5); }
    expect(isChannelKind("podcast")).toBe(false);
  });
});

describe("checkTaskDraft for the new types", () => {
  it("joins an FAQ as question and answer pairs, in order", () => {
    expect(checkTaskDraft("faq", faqOut, SOURCE)).toBe([1, 2, 3, 4].map((n) => `Q: ${faqOut[`q${n}` as keyof typeof faqOut]}\nA: ${faqOut[`a${n}` as keyof typeof faqOut]}`).join("\n\n"));
  });
  it("joins an article as title, opening, body and closing", () => {
    const t = checkTaskDraft("blog_post", { title: "Why drains clog", intro: "Most clogs start small.", body: "Hair and grease build up over time.", closing: "Call [your phone number]." }, SOURCE);
    expect(t.split("\n\n")).toEqual(["Why drains clog", "Most clogs start small.", "Hair and grease build up over time.", "Call [your phone number]."]);
  });
  it("labels the parts of a brief", () => {
    const t = checkTaskDraft("content_brief", { purpose: "Get calls.", reader: "Plano homeowners.", outline: "Headline; what's included.", facts_to_supply: "[prices]", avoid: "Guarantees." }, SOURCE);
    expect(t).toContain("Get calls.");
    expect(t).toContain("Outline\nHeadline; what's included.");
  });

  it("refuses a promise, an invented figure, an empty or an overlong part, in every new type", () => {
    const reject = (kind: "faq" | "blog_post" | "content_brief", out: Record<string, string>, reason: RegExp | string) => {
      let err: unknown;
      try { checkTaskDraft(kind, out, SOURCE); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ContentRejected);
      expect((err as ContentRejected).reason).toMatch(reason);
    };
    reject("faq", { ...faqOut, a1: "We guarantee the lowest price in Plano." }, /./);
    reject("faq", { ...faqOut, a2: "We have served 4,200 customers since 1998." }, "figure_not_in_source");
    reject("faq", { ...faqOut, a3: "" }, "empty_field");
    reject("faq", { ...faqOut, q4: "x".repeat(400) }, "too_long");
    reject("blog_post", { title: "T", intro: "I", body: "We will get you number one on Google in 30 days.", closing: "C" }, /./);
    reject("content_brief", { purpose: "P", reader: "R", outline: "O", facts_to_supply: "", avoid: "A" }, "empty_field");
    // Only the "Leave out" field may NAME a promise to avoid; the same word anywhere else in the brief is still refused.
    reject("content_brief", { purpose: "Promise a guarantee.", reader: "R", outline: "O", facts_to_supply: "F", avoid: "A" }, "promise");
    expect(() => checkTaskDraft("content_brief", { purpose: "P", reader: "R", outline: "O", facts_to_supply: "F", avoid: "Guarantees and ranking claims." }, SOURCE)).not.toThrow();
    reject("content_brief", { purpose: "P", reader: "R", outline: "O", facts_to_supply: "F", avoid: "Charge 4,200 dollars." }, "figure_not_in_source");
  });
});

describe("the promote-a-service playbook uses them", () => {
  const base: CampaignInput = { businessName: "Sunrise Plumbing", serviceArea: "Plano", primaryGoal: "more_calls", confirmedServices: ["drain cleaning"], cards: [], own: null, competitors: [] };
  const c = promoteService(base)!;
  it("adds an FAQ, a brief and an article after the page, each depending on it, and keeps the final comparison last", () => {
    const channels = c.tasks.map((t) => t.channel ?? null);
    expect(channels).toEqual([null, "landing_page", "email", "social", "gbp", "faq", "content_brief", "blog_post", null]);
    const page = channels.indexOf("landing_page") + 1;
    for (const t of c.tasks.filter((x) => x.channel && ["faq", "content_brief", "blog_post"].includes(x.channel))) expect(t.depends_on).toEqual([page]);
    expect(c.tasks.at(-1)!.title).toBe("Compare after a month");
    for (const [i, t] of c.tasks.entries()) for (const d of t.depends_on ?? []) expect(d).toBeLessThan(i + 1);
  });
  it("fills templates only from confirmed facts; everything else stays a visible [blank]", () => {
    const faq = c.tasks.find((t) => t.channel === "faq")!.deliverable!;
    expect(faq).toContain("Yes, Sunrise Plumbing serves Plano.");
    expect(faq).toMatch(/\[how you price it/);
    expect(c.tasks.find((t) => t.channel === "content_brief")!.deliverable).toMatch(/\[prices\], \[photos of your work\]/);
    expect(c.summary.length).toBeLessThanOrEqual(600);
    expect(planCampaigns(base).map((x) => x.playbook)).toContain("promote_service");
  });
});
