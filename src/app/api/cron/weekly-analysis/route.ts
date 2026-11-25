import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { log } from "@/lib/log";
import { runWebsiteReview } from "@/lib/server/agent/orchestrator";
import { createWorkerClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
/** No new business is started after this many ms (one check can take about two minutes). */
const CRON_START_CUTOFF_MS = 150_000;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Weekly re-analysis. Called by Vercel Cron (see vercel.json) with
 * "Authorization: Bearer $CRON_SECRET". Runs at most 3 businesses per call so it fits
 * the function time limit; businesses not reached run on the next call.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let db;
  try {
    db = createWorkerClient();
  } catch (error) {
    log.error("cron.weekly_analysis.not_configured", { error });
    return NextResponse.json({ error: "Worker not configured" }, { status: 503 });
  }

  const { data: due, error } = await db.rpc("worker_due_organizations", { p_limit: 2 });
  if (error) {
    log.error("cron.weekly_analysis.due_failed", { error: error.message });
    return NextResponse.json({ error: "Could not list due businesses" }, { status: 500 });
  }

  const results: { organizationId: string; started: boolean }[] = [];
  const began = Date.now();
  for (const org of due ?? []) {
    // One deadline for the whole call: a business is only started if a full check still fits inside the function limit.
    if (Date.now() - began > CRON_START_CUTOFF_MS) {
      log.warn("cron.weekly_analysis.deadline_reached", { remaining: (due?.length ?? 0) - results.length });
      break;
    }
    const { data: analysisId, error: startError } = await db.rpc("start_analysis", { p_org: org.organization_id });
    if (startError || !analysisId) {
      log.warn("cron.weekly_analysis.start_skipped", { organizationId: org.organization_id, error: startError?.message });
      results.push({ organizationId: org.organization_id, started: false });
      continue;
    }
    try {
      await runWebsiteReview(
        db,
        {
          orgId: org.organization_id,
          analysisId,
          business: { businessName: org.business_name, serviceArea: org.service_area, primaryGoal: org.primary_goal, website: org.website },
          request: "Weekly re-check",
        },
        { notifyOrg: org.organization_id },
      );
    } catch (error) {
      // One business failing must not stop the others or leave its analysis "running".
      log.error("cron.weekly_analysis.run_crashed", { organizationId: org.organization_id, error });
      await db.rpc("fail_analysis", { p_analysis: analysisId, p_reason: "The weekly check could not finish." });
    }
    results.push({ organizationId: org.organization_id, started: true });
  }
  log.info("cron.weekly_analysis.done", { due: due?.length ?? 0, started: results.filter((r) => r.started).length });
  return NextResponse.json({ processed: results.length, started: results.filter((r) => r.started).length });
}
