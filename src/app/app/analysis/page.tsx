import type { Metadata } from "next";
import Link from "next/link";

import { EvidenceLine } from "@/components/intelligence";
import { AutoRefresh, RunAnalysisButton } from "@/components/run-analysis";
import { formatWhen } from "@/lib/activity";
import { requireOrganization } from "@/lib/auth";
import { getEntitlements, getEvidence, getLastCompleteAnalysis, getLatestAnalysis, isStale } from "@/lib/queries";

export const metadata: Metadata = { title: "Analysis" };
export const maxDuration = 120;

type Coverage = {
  website?: { status: string; pages_reviewed?: number; pages_unreachable?: number };
  pagespeed?: { status: string; score?: number; reason?: string };
};

export default async function AnalysisPage({ searchParams }: { searchParams: Promise<{ onboarding?: string }> }) {
  const ws = await requireOrganization();
  const { onboarding } = await searchParams;
  const [latest, complete, ent] = await Promise.all([
    getLatestAnalysis(ws.organization.id),
    getLastCompleteAnalysis(ws.organization.id),
    getEntitlements(ws.organization.id),
  ]);
  const running = latest?.status === "running";
  const failed = latest?.status === "failed" ? latest : null;
  const coverage = (complete?.source_coverage ?? {}) as Coverage;
  const evidence = complete ? await getEvidence(complete.id) : [];
  const hasWebsite = Boolean(ws.business?.website);

  return (
    <>
      <AutoRefresh active={running} />
      {onboarding ? (
        <div className="row between" style={{ marginBottom: 12 }}>
          <b>Your first analysis</b>
          <span className="pill">Step 3 of 3</span>
        </div>
      ) : null}
      <h1 className="h1">Website check</h1>
      <p className="sub">
        {complete?.completed_at
          ? `Last analyzed ${formatWhen(complete.completed_at)}. Each source shows what was included and how fresh it is.`
          : "See which sources are included and how fresh the data is, so you know what the analysis covers."}
      </p>
      <div className="row" style={{ marginBottom: 20 }}>
        {hasWebsite ? (
          <RunAnalysisButton label={complete ? "Run a new analysis" : "Run your first analysis"} disabled={running} entitled={ent.analyses} />
        ) : (
          <Link className="btn" href="/app/onboarding">
            Add your website
          </Link>
        )}
      </div>
      {running ? (
        <p className="notice" role="status">
          Analyzing {latest?.website ? new URL(latest.website).hostname : "your website"}… We&apos;re reviewing your pages
          and checking page speed. This usually takes about a minute.
        </p>
      ) : null}
      {failed ? (
        <p className="notice error" role="alert">
          {failed.failure_reason ?? "The last analysis could not finish."}
        </p>
      ) : null}
      {!running && isStale(complete?.completed_at) ? (
        <p className="notice" role="status">This analysis is more than 30 days old, so some findings may be out of date.</p>
      ) : null}
      {complete?.summary ? <div className="card" style={{ marginBottom: 16 }}><p style={{ margin: 0 }}>{complete.summary}</p></div> : null}
      <div className="grid two">
        <div className="card">
          <h3>Website</h3>
          {coverage.website ? (
            <span className={isStale(complete?.completed_at) ? "pill yellow" : "pill green"}>
              {isStale(complete?.completed_at) ? "Out of date" : "Reviewed"} · {coverage.website.pages_reviewed} page{coverage.website.pages_reviewed === 1 ? "" : "s"}
            </span>
          ) : hasWebsite ? (
            <span className="pill yellow">Website added · not analyzed yet</span>
          ) : (
            <span className="pill yellow">Not added</span>
          )}
          <p className="muted">Pages reviewed, issues found, and source links.</p>
        </div>
        <div className="card">
          <h3>Page experience</h3>
          {coverage.pagespeed?.status === "measured" ? (
            <span className="pill green">Measured · {coverage.pagespeed.score}/100 on mobile</span>
          ) : coverage.pagespeed?.status === "missing" ? (
            <span className="pill coral">Missing · {coverage.pagespeed.reason}</span>
          ) : (
            <span className="pill yellow">Runs with each analysis</span>
          )}
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
      {evidence.length ? (
        <>
          <h3 style={{ margin: "26px 0 12px" }}>Everything we found</h3>
          <div className="card">
            {evidence.map((e) => (
              <EvidenceLine key={e.id} e={e} />
            ))}
          </div>
        </>
      ) : null}
      {onboarding && complete ? (
        <div className="row" style={{ marginTop: 20 }}>
          <Link className="btn" href="/app">
            See your next move
          </Link>
        </div>
      ) : null}
    </>
  );
}
