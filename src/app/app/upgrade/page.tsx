import type { Metadata } from "next";

import { Plans } from "@/components/plans";
import { UpgradeFeedback } from "@/components/upgrade-feedback";
import { planName } from "@/config/pricing";
import { requireOrganization } from "@/lib/auth";
import { getEntitlements, getFreeUses } from "@/lib/queries";
import { TrackEvent } from "@/components/track-event";
import { isStripeConfigured } from "@/lib/server/stripe";

export const metadata: Metadata = { title: "Keep going" };

export default async function UpgradePage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const ws = await requireOrganization();
  const { plan } = await searchParams;
  const [ent, free] = await Promise.all([getEntitlements(ws.organization.id), getFreeUses(ws.organization.id)]);
  const isOwner = ws.organization.role === "owner";
  const atLimit = !ent.plan && free.remaining <= 0;
  return (
    <div className="stack">
      <TrackEvent name="upgrade_viewed" funnel />
      {atLimit ? <TrackEvent name="limit_reached" funnel /> : null}
      <div>
        <h1 className="h1">
          {ent.plan ? `You're on ${planName(ent.plan)}` : free.remaining > 0 ? `${free.remaining} free ${free.remaining === 1 ? "use" : "uses"} left` : "Keep the momentum going"}
        </h1>
        <p className="sub">
          {ent.plan
            ? "Manage your plan from Plan and payments."
            : free.remaining > 0
              ? "Pick a plan whenever you're ready."
              : `You've used your ${free.limit} free uses. Choose how you'd like to continue.`}
        </p>
      </div>
      {!isOwner ? <p className="notice">Only the account owner can choose a plan.</p> : null}
      {isOwner && !isStripeConfigured() ? <p className="notice yellow">Checkout opens soon.</p> : null}
      <Plans mode={{ kind: "checkout", canBuy: isOwner && isStripeConfigured() }} highlight={plan} />
      {atLimit ? <UpgradeFeedback /> : null}
    </div>
  );
}
