import { logger, queue, task } from "@trigger.dev/sdk";

import {
  failWebsiteReviewJob,
  failWeeklyRecheckJob,
  runWebsiteReviewJob,
  runWeeklyRecheckJob,
  TASK_IDS,
  type WebsiteReviewJob,
  type WeeklyRecheckJob,
} from "@/lib/server/agent/background";
import { createWorkerClient } from "@/lib/supabase/admin";

/**
 * Durable background jobs for the Marketing Agent. Each task is a thin wrapper: the orchestrator does the work and makes
 * every decision (src/lib/server/agent/orchestrator.ts via background.ts). The worker uses the same database role as the
 * scheduled re-check worker (createWorkerClient), never a customer's session.
 */
/** At most 4 checks at once across all businesses: bounds load on websites, the database and any model server. */
const agentQueue = queue({ name: "marketing-agent", concurrencyLimit: 4 });

/** A website check a customer started: Website Intelligence → Marketing Analysis → Action Cards, with retries for crashes. */
export const websiteReview = task({
  id: TASK_IDS.websiteReview,
  queue: agentQueue,
  maxDuration: 600,
  retry: { maxAttempts: 3 },
  run: async (payload: WebsiteReviewJob, { ctx }) => {
    const result = await runWebsiteReviewJob(createWorkerClient(), payload, { runId: ctx.run.id, attempt: ctx.attempt.number });
    logger.info("website-review finished", { status: result.status });
    return result;
  },
  onFailure: async ({ payload }) => {
    await failWebsiteReviewJob(createWorkerClient(), payload.analysisId);
  },
});

/** One business's weekly re-check, queued by the scheduled worker (one per business per day). */
export const weeklyRecheck = task({
  id: TASK_IDS.weeklyRecheck,
  queue: agentQueue,
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async (payload: WeeklyRecheckJob, { ctx }) => {
    const result = await runWeeklyRecheckJob(createWorkerClient(), payload, { runId: ctx.run.id, attempt: ctx.attempt.number });
    logger.info("weekly-recheck finished", { status: result.status });
    return result;
  },
  onFailure: async ({ payload }) => {
    await failWeeklyRecheckJob(createWorkerClient(), payload.organizationId);
  },
});
