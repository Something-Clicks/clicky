import type { Metadata } from "next";

import { SampleNotice, SoonButton } from "@/components/soon";
import { SAMPLE_APPROVAL } from "@/content/samples";
import { requireOrganization } from "@/lib/auth";

import { CopyButton } from "../actions/[id]/copy-button";

export const metadata: Metadata = { title: "Approvals" };

const SOON = "Approvals arrive with AI preparation";

export default async function ApprovalsPage() {
  await requireOrganization();
  return (
    <>
      <div className="eyebrow">Your approval</div>
      <h1 className="h1">Review before anything goes live.</h1>
      <p className="sub">You stay in control. Preview the work, approve it, or copy it for use elsewhere.</p>
      <SampleNotice>Nothing is waiting for you. This sample shows how drafts will appear.</SampleNotice>
      <div className="card">
        <div className="row between">
          <div>
            <span className="pill yellow">Waiting for approval</span>
            <h3 style={{ marginTop: 10 }}>{SAMPLE_APPROVAL.title}</h3>
            <p className="muted">{SAMPLE_APPROVAL.source}</p>
          </div>
          <span className="small muted">Sample</span>
        </div>
        <div className="mock">
          <b>Draft preview</b>
          <p>{SAMPLE_APPROVAL.draft}</p>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <SoonButton reason={SOON}>Approve</SoonButton>
          <CopyButton text={SAMPLE_APPROVAL.draft} label="Copy text" />
          <SoonButton variant="outline" reason={SOON}>
            Request changes
          </SoonButton>
        </div>
      </div>
    </>
  );
}
