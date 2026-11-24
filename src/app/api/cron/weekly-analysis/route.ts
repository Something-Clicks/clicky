import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { log } from "@/lib/log";
import { runWebsiteReview } from "@/lib/server/agent/orchestrator";
import { createWorkerClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  const { data: due, error } = await db.rpc("worker_due_organizations", { p_limit: 3 });
  if (error) {
    log.error("cron.weekly_analysis.due_failed", { error: error.message });
    return NextResponse.json({ error: "Could not list due businesses" }, { status: 500 });
  }

  const results: { organizationId: string; started: boolean }[] = [];
  for (const org of due ?? []) {
    const { data: analysisId, error: startError } = await db.rpc("start_analysis", { p_org: org.organization_id });
    if (startError || !analysisId) {
      log.warn("cron.weekly_analysis.start_skipped", { organizationId: org.organization_id, error: startError?.message });
      results.push({ organizationId: org.organization_id, started: false });
      continue;
    }
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
    results.push({ organizationId: org.organization_id, started: true });
  }
  log.info("cron.weekly_analysis.done", { due: due?.length ?? 0, started: results.filter((r) => r.started).length });
  return NextResponse.json({ processed: results.length, started: results.filter((r) => r.started).length });
}
