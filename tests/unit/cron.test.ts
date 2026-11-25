import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const runWebsiteReview = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createWorkerClient: () => ({ rpc }) }));
vi.mock("@/lib/server/agent/orchestrator", () => ({ runWebsiteReview }));

const SECRET = "x".repeat(24);
const req = (auth?: string) => new NextRequest("https://example.test/api/cron/weekly-analysis", { headers: auth ? { authorization: auth } : {} });
const org = (n: number) => ({ organization_id: `org-${n}`, business_name: `B${n}`, service_area: null, primary_goal: null, website: "https://x.test" });

async function call(auth?: string) {
  const { GET } = await import("@/app/api/cron/weekly-analysis/route");
  return GET(req(auth));
}

describe("weekly cron", () => {
  beforeEach(() => {
    rpc.mockReset();
    runWebsiteReview.mockReset();
    process.env.CRON_SECRET = SECRET;
    vi.useRealTimers();
  });

  it("refuses a missing, wrong or short secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    process.env.CRON_SECRET = "short";
    expect((await call("Bearer short")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("one business crashing fails only its own analysis; the next still runs", async () => {
    rpc.mockImplementation(async (name: string, args: { p_org?: string }) => {
      if (name === "worker_due_organizations") return { data: [org(1), org(2)], error: null };
      if (name === "start_analysis") return { data: `analysis-${args.p_org}`, error: null };
      return { data: null, error: null };
    });
    runWebsiteReview.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ status: "prepared" });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(runWebsiteReview).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("fail_analysis", { p_analysis: "analysis-org-1", p_reason: expect.any(String) });
    expect(rpc).not.toHaveBeenCalledWith("fail_analysis", expect.objectContaining({ p_analysis: "analysis-org-2" }));
  });

  it("an analysis another run already started is skipped, not run twice", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "worker_due_organizations") return { data: [org(1)], error: null };
      if (name === "start_analysis") return { data: null, error: { message: "An analysis is already running", hint: "already_running" } };
      return { data: null, error: null };
    });
    const res = await call(`Bearer ${SECRET}`);
    expect(await res.json()).toEqual({ processed: 1, started: 0 });
    expect(runWebsiteReview).not.toHaveBeenCalled();
  });

  it("starts no new business once the call's time is nearly used up", async () => {
    vi.useFakeTimers();
    rpc.mockImplementation(async (name: string, args: { p_org?: string }) => {
      if (name === "worker_due_organizations") return { data: [org(1), org(2)], error: null };
      if (name === "start_analysis") return { data: `analysis-${args.p_org}`, error: null };
      return { data: null, error: null };
    });
    runWebsiteReview.mockImplementation(async () => { vi.advanceTimersByTime(160_000); return { status: "prepared" }; });
    await call(`Bearer ${SECRET}`);
    expect(runWebsiteReview).toHaveBeenCalledTimes(1);
  });
});
