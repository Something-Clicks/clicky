/** Writes or verifies the independent-review packets. Verify is the default; MODELREVIEW_WRITE=1 pnpm modelreview regenerates them. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_CASES } from "./dataset";
import { openActionsFor, REVIEW_CASES } from "./review-cases";
import { renderCasePacket } from "./review-packet";

const dir = join(__dirname, "..", "..", "docs", "agents", "review");

describe("review packets", () => {
  it(process.env.MODELREVIEW_WRITE === "1" ? "writes the packets" : "match the dataset", async () => {
    mkdirSync(dir, { recursive: true });
    for (const id of REVIEW_CASES) {
      const c = ALL_CASES.find((x) => x.id === id)!;
      const text = renderCasePacket(c, await openActionsFor(c));
      const file = join(dir, `CASE_REVIEW_${id}.md`);
      if (process.env.MODELREVIEW_WRITE === "1") writeFileSync(file, text);
      else expect(readFileSync(file, "utf8"), `${id} packet is out of date`).toBe(text);
    }
  });
});
