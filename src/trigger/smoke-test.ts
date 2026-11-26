import { logger, task } from "@trigger.dev/sdk";

/** Payload for the smoke test: a short label only. */
export interface SmokeTestPayload {
  message: string;
}

/** Validates the smoke-test payload; exported so the rule is unit-tested without Trigger.dev. */
export function readSmokePayload(payload: unknown): SmokeTestPayload {
  const message = (payload as { message?: unknown } | null)?.message;
  if (typeof message !== "string" || !message.trim() || message.length > 200) {
    throw new Error("The smoke test needs a message of 1 to 200 characters.");
  }
  return { message: message.trim() };
}

/**
 * A safe smoke test: proves a task registers, runs and returns. It touches no database, website or customer data.
 * Trigger it from the dashboard's Test page with { "message": "hello" }.
 */
export const smokeTest = task({
  id: "smoke-test",
  retry: { maxAttempts: 1 },
  maxDuration: 30,
  run: async (payload: SmokeTestPayload, { ctx }) => {
    const { message } = readSmokePayload(payload);
    logger.info("smoke-test received", { length: message.length });
    return { ok: true as const, echoed: message, runId: ctx.run.id, attempt: ctx.attempt.number, at: new Date().toISOString() };
  },
});
