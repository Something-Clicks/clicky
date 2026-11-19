import type { Metadata } from "next";

import { CheckoutButton, PortalButton } from "@/components/billing-buttons";
import { AutoRefresh } from "@/components/run-analysis";
import { formatPrice, PLANS, type PlanId } from "@/config/pricing";
import { formatWhen } from "@/lib/activity";
import { requireOrganization } from "@/lib/auth";
import { getEntitlements } from "@/lib/queries";
import { isStripeConfigured } from "@/lib/server/stripe";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Billing" };

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "pill green" },
  trialing: { label: "Trial", cls: "pill green" },
  past_due: { label: "Payment failed", cls: "pill coral" },
  unpaid: { label: "Unpaid", cls: "pill coral" },
  canceled: { label: "Canceled", cls: "pill" },
  incomplete: { label: "Waiting for payment", cls: "pill yellow" },
  incomplete_expired: { label: "Expired", cls: "pill" },
  paused: { label: "Paused", cls: "pill yellow" },
};

const MONTHLY: PlanId[] = ["starter_ai", "growth_ai", "scale_automation"];

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; plan?: string }> }) {
  const ws = await requireOrganization();
  const { checkout, plan: wanted } = await searchParams;
  const isOwner = ws.organization.role === "owner";
  const supabase = await createClient();
  const [ent, { data: sub }, { data: purchases }] = await Promise.all([
    getEntitlements(ws.organization.id),
    supabase.from("subscriptions").select("plan_id, status, current_period_end, cancel_at_period_end, updated_at")
      .eq("organization_id", ws.organization.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("purchases").select("id, plan_id, amount_cents, paid_at").eq("organization_id", ws.organization.id)
      .order("paid_at", { ascending: false }).limit(20),
  ]);
  const confirming = checkout === "success" && !ent.plan && !(purchases ?? []).length && !sub;
  const showPlan = sub ? (sub.plan_id as PlanId) : ent.plan;
  const canCheckout = isOwner && isStripeConfigured();
  const subscribed = sub && ["active", "trialing", "past_due", "unpaid", "paused"].includes(sub.status);

  return (
    <>
      <AutoRefresh active={confirming} everyMs={3000} />
      <div className="eyebrow">Plan and payments</div>
      <h1 className="h1">Your plan, clearly laid out.</h1>
      <p className="sub">See your current plan and manage payments securely through Stripe.</p>
      {confirming ? (
        <p className="notice" role="status">Confirming your payment with Stripe… This page updates on its own.</p>
      ) : checkout === "canceled" ? (
        <p className="notice" role="status">Checkout was canceled. You weren&apos;t charged.</p>
      ) : null}

      <div className="card">
        <div className="row between">
          <div>
            {sub ? (
              <span className={(STATUS[sub.status] ?? STATUS.incomplete!).cls}>{(STATUS[sub.status] ?? STATUS.incomplete!).label}</span>
            ) : ent.plan === "diagnostic_audit" ? (
              <span className="pill green">Audit ready to use</span>
            ) : (
              <span className="pill yellow">No plan yet</span>
            )}
            <h3 style={{ marginTop: 12 }}>{showPlan ? PLANS[showPlan].name : "Choose how to start"}</h3>
            {showPlan ? (
              <div className="price">
                {formatPrice(PLANS[showPlan])}{" "}
                <small className="muted">{PLANS[showPlan].interval === "month" ? "/ month" : "one time"}</small>
              </div>
            ) : (
              <p className="muted">Start with a one-time Diagnostic Audit, or pick a monthly plan below.</p>
            )}
          </div>
          {isOwner && (sub || (purchases ?? []).length) ? <PortalButton /> : null}
        </div>
        {sub?.current_period_end ? (
          <div className="evidence">
            {sub.cancel_at_period_end
              ? `Ends on ${formatWhen(sub.current_period_end)}. You keep access until then.`
              : sub.status === "past_due"
                ? "Your last payment didn't go through. Update your card in Manage billing to keep access."
                : `Renews on ${formatWhen(sub.current_period_end)}.`}
          </div>
        ) : null}
        {!isOwner ? <p className="small muted">Only the account owner can change the plan.</p> : null}
      </div>

      {!subscribed ? (
        <>
          <h3 style={{ margin: "26px 0 12px" }}>Plans</h3>
          <div className="grid">
            <div className="card" style={wanted === "diagnostic_audit" ? { borderColor: "var(--blue)" } : undefined}>
              <h3>{PLANS.diagnostic_audit.name}</h3>
              <div className="price">
                {formatPrice(PLANS.diagnostic_audit)} <small className="muted">one time</small>
              </div>
              <p className="muted">{PLANS.diagnostic_audit.summary}</p>
              {canCheckout && ent.plan !== "diagnostic_audit" ? <CheckoutButton plan="diagnostic_audit" label="Get your audit" /> : null}
            </div>
            {MONTHLY.map((id) => (
              <div className="card" key={id} style={wanted === id ? { borderColor: "var(--blue)" } : undefined}>
                {id === "growth_ai" ? <span className="pill">Popular working tier</span> : null}
                <h3>{PLANS[id].name}</h3>
                <div className="price">
                  {formatPrice(PLANS[id])}
                  <small className="muted"> / month</small>
                </div>
                <p className="muted">{PLANS[id].summary}</p>
                {canCheckout ? <CheckoutButton plan={id} label="Choose plan" variant="light" /> : null}
              </div>
            ))}
          </div>
          {isOwner && !isStripeConfigured() ? <p className="small muted">Checkout opens soon.</p> : null}
        </>
      ) : null}

      {(purchases ?? []).length ? (
        <>
          <h3 style={{ margin: "26px 0 12px" }}>Payments</h3>
          <div className="card list">
            {purchases!.map((p) => (
              <div className="item" key={p.id}>
                <div>
                  <b>{PLANS[p.plan_id as PlanId]?.name ?? p.plan_id}</b>
                  <div className="small muted">{formatWhen(p.paid_at)}</div>
                </div>
                <span className="pill green">Paid ${(p.amount_cents / 100).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
