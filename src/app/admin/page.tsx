import type { Metadata } from "next";

import { formatWhen } from "@/lib/activity";
import { requirePlatformAdmin } from "@/lib/auth";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

interface Overview {
  organization_count: number;
  user_count: number;
  organizations: { id: string; name: string; created_at: string; member_count: number }[];
}

export default async function AdminPage() {
  const user = await requirePlatformAdmin();
  const supabase = await createClient();
  // The database re-checks admin rights and logs this view (admin_overview).
  const { data, error } = await supabase.rpc("admin_overview");
  if (error) log.error("admin.overview_failed", { userId: user.id, error: error.message });
  else log.info("admin.overview_viewed", { userId: user.id });
  const overview = data as Overview | null;

  return (
    <>
      <div className="eyebrow">Platform admin</div>
      <h1 className="h1">Operational overview</h1>
      <p className="sub">Counts and account names only. Customer data stays private by default.</p>
      {error || !overview ? (
        <p className="notice error" role="alert">
          The overview could not be loaded. Check the server logs for admin.overview_failed.
        </p>
      ) : (
        <>
          <div className="grid">
            <div className="card">
              <div className="metric">{overview.organization_count}</div>
              <div className="metric-label">Business accounts</div>
            </div>
            <div className="card">
              <div className="metric">{overview.user_count}</div>
              <div className="metric-label">People signed up</div>
            </div>
            <div className="card">
              <div className="metric">OK</div>
              <div className="metric-label">Database reachable</div>
            </div>
          </div>
          <h3 style={{ margin: "26px 0 12px" }}>Newest business accounts</h3>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Members</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {overview.organizations.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td>
                    <td>{o.member_count}</td>
                    <td>{formatWhen(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overview.organizations.length === 0 ? <p className="muted">No accounts yet.</p> : null}
          </div>
        </>
      )}
    </>
  );
}
