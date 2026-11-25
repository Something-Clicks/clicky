import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { releaseAllowed } from "@/config/features";
import { formatWhen } from "@/lib/activity";
import { reviewQuality, DIMENSIONS, type Dimension, type ReviewFact, type ReviewFinding, type ReviewPlan } from "@/lib/agent-quality";
import { requirePlatformAdmin } from "@/lib/auth";
import { log } from "@/lib/log";
import { formatMicro } from "@/lib/server/agent/pricing";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Agent review" };
export const dynamic = "force-dynamic";

interface Row {
  id: string; organization: string; website: string | null; kind: string; status: string; started_at: string; completed_at: string | null;
  provider: string | null; model: string | null; usage: { input_tokens?: number; output_tokens?: number } | null;
  steps: { step: string; status: string; detail: string }[] | null; evidence_classes: Record<string, number> | null; error: string | null;
  facts: ReviewFact[]; findings: ReviewFinding[]; plan: ReviewPlan | null;
}
interface Spend { organization: string; calls: number; input_tokens: number; output_tokens: number; cost_micro: number; failed_calls: number }

const LABEL: Record<Dimension, string> = {
  factual_accuracy: "Supported by evidence", evidence: "Has evidence", business_relevance: "Fits this business",
  marketing_usefulness: "Useful", actionability: "Actionable",
};
const tone = (n: number | null) => (n === null ? "pill" : n >= 80 ? "pill green" : n >= 50 ? "pill yellow" : "pill coral");

/**
 * Agent review (platform admins, development and Preview only): recent Marketing Agent runs with everything the
 * agent produced beside the evidence it cites, plus automatic quality screening and model spend. The screening
 * is an aid for the person reviewing, not a verdict (see src/lib/agent-quality.ts). This shows customer content,
 * so it is not available in Production and every view is logged by the database.
 */
export default async function AgentReviewPage() {
  if (!releaseAllowed()) notFound();
  const user = await requirePlatformAdmin();
  const supabase = await createClient();
  const [{ data, error }, { data: spendData }] = await Promise.all([supabase.rpc("admin_agent_review", { p_limit: 20 }), supabase.rpc("admin_model_usage", { p_days: 7 })]);
  if (error) log.error("admin.agent_review_failed", { userId: user.id, error: error.message });
  const rows = (data ?? []) as unknown as Row[];
  const spend = (spendData ?? []) as unknown as Spend[];

  return (
    <>
      <div className="eyebrow">Platform admin · development and Preview only</div>
      <h1 className="h1">Agent review</h1>
      <p className="sub">
        What the Marketing Agent produced, beside its evidence. The scores are automatic screening (evidence present, claims supported, specific, actionable); they cannot tell you whether a quote was understood or the advice is right. Read the items.
      </p>

      {error ? (
        <p className="notice error" role="alert">
          {(error as { hint?: string }).hint === "disabled"
            ? "Agent review is switched off on this database. It is for development and Preview databases only."
            : "The review could not be loaded. Check the server logs for admin.agent_review_failed."}
        </p>
      ) : null}

      <section className="card" aria-labelledby="spend">
        <h2 id="spend" style={{ marginTop: 0 }}>Model spend, last 7 days</h2>
        {spend.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Business</th><th>Calls</th><th>Failed</th><th>Tokens in / out</th><th>Cost</th></tr></thead>
              <tbody>
                {spend.map((s) => (
                  <tr key={s.organization}>
                    <td>{s.organization}</td><td>{s.calls}</td><td>{s.failed_calls}</td>
                    <td>{s.input_tokens} / {s.output_tokens}</td><td>{formatMicro(s.cost_micro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No model calls recorded yet.</p>}
      </section>

      {rows.length === 0 && !error ? <p className="muted">No agent runs yet.</p> : null}

      {rows.map((r) => {
        const q = reviewQuality({ businessName: r.organization, facts: r.facts, findings: r.findings, plan: r.plan });
        const problems = q.flags.filter((f) => f.severity === "problem").length;
        return (
          <section className="card stack" key={r.id} aria-label={`Run for ${r.organization}`}>
            <div className="row between">
              <div>
                <h2 style={{ margin: 0 }}>{r.organization}</h2>
                <div className="small muted">{r.website ?? "no website"} · {r.kind} · {formatWhen(r.started_at)}</div>
              </div>
              <span className={r.status === "prepared" ? "pill green" : r.status === "failed" ? "pill coral" : "pill yellow"}>{r.status}</span>
            </div>
            <div className="small muted">
              {r.provider ? `${r.provider} · ${r.model ?? ""} · ${r.usage?.input_tokens ?? 0} in / ${r.usage?.output_tokens ?? 0} out` : "No model used in this run"}
              {r.error ? ` · ${r.error}` : ""}
            </div>

            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {DIMENSIONS.map((d) => (
                <span key={d} className={tone(q.scores[d])}>{LABEL[d]}: {q.scores[d] ?? "nothing to judge"}</span>
              ))}
              <span className={problems ? "pill coral" : "pill green"}>{problems} problem{problems === 1 ? "" : "s"} · {q.flags.length - problems} warning{q.flags.length - problems === 1 ? "" : "s"}</span>
            </div>

            {q.flags.length ? (
              <details open={problems > 0}>
                <summary>Flags ({q.flags.length})</summary>
                <ul>
                  {q.flags.map((f, i) => (
                    <li key={i}><b>{f.severity === "problem" ? "Problem" : "Warning"}</b> · {f.area} · {f.kind.replace(/_/g, " ")}: {f.item} <span className="muted">({f.message})</span></li>
                  ))}
                </ul>
              </details>
            ) : null}

            <details>
              <summary>Business details the agent proposed ({r.facts.length})</summary>
              <ul>
                {r.facts.map((f, i) => (
                  <li key={i}>
                    <b>{f.field}</b> [{f.evidence_class}, {f.status}]: {f.value ?? <i>unknown</i>}
                    {f.basis ? <div className="small muted">Basis: {f.basis}</div> : null}
                    {(f.evidence ?? []).map((e, j) => e.excerpt ? <div key={j} className="evidence">“{e.excerpt}”</div> : null)}
                  </li>
                ))}
              </ul>
            </details>

            <details>
              <summary>Findings ({r.findings.length})</summary>
              <ul>
                {r.findings.map((f, i) => (
                  <li key={i}>
                    <b>{f.title}</b> [{f.origin}, {f.evidence_class ?? "n/a"}, {f.impact} impact, {f.confidence} confidence]
                    <div>{f.explanation}</div>
                    <div className="small muted">Why it matters: {f.why_it_matters}</div>
                    <div className="small muted">To do: {f.recommended_action}</div>
                    {f.evidence_basis ? <div className="small muted">Basis: {f.evidence_basis}</div> : null}
                    {(f.evidence ?? []).map((e, j) => e ? <div key={j} className="evidence">“{e}”</div> : null)}
                  </li>
                ))}
              </ul>
            </details>

            {r.plan ? (
              <details>
                <summary>Plan ({r.plan.priorities?.length ?? 0} priorities)</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{JSON.stringify(r.plan, null, 2)}</pre>
              </details>
            ) : null}

            {r.steps?.length ? (
              <details>
                <summary>Steps</summary>
                <ul>{r.steps.map((s, i) => <li key={i}>{s.step} · {s.status}: {s.detail}</li>)}</ul>
              </details>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
