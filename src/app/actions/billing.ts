"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isInterval, PLANS, resolvePrice, type Interval } from "@/config/pricing";
import { getWorkspace } from "@/lib/auth";
import { log } from "@/lib/log";
import { track } from "@/lib/server/site";
import { getStripe, isPlanId, isStripeConfigured, stripeMode } from "@/lib/server/stripe";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

async function origin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

/**
 * Starts Stripe Checkout for a plan, using the catalog's Stripe price id for the active
 * mode. Access is granted later, only by the verified webhook.
 */
export async function startCheckout(_prev: FormState, form: FormData): Promise<FormState> {
  const ws = await getWorkspace();
  const planId = form.get("plan");
  const intervalValue = form.get("interval") ?? "one_time";
  if (!ws.organization) redirect("/app/onboarding");
  if (ws.organization.role !== "owner") return { error: "Only the account owner can manage billing." };
  if (!isPlanId(planId) || !isInterval(intervalValue)) return { error: "Choose a plan." };
  const interval: Interval = intervalValue;
  const plan = PLANS[planId];
  if (!plan.available) return { error: `${plan.name} isn't available yet.` };
  if (!isStripeConfigured()) return { error: "Checkout isn't switched on yet." };

  const mode = stripeMode();
  const price = resolvePrice(planId, interval, mode);
  if (!price.ok) {
    // Configuration error: never substitute another mode's id or an old price.
    log.error("billing.price_missing", { plan: planId, interval, mode, missing: price.missing });
    return { error: "Checkout isn't set up for this plan yet. Please try again later." };
  }

  const orgId = ws.organization.id;
  const supabase = await createClient();
  const [{ data: customer }, { data: ent }] = await Promise.all([
    supabase.rpc("billing_customer_id", { p_org: orgId }),
    supabase.rpc("current_entitlements", { p_org: orgId }),
  ]);
  const current = (ent as { plan: string | null } | null)?.plan;
  const currentIsSubscription = current && !["marketing_plan", "diagnostic_audit"].includes(current);
  if (interval !== "one_time" && currentIsSubscription) {
    return { error: "You already have a plan. Use Manage billing to change it." };
  }

  const metadata = { organization_id: orgId, plan_id: planId, interval };
  const base = await origin();
  let url: string | null = null;
  try {
    const stripe = getStripe();
    const subscription = interval !== "one_time";
    const params = (customerId: string | null) => ({
      mode: (subscription ? "subscription" : "payment") as "payment" | "subscription",
      line_items: [{ price: price.priceId, quantity: 1 }],
      client_reference_id: orgId,
      metadata,
      ...(subscription
        ? { subscription_data: { metadata } }
        : { payment_intent_data: { metadata }, ...(customerId ? {} : { customer_creation: "always" as const }) }),
      ...(customerId ? { customer: customerId } : { customer_email: ws.email }),
      success_url: `${base}/app/billing?checkout=success`,
      cancel_url: `${base}/app/billing?checkout=canceled`,
    });
    const minute = Math.floor(Date.now() / 60_000);
    const key = `checkout:${orgId}:${planId}:${interval}:${minute}`;
    let session;
    try {
      // A double click within a minute reuses the same session.
      session = await stripe.checkout.sessions.create(params(customer), { idempotencyKey: key });
    } catch (error) {
      // The saved Stripe customer was deleted in Stripe: start fresh with the owner's email.
      const e = error as { code?: string; param?: string };
      if (!customer || e.code !== "resource_missing" || e.param !== "customer") throw error;
      log.warn("billing.customer_missing", { organizationId: orgId });
      session = await stripe.checkout.sessions.create(params(null), { idempotencyKey: `${key}:fresh` });
    }
    url = session.url;
    log.info("billing.checkout_started", { organizationId: orgId, plan: planId, interval, mode, session: session.id });
    await track("checkout_started", { plan: planId, interval });
  } catch (error) {
    log.error("billing.checkout_failed", { organizationId: orgId, plan: planId, interval, error });
    return { error: "We couldn't open checkout. Please try again." };
  }
  if (!url) return { error: "We couldn't open checkout. Please try again." };
  redirect(url);
}

/** Opens the Stripe customer portal (requires the portal to be configured in Stripe). */
export async function openBillingPortal(_prev: FormState, _form?: FormData): Promise<FormState> {
  const ws = await getWorkspace();
  if (!ws.organization) redirect("/app/onboarding");
  if (ws.organization.role !== "owner") return { error: "Only the account owner can manage billing." };
  const supabase = await createClient();
  const { data: customer } = await supabase.rpc("billing_customer_id", { p_org: ws.organization.id });
  if (!customer) return { error: "There's no billing account yet. Choose a plan first." };
  let url: string;
  try {
    const session = await getStripe().billingPortal.sessions.create({ customer, return_url: `${await origin()}/app/billing` });
    url = session.url;
  } catch (error) {
    log.error("billing.portal_failed", { organizationId: ws.organization.id, error });
    return { error: "Billing management isn't available yet. Contact us to change your plan." };
  }
  redirect(url);
}
