/** Builds a ModelRun and a human sheet from the answer-key stand-in, to exercise scoring machinery. Not model evidence. */
import { ALL_CASES, TEST_SET, datasetHash } from "../../evals/model/dataset";
import { runEvalCase } from "../../evals/model/run";
import { emptyHumanScores, type HumanSheet, type Score } from "../../evals/model/scoring";
import type { ModelRun } from "../../evals/model/types";
import { selfHostedProvider } from "@/lib/server/agent/providers/self-hosted";

import { startStub } from "./model-stub";
import { truthStandIn, type Override } from "./truth-standin";

export async function answerKeyRun(model: string, override?: Override): Promise<ModelRun> {
  const stub = await startStub(truthStandIn(ALL_CASES, override));
  try {
    const p = selfHostedProvider({ SELF_HOSTED_MODEL_URL: stub.url, SELF_HOSTED_MODEL_TOKEN: "t".repeat(32), SELF_HOSTED_MODEL_ID: model })!;
    const names = ALL_CASES.map((c) => c.business.name);
    const cases = [];
    for (const c of TEST_SET) cases.push(await runEvalCase(p, c, names));
    return {
      schema: 1, provider: "self-hosted", model, startedAt: "2026-11-26T00:00:00.000Z", datasetHash: datasetHash(), frozenMatch: true, set: "test",
      settings: { temperature: 0.2, topP: 0.95, attemptTimeoutMs: null, extraBody: null, gpuUsdPerHour: 1.5, gpuClass: "test-class", node: process.version, gitCommit: null },
      cases,
    };
  } finally {
    await stub.close();
  }
}

/** A person who scores everything `s` and confirms nothing invented. */
export function sheetFor(run: ModelRun, s: Score = 5): HumanSheet {
  const cases: HumanSheet["cases"] = {};
  for (const cr of run.cases) {
    const h = emptyHumanScores();
    Object.assign(h, { understanding: s, customer: s, evidence: s, strategy: s, usefulness: s, content: s, consistency: s, inventedConfirmed: 0, injectionComplied: false });
    const u = cr.tasks.find((t) => t.task === "understanding");
    const facts = u?.ok ? (u.output as { accepted: { evidence_class: string }[] }).accepted : [];
    h.factLabels = facts.map((f) => (f.evidence_class === "verified" ? "true" : "reasonable"));
    const f = cr.tasks.find((t) => t.task === "findings");
    const cards = f?.ok ? (f.output as { cards: unknown[] }).cards : [];
    h.findingLabels = cards.map(() => ({ real: true, worth: true, generic: false }));
    for (const d of cr.tasks.filter((t) => t.task.startsWith("draft_") && t.ok)) h.draftRatings[d.task] = { usable: s, voice: s };
    cases[cr.caseId] = h;
  }
  return { model: run.model, cases };
}
