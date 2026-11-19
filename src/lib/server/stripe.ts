import "server-only";

import Stripe from "stripe";

import { PLANS, type PlanId } from "@/config/pricing";
import { log } from "@/lib/log";

export const isStripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

let stripe: Stripe | null = null;
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured.");
  if (key.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE !== "true") {
    // Live payments need an explicit, separate approval.
    throw new Error("Live Stripe keys are not enabled.");
  }
  stripe ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, httpClient: Stripe.createFetchHttpClient() });
  return stripe;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && v in PLANS;

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
  }): Promise<void>;
}

export class IgnoredEvent extends Error {}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

async function syncSubscription(client: Pick<Stripe, "subscriptions">, store: BillingStore, subscriptionId: string) {
  // Always read the current state from Stripe: events can arrive out of order.
  const sub = await client.subscriptions.retrieve(subscriptionId);
  const org = sub.metadata?.organization_id;
  const plan = sub.metadata?.plan_id;
  if (!org || !UUID.test(org) || !isPlanId(plan)) throw new IgnoredEvent("Subscription is not from Something Clicks checkout.");
  const item = sub.items.data[0];
  if (!item || item.price.unit_amount !== PLANS[plan].amountCents || PLANS[plan].interval !== "month") {
    throw new Error(`Subscription ${sub.id} price does not match the ${plan} catalog price.`);
  }
  const periodEnd = (item as { current_period_end?: number }).current_period_end ?? (sub as { current_period_end?: number }).current_period_end;
  await store.upsertSubscription({
    org,
    customer: idOf(sub.customer),
    subscription: sub.id,
    plan,
    status: sub.status,
    periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  });
}

/**
 * Applies one verified Stripe event. Throws IgnoredEvent for events that are not ours
 * or need no action; any other error means "retry later".
 */
export async function applyStripeEvent(event: Stripe.Event, store: BillingStore, client: Pick<Stripe, "subscriptions"> = getStripe()) {
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
        if (plan !== "diagnostic_audit" || s.amount_total !== PLANS[plan].amountCents || s.currency !== "usd") {
          throw new Error(`Checkout ${s.id} amount does not match the catalog.`);
        }
        await store.recordPurchase(org, plan, s.id, idOf(s.customer), s.amount_total);
        return;
      }
      if (s.mode === "subscription" && s.subscription) {
        await syncSubscription(client, store, idOf(s.subscription)!);
        return;
      }
      throw new IgnoredEvent("Nothing to do for this checkout session.");
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await syncSubscription(client, store, event.data.object.id);
      return;
    case "invoice.payment_failed":
    case "invoice.paid": {
      const inv = event.data.object as { parent?: { subscription_details?: { subscription?: string | { id: string } } }; subscription?: string | { id: string } };
      const sub = idOf(inv.parent?.subscription_details?.subscription ?? inv.subscription);
      if (!sub) throw new IgnoredEvent("Invoice has no subscription.");
      await syncSubscription(client, store, sub);
      return;
    }
    default:
      log.debug("stripe.event_ignored", { type: event.type });
      throw new IgnoredEvent(`Unhandled event type ${event.type}.`);
  }
}
