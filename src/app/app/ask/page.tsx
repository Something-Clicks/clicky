import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AskForm } from "@/components/agent-work";
import { FEATURES } from "@/config/features";
import { formatWhen } from "@/lib/activity";
import { requireOrganization } from "@/lib/auth";
import { REQUEST_CHOICES } from "@/lib/server/agent/intake";
import { isWorkflowKind } from "@/lib/server/agent/workflows";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ask" };
export const maxDuration = 120;

const STATUS: Record<string, string> = { running: "Working", prepared: "Ready", blocked: "Can't do this yet", failed: "Didn't finish" };
const WHERE: Record<string, string> = {
  website_review: "/app/analysis", homepage_headline: "/app/actions", competitor_research: "/app/research",
  marketing_plan: "/app/plan", promotional_campaign: "/app/campaigns", results_review: "/app/results",
};

/** Ask: one place to ask for marketing help. Recent requests show what was done, step by step, and why anything stopped. */
export default async function AskPage() {
  if (!FEATURES.agent) notFound();
  const ws = await requireOrganization();
  const supabase = await createClient();
  const { data } = await supabase
    .from("marketing_workflows")
    .select("id, kind, status, request, steps, error, started_at")
    .eq("organization_id", ws.organization.id)
    .order("started_at", { ascending: false })
    .limit(8);
  const recent = data ?? [];
  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Your marketing</div>
        <h1 className="h1">Ask</h1>
        <p className="sub">Say what you need. We work from what we know about {ws.business?.businessName ?? "your business"} and what we found on your website.</p>
      </div>
      <section className="card"><AskForm examples={["Improve my homepage headline", "What should I work on first?", "Compare me with rival-plumbing.com", "How are my results?"]} /></section>
      {recent.length ? (
        <section className="card stack" aria-labelledby="recent">
          <h2 id="recent" style={{ margin: 0 }}>Recent work</h2>
          <ul className="stack" style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
            {recent.map((w) => {
              const steps = (Array.isArray(w.steps) ? w.steps : []) as { step: string; status: string; detail: string }[];
              const kind = isWorkflowKind(w.kind) ? w.kind : null;
              return (
                <li key={w.id}>
                  <details>
                    <summary className="row between" style={{ cursor: "pointer" }}>
                      <span>{w.request ? `“${w.request.slice(0, 80)}”` : kind ? REQUEST_CHOICES[kind] : "Earlier request"}</span>
                      <span className="small muted">{STATUS[w.status] ?? w.status} · {formatWhen(w.started_at)}</span>
                    </summary>
                    <ol className="small" style={{ marginTop: 8 }}>
                      {steps.map((s, i) => <li key={i}><strong>{s.status === "done" ? "Done" : s.status === "waiting" ? "Waiting for you" : s.status === "blocked" ? "Not available" : s.status === "failed" ? "Didn't work" : "Skipped"}:</strong> {s.detail}</li>)}
                    </ol>
                    {w.error ? <p className="small muted">{w.error}</p> : null}
                    {kind && w.status === "prepared" ? <Link className="link small" href={WHERE[kind]!}>Open</Link> : null}
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
