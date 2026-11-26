import "server-only";

import { tasks } from "@trigger.dev/sdk";

import { log } from "@/lib/log";

import type { Db } from "../analysis";
import { BACKGROUND_DEADLINE_MS } from "./deadline";
import { runWebsiteReview, type BackgroundRun, type BusinessInput } from "./orchestrator";

/**
 * Durable background execution for the Marketing Agent (Trigger.dev). This module decides only WHERE work runs; the
 * orchestrator decides WHAT runs. Tasks in src/trigger/ call the functions below and contain no business logic.
 *
 * Switched off unless BACKGROUND_JOBS=trigger and TRIGGER_SECRET_KEY are set, and always off in Production
 * (VERCEL_ENV=production) until the owner changes this code. When off, or when queueing fails, work runs exactly as before
 * (in-process after the response, or inline in the cron worker).
 *
 * Retries cover the worker itself (crash, timeout, lost machine). A website that cannot be read is NOT retried: the
 * orchestrator records the analysis as failed, as it always has, and a retry finds it finished and stops. A run that
 * fails every attempt closes its analysis as failed, so nothing is left "running".
 */
export function backgroundJobsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BACKGROUND_JOBS === "trigger" && Boolean(env.TRIGGER_SECRET_KEY?.trim()) && env.VERCEL_ENV !== "production";
}

export const TASK_IDS = { websiteReview: "website-review", weeklyRecheck: "weekly-recheck" } as const;

/** A website check a customer (or onboarding) already started; the analysis row exists and passed its limits. */
export interface WebsiteReviewJob {
  organizationId: string;
  analysisId: string;
  business: BusinessInput;
  request: string | null;
  notify: boolean;
}

/** One business due for its weekly re-check. */
export interface WeeklyRecheckJob {
  organizationId: string;
  business: BusinessInput;
  /** YYYY-MM-DD: one re-check per business per day, however often the schedule fires. */
  day: string;
}

type Trigger = (id: string, payload: unknown, options: { idempotencyKey: string; tags: string[] }) => Promise<{ id: string }>;
const defaultTrigger: Trigger = (id, payload, options) => tasks.trigger(id, payload, options);

/**
 * Queues a started website check as a durable job, or runs `inline` when background jobs are off or queueing fails.
 * The idempotency key is the analysis id, so a double submit can never queue the same check twice.
 */
export async function queueWebsiteReview(
  job: WebsiteReviewJob,
  inline: () => void,
  deps: { trigger?: Trigger; env?: Record<string, string | undefined> } = {},
): Promise<{ mode: "background"; runId: string } | { mode: "inline" }> {
  if (!backgroundJobsEnabled(deps.env)) {
    inline();
    return { mode: "inline" };
  }
  try {
    const handle = await (deps.trigger ?? defaultTrigger)(TASK_IDS.websiteReview, job, {
      idempotencyKey: `website-review:${job.analysisId}`,
      tags: [`org_${job.organizationId}`, `analysis_${job.analysisId}`],
    });
    log.info("background.queued", { task: TASK_IDS.websiteReview, runId: handle.id, analysisId: job.analysisId });
    return { mode: "background", runId: handle.id };
  } catch (error) {
    log.error("background.queue_failed", { task: TASK_IDS.websiteReview, analysisId: job.analysisId, error });
    inline();
    return { mode: "inline" };
  }
}

/** Queues weekly re-checks, one per business per day (idempotent), or returns null when background jobs are off. */
export async function queueWeeklyRechecks(
  jobs: WeeklyRecheckJob[],
  deps: { trigger?: Trigger; env?: Record<string, string | undefined> } = {},
): Promise<{ queued: number; failed: number } | null> {
  if (!backgroundJobsEnabled(deps.env)) return null;
  let queued = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await (deps.trigger ?? defaultTrigger)(TASK_IDS.weeklyRecheck, job, {
        idempotencyKey: `weekly-recheck:${job.organizationId}:${job.day}`,
        tags: [`org_${job.organizationId}`],
      });
      queued += 1;
    } catch (error) {
      failed += 1;
      log.error("background.queue_failed", { task: TASK_IDS.weeklyRecheck, organizationId: job.organizationId, error });
    }
  }
  return { queued, failed };
}

type WorkerDb = Pick<Db, "rpc" | "from">;
export type JobResult = { status: "prepared" | "blocked" | "failed"; workflowId: string | null } | { status: "skipped"; reason: string };

/** Runs a queued website check (inside the worker). A retry after the check already finished does nothing. */
export async function runWebsiteReviewJob(db: WorkerDb, job: WebsiteReviewJob, run: BackgroundRun): Promise<JobResult> {
  const { data } = await db.from("analyses").select("status, organization_id").eq("id", job.analysisId).maybeSingle();
  if (!data || data.organization_id !== job.organizationId) return { status: "skipped", reason: "not_found" };
  if (data.status !== "running") return { status: "skipped", reason: `already_${data.status}` };
  if (run.attempt > 1) await closeStaleWorkflows(db, job.analysisId);
  const out = await runWebsiteReview(
    db,
    { orgId: job.organizationId, analysisId: job.analysisId, business: job.business, request: job.request, background: run, deadlineMs: BACKGROUND_DEADLINE_MS },
    job.notify ? { notifyOrg: job.organizationId } : {},
  );
  return { status: out.status, workflowId: out.workflowId };
}

/**
 * A retried run must not be blocked by the record its crashed attempt left "running" (one running workflow per kind is
 * enforced), and that record must not stay "running" forever: close it as failed, with the reason, before retrying.
 */
export async function closeStaleWorkflows(db: WorkerDb, analysisId: string): Promise<number> {
  const { data } = await db.from("marketing_workflows").select("id, steps").eq("analysis_id", analysisId).eq("status", "running");
  let closed = 0;
  for (const wf of data ?? []) {
    const steps = Array.isArray(wf.steps) ? wf.steps : [];
    const { error } = await db.rpc("finish_marketing_workflow", {
      p_workflow: wf.id, p_status: "failed", p_steps: steps, p_result: null,
      p_error: "This attempt stopped before finishing; the check was retried.", p_provider: null, p_model: null, p_usage: null,
    });
    if (error) log.warn("background.close_stale_failed", { workflowId: wf.id, error: error.message });
    else closed += 1;
  }
  return closed;
}

/** Closes a check that failed every attempt, so the customer sees it failed instead of "running" forever. */
export async function failWebsiteReviewJob(db: WorkerDb, analysisId: string): Promise<void> {
  const { data } = await db.from("analyses").select("status").eq("id", analysisId).maybeSingle();
  if (data?.status !== "running") return;
  const { error } = await db.rpc("fail_analysis", { p_analysis: analysisId, p_reason: "The check could not finish. Please try again." });
  if (error) log.error("background.fail_record_failed", { analysisId, error: error.message });
}

/** A re-check started this long ago by an earlier attempt is continued rather than started again. */
const RESUME_WINDOW_MS = 15 * 60_000;

/** Runs one business's weekly re-check (inside the worker): starts the analysis, or continues one an earlier attempt started. */
export async function runWeeklyRecheckJob(db: WorkerDb, job: WeeklyRecheckJob, run: BackgroundRun, now = Date.now()): Promise<JobResult & { analysisId?: string }> {
  let analysisId: string | null = null;
  if (run.attempt > 1) {
    const { data } = await db.from("analyses").select("id, started_at").eq("organization_id", job.organizationId).eq("status", "running")
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (data && now - Date.parse(data.started_at as string) < RESUME_WINDOW_MS) analysisId = data.id;
  }
  if (!analysisId) {
    const { data, error } = await db.rpc("start_analysis", { p_org: job.organizationId });
    if (error || !data) return { status: "skipped", reason: (error as { hint?: string } | null)?.hint ?? "not_started" };
    analysisId = data;
  }
  const out = await runWebsiteReviewJob(db, { organizationId: job.organizationId, analysisId, business: job.business, request: "Weekly re-check", notify: true }, run);
  return { ...out, analysisId };
}

/** Closes a weekly re-check that failed every attempt (the running analysis it started, if any). */
export async function failWeeklyRecheckJob(db: WorkerDb, organizationId: string, now = Date.now()): Promise<void> {
  const { data } = await db.from("analyses").select("id, started_at").eq("organization_id", organizationId).eq("status", "running")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (data && now - Date.parse(data.started_at as string) < RESUME_WINDOW_MS) await failWebsiteReviewJob(db, data.id);
}
