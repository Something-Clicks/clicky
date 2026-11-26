import { createHash } from "node:crypto";

import { DEV_CASES } from "./cases/dev";
import { TEST_CASES_A } from "./cases/test-a";
import { TEST_CASES_B } from "./cases/test-b";
import type { EvalCase } from "./types";

export * from "./types";

export const ALL_CASES: EvalCase[] = [...DEV_CASES, ...TEST_CASES_A, ...TEST_CASES_B];
export const DEV_SET = ALL_CASES.filter((c) => c.set === "dev");
export const TEST_SET = ALL_CASES.filter((c) => c.set === "test");

/** Stable JSON: object keys sorted, so the hash does not depend on authoring order within an object. */
const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);

export const caseHash = (c: EvalCase) => createHash("sha256").update(stable(c)).digest("hex");

/** One hash over every case. A frozen result is valid only for the dataset hash it ran on. */
export const datasetHash = (cases: EvalCase[] = ALL_CASES) => createHash("sha256").update(cases.map((c) => `${c.id}:${caseHash(c)}`).join("\n")).digest("hex");
