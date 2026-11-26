import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { removeResearch } from "@/app/actions/agent";
import { ResearchImportForm } from "@/components/agent-work";
import { FEATURES } from "@/config/features";
import { requireOrganization } from "@/lib/auth";
import { RESEARCH_STALE_DAYS } from "@/lib/server/agent/context";
import { RESEARCH_SOURCES, isResearchSource, searchIntent } from "@/lib/research-import";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Research" };

const CLASS: Record<string, string> = { verified: "Measured", estimated: "Estimate", inferred: "Our reading", unknown: "Unknown" };
const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : "—");

/** Research Library: everything researched for this business, each item with its source and date. */
export default async function LibraryPage() {
  if (!FEATURES.agent) notFound();
  const ws = await requireOrganization();
  const supabase = await createClient();
  const orgId = ws.organization.id;
  const [{ data: items }, { data: scans }, { data: lastCheck }] = await Promise.all([
    supabase.from("research_items").select("id, term, source, metrics, previous_metrics, evidence_class, basis, measured_on").eq("organization_id", orgId).order("measured_on", { ascending: false }).limit(300),
    supabase.from("competitor_scans").select("host, status, is_self, scanned_at").eq("organization_id", orgId).order("scanned_at", { ascending: false }),
    supabase.from("analyses").select("completed_at").eq("organization_id", orgId).not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const keywords = items ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const staleBefore = new Date(Date.parse(`${today}T00:00:00Z`) - RESEARCH_STALE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const others = (scans ?? []).filter((s) => !s.is_self && s.status === "done");

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Market research</div>
        <h1 className="h1">Research</h1>
        <p className="sub">Everything we know from research, with where it came from and when. Older than 3 months is marked, and we don&apos;t treat it as current.</p>
      </div>

      <section className="card stack" aria-labelledby="sources">
        <h2 id="sources" style={{ margin: 0 }}>Sources</h2>
        <ul style={{ margin: 0 }}>
          <li>Your website: {lastCheck?.completed_at ? <>last checked {new Date(lastCheck.completed_at).toLocaleDateString()}. <Link className="link" href="/app/analysis">See the check</Link></> : "not checked yet."}</li>
          <li>Other websites compared: {others.length}{FEATURES.campaigns ? <> · <Link className="link" href="/app/research">Compare</Link></> : null}</li>
          <li>Keywords: {keywords.length}</li>
        </ul>
      </section>

      <section className="card stack" aria-labelledby="import">
        <h2 id="import" style={{ margin: 0 }}>Add keyword research</h2>
        <ResearchImportForm today={today} />
      </section>

      {keywords.length ? (
        <section className="card stack" aria-labelledby="kw">
          <h2 id="kw" style={{ margin: 0 }}>Keywords</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th scope="col">Keyword</th><th scope="col">Searches</th><th scope="col">Position</th><th scope="col">Kind</th><th scope="col">Source</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {keywords.map((k) => {
                  const m = (k.metrics ?? {}) as Record<string, unknown>;
                  const prev = (k.previous_metrics ?? null) as Record<string, unknown> | null;
                  const intent = searchIntent(k.term, typeof m.intent === "string" ? m.intent : undefined);
                  return (
                    <tr key={k.id}>
                      <th scope="row">{k.term}</th>
                      <td>{num(m.volume ?? m.impressions)}</td>
                      <td>{num(m.position)}{prev && typeof prev.position === "number" && typeof m.position === "number" ? <div className="small muted">was {num(prev.position)}</div> : null}</td>
                      <td>{intent === "unknown" ? "—" : intent}{typeof m.intent === "string" ? null : intent !== "unknown" ? <div className="small muted">from the wording</div> : null}</td>
                      <td>{isResearchSource(k.source) ? RESEARCH_SOURCES[k.source] : k.source}<div className="small muted">{CLASS[k.evidence_class] ?? k.evidence_class} · {k.measured_on}{k.measured_on < staleBefore ? " · older than 3 months" : ""}</div></td>
                      <td><form action={removeResearch}><input type="hidden" name="id" value={k.id} /><button className="btn outline" type="submit" aria-label={`Remove ${k.term}`}>Remove</button></form></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted">“Searches” is Semrush&apos;s estimated monthly volume, or the impressions Search Console measured. We only show numbers your export contained.</p>
        </section>
      ) : null}
    </div>
  );
}
