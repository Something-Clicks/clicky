import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { decidePlan } from "@/app/actions/plan";
import { FEATURES } from "@/config/features";
import { PlanForm } from "@/components/plan-form";
import { requireOrganization } from "@/lib/auth";
import { FACT_LABEL, type FactField } from "@/lib/business-profile";
import type { StoredPlan } from "@/lib/server/agent/modules/marketing-strategy";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your plan" };
export const maxDuration = 120;

const EFFORT: Record<string, string> = { small: "Under an hour", medium: "A few hours", large: "Several days" };
const label = (name: string) => FACT_LABEL[name as FactField] ?? name;

/**
 * Your plan: the Marketing Agent's proposed plan (Marketing Strategy), for the owner to review, revise,
 * approve or reject. Behind FEATURES.strategy (off in Production). Approving a plan means the owner agrees
 * with it; it does not mean any work is done or published.
 */
export default async function PlanPage() {
  if (!FEATURES.strategy) notFound();
  const ws = await requireOrganization();
  const isOwner = ws.organization.role === "owner";
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("marketing_plans")
    .select("id, status, plan, created_at, decided_at")
    .eq("organization_id", ws.organization.id)
    .in("status", ["proposed", "approved"])
    .order("created_at", { ascending: false })
    .limit(2);
  const current = rows?.find((r) => r.status === "proposed") ?? rows?.[0] ?? null;
  const raw = (current?.plan ?? null) as unknown as Partial<StoredPlan> | null;
  // The database checks the shape of every saved plan; read defensively anyway so one bad row can never break the page.
  const plan: StoredPlan | null = raw && typeof raw.summary === "string" && Array.isArray(raw.priorities)
    ? {
        summary: raw.summary,
        objectives: Array.isArray(raw.objectives) ? raw.objectives.map((o) => ({ ...o, based_on: Array.isArray(o.based_on) ? o.based_on : [] })) : [],
        priorities: raw.priorities.map((p) => ({ ...p, based_on: Array.isArray(p.based_on) ? p.based_on : [], depends_on: Array.isArray(p.depends_on) ? p.depends_on : [] })),
        next_steps: Array.isArray(raw.next_steps) ? raw.next_steps : [],
        questions: Array.isArray(raw.questions) ? raw.questions : [],
        not_now: Array.isArray(raw.not_now) ? raw.not_now : [],
      }
    : null;

  const ids = plan ? [...plan.priorities.map((p) => p.card_id), ...plan.not_now.map((n) => n.card_id)] : [];
  const { data: cards } = ids.length
    ? await supabase.from("action_cards").select("id, title, status").eq("organization_id", ws.organization.id).in("id", ids)
    : { data: [] as { id: string; title: string; status: string }[] };
  const card = new Map((cards ?? []).map((c) => [c.id, c]));

  return (
    <div className="stack">
      <div>
        <h1 className="h1">Your plan</h1>
        <p className="sub">What to do first for {ws.business?.businessName || "your business"}, and why. Nothing happens until you approve it.</p>
      </div>

      {!plan || !current ? (
        <section className="card stack">
          <h2 style={{ marginTop: 0 }}>No plan yet</h2>
          <p className="muted">We&apos;ll use what we know about your business and what we found on your website to suggest what to do first.</p>
          <PlanForm revising={false} />
        </section>
      ) : (
        <>
          <section className="card stack" aria-labelledby="plan-summary">
            <div className="row between">
              <h2 id="plan-summary" style={{ margin: 0 }}>The plan</h2>
              {current.status === "approved" ? <span className="pill green">Approved</span> : <span className="pill yellow">Waiting for your review</span>}
            </div>
            <p>{plan.summary}</p>
            {plan.objectives.length ? (
              <div>
                <div className="small muted">What we&apos;re aiming for</div>
                <ul>
                  {plan.objectives.map((o) => (
                    <li key={o.objective}>
                      {o.objective}
                      {o.based_on.length ? <span className="small muted"> · based on {o.based_on.map(label).join(", ").toLowerCase()}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="card stack" aria-labelledby="plan-priorities">
            <h2 id="plan-priorities" style={{ margin: 0 }}>In this order</h2>
            <ol className="stack" style={{ paddingLeft: 20 }}>
              {plan.priorities.map((p) => {
                const c = card.get(p.card_id);
                return (
                  <li key={p.card_id}>
                    {c ? <Link className="link" href={`/app/actions/${c.id}`}><b>{c.title}</b></Link> : <b>This action is no longer open</b>}
                    <div>{p.why_now}</div>
                    <div className="small muted">
                      {EFFORT[p.effort] ?? p.effort}
                      {p.depends_on.length ? ` · after ${p.depends_on.map((d) => card.get(d)?.title ?? "an earlier step").join(", ")}` : ""}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {plan.next_steps.length ? (
            <section className="card stack" aria-labelledby="plan-next">
              <h2 id="plan-next" style={{ margin: 0 }}>This week</h2>
              <ul>{plan.next_steps.map((s) => <li key={s}>{s}</li>)}</ul>
            </section>
          ) : null}

          {plan.questions.length ? (
            <section className="card stack" aria-labelledby="plan-questions">
              <h2 id="plan-questions" style={{ margin: 0 }}>Help us make it better</h2>
              <ul>{plan.questions.map((s) => <li key={s}>{s}</li>)}</ul>
              <p className="small muted">Answer by revising the plan below, or add details on the Business details page.</p>
            </section>
          ) : null}

          {plan.not_now.length ? (
            <section className="card stack" aria-labelledby="plan-later">
              <h2 id="plan-later" style={{ margin: 0 }}>Later</h2>
              <ul>
                {plan.not_now.map((n) => (
                  <li key={n.card_id}>
                    <b>{card.get(n.card_id)?.title ?? "An action"}</b>: {n.reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {current.status === "proposed" ? (
            isOwner ? (
              <section className="card stack" aria-labelledby="plan-decide">
                <h2 id="plan-decide" style={{ margin: 0 }}>Your decision</h2>
                <div className="row">
                  <form action={decidePlan}>
                    <input type="hidden" name="id" value={current.id} />
                    <input type="hidden" name="decision" value="approved" />
                    <button className="btn" type="submit">Approve this plan</button>
                  </form>
                  <form action={decidePlan}>
                    <input type="hidden" name="id" value={current.id} />
                    <input type="hidden" name="decision" value="rejected" />
                    <button className="btn outline" type="submit">Not for us</button>
                  </form>
                </div>
              </section>
            ) : (
              <p className="small muted">Only the account owner can approve a plan.</p>
            )
          ) : null}

          <section className="card stack" aria-labelledby="plan-revise">
            <h2 id="plan-revise" style={{ margin: 0 }}>Want it different?</h2>
            <PlanForm revising />
          </section>
        </>
      )}
    </div>
  );
}
