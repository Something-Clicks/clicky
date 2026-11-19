import type { Metadata } from "next";

import { requireOrganization } from "@/lib/auth";

export const metadata: Metadata = { title: "Analysis" };

export default async function AnalysisPage() {
  const { business } = await requireOrganization();
  const hasWebsite = Boolean(business?.website);
  return (
    <>
      <div className="eyebrow">Marketing analysis</div>
      <h1 className="h1">Understand what the evidence says.</h1>
      <p className="sub">See which sources are included and how fresh the data is, so you know what the analysis covers.</p>
      <div className="grid two">
        <div className="card">
          <h3>Website</h3>
          {hasWebsite ? (
            <span className="pill green">Website added · not analyzed yet</span>
          ) : (
            <span className="pill yellow">Not added</span>
          )}
          <p className="muted">Pages reviewed, issues found, and source links.</p>
        </div>
        <div className="card">
          <h3>Page experience</h3>
          <span className="pill yellow">Needs connection</span>
          <p className="muted">PageSpeed results appear only after a successful check.</p>
        </div>
        <div className="card">
          <h3>Search performance</h3>
          <span className="pill yellow">Not connected</span>
          <p className="muted">Connect Search Console to view verified search data.</p>
        </div>
        <div className="card">
          <h3>Business profile</h3>
          <span className="pill yellow">Not connected</span>
          <p className="muted">Connect Google Business Profile to analyze authorized data.</p>
        </div>
      </div>
    </>
  );
}
