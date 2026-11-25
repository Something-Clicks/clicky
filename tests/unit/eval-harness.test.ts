/**
 * Tests of the evaluation harness's own logic (configuration and mechanical scoring), using
 * hand-written inputs. These are not provider results and say nothing about any provider.
 */
import { describe, expect, it } from "vitest";

import { providerConfig } from "../../evals/providers/config";
import type { SourcePacket } from "../../evals/providers/material";
import { costUsd, scoreWorkflow } from "../../evals/providers/score";
import { DraftsSchema, FindingsSchema } from "../../evals/providers/tasks";

const packet: SourcePacket = {
  site: { url: "https://sunrise.example/", business_name: "Sunrise Plumbing", service_area: "Salt Lake City", primary_goal: "more_calls" },
  built_at: "2026-11-25T00:00:00Z",
  pages: [{ key: "page0", url: "https://sunrise.example/", title: "Sunrise Plumbing", meta_description: null, h1s: ["Plumbing in Salt Lake City"], headings: [], text: "Call (801) 555-0123. Open since 2009." }],
  unreachable: [],
  evidence: [
    { key: "e1", kind: "observed", source: "website", check_key: "meta.title", url: "https://sunrise.example/", observation: "Title found.", excerpt: null },
    { key: "e2", kind: "missing", source: "pagespeed", check_key: "pagespeed.unavailable", url: null, observation: "PageSpeed unavailable.", excerpt: null },
  ],
  checks: [],
  pagespeed: "missing",
};

describe("evaluation configuration", () => {
  it("never invents a model or a price: missing settings are named", () => {
    const r = providerConfig("openai", { OPENAI_API_KEY: "x" });
    expect(r).toEqual({ ok: false, missing: ["EVAL_OPENAI_MODEL", "EVAL_OPENAI_INPUT_PER_MTOK", "EVAL_OPENAI_OUTPUT_PER_MTOK"] });
    const ok = providerConfig("gemini", { GEMINI_API_KEY: "k", EVAL_GEMINI_MODEL: "m", EVAL_GEMINI_INPUT_PER_MTOK: "1.5", EVAL_GEMINI_OUTPUT_PER_MTOK: "6" });
    expect(ok).toMatchObject({ ok: true, cfg: { id: "gemini", model: "m", inputPerMTok: 1.5, outputPerMTok: 6, effort: null } });
  });

  it("computes cost from tokens and the supplied prices", () => {
    expect(costUsd(1_000_000, 500_000, 2, 10)).toBe(7);
  });
});

describe("mechanical scoring", () => {
  it("flags invalid citations, unsupported 'verified' claims and missing bases", () => {
    const findings = FindingsSchema.parse({
      findings: [
        { title: "a", category: "seo", what_was_observed: "x", where: null, evidence_class: "verified", evidence_keys: ["e1"], basis: "", why_it_matters: "x", who_is_affected: "x", impact: "high", confidence: "high", missing_information: null, recommended_action: "x" },
        { title: "b", category: "technical", what_was_observed: "x", where: null, evidence_class: "verified", evidence_keys: ["e2", "zz"], basis: "", why_it_matters: "x", who_is_affected: "x", impact: "low", confidence: "low", missing_information: null, recommended_action: "x" },
        { title: "c", category: "content", what_was_observed: "x", where: null, evidence_class: "inferred", evidence_keys: ["page0"], basis: " ", why_it_matters: "x", who_is_affected: "x", impact: "medium", confidence: "medium", missing_information: null, recommended_action: "x" },
      ],
    });
    const m = scoreWorkflow(packet, { profile: null, findings, drafts: null });
    expect(m).toMatchObject({ findings: 3, citations_total: 4, citations_invalid: 1, verified_unsupported: 1, basis_missing: 1, class_counts: { verified: 2, inferred: 1 } });
  });

  it("finds numbers and promises in drafts that the source doesn't support", () => {
    const drafts = DraftsSchema.parse({
      homepage: { headline: "Sunrise Plumbing: trusted since 2009", subheadline: "Guaranteed same-day service for 500 homes", call_to_action: "Call [your phone number]" },
      seo: [{ url: "https://sunrise.example/", title: "Plumbing in Salt Lake City | Sunrise Plumbing", meta_description: "Short." }],
      facts_used: [{ text: "Since 2009", evidence_keys: ["page0"] }],
      placeholders_used: ["[your phone number]"],
    });
    const m = scoreWorkflow(packet, { profile: null, findings: null, drafts });
    expect(m.draft_numbers_not_in_source).toEqual(["500"]);
    expect(m.draft_promises).toBe(1);
    expect(m).toMatchObject({ seo_items: 1, seo_title_in_range: 1, seo_meta_in_range: 0, headline_in_limit: true, business_name_used: true, placeholders: 1 });
  });
});
