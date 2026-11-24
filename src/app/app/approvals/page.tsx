import type { Metadata } from "next";
import Link from "next/link";

import { ApprovalActions } from "@/components/approval-actions";
import { DRAFT_LABEL, DraftPreview, DraftUseButtons, draftAsText, draftFields } from "@/components/draft";
import { AutoRefresh } from "@/components/run-analysis";
import { Clicky } from "@/components/shell";
import { CopyButton } from "@/app/app/actions/[id]/copy-button";
import { formatWhen } from "@/lib/activity";
import { requireOrganization } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Approvals" };

const DECISION: Record<string, { label: string; cls: string }> = {
  approved: { label: "Approved", cls: "pill green" },
  rejected: { label: "Rejected", cls: "pill coral" },
  changes_requested: { label: "Changes requested", cls: "pill yellow" },
};

export default async function ApprovalsPage() {
  const ws = await requireOrganization();
  const isOwner = ws.organization.role === "owner";
  const supabase = await createClient();
  const [{ data: approvals }, { count: preparing }] = await Promise.all([
    supabase
      .from("approvals")
      .select("id, decision, note, decided_at, created_at, action_card_id, agent_runs ( output, draft_type, model, instructions ), action_cards ( title )")
      .eq("organization_id", ws.organization.id)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("agent_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ws.organization.id)
      .eq("status", "running"),
  ]);
  const pending = (approvals ?? []).filter((a) => a.decision === "pending");
  const decided = (approvals ?? []).filter((a) => a.decision !== "pending");

  return (
    <>
      <AutoRefresh active={(preparing ?? 0) > 0} />
      <h1 className="h1">Drafts</h1>
      <p className="sub">Review, approve, then copy or download. We never publish anything for you.</p>
      {preparing ? (
        <p className="notice" role="status">
          Preparing {preparing} draft{preparing === 1 ? "" : "s"}… They&apos;ll appear here when ready.
        </p>
      ) : null}
      {pending.length === 0 ? (
        <div className="card empty">
          <Clicky size={72} alt="" />
          <h3>Nothing is waiting for you.</h3>
          <p className="muted">Drafts you ask for show up here for your review.</p>
          <Link className="btn light" href="/app/actions">
            See your actions
          </Link>
        </div>
      ) : (
        <div className="list">
          {pending.map((a) => {
            const fields = draftFields(a.agent_runs?.output);
            return (
              <div className="card" key={a.id}>
                <div className="row between">
                  <div>
                    <span className="pill yellow">Waiting for approval</span>
                    <h3 style={{ marginTop: 10 }}>{DRAFT_LABEL[a.agent_runs?.draft_type ?? ""] ?? "Draft"}</h3>
                    <p className="muted">
                      For “{a.action_cards?.title}”. Prepared from your business details and the evidence on that
                      action{a.agent_runs?.instructions ? ", with your notes" : ""}.
                    </p>
                  </div>
                  <span className="small muted">{formatWhen(a.created_at)}</span>
                </div>
                <DraftPreview fields={fields} />
                {isOwner ? (
                  <ApprovalActions approvalId={a.id}>
                    <CopyButton text={draftAsText(fields)} label="Copy text" />
                  </ApprovalActions>
                ) : (
                  <div className="row" style={{ marginTop: 16 }}>
                    <CopyButton text={draftAsText(fields)} label="Copy text" />
                    <span className="small muted">Only the account owner can approve drafts.</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {decided.length ? (
        <>
          <h3 style={{ margin: "26px 0 12px" }}>Recent decisions</h3>
          <div className="list">
            {decided.map((a) => {
              const fields = draftFields(a.agent_runs?.output);
              const d = DECISION[a.decision]!;
              return (
                <div className="card" key={a.id}>
                  <div className="row between">
                    <div>
                      <span className={d.cls}>{d.label}</span>
                      <h3 style={{ marginTop: 10 }}>{DRAFT_LABEL[a.agent_runs?.draft_type ?? ""] ?? "Draft"}</h3>
                      <p className="muted">
                        For <Link className="link" href={`/app/actions/${a.action_card_id}`}>“{a.action_cards?.title}”</Link>
                        {a.note ? ` · Your note: ${a.note}` : ""}
                      </p>
                    </div>
                    <span className="small muted">{a.decided_at ? formatWhen(a.decided_at) : ""}</span>
                  </div>
                  {a.decision === "approved" ? (
                    <>
                      <DraftPreview fields={fields} />
                      <div className="row" style={{ marginTop: 16 }}>
                        <DraftUseButtons approvalId={a.id} fields={fields} />
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}
