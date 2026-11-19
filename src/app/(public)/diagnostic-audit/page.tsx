import type { Metadata } from "next";

import { SoonButton } from "@/components/soon";
import { formatPrice, PLANS } from "@/config/pricing";

export const metadata: Metadata = { title: "Diagnostic audit" };

const price = formatPrice(PLANS.diagnostic_audit);

export default function DiagnosticAuditPage() {
  return (
    <>
      <div className="eyebrow">One clear starting point</div>
      <h1 className="h1">Find out what your marketing needs next.</h1>
      <p className="sub">
        The Diagnostic Audit is a one-time {price} review. Start with a few details about your business.
      </p>
      <div className="card" style={{ maxWidth: 700 }}>
        {/* No name attributes and no submit: nothing typed here is sent or stored until checkout exists. */}
        <label className="field">
          <span>Business name</span>
          <input className="input" placeholder="Your business" autoComplete="organization" />
        </label>
        <label className="field">
          <span>Website</span>
          <input className="input" placeholder="https://example.com" inputMode="url" />
        </label>
        <label className="field">
          <span>What would you most like to improve?</span>
          <select className="input">
            <option>Getting found by more customers</option>
            <option>Turning visits into calls</option>
            <option>Understanding what is working</option>
            <option>Not sure yet</option>
          </select>
        </label>
        <label className="field">
          <span>Email</span>
          <input className="input" placeholder="you@example.com" type="email" autoComplete="email" />
        </label>
        <SoonButton reason="Checkout opens soon">Continue to secure checkout · {price}</SoonButton>
        <p className="small muted">Checkout opens soon. Nothing you type here is sent or saved yet.</p>
      </div>
    </>
  );
}
