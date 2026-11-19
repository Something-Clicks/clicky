import type { Metadata } from "next";
import Link from "next/link";

import { formatPrice, PLANS } from "@/config/pricing";

export const metadata: Metadata = { title: "Pricing" };

const { diagnostic_audit: audit, starter_ai: starter, growth_ai: growth, scale_automation: scale } = PLANS;

export default function PricingPage() {
  return (
    <>
      <div className="eyebrow">Straightforward plans</div>
      <h1 className="h1">Start with clarity. Keep making progress.</h1>
      <p className="sub">Start with a one-time audit, or choose a monthly plan. No retainers.</p>
      <div className="grid">
        <div className="card">
          <h3>{audit.name}</h3>
          <div className="price">
            {formatPrice(audit)} <small className="muted">one time</small>
          </div>
          <p className="muted">{audit.summary}</p>
          <Link className="btn" href="/diagnostic-audit">
            Get your audit
          </Link>
        </div>
        <div className="card">
          <h3>{starter.name}</h3>
          <div className="price">
            {formatPrice(starter)}
            <small className="muted"> / month</small>
          </div>
          <p className="muted">{starter.summary}</p>
          <Link className="btn light" href="/app/billing?plan=starter_ai">
            View plan
          </Link>
        </div>
        <div className="card">
          <span className="pill">Popular working tier</span>
          <h3>{growth.name}</h3>
          <div className="price">
            {formatPrice(growth)}
            <small className="muted"> / month</small>
          </div>
          <p className="muted">{growth.summary}</p>
          <Link className="btn light" href="/app/billing?plan=growth_ai">
            View plan
          </Link>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row between">
          <div>
            <h3>{scale.name}</h3>
            <div className="price">
              {formatPrice(scale)} <small className="muted">/ month</small>
            </div>
            <p className="muted">{scale.summary}</p>
          </div>
          <Link className="btn light" href="/app/billing?plan=scale_automation">
            View plan
          </Link>
        </div>
      </div>
    </>
  );
}
