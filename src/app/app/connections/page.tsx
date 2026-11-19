import type { Metadata } from "next";
import Link from "next/link";

import { SoonButton } from "@/components/soon";
import { requireOrganization } from "@/lib/auth";

export const metadata: Metadata = { title: "Connections" };

const SOON = "Connections open with website analysis";

export default async function ConnectionsPage() {
  const { business } = await requireOrganization();
  return (
    <>
      <div className="eyebrow">Your data, your choice</div>
      <h1 className="h1">Connect the tools you already use.</h1>
      <p className="sub">
        A source shows as connected only after you authorize it. You can disconnect at any time, and we explain what
        each permission is for.
      </p>
      <div className="list">
        <div className="card row between">
          <div>
            <h3>Your website</h3>
            <p className="muted">Analyze public pages from your website.</p>
          </div>
          {business?.website ? (
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
          <SoonButton variant="light" reason={SOON}>
            Connect
          </SoonButton>
        </div>
        <div className="card row between">
          <div>
            <h3>PageSpeed Insights</h3>
            <p className="muted">Check page loading and user experience.</p>
          </div>
          <SoonButton variant="light" reason={SOON}>
            Run check
          </SoonButton>
        </div>
        <div className="card row between">
          <div>
            <h3>Google Business Profile</h3>
            <p className="muted">Review your authorized business profile information.</p>
          </div>
          <SoonButton variant="light" reason={SOON}>
            Connect
          </SoonButton>
        </div>
      </div>
    </>
  );
}
