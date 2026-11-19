import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyStripeEvent, IgnoredEvent, type BillingStore } from "@/lib/server/stripe";

const ORG = "11111111-2222-4333-8444-555555555555";
const store = () => ({ recordPurchase: vi.fn(), upsertSubscription: vi.fn() }) satisfies BillingStore;
const event = (type: string, object: Record<string, unknown>) => ({ id: "evt_1", type, data: { object } }) as unknown as Stripe.Event;
const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_1", mode: "payment", payment_status: "paid", amount_total: 3900, currency: "usd",
  client_reference_id: ORG, customer: "cus_1", metadata: { organization_id: ORG, plan_id: "diagnostic_audit" }, ...over,
});
const subscription = (over: Record<string, unknown> = {}) => ({
  id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false,
  metadata: { organization_id: ORG, plan_id: "growth_ai" },
  items: { data: [{ price: { unit_amount: 14900 }, current_period_end: 1_900_000_000 }] }, ...over,
});
const client = (sub: Record<string, unknown>) => ({ subscriptions: { retrieve: vi.fn().mockResolvedValue(sub) } }) as never;

describe("applyStripeEvent", () => {
  it("records a paid Diagnostic Audit at the catalog price", async () => {
    const s = store();
    await applyStripeEvent(event("checkout.session.completed", session()), s, client({}));
    expect(s.recordPurchase).toHaveBeenCalledWith(ORG, "diagnostic_audit", "cs_test_1", "cus_1", 3900);
  });

  it("refuses an amount that doesn't match the catalog", async () => {
    await expect(applyStripeEvent(event("checkout.session.completed", session({ amount_total: 100 })), store(), client({}))).rejects.toThrow(/does not match/);
  });

  it("waits for unpaid (async) payments and ignores sessions that aren't ours", async () => {
    await expect(applyStripeEvent(event("checkout.session.completed", session({ payment_status: "unpaid" })), store(), client({}))).rejects.toBeInstanceOf(IgnoredEvent);
    await expect(applyStripeEvent(event("checkout.session.completed", session({ metadata: {} })), store(), client({}))).rejects.toBeInstanceOf(IgnoredEvent);
    await expect(applyStripeEvent(event("checkout.session.completed", session({ client_reference_id: "other" })), store(), client({}))).rejects.toBeInstanceOf(IgnoredEvent);
    await expect(applyStripeEvent(event("charge.refunded", {}), store(), client({}))).rejects.toBeInstanceOf(IgnoredEvent);
  });

  it("syncs subscriptions from Stripe's current state, not the event payload", async () => {
    const s = store();
    const c = client(subscription({ status: "past_due" }));
    await applyStripeEvent(event("customer.subscription.updated", { id: "sub_1", status: "active" }), s, c);
    expect(s.upsertSubscription).toHaveBeenCalledWith(expect.objectContaining({
      org: ORG, subscription: "sub_1", plan: "growth_ai", status: "past_due", customer: "cus_1",
      periodEnd: new Date(1_900_000_000 * 1000).toISOString(),
    }));
  });

  it("refuses a subscription whose price doesn't match its plan", async () => {
    const c = client(subscription({ items: { data: [{ price: { unit_amount: 100 } }] } }));
    await expect(applyStripeEvent(event("customer.subscription.created", { id: "sub_1" }), store(), c)).rejects.toThrow(/price does not match/);
  });

  it("subscription checkout and invoice events both re-sync the subscription", async () => {
    const s = store();
    const c = client(subscription());
    await applyStripeEvent(event("checkout.session.completed", session({ mode: "subscription", subscription: "sub_1", metadata: { organization_id: ORG, plan_id: "growth_ai" } })), s, c);
    await applyStripeEvent(event("invoice.payment_failed", { parent: { subscription_details: { subscription: "sub_1" } } }), s, c);
    expect(s.upsertSubscription).toHaveBeenCalledTimes(2);
  });
});

describe("webhook route", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("is unavailable until configured, and rejects bad signatures before touching the database", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const req = (body: string, sig: string) => ({ text: async () => body, headers: new Headers({ "stripe-signature": sig }) }) as never;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await POST(req("{}", "x"))).status).toBe(503);

    Object.assign(process.env, {
      STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_test_secret", BILLING_WEBHOOK_KEY: "k".repeat(40),
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    });
    expect((await POST(req("{}", "t=1,v1=deadbeef"))).status).toBe(400);
    const payload = JSON.stringify({ id: "evt_x", object: "event", type: "checkout.session.completed", livemode: false, data: { object: {} } });
    const wrongSig = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_other" });
    expect((await POST(req(payload, wrongSig))).status).toBe(400);
  });
});
