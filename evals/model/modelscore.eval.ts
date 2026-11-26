/**
 * Scoring and comparison. A person scores blinded outputs; this file blinds, unblinds, evaluates against the frozen
 * thresholds, compares models and (only when asked) records the round. See docs/agents/EVALUATION_FREEZE.md section 7.
 *
 *   MODELSCORE_RUNS=a.json,b.json MODELSCORE_BLIND=1 pnpm modelscore                       # writes a coded, shuffled sheet and a separate key
 *   MODELSCORE_RUNS=a.json,b.json MODELSCORE_SHEET=sheet.json MODELSCORE_KEY=key.json pnpm modelscore   # evaluates and compares
 *   … MODELSCORE_RECORD=1 …                                                                  # also appends the round to evals/model/rounds.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { datasetHash } from "./dataset";
import { compareEvaluations, consecutivePasses, evaluateModel, isProductionCandidate, makeBlindSheet, unblind, type BlindKey, type BlindSheet, type Evaluation, type RoundRecord } from "./scoring";
import type { ModelRun } from "./types";

const runsEnv = process.env.MODELSCORE_RUNS;
const blind = process.env.MODELSCORE_BLIND === "1";
const sheetPath = process.env.MODELSCORE_SHEET;
const keyPath = process.env.MODELSCORE_KEY;
const read = <T>(p: string) => JSON.parse(readFileSync(p, "utf8")) as T;
const ROUNDS = process.env.MODELSCORE_ROUNDS ?? join(__dirname, "rounds.json");
const OUT = process.env.EVAL_RESULTS_DIR ?? "eval-results";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export function evaluationMarkdown(e: Evaluation): string {
  return [
    `# Evaluation: ${e.model}`, "", `**Status: ${e.status.toUpperCase()}**. Dataset ${e.datasetHash.slice(0, 12)} (frozen match: ${e.frozenMatch}).`, "",
    e.pending.length ? `Still needs a person: ${[...new Set(e.pending)].join("; ")}.\n` : "",
    "| Criterion | Value | Requirement | Result |", "|---|---|---|---|",
    ...e.criteria.map((c) => `| ${c.label} | ${c.value} | ${c.requirement} | ${c.status} |`), "",
    "## Capability scores by case", "| Capability | Mean | Lowest |", "|---|---|---|",
    ...Object.entries(e.capabilities).map(([id, s]) => `| ${id} | ${s.mean ?? "n/a"} | ${s.min ?? "n/a"} |`), "",
  ].join("\n");
}

describe.skipIf(!runsEnv)("model scoring", () => {
  it("blinds, evaluates and compares", () => {
    const runs = runsEnv!.split(",").map((p) => read<ModelRun>(p.trim()));
    mkdirSync(OUT, { recursive: true });
    if (blind) {
      const seed = process.env.MODELSCORE_SEED ?? stamp();
      const { sheet, key } = makeBlindSheet(runs, seed);
      writeFileSync(`${OUT}/blind-${seed}.sheet.json`, JSON.stringify(sheet, null, 2));
      writeFileSync(`${OUT}/blind-${seed}.key.json`, JSON.stringify(key, null, 2));
      console.log(`Blind sheet: ${OUT}/blind-${seed}.sheet.json (give this to the scorer). Key: ${OUT}/blind-${seed}.key.json (keep it away from the scorer).`);
      expect(sheet.submissions.length).toBeGreaterThan(0);
      return;
    }
    if (!sheetPath || !keyPath) throw new Error("Set MODELSCORE_SHEET and MODELSCORE_KEY to evaluate, or MODELSCORE_BLIND=1 to make a sheet.");
    const sheets = unblind(read<BlindSheet>(sheetPath), read<BlindKey>(keyPath));
    const frozen = datasetHash();
    const evals = runs.map((r) => evaluateModel(r, sheets[r.model] ?? null, frozen));
    const tag = stamp();
    for (const e of evals) {
      writeFileSync(`${OUT}/evaluation-${e.model.replace(/[^A-Za-z0-9._-]+/g, "_")}-${tag}.json`, JSON.stringify(e, null, 2));
      writeFileSync(`${OUT}/evaluation-${e.model.replace(/[^A-Za-z0-9._-]+/g, "_")}-${tag}.md`, evaluationMarkdown(e));
    }
    const cmp = compareEvaluations(evals);
    writeFileSync(`${OUT}/comparison-${tag}.json`, JSON.stringify(cmp, null, 2));
    const file = read<{ version: 1; note: string; rounds: RoundRecord[] }>(ROUNDS);
    if (process.env.MODELSCORE_RECORD === "1") {
      for (const e of evals) file.rounds.push({ round: file.rounds.filter((r) => r.model === e.model).length + 1, model: e.model, modelCommit: runs.find((r) => r.model === e.model)?.settings.gitCommit ?? null, datasetHash: e.datasetHash, evaluatedAt: new Date().toISOString(), status: e.status, note: process.env.MODELSCORE_NOTE ?? "" });
      writeFileSync(ROUNDS, `${JSON.stringify(file, null, 2)}\n`);
    }
    for (const e of evals) console.log(`${e.model}: ${e.status}; consecutive passing rounds ${consecutivePasses(file.rounds, e.model, frozen)}; production candidate: ${isProductionCandidate(file.rounds, e.model, frozen)}`);
    expect(evals.length).toBe(runs.length);
  });
});
