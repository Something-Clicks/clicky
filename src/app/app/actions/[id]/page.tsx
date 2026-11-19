import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { setCardStatus } from "@/app/actions/intelligence";
import { ApprovalActions } from "@/components/approval-actions";
import { DRAFT_LABEL, DraftPreview, DraftUseButtons, draftAsText, draftFields } from "@/components/draft";
import { EvidenceLine, StatusPill } from "@/components/intelligence";
import { PrepareDraftForm } from "@/components/prepare-draft";
import { AutoRefresh } from "@/components/run-analysis";
import { requireOrganization } from "@/lib/auth";
import { getCard, impactLabel } from "@/lib/queries";
import { isAiConfigured } from "@/lib/server/ai";
import { SUPPORTED_DRAFTS } from "@/lib/server/drafts";
import { createClient } from "@/lib/supabase/server";

import { CopyButton } from "./copy-button";

export const metadata: Metadata = { title: "Action detail" };

function StatusButton({ id, status, label, variant }: { id: string; status: string; label: string; variant?: string }) {
  return (
    <form action={setCardStatus}>
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
  const draftable = card.ai_capable && SUPPORTED_DRAFTS.includes(card.execution_type as never);

  const supabase = await createClient();
  const [{ data: run }, { data: approval }] = await Promise.all([
    supabase.from("agent_runs").select("id, status, error, output, started_at").eq("action_card_id", card.id)
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("approvals").select("id, decision, note, agent_runs ( output, draft_type )").eq("action_card_id", card.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const running = run?.status === "running";
  const fields = draftFields(approval?.agent_runs?.output);
  const lastFailed = run?.status === "failed" ? run.error : null;

  return (
    <>
      <div className="eyebrow">
        Action card · {impactLabel(card.impact_priority).toLowerCase()} · {card.confidence} confidence
      </div>
      <h1 className="h1">{card.title}</h1>
      <p className="sub">{card.explanation}</p>
      <div className="grid two">
        <div className="card">
          <h3>Why this matters</h3>
          <p className="muted">{card.why_it_matters}</p>
          <h3 style={{ marginTop: 22 }}>Recommended action</h3>
          <p className="muted">{card.recommended_action}</p>
          <h3 style={{ marginTop: 22 }}>What it should help with</h3>
          <p className="muted">{card.expected_benefit} This is an expected benefit, not a guaranteed result.</p>
          <h3 style={{ marginTop: 22 }}>Evidence</h3>
          {evidence.map((e) => (
            <EvidenceLine key={e.id} e={e} />
          ))}
          <p className="small muted">
            {card.wording === "ai" ? "Explained by AI from the evidence above." : "Explained from the evidence above."}
          </p>
        </div>
        <div className="card">
          <div className="row">
            <StatusPill status={card.status} />
            {card.approval_required ? <span className="pill yellow">Needs your approval</span> : <span className="pill">No approval needed</span>}
          </div>
          {!draftable ? (
            <>
              <h3 style={{ marginTop: 12 }}>A task for you or your web designer</h3>
              <p className="muted">This needs a change on your website that AI can&apos;t make for you. Mark it done once it&apos;s fixed.</p>
            </>
          ) : running ? (
            <>
              <AutoRefresh active />
              <h3 style={{ marginTop: 12 }}>Preparing your draft…</h3>
              <p className="muted" role="status">AI is writing a {DRAFT_LABEL[card.execution_type]?.toLowerCase()} from your business details and the evidence. This usually takes under a minute.</p>
            </>
          ) : approval?.decision === "pending" ? (
            <>
              <span className="pill yellow" style={{ marginTop: 12 }}>Waiting for approval</span>
              <h3 style={{ marginTop: 12 }}>AI-prepared draft</h3>
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
          ) : !isAiConfigured() ? (
            <>
              <h3 style={{ marginTop: 12 }}>AI can help prepare this</h3>
              <p className="muted">AI drafting isn&apos;t switched on yet. You can still follow the recommended action yourself.</p>
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 12 }}>AI can help prepare this</h3>
              <p className="muted">AI will prepare a {DRAFT_LABEL[card.execution_type]?.toLowerCase()} for you to review. Nothing changes on your website unless you use it.</p>
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
