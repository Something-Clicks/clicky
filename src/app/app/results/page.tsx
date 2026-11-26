import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { removeMetric } from "@/app/actions/agent";
import { MetricForm, ReviewResultsForm } from "@/components/agent-work";
import { FEATURES } from "@/config/features";
import { formatWhen } from "@/lib/activity";
import { requireOrganization } from "@/lib/auth";
import { METRICS } from "@/lib/server/agent/modules/performance-intelligence";
import type { ResultsReview } from "@/lib/server/agent/orchestrator";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Results" };

const SOURCE: Record<string, string> = { owner_entered: "your records", search_console_export: "Search Console", analytics_export: "your analytics" };
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Results: what was done, what a website check confirmed, and the figures the owner supplied, compared fairly. */
export default async function ResultsPage() {
  if (!FEATURES.agent) notFound();
  const ws = await requireOrganization();
  const supabase = await createClient();
  const orgId = ws.organization.id;
  const [{ data: wf }, { data: metrics }] = await Promise.all([
    supabase.from("marketing_workflows").select("result, completed_at").eq("organization_id", orgId).eq("kind", "results_review").eq("status", "prepared")
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("performance_metrics").select("id, metric, period_start, period_end, value, source").eq("organization_id", orgId).order("period_end", { ascending: false }).limit(60),
  ]);
  const review = (wf?.result ?? null) as ResultsReview | null;
  const s = review?.summary;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Measure</div>
        <h1 className="h1">Results</h1>
        <p className="sub">What was done, what your website now shows, and the numbers you give us. We don&apos;t measure your traffic ourselves, and we never fill in numbers.</p>
      </div>

      <section className="card stack" aria-labelledby="review">
        <h2 id="review" style={{ margin: 0 }}>Review</h2>
        {s ? (
          <>
            <p className="small muted">Last reviewed {formatWhen(wf!.completed_at!)}.</p>
            <div className="stats">
              <div className="stat"><div className="metric">{s.verified_fixed}</div><div className="metric-label">Fixes confirmed on your website</div></div>
              <div className="stat"><div className="metric">{s.still_found}</div><div className="metric-label">Still found after being done</div></div>
              <div className="stat"><div className="metric">{s.awaiting_check}</div><div className="metric-label">Waiting for the next check</div></div>
              <div className="stat"><div className="metric">{s.executed}</div><div className="metric-label">Carried out after your OK</div></div>
            </div>
            {s.comparisons.length ? (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead><tr><th scope="col">Number</th><th scope="col">Before</th><th scope="col">Latest</th><th scope="col">Change</th></tr></thead>
                  <tbody>
                    {s.comparisons.map((c) => (
                      <tr key={`${c.metric}-${c.source}`}>
                        <th scope="row">{c.label}<div className="small muted">{SOURCE[c.source] ?? c.source}</div></th>
                        <td>{c.previous ? <>{fmt(c.previous.value)}<div className="small muted">{c.previous.period_start} – {c.previous.period_end}</div></> : "—"}</td>
                        <td>{fmt(c.current.value)}<div className="small muted">{c.current.period_start} – {c.current.period_end}</div></td>
                        <td>{c.direction === null ? <span className="small muted">Nothing to compare yet</span> : c.direction === "about_the_same" ? "About the same" : `${c.change! > 0 ? "+" : ""}${fmt(c.change!)}${c.change_pct === null ? "" : ` (${c.change_pct > 0 ? "+" : ""}${c.change_pct}%)`}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {review!.follow_ups.length ? (
              <>
                <h3 style={{ marginBottom: 0 }}>What to look at</h3>
                <ul>{review!.follow_ups.map((f, i) => <li key={i}><strong>{f.card_id ? <Link className="link" href={`/app/actions/${f.card_id}`}>{f.title}</Link> : f.title}.</strong> {f.why}</li>)}</ul>
              </>
            ) : null}
            {review!.next_action ? <p><strong>Next:</strong> <Link className="link" href={`/app/actions/${review!.next_action.card_id}`}>{review!.next_action.title}</Link>. <span className="small muted">Chosen by fixed rules: impact, what we saw, the size of the change and your goal.</span></p> : null}
            {review!.plan_progress ? <p>Your approved plan: {review!.plan_progress.completed} of {review!.plan_progress.total} done.</p> : null}
            {s.caveats.map((c) => <p key={c} className="small muted">{c}</p>)}
          </>
        ) : <p>No review yet. It uses your completed work, your website checks and any numbers you add below.</p>}
        <ReviewResultsForm again={Boolean(s)} />
      </section>

      <section className="card stack" aria-labelledby="add">
        <h2 id="add" style={{ margin: 0 }}>Add a number</h2>
        <p className="small muted">Monthly calls, enquiries or visits work best. Add the same kind of number for the period before, so we can compare like with like.</p>
        <MetricForm metrics={Object.entries(METRICS).map(([value, m]) => ({ value, label: m.label }))} today={today} />
      </section>

      {metrics?.length ? (
        <section className="card stack" aria-labelledby="numbers">
          <h2 id="numbers" style={{ margin: 0 }}>Your numbers</h2>
          <ul className="stack" style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
            {metrics.map((m) => (
              <li key={m.id} className="row between">
                <span>{METRICS[m.metric]?.label ?? m.metric}: <strong>{fmt(Number(m.value))}</strong> <span className="small muted">· {m.period_start} – {m.period_end} · {SOURCE[m.source] ?? m.source}</span></span>
                <form action={removeMetric}><input type="hidden" name="id" value={m.id} /><button className="btn outline" type="submit" aria-label={`Remove ${METRICS[m.metric]?.label ?? m.metric} ${m.period_start}`}>Remove</button></form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
