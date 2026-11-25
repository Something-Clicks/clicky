import type { CapabilityId } from "../capabilities";

/**
 * The contract every Something Clicks Marketing Agent capability implements (specification §2.2):
 * typed input, typed output, independently testable, reusable by any workflow.
 *
 * A capability either completes ("done", with its output and a plain one-line summary for the
 * workflow record) or reports that it cannot run ("blocked", with the reason). It never returns
 * placeholder output. Unexpected failures throw; the orchestrator records them.
 */
export type CapabilityRun<O> = { status: "done"; output: O; detail: string } | { status: "blocked"; reason: string };

export interface CapabilityModule<I, O> {
  id: CapabilityId;
  run(input: I): Promise<CapabilityRun<O>>;
}

/** Unwraps a run that must have completed (for callers that already checked availability). */
export function expectDone<O>(run: CapabilityRun<O>, id: string): { output: O; detail: string } {
  if (run.status !== "done") throw new Error(`${id} did not run: ${run.reason}`);
  return run;
}
