/**
 * Every dataset case executed end to end through the REAL adapter, capabilities, grounding and automatic checks, against a
 * stand-in server that answers from the case's own answer key. This proves the machinery: every case can run, a good
 * answer is not wrongly flagged, and a bad answer is caught. It is a TEST DOUBLE built from the answer key and shows
 * nothing about any model's intelligence.
 */
import { afterEach, describe, expect, it } from "vitest";

import { ALL_CASES, TEST_SET } from "../../evals/model/dataset";
import { runEvalCase } from "../../evals/model/run";
import { selfHostedProvider } from "@/lib/server/agent/providers/self-hosted";

import { startStub, type Stub } from "../support/model-stub";
import { truthStandIn, type Override } from "../support/truth-standin";

let stub: Stub | null = null;
afterEach(async () => { await stub?.close(); stub = null; });
const NAMES = ALL_CASES.map((c) => c.business.name);
const provider = (s: Stub) => selfHostedProvider({ SELF_HOSTED_MODEL_URL: s.url, SELF_HOSTED_MODEL_TOKEN: "t".repeat(32), SELF_HOSTED_MODEL_ID: "answer-key-standin" })!;
const run = async (id: string, override?: Override) => {
  stub = await startStub(truthStandIn(ALL_CASES, override));
  return runEvalCase(provider(stub), ALL_CASES.find((c) => c.id === id)!, NAMES);
};

describe("an answer-key stand-in passes every automatic check on every case (the checks do not wrongly flag a good answer)", () => {
  it.each(ALL_CASES.map((c) => [c.id, c] as const))("%s", async (id, c) => {
    const r = await run(id);
    const k = r.checks!;
    const detail = JSON.stringify({ tasks: r.tasks.filter((t) => !t.ok).map((t) => [t.task, t.failure]), flags: k.flags, missing: k.understanding.recallMissing, plan: k.plan.map((p) => [p.task, p.mustAddressMissing, p.violations]) });
    expect(r.tasks.every((t) => t.ok && t.attempts === 1), detail).toBe(true);
    expect(k.flags, detail).toEqual([]);
    expect(k.understanding.recallMissing, detail).toEqual([]);
    expect(k.understanding.unknownHandledPct).toBe(100);
    expect(k.findings.expectedMissed, detail).toEqual([]);
    expect(k.plan.length).toBe(1 + c.notes.length);
    for (const p of k.plan) expect(p.mustAddressPct, detail).toBe(100);
    expect(k.drafts.every((d) => d.ok && d.mentionsOk && d.bannedHits.length === 0), detail).toBe(true);
    expect(k.structured).toMatchObject({ usable: k.structured.tasks, usableFirstTry: k.structured.tasks });
  });
});

describe("the checks catch what they claim to catch (bad answers from a stand-in)", () => {
  it("T1: a plan that recommends weekend promotions or a price war is a constraint violation and caps strategy", async () => {
    const r = await run("T1", (ctx, ideal) => (ctx.task === "plan" && ctx.notes ? { ...ideal, next_steps: ["Run a weekend special on tune-ups.", "Beat their prices on every job."] } : undefined));
    const p = r.checks!.plan.find((x) => x.task.startsWith("plan_notes:"))!;
    expect(p.violations.length).toBeGreaterThanOrEqual(2);
    expect(r.checks!.flags.some((f) => f.kind === "constraint_violation" && f.severity === "fail")).toBe(true);
    expect(r.checks!.autoCaps.strategy).toBeLessThanOrEqual(2);
    expect(r.checks!.autoCaps.consistency).toBeLessThanOrEqual(2);
  });

  it("T1: saying the plan AVOIDS weekend promotions is not a violation (negation guard)", async () => {
    const r = await run("T1", (ctx, ideal) => (ctx.task === "plan" && ctx.notes ? { ...ideal, next_steps: ["Do not run weekend promotions: the team does not take weekend jobs."] } : undefined));
    expect(r.checks!.plan.find((x) => x.task.startsWith("plan_notes:"))!.violations).toEqual([]);
  });

  it("T7: putting the call button first when the owner wants fewer calls is a first-priority violation", async () => {
    const r = await run("T7", (ctx, ideal) => {
      if (ctx.task !== "plan" || !ctx.notes) return undefined;
      const tap = ctx.actions.find((a) => /call you with one tap/i.test(a.title))!;
      const rest = (ideal.priorities as { action: string }[]).filter((p) => p.action !== tap.reference);
      return { ...ideal, priorities: [{ ...(ideal.priorities as object[])[0], action: tap.reference }, ...rest].map((p, i) => ({ ...p, order: i + 1 })) };
    });
    const p = r.checks!.plan.find((x) => x.task.startsWith("plan_notes:"))!;
    expect(p.firstPriorityCheck).toBe("contact.no_click_to_call");
    expect(p.firstPriorityViolation).toBe(true);
  });

  it("T3: an output that repeats the planted claim is flagged for a person to confirm", async () => {
    const r = await run("T3", (ctx, ideal) => (ctx.task === "plan" ? { ...ideal, summary: "Lone Star Glass Pros is the only auto glass shop in Texas, so lead with that." } : undefined));
    expect(r.checks!.injectionHits.length).toBeGreaterThan(0);
    expect(r.checks!.flags.some((f) => f.kind === "possible_injection_compliance" && f.severity === "review")).toBe(true);
  });

  it("T2: an invented flavor in a business detail is flagged as a possible invention", async () => {
    const r = await run("T2", (ctx, ideal) => {
      if (ctx.task !== "understanding") return undefined;
      const key = ctx.pages[0]!.key;
      return { facts: [...(ideal.facts as object[]), { category: "business", field: "product", value: "Apple and cherry hand pies", evidence_class: "verified", basis: "", quotes: [{ page_key: key, quote: "Hand pies, baked fresh on Saturdays." }] }] };
    });
    expect(r.checks!.invention.hits.some((h) => h.id === "flavors")).toBe(true);
    expect(r.checks!.understanding.guessedVerified).toBeGreaterThan(0);
  });

  it("T2: a fabricated quote is dropped by grounding and counted against raw quote validity", async () => {
    const r = await run("T2", (ctx, ideal) => (ctx.task === "understanding" ? { facts: [...(ideal.facts as object[]), { category: "business", field: "product", value: "Pies baked by hand", evidence_class: "verified", basis: "", quotes: [{ page_key: ctx.pages[0]!.key, quote: "Baking pies the old way." }] }] } : undefined));
    const u = r.tasks.find((t) => t.task === "understanding")!;
    expect(u.yield!.rejectedReasons.quote_not_found).toBe(1);
    expect(r.checks!.understanding.rawQuoteValidPct).toBeLessThan(100);
  });

  it("T7: stating only one of the conflicting phone numbers, silently, is flagged", async () => {
    const r = await run("T7", (ctx, ideal) => (ctx.task === "understanding" ? { facts: (ideal.facts as { value: string }[]).filter((f) => !/0141|0188/.test(f.value)) } : undefined));
    expect(r.checks!.conflicts.some((c) => c.silentChoice)).toBe(true);
  });

  it("another business's name in an output is a cross-case leak and caps consistency", async () => {
    const r = await run("T4", (ctx, ideal) => (ctx.task === "plan" ? { ...ideal, summary: "Harbor Light Kitchen should do what Alder Creek Heating and Cooling does." } : undefined));
    expect(r.checks!.crossCaseLeaks).toContain("Alder Creek Heating and Cooling");
    expect(r.checks!.autoCaps.consistency).toBeLessThanOrEqual(2);
  });

  it("a draft with a banned claim or without the business is capped", async () => {
    const r = await run("T4", (ctx, ideal) => (ctx.task === "draft_meta" ? { ...ideal, meta_description: "Harbor Light Kitchen: a Michelin favorite for seafood." } : undefined));
    expect(r.checks!.drafts.find((d) => d.task === "draft_meta")!.bannedHits.length).toBeGreaterThan(0);
    expect(r.checks!.autoCaps.content).toBeLessThanOrEqual(2);
  });

  it("answers in prose are retried once, and two failures end in a recorded, typed failure that caps the capability", async () => {
    let n = 0;
    const flaky = await run("T2", (ctx) => (ctx.task === "findings" ? (n++ === 0 ? "invalid" : undefined) : undefined));
    expect(flaky.tasks.find((t) => t.task === "findings")).toMatchObject({ ok: true, attempts: 2 });
    await stub!.close();
    const broken = await run("T2", (ctx) => (ctx.task === "draft_meta" ? "invalid" : undefined));
    const t = broken.tasks.find((x) => x.task === "draft_meta")!;
    expect(t).toMatchObject({ ok: false, attempts: 2 });
    expect(t.failure).toMatch(/^unusable:/);
    expect(broken.checks!.autoCaps.content).toBe(1);
    expect(broken.checks!.autoCaps.structured).toBeLessThanOrEqual(3);
  });

  it("a plan whose reasons name nothing about the business is generic advice: strategic reasoning is capped", async () => {
    const r = await run("T6", (ctx, ideal) => (ctx.task === "plan" ? { ...ideal, priorities: (ideal.priorities as { why_now: string }[]).map((p) => ({ ...p, why_now: "This is important for any company that wants to do well." })) } : undefined));
    expect(r.checks!.plan[0]!.specificityPct).toBe(0);
    expect(r.checks!.autoCaps.strategy).toBeLessThanOrEqual(3);
  });

  it("a refusal is recorded as a refused call", async () => {
    const r = await run("T2", (ctx) => (ctx.task === "plan" ? "refuse" : undefined));
    const t = r.tasks.find((x) => x.task === "plan")!;
    expect(t.ok).toBe(false);
    expect(t.refusals).toBeGreaterThan(0);
  });

  it("a made-up plan that points at actions that do not exist is cut down by grounding and recorded as the share that survived", async () => {
    const r = await run("T6", (ctx, ideal) => (ctx.task === "plan" ? { ...ideal, priorities: [...(ideal.priorities as object[]), { action: "a99", order: 9, why_now: "Fernhill needs this because of soy.", effort: "small", based_on: [], depends_on: [] }] } : undefined));
    const p = r.tasks.find((t) => t.task === "plan")!;
    expect(p.ok).toBe(true);
    expect(p.yield!.proposed).toBeGreaterThan(p.yield!.kept);
  });
});

describe("the dataset really has the shape the evaluation needs", () => {
  it("runs the scored cases only when asked: the scored set is the 10 test cases", () => {
    expect(TEST_SET).toHaveLength(10);
  });
});
