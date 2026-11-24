import type { Metadata } from "next";
import Link from "next/link";

import { PortalButton } from "@/components/billing-buttons";
import { AutoRefresh } from "@/components/run-analysis";
import { formatAmount, isPlanId, planName, priceLabel } from "@/config/pricing";
import { formatWhen } from "@/lib/activity";
import { requireOrganization } from "@/lib/auth";
import { getEntitlements, getFreeUses } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Plan and payments" };

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

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const ws = await requireOrganization();
  const { checkout } = await searchParams;
  const isOwner = ws.organization.role === "owner";
  const supabase = await createClient();
  const [ent, free, { data: sub }, { data: purchases }] = await Promise.all([
    getEntitlements(ws.organization.id),
    getFreeUses(ws.organization.id),
    supabase
      .from("subscriptions")
      .select("plan_id, status, current_period_end, cancel_at_period_end, billing_interval, updated_at")
      .eq("organization_id", ws.organization.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("purchases").select("id, plan_id, amount_cents, paid_at").eq("organization_id", ws.organization.id).order("paid_at", { ascending: false }).limit(20),
  ]);
  const confirming = checkout === "success" && !ent.plan && !(purchases ?? []).length && !sub;
  const status = sub ? (STATUS[sub.status] ?? STATUS.incomplete!) : null;
  const interval = sub?.billing_interval === "year" ? "year" : "month";

  return (
    <div className="stack" data-clarity-mask="true">
      <AutoRefresh active={confirming} everyMs={3000} />
      <h1 className="h1">Plan and payments</h1>
      {confirming ? (
        <p className="notice" role="status">
          Confirming your payment with Stripe… This page updates on its own.
        </p>
      ) : checkout === "canceled" ? (
        <p className="notice" role="status">
          Checkout was canceled. You weren&apos;t charged.
        </p>
      ) : null}

      <div className="card">
        {sub ? (
          <>
            <span className={status!.cls}>{status!.label}</span>
            <h2 style={{ marginTop: 10 }}>{planName(sub.plan_id)}</h2>
            {isPlanId(sub.plan_id) ? <p className="price">{priceLabel(sub.plan_id, interval)}</p> : null}
            {sub.current_period_end ? (
              <p className="muted">
                {sub.cancel_at_period_end
                  ? `Ends on ${formatWhen(sub.current_period_end)}. You keep access until then.`
                  : sub.status === "past_due"
                    ? "Your last payment didn't go through. Update your card in Manage billing to keep access."
                    : `Renews on ${formatWhen(sub.current_period_end)}.`}
              </p>
            ) : null}
          </>
        ) : ent.plan ? (
          <>
            <span className="pill green">Ready to use</span>
            <h2 style={{ marginTop: 10 }}>{planName(ent.plan)}</h2>
            <p className="muted">Your next website check is included.</p>
          </>
        ) : (
          <>
            <span className="pill lavender">Free</span>
            <h2 style={{ marginTop: 10 }}>
              {free.remaining} of {free.limit} free uses left
            </h2>
            <div className="bar" aria-hidden="true" style={{ margin: "8px 0 16px" }}>
              <span style={{ width: `${Math.round((free.used / Math.max(free.limit, 1)) * 100)}%` }} />
            </div>
            <Link className="btn" href="/app/upgrade">
              See plans
            </Link>
          </>
        )}
        {isOwner && (sub || (purchases ?? []).length) ? (
          <div style={{ marginTop: 12 }}>
            <PortalButton />
          </div>
        ) : null}
        {!isOwner ? <p className="small muted">Only the account owner can change the plan.</p> : null}
      </div>

      {(purchases ?? []).length ? (
        <section aria-labelledby="pay-title">
          <h2 id="pay-title">Payments</h2>
          <div className="card list">
            {purchases!.map((p) => (
              <div className="item between" key={p.id}>
                <div>
                  <b>{planName(p.plan_id)}</b>
                  <div className="small muted">{formatWhen(p.paid_at)}</div>
                </div>
                <span className="pill green">Paid {formatAmount(p.amount_cents)}</span>
              </div>
            ))}
          </div>
          <p className="small muted">Subscription invoices are in Manage billing.</p>
        </section>
      ) : null}
    </div>
  );
}
