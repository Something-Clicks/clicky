import type { Metadata } from "next";
import Link from "next/link";

import { SoonButton } from "@/components/soon";
import { formatWhen } from "@/lib/activity";
import { requireOrganization } from "@/lib/auth";
import { getLastCompleteAnalysis } from "@/lib/queries";

export const metadata: Metadata = { title: "Connections" };

const GOOGLE_SOON = "Google sign-in for this source is being set up";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ onboarding?: string }> }) {
  const ws = await requireOrganization();
  const { onboarding } = await searchParams;
  const last = await getLastCompleteAnalysis(ws.organization.id);
  const psi = (last?.source_coverage as { pagespeed?: { status: string } } | null)?.pagespeed;

  return (
    <>
      {onboarding ? (
        <div className="card" style={{ maxWidth: 760, marginBottom: 20 }}>
          <div className="row between">
            <b>Connect your data</b>
            <span className="pill">Step 2 of 3</span>
          </div>
          <div className="bar" style={{ margin: "12px 0 0" }}>
            <i style={{ width: "67%" }} />
          </div>
        </div>
      ) : null}
      <div className="eyebrow">Your data sources</div>
      <h1 className="h1">Connections</h1>
      <p className="sub">
        A source shows as connected only after you authorize it. You can disconnect at any time, and we explain what
        each permission is for.
      </p>
      <div className="list">
        <div className="card row between">
          <div>
            <h3>Your website</h3>
            <p className="muted">
              Analyze public pages from your website.
              {ws.business?.website ? ` ${new URL(ws.business.website).hostname}.` : ""}
            </p>
          </div>
          {ws.business?.website ? (
            <span className="pill green">Website added</span>
          ) : (
            <Link className="btn light" href="/app/onboarding">
              Add website
            </Link>
          )}
        </div>
        <div className="card row between">
          <div>
            <h3>Google Search Console</h3>
            <p className="muted">Understand how people find your website.</p>
          </div>
          <SoonButton variant="light" reason={GOOGLE_SOON}>
            Connect
          </SoonButton>
        </div>
        <div className="card row between">
          <div>
            <h3>PageSpeed Insights</h3>
            <p className="muted">
              Check page loading and user experience. Public data, so no sign-in is needed: it runs with each website check.
              {psi?.status === "measured" && last?.completed_at ? ` Last checked ${formatWhen(last.completed_at)}.` : ""}
            </p>
          </div>
          {psi?.status === "measured" ? (
            <span className="pill green">Checked</span>
          ) : (
            <Link className="btn light" href="/app/analysis">
              Run check
            </Link>
          )}
        </div>
        <div className="card row between">
          <div>
            <h3>Google Business Profile</h3>
            <p className="muted">Review your authorized business profile information.</p>
          </div>
          <SoonButton variant="light" reason={GOOGLE_SOON}>
            Connect
          </SoonButton>
        </div>
      </div>
      {onboarding ? (
        <div className="row" style={{ marginTop: 20 }}>
          <Link className="btn" href="/app/analysis?onboarding=1">
            Continue
          </Link>
        </div>
      ) : null}
    </>
  );
}
