import type { Metadata } from "next";

import { formatPrice, PLANS } from "@/config/pricing";

import { AuditForm } from "./audit-form";

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
      <AuditForm price={price} />
    </>
  );
}
