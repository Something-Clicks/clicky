import "server-only";

import Stripe from "stripe";

import { isPlanId, PLANS, planForPrice, type Interval, type PlanId, type StripeMode } from "@/config/pricing";
import { log } from "@/lib/log";

export const isStripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

/** The mode of the configured secret key: sk_live_/rk_live_ → live, anything else → test. */
export function stripeMode(): StripeMode {
  return /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "") ? "live" : "test";
}

let stripe: Stripe | null = null;
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured.");
  if (stripeMode() === "live" && process.env.STRIPE_ALLOW_LIVE !== "true") {
    // Live payments need an explicit, separate approval.
    throw new Error("Live Stripe keys are not enabled.");
  }
  stripe ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, httpClient: Stripe.createFetchHttpClient() });
  return stripe;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export { isPlanId };

/** What the webhook handler needs from the database (billing key already bound). */
export interface BillingStore {
  recordPurchase(org: string, plan: PlanId, session: string, customer: string | null, amount: number): Promise<void>;
  upsertSubscription(input: {
    org: string;
    customer: string | null;
    subscription: string;
    plan: PlanId;
    status: string;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    interval: Exclude<Interval, "one_time">;
    priceId: string;
  }): Promise<void>;
}

export class IgnoredEvent extends Error {}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

async function syncSubscription(client: Pick<Stripe, "subscriptions">, store: BillingStore, subscriptionId: string, mode: StripeMode) {
  // Always read the current state from Stripe: events can arrive out of order.
  const sub = await client.subscriptions.retrieve(subscriptionId);
  const org = sub.metadata?.organization_id;
  if (!org || !UUID.test(org)) throw new IgnoredEvent("Subscription is not from Something Clicks checkout.");
  const item = sub.items.data[0];
  // The plan comes from the price actually billed (so portal upgrades and downgrades apply),
  // and the price must be one of ours in this mode, at the catalog amount.
  const found = item ? planForPrice(item.price.id, mode) : null;
  if (!item || !found || found.interval === "one_time") {
    throw new Error(`Subscription ${sub.id} uses a price that is not in the ${mode} catalog.`);
  }
  const expected = (PLANS[found.plan].amounts as Partial<Record<Interval, number>>)[found.interval];
  if (item.price.unit_amount !== expected || item.price.recurring?.interval !== found.interval) {
    throw new Error(`Subscription ${sub.id} price does not match the ${found.plan} catalog price.`);
  }
  const periodEnd = (item as { current_period_end?: number }).current_period_end ?? (sub as { current_period_end?: number }).current_period_end;
  await store.upsertSubscription({
    org,
    customer: idOf(sub.customer),
    subscription: sub.id,
    plan: found.plan,
    status: sub.status,
    periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    interval: found.interval,
    priceId: item.price.id,
  });
}

/**
 * Applies one verified Stripe event. Throws IgnoredEvent for events that are not ours
 * or need no action; any other error means "retry later".
 */
export async function applyStripeEvent(event: Stripe.Event, store: BillingStore, client: Pick<Stripe, "subscriptions"> = getStripe()) {
  const mode: StripeMode = event.livemode ? "live" : "test";
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      const org = s.metadata?.organization_id;
      const plan = s.metadata?.plan_id;
      if (!org || !UUID.test(org) || !isPlanId(plan) || s.client_reference_id !== org) {
        throw new IgnoredEvent("Checkout session is not from Something Clicks.");
      }
      if (s.mode === "payment") {
        if (s.payment_status !== "paid") throw new IgnoredEvent("Payment not completed yet.");
        const amount = (PLANS[plan].amounts as Partial<Record<Interval, number>>).one_time;
        if (amount === undefined || s.amount_total !== amount || s.currency !== "usd") {
          throw new Error(`Checkout ${s.id} amount does not match the catalog.`);
        }
        await store.recordPurchase(org, plan, s.id, idOf(s.customer), s.amount_total);
        return;
      }
      if (s.mode === "subscription" && s.subscription) {
        await syncSubscription(client, store, idOf(s.subscription)!, mode);
        return;
      }
      throw new IgnoredEvent("Nothing to do for this checkout session.");
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await syncSubscription(client, store, event.data.object.id, mode);
      return;
    case "invoice.payment_failed":
    case "invoice.paid": {
      const inv = event.data.object as { parent?: { subscription_details?: { subscription?: string | { id: string } } }; subscription?: string | { id: string } };
      const sub = idOf(inv.parent?.subscription_details?.subscription ?? inv.subscription);
      if (!sub) throw new IgnoredEvent("Invoice has no subscription.");
      await syncSubscription(client, store, sub, mode);
      return;
    }
    default:
      log.debug("stripe.event_ignored", { type: event.type });
      throw new IgnoredEvent(`Unhandled event type ${event.type}.`);
  }
}
