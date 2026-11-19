import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SampleNotice, SoonButton } from "@/components/soon";
import { SAMPLE_DETAIL } from "@/content/samples";
import { requireOrganization } from "@/lib/auth";

import { CopyButton } from "./copy-button";

export const metadata: Metadata = { title: "Action detail" };

export default async function ActionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOrganization();
  const { id } = await params;
  // Real Action Cards (with evidence) arrive with analysis. Only the sample exists now.
  if (id !== "sample") notFound();
  const d = SAMPLE_DETAIL;
  return (
    <>
      <div className="eyebrow">Action card · sample</div>
      <h1 className="h1">{d.title}</h1>
      <p className="sub">{d.summary}</p>
      <SampleNotice>This is a sample Action Card. Approving drafts becomes available with AI preparation.</SampleNotice>
      <div className="grid two">
        <div className="card">
          <h3>Why this matters</h3>
          <p className="muted">{d.why}</p>
          <h3 style={{ marginTop: 22 }}>Recommended action</h3>
          <p className="muted">{d.recommended}</p>
          <div className="evidence">{d.evidence}</div>
        </div>
        <div className="card">
          <span className="pill yellow">Needs approval</span>
          <h3 style={{ marginTop: 12 }}>AI-prepared draft</h3>
          <div className="mock">
            <b>{d.draftHeading}</b>
            <p>{d.draft}</p>
            <small className="muted">{d.draftNote}</small>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <SoonButton reason="Approvals arrive with AI preparation">Approve draft</SoonButton>
            <CopyButton text={d.draft} label="Copy draft" />
          </div>
        </div>
      </div>
    </>
  );
}
