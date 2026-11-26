import type { CaseChecks } from "./checks";

export interface CallRecord { task: string; ms: number; inputTokens: number; outputTokens: number; refused: boolean; error: string | null }

export interface TaskResult {
  site: string;
  /** "understanding", "findings", "plan", "plan_notes:<id>", "draft_meta", "draft_page_copy" or "scan". */
  task: string;
  ok: boolean;
  /** Why it did not produce usable output: a typed reason, never a raw server message. */
  failure: string | null;
  ms: number;
  /** Model calls this task needed (2 or more means the first answer was unusable). */
  attempts: number;
  /** Longest single call, and refused calls (a refusal is a call that returned "refused"). */
  maxCallMs: number;
  refusals: number;
  inputTokens: number;
  outputTokens: number;
  /** Counts of what the model proposed and what survived Something Clicks' grounding checks. */
  yield: { proposed: number; kept: number; rejectedReasons: Record<string, number> } | null;
  /** The raw material for a person to score. */
  output: unknown;
}

export interface CaseRun {
  caseId: string;
  tasks: TaskResult[];
  checks: CaseChecks | null;
}

export interface RunSettings {
  /** What was held identical across candidates (MODEL_EVALUATION_PLAN.md section 5). */
  temperature: number;
  topP: number;
  attemptTimeoutMs: number | null;
  extraBody: string | null;
  gpuUsdPerHour: number | null;
  gpuClass: string | null;
  node: string;
  gitCommit: string | null;
}

export interface ModelRun {
  schema: 1;
  provider: string;
  model: string;
  startedAt: string;
  /** The dataset this ran on. A result counts only if this equals the frozen hash. */
  datasetHash: string;
  frozenMatch: boolean;
  set: "dev" | "test" | "all" | "custom";
  settings: RunSettings;
  cases: CaseRun[];
}
