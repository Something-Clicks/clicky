import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { setCardStatus } from "@/app/actions/intelligence";
import { EvidenceLine, StatusPill } from "@/components/intelligence";
import { requireOrganization } from "@/lib/auth";
import { getCard, impactLabel } from "@/lib/queries";

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
          <h3 style={{ marginTop: 12 }}>{card.ai_capable ? "AI can help prepare this" : "A task for you or your web designer"}</h3>
          <p className="muted">
            {card.ai_capable
              ? "AI can prepare a draft for you to review. Nothing changes on your website unless you use it."
              : "This needs a change on your website that AI can't make for you. Mark it done once it's fixed."}
          </p>
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
