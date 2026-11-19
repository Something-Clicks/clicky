import type { Metadata } from "next";
import Link from "next/link";

import { requireOrganization } from "@/lib/auth";
import { SAMPLE_NEXT_MOVE } from "@/content/samples";

import { Greeting } from "./greeting";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await requireOrganization();
  // Action Cards, approvals and analyses arrive in later phases. Until then the
  // true values are zero / not yet, and the next-move card is a labeled sample.
  return (
    <>
      <div className="eyebrow">Your workspace</div>
      <h1 className="h1">
        <Greeting /> Here&apos;s your next move.
      </h1>
      <p className="sub">A clear view of what needs attention. The action below is a sample until your first analysis runs.</p>
      <div className="grid">
        <div className="card">
          <div className="metric">0</div>
          <div className="metric-label">Actions to review</div>
        </div>
        <div className="card">
          <div className="metric">0</div>
          <div className="metric-label">Approvals waiting</div>
        </div>
        <div className="card">
          <div className="metric">Not yet</div>
          <div className="metric-label">Last analysis</div>
        </div>
      </div>
      <h3 style={{ margin: "26px 0 12px" }}>Your next best move</h3>
      <div className="card action">
        <div className="tag">{SAMPLE_NEXT_MOVE.impact} · SAMPLE</div>
        <h3>{SAMPLE_NEXT_MOVE.title}</h3>
        <p>{SAMPLE_NEXT_MOVE.summary}</p>
        <div className="evidence">{SAMPLE_NEXT_MOVE.evidence}</div>
        <Link className="btn" href="/app/actions/sample">
          Review action
        </Link>
      </div>
    </>
  );
}
