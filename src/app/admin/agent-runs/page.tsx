import type { Metadata } from "next";

import { DRAFT_LABEL } from "@/components/draft";
import { formatWhen } from "@/lib/activity";
import { requirePlatformAdmin } from "@/lib/auth";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Agent runs" };
export const dynamic = "force-dynamic";

interface Runs {
  last_day: Record<string, number> | null;
  runs: {
    id: string;
    organization: string;
    draft_type: string;
    status: string;
    model: string | null;
    error: string | null;
    usage: { input_tokens?: number; output_tokens?: number } | null;
    started_at: string;
  }[];
}

const PILL: Record<string, string> = { succeeded: "pill green", failed: "pill coral", running: "pill yellow" };

export default async function AgentRunsPage() {
  const user = await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_agent_runs");
  if (error) log.error("admin.agent_runs_failed", { userId: user.id, error: error.message });
  const r = data as Runs | null;

  return (
    <>
      <div className="eyebrow">Platform admin</div>
      <h1 className="h1">Agent runs</h1>
      <p className="sub">Every AI preparation, its outcome and cost. Draft content is not shown here.</p>
      {error || !r ? (
        <p className="notice error" role="alert">Agent runs could not be loaded.</p>
      ) : (
        <>
          <div className="grid">
            {(["succeeded", "failed", "running"] as const).map((s) => (
              <div className="card" key={s}>
                <div className="metric">{r.last_day?.[s] ?? 0}</div>
                <div className="metric-label">{s[0]!.toUpperCase() + s.slice(1)} in the last day</div>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Account</th>
                  <th scope="col">Draft</th>
                  <th scope="col">Status</th>
                  <th scope="col">Tokens (in / out)</th>
                  <th scope="col">Error</th>
                </tr>
              </thead>
              <tbody>
                {r.runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatWhen(run.started_at)}</td>
                    <td>{run.organization}</td>
                    <td>{DRAFT_LABEL[run.draft_type] ?? run.draft_type}</td>
                    <td><span className={PILL[run.status] ?? "pill"}>{run.status}</span></td>
                    <td>{run.usage ? `${run.usage.input_tokens ?? 0} / ${run.usage.output_tokens ?? 0}` : "—"}</td>
                    <td>{run.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.runs.length === 0 ? <p className="muted">No runs yet.</p> : null}
          </div>
        </>
      )}
    </>
  );
}
