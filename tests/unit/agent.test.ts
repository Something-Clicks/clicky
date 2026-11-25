/**
 * Unit tests for the marketing agent's plumbing: provider gate, workflow selection, ranking,
 * stages and the orchestrator's step sequence. The orchestrator tests use stub database calls
 * and fixture HTML (like tests/unit/analysis.test.ts). They prove the control flow only; they
 * are NOT evidence that the agent works on real websites, and no model is involved anywhere.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { CAPABILITIES } from "@/lib/server/agent/capabilities";
import { requestMarketingWork, runWebsiteReview } from "@/lib/server/agent/orchestrator";
import {
  generateStructured,
  getModelProvider,
  ModelOutputInvalid,
  ModelProviderNotConfigured,
  registeredProviders,
  type ModelProvider,
} from "@/lib/server/agent/provider";
import { evidenceClass, rankNeeds } from "@/lib/server/agent/rank";
import { planWorkflow, WORKFLOWS } from "@/lib/server/agent/workflows";
import type { Finding } from "@/lib/server/checks";
import { FetchBlockedError, type FetchedPage } from "@/lib/server/safe-fetch";
import { cardStage, completionBasis, stageCounts } from "@/lib/stages";

describe("model provider", () => {
  it("has only the development adapter registered and never falls back to one", () => {
    expect(registeredProviders()).toEqual(["anthropic-dev"]);
    expect(getModelProvider({})).toBeNull();
    expect(getModelProvider({ MARKETING_MODEL_PROVIDER: "anthropic" })).toBeNull();
    expect(getModelProvider({ MARKETING_MODEL_PROVIDER: "openai", ANTHROPIC_API_KEY: "x" })).toBeNull();
    // The development adapter needs both the switch and its key, and never runs in Production.
    expect(getModelProvider({ MARKETING_MODEL_PROVIDER: "anthropic-dev" })).toBeNull();
    expect(getModelProvider({ MARKETING_MODEL_PROVIDER: "anthropic-dev", ANTHROPIC_API_KEY: "x" })?.id).toBe("anthropic-dev");
    expect(getModelProvider({ MARKETING_MODEL_PROVIDER: "anthropic-dev", ANTHROPIC_API_KEY: "x", VERCEL_ENV: "production" })).toBeNull();
    expect(getModelProvider({ MARKETING_MODEL_PROVIDER: "anthropic-dev", ANTHROPIC_API_KEY: "x", VERCEL_ENV: "preview" })?.id).toBe("anthropic-dev");
  });

  it("refuses to generate without a provider", async () => {
    await expect(generateStructured({ task: "t", system: "s", input: {}, schema: z.object({ a: z.string() }) }, null)).rejects.toBeInstanceOf(ModelProviderNotConfigured);
  });

  // A hand-written TEST DOUBLE of the adapter interface (not a model, not a mock answer for any real task):
  // it only checks that output is validated and retried once before being used.
  const double = (outputs: unknown[]): ModelProvider => ({
    id: "test-double",
    generate: vi.fn(async () => ({ output: outputs.shift(), model: "none", usage: { inputTokens: 1, outputTokens: 1 } })),
  });

  it("validates structured output and retries once", async () => {
    const schema = z.object({ headline: z.string().min(1) });
    const p = double([{ wrong: true }, { headline: "ok" }]);
    const r = await generateStructured({ task: "t", system: "s", input: {}, schema }, p);
    expect(r.output).toEqual({ headline: "ok" });
    expect(r.usage).toEqual({ inputTokens: 2, outputTokens: 2 });
    expect(p.generate).toHaveBeenCalledTimes(2);
    await expect(generateStructured({ task: "t", system: "s", input: {}, schema }, double([{}, {}]))).rejects.toBeInstanceOf(ModelOutputInvalid);
  });
});

describe("workflow selection (spec 12.2)", () => {
  it("selects only the capabilities each request needs", () => {
    expect(WORKFLOWS.homepage_headline.capabilities).toEqual(["business_intelligence", "website_intelligence", "marketing_analysis", "content_creation"]);
    expect(WORKFLOWS.competitor_research.capabilities).toEqual(["business_intelligence", "market_research", "marketing_analysis"]);
    expect(WORKFLOWS.results_review.capabilities).toEqual(["performance_intelligence", "marketing_analysis", "marketing_strategy"]);
  });

  it("the website review runs on checks alone; the rest are blocked without a provider", () => {
    const env = { modelProvider: false };
    expect(planWorkflow("website_review", env).blocked).toBeNull();
    for (const kind of ["homepage_headline", "competitor_research", "marketing_plan", "promotional_campaign", "results_review"] as const) {
      expect(planWorkflow(kind, env).blocked).toMatch(/No model provider is configured/);
    }
    expect(planWorkflow("homepage_headline", { modelProvider: true }).blocked).toBeNull();
  });

  it("execution is never available: no integration exists", () => {
    expect(CAPABILITIES.marketing_execution.runsOn).toBe("integration");
  });
});

const f = (check_key: string, impact: Finding["impact_priority"], confidence: Finding["confidence"], keys: string[], execution_type: Finding["execution_type"] = "manual"): Finding => ({
  check_key, title: check_key, explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x",
  impact_priority: impact, confidence, ai_capable: execution_type !== "manual", execution_type, approval_required: false, evidence_keys: keys,
});

describe("ranking needs", () => {
  const evidence = [{ key: "o", kind: "observed" as const }, { key: "m", kind: "missing" as const }, { key: "p", kind: "measured" as const }];

  it("classifies evidence as verified or unknown, never inferred", () => {
    expect(evidenceClass({ evidence_keys: ["o"] }, evidence)).toBe("verified");
    expect(evidenceClass({ evidence_keys: ["m"] }, evidence)).toBe("unknown");
    expect(evidenceClass({ evidence_keys: ["m", "p"] }, evidence)).toBe("verified");
    expect(evidenceClass({ evidence_keys: ["nope"] }, evidence)).toBe("unknown");
  });

  it("orders by impact, then evidence strength, then confidence, then owner changes first", () => {
    const ranked = rankNeeds([
      f("low", "low", "high", ["o"]),
      f("high_missing", "high", "high", ["m"]),
      f("high_draft", "high", "high", ["o"], "meta"),
      f("high_manual", "high", "high", ["p"]),
      f("high_lowconf", "high", "low", ["o"]),
    ], evidence);
    expect(ranked.map((r) => r.check_key)).toEqual(["high_manual", "high_draft", "high_lowconf", "high_missing", "low"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(ranked[0]!.why_ranked).toBe("High impact; seen directly on your website or measured; high confidence.");
  });
});

describe("stages", () => {
  it("only a person (done) or a later check (fixed) completes work", () => {
    expect(cardStage({ status: "new", verification: null })).toBe("prepared");
    expect(cardStage({ status: "in_progress", verification: null })).toBe("prepared");
    expect(cardStage({ status: "approved", verification: null })).toBe("approved");
    expect(cardStage({ status: "approved", verification: "still_found" })).toBe("approved");
    expect([cardStage({ status: "approved", verification: "fixed" }), completionBasis({ status: "approved", verification: "fixed" })]).toEqual(["completed", "verified"]);
    expect([cardStage({ status: "done", verification: null }), completionBasis({ status: "done", verification: null })]).toEqual(["completed", "reported"]);
    expect(cardStage({ status: "new", verification: "fixed" })).toBe("prepared");
    expect(stageCounts([{ status: "new", verification: null }, { status: "approved", verification: null }, { status: "done", verification: null }])).toEqual({ prepared: 1, approved: 1, completed: 1, dismissed: 0 });
  });
});

const HOME = `<!doctype html><html><head></head><body><nav><a href="/about">About</a></nav><p>Call us at (801) 555-0123 for plumbing.</p><img src="a.jpg"></body></html>`;
const page = (url: string, body: string): FetchedPage => ({ url, status: 200, contentType: "text/html", body, truncated: false, redirects: [] });
const business = { businessName: "Sunrise Plumbing", serviceArea: null, primaryGoal: "more_calls", website: "https://sunrise.example/" };
const psiMissing = async () => ({ ok: false as const, reason: "PageSpeed Insights is busy right now." });

describe("orchestrator: website review (stub database, fixture HTML)", () => {
  it("records the workflow, saves the analysis, ranks needs, and finishes as prepared", async () => {
    const rpc = vi.fn(async (name: string, _args?: unknown) => ({ data: name === "start_marketing_workflow" ? "wf1" : null, error: null }));
    const out = await runWebsiteReview({ rpc } as never, { orgId: "o1", analysisId: "a1", business }, { fetchPage: async (u) => page(u, HOME), pageSpeed: psiMissing });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["start_marketing_workflow", "complete_analysis", "propose_business_facts", "finish_marketing_workflow"]);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_org: "o1", p_kind: "website_review", p_analysis: "a1", p_capabilities: ["business_intelligence", "website_intelligence", "seo_intelligence", "marketing_analysis"] });
    expect(out.status).toBe("prepared");
    if (out.status !== "prepared") return;
    expect(out.result.source).toBe("website_check");
    expect(out.result.model_worded).toBe(false);
    // The phone number in the page text was proposed (verified: observed); the rest is still missing.
    expect(out.result.missing_business_info).toEqual(["what_it_does", "service", "audience", "service_area", "value_proposition"]);
    expect(rpc.mock.calls[2]![1]).toMatchObject({ p_org: "o1", p_analysis: "a1", p_facts: [{ field: "contact_phone", value: "(801) 555-0123", evidence_class: "verified", source: "website" }] });
    expect(out.result.evidence_classes.inferred).toBe(0);
    expect(out.result.evidence_classes.verified + out.result.evidence_classes.unknown).toBe(out.result.ranked.length);
    expect(out.result.ranked.length).toBeGreaterThan(2);
    expect(out.steps.map((s) => [s.step, s.status])).toEqual([
      ["understand_business", "done"], ["plan", "done"], ["analyze_website", "done"], ["analyze_marketing", "done"], ["analyze_seo", "done"],
      ["learn_business", "done"], ["rank_needs", "done"], ["prepare_work", "done"], ["prepare_drafts", "blocked"], ["owner_review", "waiting"],
    ]);
    const finish = rpc.mock.calls[3]![1] as Record<string, unknown>;
    expect(finish).toMatchObject({ p_workflow: "wf1", p_status: "prepared", p_provider: null, p_model: null, p_usage: null });
  });

  it("records a failure with the customer's plain reason", async () => {
    const rpc = vi.fn(async (name: string, _args?: unknown) => ({ data: name === "start_marketing_workflow" ? "wf2" : null, error: null }));
    const out = await runWebsiteReview({ rpc } as never, { orgId: "o1", analysisId: "a2", business }, {
      fetchPage: async () => { throw new FetchBlockedError("blocked", "not_public"); },
      pageSpeed: psiMissing,
    });
    expect(out.status).toBe("failed");
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["start_marketing_workflow", "fail_analysis", "finish_marketing_workflow"]);
    expect(rpc.mock.calls[2]![1]).toMatchObject({ p_status: "failed", p_error: expect.stringContaining("isn't a public website") });
  });

  it("still runs the customer's check when the workflow record cannot be written", async () => {
    const rpc = vi.fn(async (name: string, _args?: unknown) =>
      name === "start_marketing_workflow" ? { data: null, error: { message: "function does not exist" } } : { data: null, error: null });
    const out = await runWebsiteReview({ rpc } as never, { orgId: "o1", analysisId: "a3", business }, { fetchPage: async (u) => page(u, HOME), pageSpeed: psiMissing });
    expect(out.status).toBe("prepared");
    expect(out.workflowId).toBeNull();
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["start_marketing_workflow", "complete_analysis", "propose_business_facts"]);
  });
});

describe("orchestrator: model-dependent requests", () => {
  it("records them as blocked with the reason and produces no output", async () => {
    const rpc = vi.fn(async (name: string, _args?: unknown) => ({ data: name === "start_marketing_workflow" ? "wf3" : null, error: null }));
    const out = await requestMarketingWork({ rpc } as never, { orgId: "o1", kind: "homepage_headline", request: "Improve my homepage headline" });
    expect(out.status).toBe("blocked");
    if (out.status !== "blocked") return;
    expect(out.reason).toMatch(/Content Creation: No model provider is configured/);
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_status: "blocked", p_result: null });
  });
});
