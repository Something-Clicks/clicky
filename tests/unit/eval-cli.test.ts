/**
 * The real commands, as separate processes, against the answer-key stand-in server: `pnpm modelcheck` runs the frozen test set
 * through the adapter, `pnpm modelscore` blinds, evaluates, compares and records a round. This proves the file flow works as
 * the owner will use it. The stand-in answers from the answer key, so a "pass" here is a statement about the machinery only.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ALL_CASES, datasetHash } from "../../evals/model/dataset";
import type { BlindSheet } from "../../evals/model/scoring";
import { emptyHumanScores } from "../../evals/model/scoring";

import { startStub, type Stub } from "../support/model-stub";
import { truthStandIn } from "../support/truth-standin";

const exec = promisify(execFile);
const TOKEN = "z".repeat(40);
let stub: Stub;
let dir: string;
beforeAll(async () => { stub = await startStub(truthStandIn(ALL_CASES)); dir = mkdtempSync(join(tmpdir(), "modelcheck-")); });
afterAll(async () => { await stub.close(); });

const run = (args: string[], env: Record<string, string>) => exec("pnpm", ["exec", "vitest", "run", "--project", "modelcheck", ...args], { cwd: join(__dirname, "..", ".."), env: { ...process.env, EVAL_RESULTS_DIR: dir, ...env }, timeout: 240_000, maxBuffer: 20_000_000 });
const modelEnv = (model: string) => ({ SELF_HOSTED_MODEL_URL: stub.url, SELF_HOSTED_MODEL_TOKEN: TOKEN, SELF_HOSTED_MODEL_ID: model, MODELCHECK_SET: "test", MODELCHECK_GPU_USD_PER_HOUR: "1.5", MODELCHECK_GPU_CLASS: "stand-in" });
const files = (re: RegExp) => readdirSync(dir).filter((f) => re.test(f)).sort();

describe("the commands, end to end", () => {
  it("modelcheck runs the 10 scored cases and writes a reproducible, secret-free run file", async () => {
    await run(["evals/model/modelcheck.eval.ts"], { ...modelEnv("standin-a"), MODELCHECK_LABEL: "r1" });
    await run(["evals/model/modelcheck.eval.ts"], { ...modelEnv("standin-b"), MODELCHECK_LABEL: "r1" });
    const runs = files(/^modelrun-.*\.json$/);
    expect(runs).toHaveLength(2);
    const text = readFileSync(join(dir, runs[0]!), "utf8");
    const r = JSON.parse(text);
    expect(r.datasetHash).toBe(datasetHash());
    expect(r.frozenMatch).toBe(true);
    expect(r.set).toBe("test");
    expect(r.cases.map((c: { caseId: string }) => c.caseId)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"]);
    expect(r.settings).toMatchObject({ temperature: 0.2, topP: 0.95, gpuUsdPerHour: 1.5, gpuClass: "stand-in" });
    expect(r.cases.every((c: { tasks: { ok: boolean }[] }) => c.tasks.every((t) => t.ok))).toBe(true);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(stub.url);
    expect(files(/^modelrun-.*\.md$/)).toHaveLength(2);
  }, 280_000);

  it("a subset run is labelled custom and cannot pass as a full round", async () => {
    await run(["evals/model/modelcheck.eval.ts"], { ...modelEnv("standin-subset"), MODELCHECK_CASES: "T1,T2" });
    const f = files(/^modelrun-standin-subset-.*\.json$/)[0]!;
    const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
    expect(r.set).toBe("custom");
    expect(r.cases).toHaveLength(2);
  }, 120_000);

  it("modelscore blinds, a person's scores are applied, models are evaluated, compared and the round is recorded", async () => {
    const [a, b] = files(/^modelrun-standin-[ab]-.*\.json$/).map((f) => join(dir, f));
    const rounds = join(dir, "rounds.json");
    writeFileSync(rounds, JSON.stringify({ version: 1, note: "test", rounds: [] }));
    await run(["evals/model/modelscore.eval.ts"], { MODELSCORE_RUNS: `${a},${b}`, MODELSCORE_BLIND: "1", MODELSCORE_SEED: "cli" });
    const sheetPath = join(dir, "blind-cli.sheet.json"), keyPath = join(dir, "blind-cli.key.json");
    const sheet = JSON.parse(readFileSync(sheetPath, "utf8")) as BlindSheet;
    expect(sheet.submissions).toHaveLength(20);
    expect(readFileSync(sheetPath, "utf8")).not.toMatch(/standin-a|standin-b/);

    // A person scores every submission (here: perfect scores, every flagged item cleared).
    for (const s of sheet.submissions) {
      const h = emptyHumanScores();
      Object.assign(h, { understanding: 5, customer: 5, evidence: 5, strategy: 5, usefulness: 5, content: 5, consistency: 5, inventedConfirmed: 0, injectionComplied: false });
      h.factLabels = (s.outputs.facts as { evidence_class: string }[]).map((f) => (f.evidence_class === "verified" ? "true" : "reasonable"));
      h.findingLabels = s.outputs.findings.map(() => ({ real: true, worth: true, generic: false }));
      for (const d of s.outputs.drafts) h.draftRatings[d.task] = { usable: 5, voice: 5 };
      s.human = h;
    }
    writeFileSync(sheetPath, JSON.stringify(sheet));
    await run(["evals/model/modelscore.eval.ts"], { MODELSCORE_RUNS: `${a},${b}`, MODELSCORE_SHEET: sheetPath, MODELSCORE_KEY: keyPath, MODELSCORE_ROUNDS: rounds, MODELSCORE_RECORD: "1", MODELSCORE_NOTE: "cli test" });

    const evals = files(/^evaluation-.*\.json$/).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
    expect(evals.map((e) => e.model).sort()).toEqual(["standin-a", "standin-b"]);
    expect(evals.every((e) => e.status === "pass"), JSON.stringify(evals.map((e) => [e.model, e.status, e.criteria.filter((c: { status: string }) => c.status !== "pass").map((c: { id: string; value: string }) => `${c.id}=${c.value}`)]))).toBe(true);
    expect(files(/^evaluation-.*\.md$/)).toHaveLength(2);
    const cmp = JSON.parse(readFileSync(join(dir, files(/^comparison-.*\.json$/)[0]!), "utf8"));
    expect(cmp.ranked.sort()).toEqual(["standin-a", "standin-b"]);
    const rec = JSON.parse(readFileSync(rounds, "utf8"));
    expect(rec.rounds).toHaveLength(2);
    expect(rec.rounds.every((x: { status: string; datasetHash: string; round: number }) => x.status === "pass" && x.datasetHash === datasetHash() && x.round === 1)).toBe(true);
  }, 280_000);

  it("an unscored sheet is INCOMPLETE and is recorded as such, never as a pass", async () => {
    const [a] = files(/^modelrun-standin-a-.*\.json$/).map((f) => join(dir, f));
    const rounds = join(dir, "rounds-incomplete.json");
    writeFileSync(rounds, JSON.stringify({ version: 1, note: "test", rounds: [] }));
    await run(["evals/model/modelscore.eval.ts"], { MODELSCORE_RUNS: a!, MODELSCORE_BLIND: "1", MODELSCORE_SEED: "empty" });
    await run(["evals/model/modelscore.eval.ts"], { MODELSCORE_RUNS: a!, MODELSCORE_SHEET: join(dir, "blind-empty.sheet.json"), MODELSCORE_KEY: join(dir, "blind-empty.key.json"), MODELSCORE_ROUNDS: rounds, MODELSCORE_RECORD: "1" });
    expect(JSON.parse(readFileSync(rounds, "utf8")).rounds[0].status).toBe("incomplete");
  }, 280_000);
});
