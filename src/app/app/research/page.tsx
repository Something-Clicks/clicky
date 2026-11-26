import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { removeComparison } from "@/app/actions/campaigns";
import { CompareForm } from "@/components/agent-forms";
import { FEATURES } from "@/config/features";
import { requireOrganization } from "@/lib/auth";
import { compareSignals, readSignals, SIGNAL_LABEL, SIGNAL_KEYS, type SiteSignals } from "@/lib/research";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Compare" };
export const maxDuration = 120;

/** Compare: what the owner's homepage visibly shows next to the sites they named. Observed on public homepages only. */
export default async function ResearchPage() {
  if (!FEATURES.campaigns) notFound();
  const ws = await requireOrganization();
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("competitor_scans")
    .select("id, host, status, is_self, signals, failure, scanned_at")
    .eq("organization_id", ws.organization.id)
    .order("scanned_at", { ascending: false });
  const scans = rows ?? [];
  const own = readSignals(scans.find((s) => s.is_self && s.status === "done")?.signals);
  const others = scans.filter((s) => !s.is_self);
  const read = others.filter((s) => s.status === "done").map((s) => ({ host: s.host, signals: readSignals(s.signals) })).filter((s): s is { host: string; signals: SiteSignals } => s.signals !== null);
  const table = compareSignals(own, read);

  return (
    <div className="stack">
      <div>
        <h1 className="h1">Compare</h1>
        <p className="sub">See what other websites show on their homepage that yours doesn&apos;t. We only read public pages.</p>
      </div>
      {!own && others.length === 0 && !ws.business?.website ? <p className="notice">Add your website first so we can compare it. <Link className="link" href="/app/onboarding">Add it</Link></p> : null}
      <section className="card stack"><h2 style={{ marginTop: 0 }}>{others.length ? "Compare again" : "Pick websites to compare with"}</h2><CompareForm /></section>

      {table.length && read.length ? (
        <section className="card stack" aria-labelledby="cmp-table">
          <h2 id="cmp-table" style={{ margin: 0 }}>What each homepage shows</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th scope="col">Homepage</th><th scope="col">Yours</th>{read.map((r) => <th scope="col" key={r.host}>{r.host}</th>)}</tr></thead>
              <tbody>
                {SIGNAL_KEYS.map((k) => (
                  <tr key={k}>
                    <th scope="row">{SIGNAL_LABEL[k].shows[0]!.toUpperCase() + SIGNAL_LABEL[k].shows.slice(1)}</th>
                    <td>{own?.[k] ? "Yes" : "No"}</td>
                    {read.map((r) => <td key={r.host}>{r.signals[k] ? "Yes" : "No"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Observed on each public homepage. &ldquo;Yes&rdquo; means the page shows or mentions it; it doesn&apos;t mean the claim is true.</p>
          {table.some((r) => r.gap) ? (
            <>
              <p>{table.filter((r) => r.gap).length} thing{table.filter((r) => r.gap).length === 1 ? "" : "s"} they show that you don&apos;t.</p>
              <div><Link className="btn" href="/app/campaigns">Turn this into tasks</Link></div>
            </>
          ) : <p>You show everything the compared sites show. <Link className="link" href="/app/campaigns">See your campaigns</Link></p>}
        </section>
      ) : null}

      {others.length ? (
        <section className="card stack" aria-labelledby="cmp-sites">
          <h2 id="cmp-sites" style={{ margin: 0 }}>Websites</h2>
          <ul className="stack" style={{ listStyle: "none", paddingLeft: 0 }}>
            {others.map((s) => (
              <li key={s.id} className="row between">
                <span>{s.host} {s.status === "failed" ? <span className="small muted">· couldn&apos;t be read{s.failure ? `: ${s.failure}` : ""}</span> : <span className="small muted">· read {new Date(s.scanned_at).toLocaleDateString()}</span>}</span>
                <form action={removeComparison}><input type="hidden" name="id" value={s.id} /><button className="btn outline" type="submit" aria-label={`Remove ${s.host}`}>Remove</button></form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
