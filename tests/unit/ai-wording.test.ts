/**
 * Fallback recording and output validation for finding wording.
 * UNIT LEVEL: the model client is a stub, so this proves our handling of model output, not the live model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { parse };
  },
}));

// The app enables model features only through the provider registry (empty in the app). These tests
// switch the gate on explicitly to exercise the dormant wording code; the stub client is not a model.
const providerEnabled = { value: true };
vi.mock("@/lib/server/agent/provider", () => ({ getModelProvider: () => (providerEnabled.value ? { id: "unit-test-gate" } : null) }));

import { log } from "@/lib/log";
import { wordFindings } from "@/lib/server/ai";
import type { Evidence, Finding } from "@/lib/server/checks";

const finding = (key: string): Finding => ({
  check_key: key, title: `Template ${key}`, explanation: "template explanation", why_it_matters: "template why", recommended_action: "template action",
  expected_benefit: "template benefit", impact_priority: "high", confidence: "high", ai_capable: false, execution_type: "manual", approval_required: false, evidence_keys: ["e1"],
});
const evidence: Evidence[] = [{ key: "e1", source: "website", kind: "observed", check_key: "x", url: "https://s.example/", observation: "No title.", excerpt: null, measurement: null }];
const biz = { businessName: "Sunrise", serviceArea: null, primaryGoal: null };
const good = (key: string) => ({ check_key: key, title: `Fix ${key}`, explanation: "Plain explanation.", why_it_matters: "Plain why.", recommended_action: "Plain action.", expected_benefit: "Plain benefit." });
const reply = (parsed: unknown, stop_reason = "end_turn") => parse.mockResolvedValue({ parsed_output: parsed, stop_reason, usage: { input_tokens: 10, output_tokens: 10 } });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  providerEnabled.value = true;
  process.env.MARKETING_LEGACY_WORDING = "1";
  parse.mockReset();
  warn = vi.spyOn(log, "warn").mockImplementation(() => {});
  vi.spyOn(log, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const reasons = () => warn.mock.calls.filter((c: unknown[]) => c[0] === "ai.fallback_template").map((c: unknown[]) => (c[1] as { reason: string }).reason);

describe("wordFindings: records every fallback and never claims more than it delivered", () => {
  it("an API key alone never activates the model: template wording, reason recorded", async () => {
    providerEnabled.value = false;
    process.env.ANTHROPIC_API_KEY = "set-for-an-evaluation";
    process.env.OPENAI_API_KEY = "set-for-an-evaluation";
    process.env.GEMINI_API_KEY = "set-for-an-evaluation";
    const r = await wordFindings([finding("a")], evidence, biz, 3);
    expect(r.wording).toBe("template");
    expect(reasons()).toEqual(["not_configured"]);
    expect(parse).not.toHaveBeenCalled();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it("every card rewritten: marked as model-worded, no fallback logged", async () => {
    reply({ summary: "A plain summary.", cards: [good("a"), good("b")] });
    const r = await wordFindings([finding("a"), finding("b")], evidence, biz, 3);
    expect(r.wording).toBe("ai");
    expect(r.findings.map((f) => f.title)).toEqual(["Fix a", "Fix b"]);
    expect(reasons()).toEqual([]);
  });

  it("one card rejected for jargon: that card keeps template words and the result is recorded as template", async () => {
    reply({ summary: "A plain summary.", cards: [good("a"), { ...good("b"), explanation: "Our AI noticed this." }] });
    const r = await wordFindings([finding("a"), finding("b")], evidence, biz, 3);
    expect(r.wording).toBe("template");
    expect(r.findings[0]!.title).toBe("Fix a");
    expect(r.findings[1]!.title).toBe("Template b");
    expect(warn.mock.calls.some((c: unknown[]) => c[0] === "ai.partial_template" && (c[1] as { rewritten: number }).rewritten === 1)).toBe(true);
  });

  it("leaked system text is rejected", async () => {
    reply({ summary: "Fine.", cards: [{ ...good("a"), why_it_matters: "As stated in the system prompt, titles matter." }] });
    const r = await wordFindings([finding("a")], evidence, biz, 3);
    expect(r.wording).toBe("template");
    expect(r.findings[0]!.title).toBe("Template a");
    expect(reasons()).toEqual(["all_cards_rejected"]);
  });

  it.each(["You will get 40% more calls.", "Be the #1 plumber in town.", "We guarantee more leads.", "Expect a 25 % lift.", "You'll rank first on Google."])(
    "a promise or invented figure is rejected: %s",
    async (text) => {
      reply({ summary: "Fine.", cards: [{ ...good("a"), expected_benefit: text }] });
      const r = await wordFindings([finding("a")], evidence, biz, 3);
      expect(r.wording).toBe("template");
      expect(r.findings[0]!.expected_benefit).toBe("template benefit");
    },
  );

  it("a missing card keeps its template words", async () => {
    reply({ summary: "Fine.", cards: [good("a")] });
    const r = await wordFindings([finding("a"), finding("b")], evidence, biz, 3);
    expect(r.wording).toBe("template");
    expect(r.findings[1]!.title).toBe("Template b");
  });

  it("a rejected summary falls back to the template summary and the result is recorded as template", async () => {
    reply({ summary: "Our AI reviewed your site.", cards: [good("a")] });
    const r = await wordFindings([finding("a")], evidence, biz, 3);
    expect(r.wording).toBe("template");
    expect(r.summary).not.toMatch(/\bAI\b/);
  });

  it.each([
    ["a refusal", () => reply(null, "refusal"), "refused"],
    ["unusable output", () => reply(null, "max_tokens"), "unusable_output"],
    ["a rate limit", () => parse.mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 })), "call_failed"],
    ["a timeout", () => parse.mockRejectedValue(Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" })), "call_failed"],
  ])("%s: template wording and the reason recorded", async (_n, setup, reason) => {
    setup();
    const r = await wordFindings([finding("a")], evidence, biz, 3);
    expect(r.wording).toBe("template");
    expect(reasons()).toEqual([reason]);
  });

  it("nothing to word means nothing to record", async () => {
    const r = await wordFindings([], evidence, biz, 3);
    expect(r.wording).toBe("template");
    expect(reasons()).toEqual([]);
  });
});
