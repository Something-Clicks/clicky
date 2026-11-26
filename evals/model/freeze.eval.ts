/**
 * Writes or verifies the freeze. Verify (default) fails if the dataset, thresholds, rubric or generated document differ from
 * the committed freeze. To re-freeze after a deliberate change: MODELFREEZE_WRITE=1 MODELFREEZE_WHAT="..." MODELFREEZE_WHY="..." pnpm modelfreeze
 * (the first freeze needs neither). A re-freeze restarts the two-consecutive-rounds count; it is logged in the document.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { freezeRecord, renderFreezeDoc, type FreezeRecord } from "./freeze";

const root = join(__dirname, "..", "..");
const FREEZE = join(root, "evals", "model", "dataset", "FREEZE.json");
const DOC = join(root, "docs", "agents", "EVALUATION_FREEZE.md");

describe("evaluation freeze", () => {
  it(process.env.MODELFREEZE_WRITE === "1" ? "writes the freeze and the generated document" : "matches the committed freeze and document", () => {
    const existing: FreezeRecord | null = existsSync(FREEZE) ? JSON.parse(readFileSync(FREEZE, "utf8")) : null;
    const next = freezeRecord(existing?.changeLog ?? []);
    if (process.env.MODELFREEZE_WRITE === "1") {
      const changed = existing && (existing.datasetHash !== next.datasetHash || existing.standardsHash !== next.standardsHash);
      if (changed) {
        const what = process.env.MODELFREEZE_WHAT, why = process.env.MODELFREEZE_WHY;
        if (!what || !why) throw new Error("The dataset or standards changed after a freeze: set MODELFREEZE_WHAT and MODELFREEZE_WHY to log it (this restarts the two-round count).");
        next.changeLog = [...next.changeLog, { date: new Date().toISOString().slice(0, 10), what, why }];
      }
      writeFileSync(FREEZE, `${JSON.stringify(next, null, 2)}\n`);
      writeFileSync(DOC, renderFreezeDoc(next));
      return;
    }
    expect(existing, "no FREEZE.json: run pnpm modelfreeze with MODELFREEZE_WRITE=1").not.toBeNull();
    expect(existing!.datasetHash, "dataset changed since the freeze").toBe(next.datasetHash);
    expect(existing!.standardsHash, "thresholds or rubric changed since the freeze").toBe(next.standardsHash);
    expect(readFileSync(DOC, "utf8"), "EVALUATION_FREEZE.md is out of date").toBe(renderFreezeDoc(existing!));
  });
});
