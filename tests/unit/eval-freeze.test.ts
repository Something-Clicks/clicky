/**
 * The freeze is real: the committed record matches the dataset and standards in the code, and the generated document matches the
 * record. If any case, threshold or rubric changes without a re-freeze (and a logged reason), this fails. That is what stops a
 * failing model being rescued by editing the test.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_CASES, caseHash, datasetHash } from "../../evals/model/dataset";
import { freezeRecord, renderFreezeDoc, standardsHash, type FreezeRecord } from "../../evals/model/freeze";

const root = join(__dirname, "..", "..");
const recPath = join(root, "evals", "model", "dataset", "FREEZE.json");
const rec = existsSync(recPath) ? (JSON.parse(readFileSync(recPath, "utf8")) as FreezeRecord) : null;

describe("evaluation freeze", () => {
  it("a freeze record exists", () => { expect(rec, "run: MODELFREEZE_WRITE=1 pnpm modelfreeze").not.toBeNull(); });

  it("the dataset still matches the freeze, case by case", () => {
    expect(datasetHash(), "the dataset changed since the freeze: re-freeze and log the reason").toBe(rec!.datasetHash);
    expect(rec!.cases.map((c) => c.id)).toEqual(ALL_CASES.map((c) => c.id));
    for (const c of ALL_CASES) expect(caseHash(c), `case ${c.id} changed`).toBe(rec!.cases.find((x) => x.id === c.id)!.hash);
  });

  it("the thresholds, capabilities and rubric still match the freeze", () => {
    expect(standardsHash(), "the pass requirements changed since the freeze: re-freeze and log the reason").toBe(rec!.standardsHash);
  });

  it("the generated document is up to date", () => {
    expect(readFileSync(join(root, "docs", "agents", "EVALUATION_FREEZE.md"), "utf8")).toBe(renderFreezeDoc(rec!));
  });

  it("the hash does not depend on key order, and any edit changes it", () => {
    const a = ALL_CASES[0]!;
    const reordered = { ...Object.fromEntries(Object.entries(a).reverse()) } as typeof a;
    expect(caseHash(reordered)).toBe(caseHash(a));
    expect(caseHash({ ...a, title: `${a.title}!` })).not.toBe(caseHash(a));
    expect(freezeRecord().datasetHash).toBe(datasetHash());
  });

  it("no result file or round has been recorded before any model ran", () => {
    const rounds = JSON.parse(readFileSync(join(root, "evals", "model", "rounds.json"), "utf8")) as { rounds: unknown[] };
    expect(rounds.rounds).toEqual([]);
  });
});
