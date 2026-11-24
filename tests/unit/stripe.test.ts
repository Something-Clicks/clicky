import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyStripeEvent, IgnoredEvent, type BillingStore } from "@/lib/server/stripe";

const ORG = "11111111-2222-4333-8444-555555555555";
const LIVE_SINGLE_MONTH = "price_1Uen6xFnFMCbDhHEm8XTUgNR";
const LIVE_SINGLE_YEAR = "price_1Uen6xFnFMCbDhHEVERLfWyA";
const store = () => ({ recordPurchase: vi.fn(), upsertSubscription: vi.fn() }) satisfies BillingStore;
const event = (type: string, object: Record<string, unknown>, livemode = true) =>
  ({ id: "evt_1", type, livemode, data: { object } }) as unknown as Stripe.Event;
const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_1", mode: "payment", payment_status: "paid", amount_total: 4900, currency: "usd",
  client_reference_id: ORG, customer: "cus_1", metadata: { organization_id: ORG, plan_id: "marketing_plan" }, ...over,
});
const item = (id = LIVE_SINGLE_MONTH, amount = 7900, interval = "month") => ({
  price: { id, unit_amount: amount, recurring: { interval } }, current_period_end: 1_900_000_000,
});
const subscription = (over: Record<string, unknown> = {}) => ({
  id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false,
  metadata: { organization_id: ORG, plan_id: "single_site" },
  items: { data: [item()] }, ...over,
});
const client = (sub: Record<string, unknown>) => ({ subscriptions: { retrieve: vi.fn().mockResolvedValue(sub) } }) as never;

describe("applyStripeEvent", () => {
  it("records a paid Marketing Plan at the catalog price", async () => {
    const s = store();
    await applyStripeEvent(event("checkout.session.completed", session()), s, client({}));
    expect(s.recordPurchase).toHaveBeenCalledWith(ORG, "marketing_plan", "cs_test_1", "cus_1", 4900);
  });

  it("refuses an amount that doesn't match the catalog, and one-time checkout for a subscription plan", async () => {
    await expect(applyStripeEvent(event("checkout.session.completed", session({ amount_total: 100 })), store(), client({}))).rejects.toThrow(/does not match/);
    await expect(applyStripeEvent(event("checkout.session.completed", session({ metadata: { organization_id: ORG, plan_id: "single_site" } })), store(), client({}))).rejects.toThrow(/does not match/);
  });

  it("waits for unpaid (async) payments and ignores sessions that aren't ours", async () => {
    await expect(applyStripeEvent(event("checkout.session.completed", session({ payment_status: "unpaid" })), store(), client({}))).rejects.toBeInstanceOf(IgnoredEvent);
    await expect(applyStripeEvent(event("checkout.session.completed", session({ metadata: {} })), store(), client({}))).rejects.toBeInstanceOf(IgnoredEvent);
    await expect(applyStripeEvent(event("checkout.session.completed", session({ metadata: { organization_id: ORG, plan_id: "growth_ai" } })), store(), client({}))).rejects.toBeInstanceOf(IgnoredEvent);
    await expect(applyStripeEvent(event("checkout.session.completed", session({ client_reference_id: "other" })), store(), client({}))).rejects.toBeInstanceOf(IgnoredEvent);
    await expect(applyStripeEvent(event("charge.refunded", {}), store(), client({}))).rejects.toBeInstanceOf(IgnoredEvent);
  });

  it("syncs subscriptions from Stripe's current state, not the event payload", async () => {
    const s = store();
    const c = client(subscription({ status: "past_due" }));
    await applyStripeEvent(event("customer.subscription.updated", { id: "sub_1", status: "active" }), s, c);
    expect(s.upsertSubscription).toHaveBeenCalledWith({
      org: ORG, subscription: "sub_1", plan: "single_site", status: "past_due", customer: "cus_1",
      periodEnd: new Date(1_900_000_000 * 1000).toISOString(), cancelAtPeriodEnd: false,
      interval: "month", priceId: LIVE_SINGLE_MONTH,
    });
  });

  it("takes the plan and interval from the billed price (portal upgrades, annual billing)", async () => {
    const s = store();
    await applyStripeEvent(event("customer.subscription.updated", { id: "sub_1" }), s, client(subscription({ items: { data: [item(LIVE_SINGLE_YEAR, 75600, "year")] } })));
    expect(s.upsertSubscription).toHaveBeenCalledWith(expect.objectContaining({ plan: "single_site", interval: "year", priceId: LIVE_SINGLE_YEAR }));
    await applyStripeEvent(event("customer.subscription.updated", { id: "sub_1" }), s, client(subscription({ items: { data: [item("price_1Uen7uFnFMCbDhHE7l1ZLhw7", 171600, "year")] } })));
    expect(s.upsertSubscription).toHaveBeenLastCalledWith(expect.objectContaining({ plan: "business_plus", interval: "year" }));
  });

  it("refuses a subscription whose price is unknown, mismatched, or from the other mode", async () => {
    await expect(applyStripeEvent(event("customer.subscription.created", { id: "sub_1" }), store(), client(subscription({ items: { data: [item(LIVE_SINGLE_MONTH, 100)] } })))).rejects.toThrow(/price does not match/);
    await expect(applyStripeEvent(event("customer.subscription.created", { id: "sub_1" }), store(), client(subscription({ items: { data: [item("price_unknown")] } })))).rejects.toThrow(/not in the live catalog/);
    // A live price id never counts in test mode.
    await expect(applyStripeEvent(event("customer.subscription.created", { id: "sub_1" }, false), store(), client(subscription()))).rejects.toThrow(/not in the test catalog/);
  });

  it("subscription checkout and invoice events both re-sync the subscription", async () => {
    const s = store();
    const c = client(subscription());
    await applyStripeEvent(event("checkout.session.completed", session({ mode: "subscription", subscription: "sub_1", metadata: { organization_id: ORG, plan_id: "single_site" } })), s, c);
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
