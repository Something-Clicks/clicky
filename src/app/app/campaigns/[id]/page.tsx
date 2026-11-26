import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { decideCampaign, editTaskDraft, markTask } from "@/app/actions/campaigns";
import { CopyButton } from "@/app/app/actions/[id]/copy-button";
import { FEATURES } from "@/config/features";
import { requireOrganization } from "@/lib/auth";
import { campaignResults } from "@/lib/campaigns";
import { EVIDENCE_CLASS_LABEL, isEvidenceClass } from "@/lib/evidence";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Campaign" };

/** One campaign: the owner approves it, edits the template drafts, does each task and marks it done. */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  if (!FEATURES.campaigns) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ws = await requireOrganization();
  const supabase = await createClient();
  const { data: c } = await supabase.from("marketing_campaigns").select("id, title, goal, summary, status").eq("id", id).eq("organization_id", ws.organization.id).maybeSingle();
  if (!c || c.status === "dismissed") notFound();
  const { data: tasks } = await supabase
    .from("campaign_tasks")
    .select("id, position, kind, title, why, steps, deliverable, deliverable_edited, card_id, evidence_class, basis, status, note")
    .eq("campaign_id", id).order("position");
  const list = tasks ?? [];
  const cardIds = list.flatMap((t) => (t.card_id ? [t.card_id] : []));
  const { data: cards } = cardIds.length ? await supabase.from("action_cards").select("id, verification").in("id", cardIds) : { data: [] as { id: string; verification: string | null }[] };
  const results = campaignResults(list, new Map((cards ?? []).map((x) => [x.id, x])));
  const isOwner = ws.organization.role === "owner";
  const approved = c.status === "approved" || c.status === "completed";

  return (
    <div className="stack">
      <div>
        <p className="small"><Link className="link" href="/app/campaigns">← Campaigns</Link></p>
        <h1 className="h1">{c.title}</h1>
        <p className="sub">{c.goal}</p>
      </div>

      {c.status === "proposed" ? (
        <section className="card stack" aria-labelledby="camp-decide">
          <h2 id="camp-decide" style={{ margin: 0 }}>Your decision</h2>
          <p>{c.summary}</p>
          {isOwner ? (
            <div className="row">
              <form action={decideCampaign}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="decision" value="approved" /><button className="btn" type="submit">Approve this campaign</button></form>
              <form action={decideCampaign}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="decision" value="dismissed" /><button className="btn outline" type="submit">Not for us</button></form>
            </div>
          ) : <p className="small muted">Only the account owner can approve a campaign.</p>}
          <p className="small muted">Approving means you agree with the tasks. Nothing is published or sent for you.</p>
        </section>
      ) : (
        <section className="card stack" aria-labelledby="camp-results">
          <h2 id="camp-results" style={{ margin: 0 }}>How it&apos;s going</h2>
          <p>{results.done} of {results.total} tasks done{results.skipped ? `, ${results.skipped} skipped` : ""}.</p>
          {results.fixesLinked ? <p className="small muted">Website fixes: {results.verifiedFixed} confirmed fixed by a website check, {results.stillFound} still found, {results.awaitingCheck} waiting for the next check.</p> : null}
        </section>
      )}

      <ol className="stack" style={{ paddingLeft: 0, listStyle: "none" }}>
        {list.map((t) => {
          const draft = t.deliverable_edited ?? t.deliverable;
          const steps = Array.isArray(t.steps) ? (t.steps as string[]) : [];
          const closed = t.status === "done" || t.status === "skipped";
          return (
            <li key={t.id} className="card stack">
              <div className="row between">
                <h2 style={{ margin: 0 }}>{t.position}. {t.title}</h2>
                {closed ? <span className="pill green">{t.status === "done" ? "Done" : "Skipped"}</span> : t.status === "approved" ? <span className="pill">To do</span> : <span className="pill yellow">Not approved yet</span>}
              </div>
              <p>{t.why}</p>
              <p className="small muted">{isEvidenceClass(t.evidence_class) ? EVIDENCE_CLASS_LABEL[t.evidence_class] : t.evidence_class}{t.basis ? ` · ${t.basis}` : ""}</p>
              {steps.length ? <ol>{steps.map((s) => <li key={s}>{s}</li>)}</ol> : null}
              {t.card_id ? <p className="small"><Link className="link" href={`/app/actions/${t.card_id}`}>See the evidence for this fix</Link></p> : null}
              {draft ? (
                <form action={editTaskDraft} className="stack" data-clarity-mask="true">
                  <input type="hidden" name="task" value={t.id} /><input type="hidden" name="campaign" value={c.id} />
                  <label className="field" htmlFor={`d-${t.id}`}><span>Draft (a fixed template, edit it so it sounds like you){t.deliverable_edited ? " · edited" : ""}</span>
                    <textarea id={`d-${t.id}`} name="text" className="input" rows={5} maxLength={4000} defaultValue={draft} /></label>
                  <div className="row"><button className="btn outline" type="submit">Save my edits</button><CopyButton text={draft} label="Copy" /></div>
                </form>
              ) : null}
              {approved && !closed ? (
                <form action={markTask} className="row">
                  <input type="hidden" name="task" value={t.id} /><input type="hidden" name="campaign" value={c.id} />
                  <button className="btn" type="submit" name="status" value="done">I did this</button>
                  <button className="btn outline" type="submit" name="status" value="skipped">Skip</button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
