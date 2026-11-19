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
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) log.error("activity.query_failed", { organizationId: organization.id, error: error.message });

  return (
    <>
      <div className="eyebrow">A clear record</div>
      <h1 className="h1">See what has happened.</h1>
      <p className="sub">A transparent history of analyses, approvals, agent runs, and completed work.</p>
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
                {event.action === "analysis.failed" ? (
                  <span className="pill coral">Failed</span>
                ) : event.action === "analysis.started" ? (
                  <span className="pill">Started</span>
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
