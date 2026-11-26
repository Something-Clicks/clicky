import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { decideCampaign, editTaskDraft, markTask } from "@/app/actions/campaigns";
import { CopyButton } from "@/app/app/actions/[id]/copy-button";
import { FEATURES } from "@/config/features";
import { requireOrganization } from "@/lib/auth";
import { CHANNEL_LABEL, campaignResults, type Channel } from "@/lib/campaigns";
import { WriteDraftsForm } from "@/components/agent-forms";
import { getModelProvider } from "@/lib/server/agent/provider";
import { EvidenceLine } from "@/components/intelligence";
import { EVIDENCE_CLASS_LABEL, isEvidenceClass } from "@/lib/evidence";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Campaign" };
export const maxDuration = 300;

/** One campaign: the owner approves it, edits the template drafts, does each task and marks it done. */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  if (!FEATURES.campaigns) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ws = await requireOrganization();
  const supabase = await createClient();
  const { data: c } = await supabase.from("marketing_campaigns").select("id, title, goal, summary, status, brief").eq("id", id).eq("organization_id", ws.organization.id).maybeSingle();
  if (!c || c.status === "dismissed") notFound();
  const { data: tasks } = await supabase
    .from("campaign_tasks")
    .select("id, position, kind, title, why, steps, deliverable, deliverable_edited, deliverable_model, deliverable_model_at, card_id, evidence_class, basis, status, note, channel, due_in_days, depends_on")
    .eq("campaign_id", id).order("position");
  const list = tasks ?? [];
  const cardIds = list.flatMap((t) => (t.card_id ? [t.card_id] : []));
  const { data: cards } = cardIds.length ? await supabase.from("action_cards").select("id, verification, status").in("id", cardIds) : { data: [] as { id: string; verification: string | null; status: string }[] };
  const { data: ev } = cardIds.length
    ? await supabase.from("action_card_evidence").select("action_card_id, analysis_evidence ( id, kind, source, url, observation, excerpt )").in("action_card_id", cardIds)
    : { data: [] as { action_card_id: string; analysis_evidence: { id: string; kind: string; source: string; url: string | null; observation: string; excerpt: string | null } | null }[] };
  const results = campaignResults(list, new Map((cards ?? []).map((x) => [x.id, x])));
  const isOwner = ws.organization.role === "owner";
  const approved = c.status === "approved" || c.status === "completed";
  const brief = (c.brief ?? null) as { objective: string; audience: string | null; offer: string | null; core_message: string; channels: Channel[]; measurement: string[] } | null;
  const byPos = new Map(list.map((t) => [t.position, t]));
  const writable = list.some((t) => t.channel && t.status !== "done" && t.status !== "skipped");
  const canWrite = FEATURES.drafts && getModelProvider() !== null && writable;

  return (
    <div className="stack">
      <div>
        <p className="small"><Link className="link" href="/app/campaigns">← Campaigns</Link></p>
        <div className="eyebrow">Campaign</div>
        <h1 className="h1">{c.title}</h1>
        <p className="sub">{c.goal}</p>
      </div>

      {brief ? (
        <section className="card stack" aria-labelledby="camp-brief">
          <h2 id="camp-brief" style={{ margin: 0 }}>The plan</h2>
          <ul style={{ margin: 0 }}>
            <li><strong>Aim:</strong> {brief.objective}</li>
            <li><strong>Who it&apos;s for:</strong> {brief.audience ?? <span className="muted">not confirmed yet; add your customers in Business details</span>}</li>
            <li><strong>Offer:</strong> {brief.offer ?? <span className="muted">none set; add one only if you mean it</span>}</li>
            <li><strong>Message:</strong> {brief.core_message}</li>
            <li><strong>Where:</strong> {brief.channels.map((ch) => CHANNEL_LABEL[ch] ?? ch).join(", ")}</li>
            <li><strong>How we&apos;ll know:</strong> your own numbers before and after, in Results</li>
          </ul>
          {canWrite ? <WriteDraftsForm campaign={c.id} again={list.some((t) => t.deliverable_model)} /> : null}
        </section>
      ) : null}

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
          <p>{results.done} of {results.total} {results.total === 1 ? "task" : "tasks"} done{results.skipped ? `, ${results.skipped} skipped` : ""}.</p>
          {results.open > 0 ? <p className="small">Next: {list.find((t) => t.status === "approved")?.title ?? "finish the remaining tasks"}.</p> : <p className="small">All done. Check your website again to see what changed.</p>}
          {results.fixesLinked ? <p className="small muted">Website fixes: {results.verifiedFixed} confirmed fixed by a website check, {results.stillFound} still found, {results.awaitingCheck} waiting for the next check.</p> : null}
        </section>
      )}

      <ol className="stack" style={{ paddingLeft: 0, listStyle: "none" }}>
        {list.map((t) => {
          const draft = t.deliverable_edited ?? t.deliverable;
          const steps = Array.isArray(t.steps) ? (t.steps as string[]) : [];
          const closed = t.status === "done" || t.status === "skipped";
          const waitingOn = (t.depends_on ?? []).map((p) => byPos.get(p)).filter((d): d is NonNullable<typeof d> => Boolean(d) && d!.status !== "done" && d!.status !== "skipped");
          return (
            <li key={t.id} className="card stack">
              <div className="row between">
                <h2 style={{ margin: 0 }}>{t.position}. {t.title}</h2>
                {closed ? <span className="pill green">{t.status === "done" ? "Done" : "Skipped"}</span> : t.status === "approved" ? <span className="pill">Ready to do</span> : <span className="pill yellow">Not approved yet</span>}
              </div>
              <p>{t.why}</p>
              {t.channel || t.due_in_days !== null || waitingOn.length ? (
                <p className="small">
                  {t.channel ? <>{CHANNEL_LABEL[t.channel as Channel] ?? t.channel}. </> : null}
                  {t.due_in_days !== null ? <>Start: {t.due_in_days === 0 ? "right away" : `about ${t.due_in_days} days after approval`}. </> : null}
                  {waitingOn.length ? <strong>Do first: {waitingOn.map((d) => d.title).join(", ")}.</strong> : null}
                </p>
              ) : null}
              <p className="small muted">{isEvidenceClass(t.evidence_class) ? EVIDENCE_CLASS_LABEL[t.evidence_class] : t.evidence_class}{t.basis ? ` · ${t.basis}` : ""}</p>
              {steps.length ? <ol>{steps.map((s) => <li key={s}>{s}</li>)}</ol> : null}
              {t.card_id ? (
                <div className="stack">
                  {(ev ?? []).filter((x) => x.action_card_id === t.card_id && x.analysis_evidence).slice(0, 2).map((x) => <EvidenceLine key={x.analysis_evidence!.id} e={x.analysis_evidence!} />)}
                  <p className="small"><Link className="link" href={`/app/actions/${t.card_id}`}>Open the full recommendation</Link></p>
                </div>
              ) : null}
              {draft ? (
                <form action={editTaskDraft} className="stack" data-clarity-mask="true">
                  <input type="hidden" name="task" value={t.id} /><input type="hidden" name="campaign" value={c.id} />
                  <label className="field" htmlFor={`d-${t.id}`}><span>Draft (a fixed template, edit it so it sounds like you){t.deliverable_edited ? " · edited" : ""}</span>
                    <textarea id={`d-${t.id}`} name="text" className="input" rows={5} maxLength={4000} defaultValue={draft} /></label>
                  <div className="row"><button className="btn outline" type="submit">Save my edits</button><CopyButton text={draft} label="Copy" /></div>
                </form>
              ) : null}
              {t.deliverable_model && !closed ? (
                <form action={editTaskDraft} className="stack" data-clarity-mask="true">
                  <input type="hidden" name="task" value={t.id} /><input type="hidden" name="campaign" value={c.id} />
                  <label className="field" htmlFor={`m-${t.id}`}><span>Written for you from your business details. Check every word and fill in the [blanks]</span>
                    <textarea id={`m-${t.id}`} name="text" className="input" rows={7} maxLength={4000} defaultValue={t.deliverable_model} /></label>
                  <div className="row"><button className="btn outline" type="submit">Use this version</button><CopyButton text={t.deliverable_model} label="Copy" /></div>
                </form>
              ) : null}
              {approved && !closed && !waitingOn.length ? (
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
