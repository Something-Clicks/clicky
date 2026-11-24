import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { setCardStatus } from "@/app/actions/intelligence";
import { ApprovalActions } from "@/components/approval-actions";
import { DRAFT_LABEL, DraftPreview, DraftUseButtons, draftAsText, draftFields } from "@/components/draft";
import { EvidenceLine, StatusPill, VerificationPill } from "@/components/intelligence";
import { PrepareDraftForm } from "@/components/prepare-draft";
import { AutoRefresh } from "@/components/run-analysis";
import { FEATURES } from "@/config/features";
import { requireOrganization } from "@/lib/auth";
import { getCard, getEntitlements, getFreeUses, getSpeedComparison } from "@/lib/queries";
import Link from "next/link";
import { formatWhen } from "@/lib/activity";
import { isAiConfigured } from "@/lib/server/ai";
import { SUPPORTED_DRAFTS } from "@/lib/server/drafts";
import { createClient } from "@/lib/supabase/server";

import { CopyButton } from "./copy-button";

export const metadata: Metadata = { title: "To do" };
export const maxDuration = 120;

function StatusButton({ id, status, label, variant }: { id: string; status: string; label: string; variant?: string }) {
  return (
    <form data-clarity-mask="true" action={setCardStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={variant ? `btn ${variant}` : "btn"} type="submit">
        {label}
      </button>
    </form>
  );
}

export default async function ActionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireOrganization();
  const { id } = await params;
  const card = await getCard(ws.organization.id, id);
  if (!card) notFound();
  const evidence = card.action_card_evidence.map((x) => x.analysis_evidence).filter((e) => e !== null);
  const closed = card.status === "done" || card.status === "dismissed";
  const isOwner = ws.organization.role === "owner";
  // Drafts are switched off for customers (see src/config/features.ts); every item is a task to do on the site.
  const draftable = FEATURES.drafts && card.ai_capable && SUPPORTED_DRAFTS.includes(card.execution_type as never);

  const supabase = await createClient();
  const [{ data: run }, { data: approval }] = await Promise.all([
    supabase.from("agent_runs").select("id, status, error, output, started_at").eq("action_card_id", card.id)
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("approvals").select("id, decision, note, agent_runs ( output, draft_type )").eq("action_card_id", card.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const running = run?.status === "running";
  const [ent, free] = await Promise.all([getEntitlements(ws.organization.id), getFreeUses(ws.organization.id)]);
  const planAllowsDraft = ent.drafts === "all" || (ent.drafts === "meta" && card.execution_type === "meta");
  const canDraft = planAllowsDraft || free.remaining > 0;
  const speed = card.check_key === "pagespeed.performance" ? await getSpeedComparison(ws.organization.id, card.id) : null;
  const fields = draftFields(approval?.agent_runs?.output);
  const lastFailed = run?.status === "failed" ? run.error : null;

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className={card.impact_priority === "high" ? "pill coral" : card.impact_priority === "low" ? "pill green" : "pill yellow"}>
          {card.impact_priority === "high" ? "High" : card.impact_priority === "low" ? "Low" : "Medium"} impact
        </span>
      </div>
      <h1 className="h1">{card.title}</h1>
      <p className="sub">{card.explanation}</p>
      <div className="two">
        <div className="card">
          <h3>Why this matters</h3>
          <p className="muted">{card.why_it_matters}</p>
          <h3 style={{ marginTop: 22 }}>What to do</h3>
          <p className="muted">{card.recommended_action}</p>
          <h3 style={{ marginTop: 22 }}>What it should help with</h3>
          <p className="muted">{card.expected_benefit} This is an expected benefit, not a guaranteed result.</p>
          <h3 style={{ marginTop: 22 }}>Evidence</h3>
          {evidence.map((e) => (
            <EvidenceLine key={e.id} e={e} />
          ))}

        </div>
        <div className="card">
          <div className="row">
            <StatusPill status={card.status} />
            <VerificationPill verification={card.verification} />
            {FEATURES.drafts ? (card.approval_required ? <span className="pill yellow">Needs your approval</span> : <span className="pill">No approval needed</span>) : null}
          </div>
          {!draftable ? (
            <>
              <h3 style={{ marginTop: 12 }}>Do this on your website</h3>
              <p className="muted">Make this change yourself, or ask your web designer. Mark it done when it&apos;s fixed, then check your website again to see it confirmed.</p>
            </>
          ) : running ? (
            <>
              <AutoRefresh active />
              <h3 style={{ marginTop: 12 }}>Preparing your draft…</h3>
              <p className="muted" role="status">Writing a {DRAFT_LABEL[card.execution_type]?.toLowerCase()} from your business details and the evidence. This usually takes under a minute.</p>
            </>
          ) : approval?.decision === "pending" ? (
            <>
              <span className="pill yellow" style={{ marginTop: 12 }}>Waiting for approval</span>
              <h3 style={{ marginTop: 12 }}>Your draft</h3>
              <DraftPreview fields={fields} />
              {isOwner ? (
                <ApprovalActions approvalId={approval.id}>
                  <CopyButton text={draftAsText(fields)} label="Copy draft" />
                </ApprovalActions>
              ) : (
                <p className="small muted">Only the account owner can approve drafts.</p>
              )}
            </>
          ) : approval?.decision === "approved" && !closed ? (
            <>
              <span className="pill green" style={{ marginTop: 12 }}>Approved</span>
              <h3 style={{ marginTop: 12 }}>Your approved draft</h3>
              <DraftPreview fields={fields} />
              <div className="row" style={{ marginTop: 16 }}>
                <DraftUseButtons approvalId={approval.id} fields={fields} />
              </div>
              <p className="small muted">Nothing is published automatically. Use the text on your website or profile, then mark this action done.</p>
            </>
          ) : closed ? (
            <h3 style={{ marginTop: 12 }}>{card.status === "done" ? "Done" : "Dismissed"}</h3>
          ) : !canDraft ? (
            <>
              <h3 style={{ marginTop: 12 }}>We can draft this for you</h3>
              <p className="muted">Drafts come with Single Site. You can still follow the steps yourself.</p>
              <Link className="btn light" href="/app/upgrade">
                See plans
              </Link>
            </>
          ) : !isAiConfigured() ? (
            <>
              <h3 style={{ marginTop: 12 }}>We can draft this for you</h3>
              <p className="muted">Drafts aren&apos;t switched on yet. You can still follow the steps yourself.</p>
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 12 }}>We can draft this for you</h3>
              <p className="muted">
                We&apos;ll write a {DRAFT_LABEL[card.execution_type]?.toLowerCase()} for you to review. Nothing changes on your website unless you use it.
                {!planAllowsDraft ? ` Uses one free use (${free.remaining} left).` : ""}
              </p>
              {lastFailed ? <p className="notice error" role="alert">The last draft couldn&apos;t be prepared: {lastFailed}</p> : null}
              {approval?.decision === "changes_requested" && approval.note ? (
                <p className="notice">Your requested changes: {approval.note}</p>
              ) : null}
              <PrepareDraftForm
                cardId={card.id}
                label={approval ? "Prepare a new draft" : "Prepare a draft"}
                defaultNotes={approval?.decision === "changes_requested" ? (approval.note ?? "") : ""}
              />
            </>
          )}
          {card.result_summary ? <div className="evidence">{card.result_summary}</div> : null}
          {card.verification && card.verified_at ? (
            <div className="evidence">
              <b>Result</b> ·{" "}
              {card.verification === "fixed"
                ? `The check on ${formatWhen(card.verified_at)} no longer found this.`
                : `The check on ${formatWhen(card.verified_at)} still found this.`}
            </div>
          ) : (card.status === "done" || card.status === "approved") ? (
            <div className="evidence">
              <b>Result</b> · Check your website again to see whether this is fixed.
            </div>
          ) : null}
          {speed?.after != null ? (
            <div className="evidence">
              <b>Measured</b> · Mobile performance score {speed.before} → {speed.after} (Google PageSpeed Insights, same test both times)
            </div>
          ) : null}
          <div className="row" style={{ marginTop: 16 }}>
            {closed ? (
              <StatusButton id={card.id} status="new" label="Reopen" variant="outline" />
            ) : (
              <>
                <StatusButton id={card.id} status="done" label="Mark done" />
                <StatusButton id={card.id} status="dismissed" label="Dismiss" variant="outline" />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
