import type { Metadata } from "next";

import { pageMetadata } from "@/config/seo";
import Link from "next/link";

import { TrackEvent } from "@/components/track-event";
import { Plans } from "@/components/plans";

export const metadata: Metadata = pageMetadata("/pricing");

export default function PricingPage() {
  return (
    <div className="stack">
      <TrackEvent name="pricing_viewed" funnel />
      <div>
        <h1 className="h1">Simple pricing</h1>
        <p className="sub">Start with three free uses. Pay when it&apos;s worth it.</p>
        <Link className="btn" href="/">
          Start free
        </Link>
      </div>
      <Plans mode={{ kind: "link" }} />
      <p className="muted small">Prices in US dollars. Cancel a subscription any time from your account.</p>
    </div>
  );
}
