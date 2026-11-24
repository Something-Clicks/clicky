import type { Metadata } from "next";
import Link from "next/link";

import { formatWhen } from "@/lib/activity";
import { requirePlatformAdmin } from "@/lib/auth";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Funnel and feedback" };
export const dynamic = "force-dynamic";

interface Funnel {
  since: string;
  events: Record<string, number>;
  free_uses: number;
  previews: { started: number; completed: number; saved: number; claimed: number };
  purchases: number;
  subscriptions: number;
  ratings: { up: number; down: number };
  feedback: { id: string; kind: string; rating: string | null; reason: string | null; created_at: string; followup_email: string | null }[];
}

const STEPS: [string, string][] = [
  ["homepage_visit", "Homepage visits"],
  ["first_use_started", "First use started"],
  ["first_result_completed", "First result completed"],
  ["save_this_clicked", "Save this"],
  ["signup_started", "Sign-up started"],
  ["signup_completed", "Sign-up completed"],
  ["free_use_consumed", "Free uses consumed"],
  ["upgrade_viewed", "Upgrade viewed"],
  ["checkout_started", "Checkout started"],
  ["purchase_completed", "Marketing Report purchases"],
  ["subscription_completed", "Subscriptions started"],
  ["draft_created", "Drafts created"],
  ["draft_approved", "Drafts approved"],
  ["work_completed", "Work marked done"],
  ["reanalysis_completed", "Website checks completed"],
  ["feedback_submitted", "Feedback sent"],
];

/** Internal view: funnel counts (no personal data) and feedback. Admins only; every view is logged. */
export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requirePlatformAdmin();
  const days = [7, 30, 90].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_funnel", { p_days: days });
  if (error) log.error("admin.funnel_failed", { error: error.message });
  const f = data as unknown as Funnel | null;

  return (
    <div className="stack">
      <div>
        <h1 className="h1">Funnel and feedback</h1>
        <div className="row">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={`/admin/funnel?days=${d}`} className={d === days ? "pill" : "pill lavender"} style={{ textDecoration: "none" }} aria-current={d === days ? "true" : undefined}>
              Last {d} days
            </Link>
          ))}
        </div>
      </div>
      {!f ? (
        <p className="notice error">The funnel couldn&apos;t load. Has the launch migration been applied?</p>
      ) : (
        <>
          <section className="card" aria-labelledby="steps-title">
            <h2 id="steps-title">Steps</h2>
            <table className="table">
              <tbody>
                {STEPS.map(([key, label]) => (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    <td style={{ textAlign: "right" }}>{f.events[key] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="two">
            <div className="card">
              <h2>From the database</h2>
              <table className="table">
                <tbody>
                  <tr><th scope="row">Free first results started</th><td>{f.previews.started}</td></tr>
                  <tr><th scope="row">… completed</th><td>{f.previews.completed}</td></tr>
                  <tr><th scope="row">… saved (email entered)</th><td>{f.previews.saved}</td></tr>
                  <tr><th scope="row">… claimed into an account</th><td>{f.previews.claimed}</td></tr>
                  <tr><th scope="row">Free uses completed</th><td>{f.free_uses}</td></tr>
                  <tr><th scope="row">Purchases</th><td>{f.purchases}</td></tr>
                  <tr><th scope="row">Subscriptions</th><td>{f.subscriptions}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="card">
              <h2>First result ratings</h2>
              <p className="metric">
                👍 {f.ratings.up} · 👎 {f.ratings.down}
              </p>
            </div>
          </section>
          <section className="card" aria-labelledby="fb-title">
            <h2 id="fb-title">Feedback</h2>
            {f.feedback.length === 0 ? (
              <p className="muted">No feedback yet.</p>
            ) : (
              <div className="list">
                {f.feedback.map((x) => (
                  <div className="item" key={x.id} style={{ display: "block" }}>
                    <div className="row">
                      <span className={x.kind === "upgrade" ? "pill yellow" : "pill"}>{x.kind === "upgrade" ? "What stopped you" : "First result"}</span>
                      {x.rating ? <span>{x.rating === "up" ? "👍" : "👎"}</span> : null}
                      <span className="small muted">{formatWhen(x.created_at)}</span>
                    </div>
                    {x.reason ? <p style={{ margin: "6px 0 0" }}>{x.reason}</p> : null}
                    {x.followup_email ? <p className="small" style={{ margin: "6px 0 0" }}>One follow-up OK: {x.followup_email}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
