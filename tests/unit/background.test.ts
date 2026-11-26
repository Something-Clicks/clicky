/**
 * Durable background jobs (Trigger.dev): where work runs, and what a retry or a final failure does. The orchestrator's own
 * behaviour is tested in agent.test.ts; here a stand-in database proves the job rules only. Trigger.dev itself is not called.
 */
import { describe, expect, it, vi } from "vitest";

import {
  backgroundJobsEnabled,
  failWebsiteReviewJob,
  failWeeklyRecheckJob,
  queueWebsiteReview,
  queueWeeklyRechecks,
  runWebsiteReviewJob,
  runWeeklyRecheckJob,
} from "@/lib/server/agent/background";
import { readSmokePayload } from "@/trigger/smoke-test";

const ON = { BACKGROUND_JOBS: "trigger", TRIGGER_SECRET_KEY: "tr_dev_x" };
const business = { businessName: "Sunrise", website: "https://sunrise.example", serviceArea: null, primaryGoal: null };
const job = { organizationId: "o1", analysisId: "a1", business, request: null, notify: true };

type Row = Record<string, unknown>;
function db(analyses: Row[] | ((read: number) => Row[]), rpc: (name: string, args: Row) => { data: unknown; error: unknown } = () => ({ data: null, error: null })) {
  const calls: [string, Row][] = [];
  let reads = 0;
  return {
    calls,
    db: {
      rpc: vi.fn(async (name: string, args: Row) => { calls.push([name, args]); return rpc(name, args); }),
      from: () => {
        let rows = [...(typeof analyses === "function" ? analyses(reads++) : analyses)];
        const q = {
          select: () => q,
          eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
          order: () => q,
          limit: () => q,
          maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        };
        return q;
      },
    } as never,
  };
}

describe("switch", () => {
  it("is on only with BACKGROUND_JOBS=trigger and a secret key, and never in Production", () => {
    expect(backgroundJobsEnabled({})).toBe(false);
    expect(backgroundJobsEnabled({ BACKGROUND_JOBS: "trigger" })).toBe(false);
    expect(backgroundJobsEnabled({ TRIGGER_SECRET_KEY: "x" })).toBe(false);
    expect(backgroundJobsEnabled(ON)).toBe(true);
    expect(backgroundJobsEnabled({ ...ON, VERCEL_ENV: "production" })).toBe(false);
  });
});

describe("queueing", () => {
  it("off: runs inline exactly as before and never calls Trigger.dev", async () => {
    const trigger = vi.fn();
    const inline = vi.fn();
    expect(await queueWebsiteReview(job, inline, { trigger, env: {} })).toEqual({ mode: "inline" });
    expect(inline).toHaveBeenCalledOnce();
    expect(trigger).not.toHaveBeenCalled();
    expect(await queueWeeklyRechecks([], { trigger, env: {} })).toBeNull();
  });

  it("on: queues once per analysis (idempotency key), tagged by business", async () => {
    const trigger = vi.fn(async () => ({ id: "run_1" }));
    const inline = vi.fn();
    expect(await queueWebsiteReview(job, inline, { trigger, env: ON })).toEqual({ mode: "background", runId: "run_1" });
    expect(inline).not.toHaveBeenCalled();
    expect(trigger).toHaveBeenCalledWith("website-review", job, { idempotencyKey: "website-review:a1", tags: ["org_o1", "analysis_a1"] });
  });

  it("on, but Trigger.dev unreachable: the customer's check still runs inline", async () => {
    const inline = vi.fn();
    const out = await queueWebsiteReview(job, inline, { trigger: async () => { throw new Error("network"); }, env: ON });
    expect(out).toEqual({ mode: "inline" });
    expect(inline).toHaveBeenCalledOnce();
  });

  it("weekly re-checks: one per business per day, failures counted", async () => {
    const trigger = vi.fn(async (_id: string, p: unknown, _opts?: unknown) => { if ((p as { organizationId: string }).organizationId === "bad") throw new Error("x"); return { id: "r" }; });
    const jobs = ["o1", "bad", "o2"].map((organizationId) => ({ organizationId, business, day: "2026-11-27" }));
    expect(await queueWeeklyRechecks(jobs, { trigger, env: ON })).toEqual({ queued: 2, failed: 1 });
    expect(trigger.mock.calls[0]![2]).toEqual({ idempotencyKey: "weekly-recheck:o1:2026-11-27", tags: ["org_o1"] });
  });
});

describe("running a queued check", () => {
  it("a retry after the check finished does nothing (no second analysis, no double completion)", async () => {
    for (const status of ["complete", "failed"]) {
      const d = db([{ id: "a1", status, organization_id: "o1" }]);
      expect(await runWebsiteReviewJob(d.db, job, { runId: "r", attempt: 2 })).toEqual({ status: "skipped", reason: `already_${status}` });
      expect(d.calls).toEqual([]);
    }
  });

  it("refuses a job whose analysis belongs to another business", async () => {
    const d = db([{ id: "a1", status: "running", organization_id: "other" }]);
    expect(await runWebsiteReviewJob(d.db, job, { runId: "r", attempt: 1 })).toEqual({ status: "skipped", reason: "not_found" });
    expect(d.calls).toEqual([]);
  });

  it("after every attempt failed, a still-running check is closed as failed; a finished one is left alone", async () => {
    const running = db([{ id: "a1", status: "running" }]);
    await failWebsiteReviewJob(running.db, "a1");
    expect(running.calls).toEqual([["fail_analysis", { p_analysis: "a1", p_reason: "The check could not finish. Please try again." }]]);
    const done = db([{ id: "a1", status: "complete" }]);
    await failWebsiteReviewJob(done.db, "a1");
    expect(done.calls).toEqual([]);
  });

  it("weekly: a retry continues the analysis its first attempt started instead of starting (and counting) another", async () => {
    const now = Date.parse("2026-11-27T14:20:00Z");
    // Read 1 finds the running analysis from attempt 1; read 2 (inside the job) sees it finished meanwhile, so no website is read here.
    const d = db((read) => [{ id: "a9", status: read === 0 ? "running" : "complete", organization_id: "o1", started_at: "2026-11-27T14:17:00Z" }]);
    const resumed = await runWeeklyRecheckJob(d.db, { organizationId: "o1", business, day: "2026-11-27" }, { runId: "r", attempt: 2 }, now);
    expect(resumed).toEqual({ status: "skipped", reason: "already_complete", analysisId: "a9" });
    expect(d.calls.map((c) => c[0])).not.toContain("start_analysis");
    const first = db([], (name) => (name === "start_analysis" ? { data: null, error: { message: "x", hint: "already_running" } } : { data: null, error: null }));
    expect(await runWeeklyRecheckJob(first.db, { organizationId: "o1", business, day: "2026-11-27" }, { runId: "r", attempt: 1 }, now)).toEqual({ status: "skipped", reason: "already_running" });
    const old = db([{ id: "a9", status: "running", organization_id: "o1", started_at: "2026-11-27T13:00:00Z" }]);
    await failWeeklyRecheckJob(old.db, "o1", now);
    expect(old.calls).toEqual([]); // an old running check is not this job's to close
  });
});

describe("smoke test payload", () => {
  it("accepts a short message and refuses anything else", () => {
    expect(readSmokePayload({ message: "  hello " })).toEqual({ message: "hello" });
    for (const bad of [null, {}, { message: "" }, { message: 5 }, { message: "x".repeat(201) }]) expect(() => readSmokePayload(bad)).toThrow(/1 to 200/);
  });
});

describe("retries and schedulers", () => {
  it("a retry closes the workflow record its crashed attempt left running, as failed with the reason", async () => {
    const { closeStaleWorkflows } = await import("@/lib/server/agent/background");
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const rows = [{ id: "wf-old", steps: [{ step: "plan" }], analysis_id: "a1", status: "running" }];
    const from = () => {
      let r = [...rows];
      const q = { select: () => q, eq: (k: string, v: unknown) => { r = r.filter((x) => (x as Row)[k] === v); return q; }, then: (res: (v: { data: Row[] }) => unknown) => Promise.resolve({ data: r }).then(res) };
      return q;
    };
    expect(await closeStaleWorkflows({ rpc, from } as never, "a1")).toBe(1);
    expect(rpc).toHaveBeenCalledWith("finish_marketing_workflow", expect.objectContaining({ p_workflow: "wf-old", p_status: "failed", p_steps: [{ step: "plan" }], p_error: expect.stringMatching(/retried/) }));
    expect(await closeStaleWorkflows({ rpc, from } as never, "other")).toBe(0);
  });

  it("only one scheduler exists: Trigger.dev tasks are queued by the Vercel cron, never scheduled on their own", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = "src/trigger";
    for (const f of readdirSync(dir)) {
      // A schedules.task here would run re-checks alongside the Vercel cron (vercel.json). Retire one before adding the other.
      expect(readFileSync(`${dir}/${f}`, "utf8")).not.toMatch(/schedules\s*\.\s*task|\bcron\s*:/);
    }
    expect(readFileSync("vercel.json", "utf8")).toMatch(/\/api\/cron\/weekly-analysis/);
  });
});
