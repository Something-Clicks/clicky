import type { Metadata } from "next";

import { SoonButton } from "@/components/soon";
import { formatPrice, PLANS } from "@/config/pricing";
import { requireOrganization } from "@/lib/auth";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  await requireOrganization();
  const plan = PLANS.growth_ai;
  return (
    <>
      <div className="eyebrow">Plan and payments</div>
      <h1 className="h1">Your plan, clearly laid out.</h1>
      <p className="sub">See your current plan and manage payments securely.</p>
      <div className="card">
        <div className="row between">
          <div>
            <span className="pill green">Illustrative active plan · sample</span>
            <h3 style={{ marginTop: 12 }}>{plan.name}</h3>
            <div className="price">
              {formatPrice(plan)} <small className="muted">/ month</small>
            </div>
          </div>
          <SoonButton variant="outline" reason="Billing opens with checkout">
            Manage billing
          </SoonButton>
        </div>
        <div className="evidence">
          Sample only. You don&apos;t have a plan yet. Your real plan appears here once checkout opens and your payment is
          confirmed.
        </div>
      </div>
    </>
  );
}
