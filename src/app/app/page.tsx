import type { Metadata } from "next";
import Link from "next/link";

import { ActionCardItem } from "@/components/intelligence";
import { AutoRefresh, RunAnalysisButton } from "@/components/run-analysis";
import { Clicky } from "@/components/shell";
import { requireOrganization } from "@/lib/auth";
import { getCards, getLastCompleteAnalysis, getLatestAnalysis, getPendingApprovalCount, openCards, relativeDay } from "@/lib/queries";

import { Greeting } from "./greeting";

export const metadata: Metadata = { title: "Dashboard" };
export const maxDuration = 120;

export default async function DashboardPage() {
  const ws = await requireOrganization();
  const [latest, lastComplete, cards, approvalsWaiting] = await Promise.all([
    getLatestAnalysis(ws.organization.id),
    getLastCompleteAnalysis(ws.organization.id),
    getCards(ws.organization.id),
    getPendingApprovalCount(ws.organization.id),
  ]);
  const open = openCards(cards);
  const running = latest?.status === "running";
  const next = open.find((c) => c.status === "new") ?? open[0];

  return (
    <>
      <AutoRefresh active={running} />
      <div className="eyebrow">Your workspace</div>
      <h1 className="h1">
        <Greeting /> Here&apos;s your next move.
      </h1>
      <p className="sub">A clear view of what needs attention.</p>
      <div className="grid">
        <div className="card">
          <div className="metric">{open.length}</div>
          <div className="metric-label">Actions to review</div>
        </div>
        <div className="card">
          <div className="metric">{approvalsWaiting}</div>
          <div className="metric-label">{approvalsWaiting === 1 ? "Approval waiting" : "Approvals waiting"}</div>
        </div>
        <div className="card">
          <div className="metric">{running ? "Running" : relativeDay(lastComplete?.completed_at)}</div>
          <div className="metric-label">Last analysis</div>
        </div>
      </div>
      <h3 style={{ margin: "26px 0 12px" }}>Your next best move</h3>
      {next ? (
        <ActionCardItem card={next} cta="Review action" primary />
      ) : running ? (
        <div className="card empty" role="status">
          <Clicky size={72} alt="" />
          <h3>Analyzing your website…</h3>
          <p className="muted">We&apos;re reviewing your pages and checking page speed. This usually takes about a minute.</p>
        </div>
      ) : lastComplete ? (
        <div className="card empty">
          <Clicky size={72} alt="" />
          <h3>You&apos;re all caught up.</h3>
          <p className="muted">There&apos;s nothing open right now. Run a new analysis after you change your website.</p>
          <RunAnalysisButton label="Run a new analysis" />
        </div>
      ) : !ws.business?.website ? (
        <div className="card empty">
          <Clicky size={72} alt="" />
          <h3>Add your website to get started.</h3>
          <p className="muted">Your first Action Cards come from a review of your website.</p>
          <Link className="btn" href="/app/onboarding">
            Add your website
          </Link>
        </div>
      ) : (
        <div className="card empty">
          <Clicky size={72} alt="" />
          <h3>Let&apos;s find your first next step.</h3>
          <p className="muted">We&apos;ll review {new URL(ws.business.website).hostname} and turn what we find into a short list of actions.</p>
          <RunAnalysisButton label="Run your first analysis" />
        </div>
      )}
    </>
  );
}
