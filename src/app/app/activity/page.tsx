import type { Metadata } from "next";

import { activityDetail, activityLabel, formatWhen } from "@/lib/activity";
import { requireOrganization } from "@/lib/auth";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  const { organization } = await requireOrganization();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, action, metadata, created_at")
    .eq("organization_id", organization.id)
    // Internal Marketing Agent records stay out of the customer's history until those features are switched on:
    // workflow runs (workflow.*) and business details proposed from the website (business_fact.*).
    .not("action", "like", "workflow.%")
    .not("action", "like", "business_fact.%")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) log.error("activity.query_failed", { organizationId: organization.id, error: error.message });

  return (
    <>
      <div className="eyebrow">A clear record</div>
      <h1 className="h1">History</h1>
      <p className="sub">Checks, drafts, approvals and finished work.</p>
      {error ? (
        <p className="notice error" role="alert">
          We couldn&apos;t load your activity right now. Refresh the page to try again.
        </p>
      ) : (
        <div className="card list">
          {(data ?? []).map((event) => {
            const detail = activityDetail(event.metadata);
            return (
              <div className="item" key={event.id}>
                <div>
                  <b>{activityLabel(event.action)}</b>
                  <div className="small muted">
                    {detail ? `${detail} · ` : ""}
                    <time dateTime={event.created_at}>{formatWhen(event.created_at)}</time>
                  </div>
                </div>
                {event.action === "analysis.failed" || event.action === "agent_run.failed" || event.action === "approval.rejected" || event.action === "outcome.still_found" ? (
                  <span className="pill coral">Failed</span>
                ) : event.action === "analysis.started" || event.action === "agent_run.started" ? (
                  <span className="pill">Started</span>
                ) : event.action === "agent_run.succeeded" || event.action === "approval.changes_requested" ? (
                  <span className="pill yellow">Needs approval</span>
                ) : (
                  <span className="pill green">Done</span>
                )}
              </div>
            );
          })}
          {data?.length === 0 ? <p className="muted">No activity yet.</p> : null}
        </div>
      )}
    </>
  );
}
