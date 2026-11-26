import Link from "next/link";

import { authorizeExecution, cancelExecution, requestExecution } from "@/app/actions/agent";
import { formatWhen } from "@/lib/activity";
import { EXECUTIONS, executionOptions, executionStatusLabel, isExecutionAction } from "@/lib/server/agent/modules/marketing-execution";
import { createClient } from "@/lib/supabase/server";

const EFFORT: Record<string, string> = { small: "Small: under an hour", medium: "Medium: a few hours", large: "Large: a day or more" };

/**
 * Effort, what to do first, and execution for one Action Card (§10, §13.1). Requesting, authorizing (owner only),
 * carrying out and verifying are separate, recorded events. Only what the application itself can do is offered.
 */
export async function ExecutionPanel({ card, isOwner }: { card: { id: string; status: string; effort: string | null; depends_on: string[] }; isOwner: boolean }) {
  const supabase = await createClient();
  const [{ data: records }, { data: approved }, { data: deps }] = await Promise.all([
    supabase.from("execution_records").select("id, action, status, integration, result, error, verification, requested_at, authorized_at, executed_at, verified_at, draft_version_id")
      .eq("card_id", card.id).order("requested_at", { ascending: false }).limit(10),
    supabase.from("approvals").select("id").eq("action_card_id", card.id).eq("decision", "approved").not("approved_version_id", "is", null).limit(1),
    card.depends_on.length ? supabase.from("action_cards").select("id, title, stage").in("id", card.depends_on) : Promise.resolve({ data: [] as { id: string; title: string; stage: string }[] }),
  ]);
  const rows = records ?? [];
  const openActions = rows.filter((r) => r.status === "requested" || r.status === "authorized").map((r) => r.action).filter(isExecutionAction);
  const options = executionOptions({ open: !["done", "dismissed"].includes(card.status), hasApprovedDraft: Boolean(approved?.length), openActions });
  const blocking = (deps ?? []).filter((d) => d.stage !== "completed" && d.stage !== "dismissed");

  return (
    <section className="card stack" aria-labelledby="carry-out">
      <h2 id="carry-out" style={{ margin: 0 }}>Getting it done</h2>
      {card.effort ? <p style={{ margin: 0 }}><strong>Effort:</strong> {EFFORT[card.effort] ?? card.effort}</p> : null}
      {blocking.length ? (
        <p style={{ margin: 0 }}><strong>Do first:</strong> {blocking.map((d, i) => <span key={d.id}>{i ? ", " : ""}<Link className="link" href={`/app/actions/${d.id}`}>{d.title}</Link></span>)}</p>
      ) : null}
      <ul className="stack" style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
        {options.filter((o) => EXECUTIONS[o.action].supported).map((o) => (
          <li key={o.action} className="row between" style={{ gap: 12, flexWrap: "wrap" }}>
            <span><strong>{o.label}.</strong> <span className="small muted">{o.reason}</span></span>
            {o.available ? (
              <form action={requestExecution}>
                <input type="hidden" name="card" value={card.id} />
                <input type="hidden" name="action" value={o.action} />
                {/* Same rendered form, same key: a double submit is one request. A new key once the record list changes. */}
                <input type="hidden" name="key" value={`${card.id}:${o.action}:${rows.length}`} />
                <button className="btn outline" type="submit">{isOwner ? "Ask for this" : "Ask the owner"}</button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="small muted" style={{ margin: 0 }}>We never publish to your website, send emails or spend money for you. Nothing here happens until the account owner says yes.</p>
      {rows.length ? (
        <>
          <h3 style={{ marginBottom: 0 }}>Record</h3>
          <ul className="stack" style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
            {rows.map((r) => (
              <li key={r.id} className="stack" style={{ gap: 4 }}>
                <div className="row between" style={{ gap: 12, flexWrap: "wrap" }}>
                  <span><strong>{isExecutionAction(r.action) ? EXECUTIONS[r.action].label : r.action}</strong> · {executionStatusLabel(r)}</span>
                  {r.status === "requested" ? (
                    <span className="row" style={{ gap: 8 }}>
                      {isOwner ? (
                        <form action={authorizeExecution}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="card" value={card.id} /><button className="btn" type="submit">Yes, do it</button></form>
                      ) : null}
                      <form action={cancelExecution}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="card" value={card.id} /><button className="btn outline" type="submit">Cancel</button></form>
                    </span>
                  ) : null}
                </div>
                <span className="small muted">
                  Asked {formatWhen(r.requested_at)}
                  {r.authorized_at ? ` · approved ${formatWhen(r.authorized_at)}` : ""}
                  {r.executed_at ? ` · carried out ${formatWhen(r.executed_at)}` : ""}
                  {r.verified_at ? ` · checked ${formatWhen(r.verified_at)}` : ""}
                  {r.result ? ` · ${r.result}` : ""}{r.error ? ` · ${r.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
