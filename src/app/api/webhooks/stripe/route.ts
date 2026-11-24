import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

import { log } from "@/lib/log";
import { applyStripeEvent, IgnoredEvent, type BillingStore } from "@/lib/server/stripe";
import type { Database } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook. The ONLY way paid access is granted.
 *   1. Verify the signature (STRIPE_WEBHOOK_SECRET) on the raw body.
 *   2. Record the event id once (duplicates are acknowledged and skipped).
 *   3. Apply it through the billing_* database functions, authorized by BILLING_WEBHOOK_KEY.
 * Failures return 500 so Stripe retries; the event is marked failed and retried safely.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.BILLING_WEBHOOK_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!secret || !key || !url || !anon) {
    log.error("stripe.webhook_not_configured");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    // Signature verification needs only the webhook secret, not the API key.
    event = Stripe.webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch (error) {
    log.warn("stripe.webhook_bad_signature", { error: (error as Error).message });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  if (event.livemode && process.env.STRIPE_ALLOW_LIVE !== "true") {
    log.warn("stripe.live_event_refused", { id: event.id });
    return NextResponse.json({ error: "Live mode not enabled" }, { status: 400 });
  }

  const db = createClient<Database>(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: seen, error: recordError } = await db.rpc("billing_record_event", { p_key: key, p_event_id: event.id, p_type: event.type });
  if (recordError) {
    log.error("stripe.webhook_record_failed", { id: event.id, error: recordError.message });
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }
  if (seen === "duplicate") return NextResponse.json({ received: true, duplicate: true });

  const store: BillingStore = {
    async recordPurchase(org, plan, session, customer, amount) {
      const { error } = await db.rpc("billing_record_purchase", { p_key: key, p_org: org, p_plan: plan, p_session: session, p_customer: customer, p_amount: amount });
      if (error) throw new Error(error.message);
    },
    async upsertSubscription(s) {
      const { error } = await db.rpc("billing_upsert_subscription", {
        p_key: key, p_org: s.org, p_customer: s.customer, p_subscription: s.subscription, p_plan: s.plan,
        p_status: s.status, p_period_end: s.periodEnd, p_cancel_at_period_end: s.cancelAtPeriodEnd,
        p_interval: s.interval, p_price: s.priceId,
      });
      if (error) throw new Error(error.message);
    },
  };

  const finish = (status: string, error: string | null) =>
    db.rpc("billing_finish_event", { p_key: key, p_event_id: event.id, p_status: status, p_error: error });

  try {
    await applyStripeEvent(event, store);
    await finish("processed", null);
    log.info("stripe.webhook_processed", { id: event.id, type: event.type });
    return NextResponse.json({ received: true });
  } catch (error) {
    if (error instanceof IgnoredEvent) {
      await finish("ignored", error.message);
      return NextResponse.json({ received: true, ignored: true });
    }
    log.error("stripe.webhook_failed", { id: event.id, type: event.type, error });
    await finish("failed", (error as Error).message);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
