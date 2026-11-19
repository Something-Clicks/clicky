"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PLANS } from "@/config/pricing";
import { getWorkspace } from "@/lib/auth";
import { log } from "@/lib/log";
import { getStripe, isPlanId, isStripeConfigured } from "@/lib/server/stripe";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

async function origin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

/** Starts Stripe Checkout for a plan. Access is granted later, only by the verified webhook. */
export async function startCheckout(_prev: FormState, form: FormData): Promise<FormState> {
  const ws = await getWorkspace();
  const planId = form.get("plan");
  if (!ws.organization) redirect("/app/onboarding");
  if (ws.organization.role !== "owner") return { error: "Only the account owner can manage billing." };
  if (!isPlanId(planId)) return { error: "Choose a plan." };
  if (!isStripeConfigured()) return { error: "Checkout isn't switched on yet." };

  const plan = PLANS[planId];
  const orgId = ws.organization.id;
  const supabase = await createClient();
  const [{ data: customer }, { data: ent }] = await Promise.all([
    supabase.rpc("billing_customer_id", { p_org: orgId }),
    supabase.rpc("current_entitlements", { p_org: orgId }),
  ]);
  const current = (ent as { plan: string | null } | null)?.plan;
  if (plan.interval === "month" && current && current !== "diagnostic_audit") {
    return { error: "You already have a plan. Use Manage billing to change it." };
  }

  const metadata = { organization_id: orgId, plan_id: planId };
  const base = await origin();
  let url: string | null = null;
  try {
    const stripe = getStripe();
    const params = (customerId: string | null) => ({
      mode: (plan.interval === "one_time" ? "payment" : "subscription") as "payment" | "subscription",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: plan.currency,
            unit_amount: plan.amountCents,
            product_data: { name: `Something Clicks · ${plan.name}`, description: plan.summary },
            ...(plan.interval === "month" ? { recurring: { interval: "month" as const } } : {}),
          },
        },
      ],
      client_reference_id: orgId,
      metadata,
      ...(plan.interval === "month"
        ? { subscription_data: { metadata } }
        : { payment_intent_data: { metadata }, ...(customerId ? {} : { customer_creation: "always" as const }) }),
      ...(customerId ? { customer: customerId } : { customer_email: ws.email }),
      success_url: `${base}/app/billing?checkout=success`,
      cancel_url: `${base}/app/billing?checkout=canceled`,
    });
    const minute = Math.floor(Date.now() / 60_000);
    let session;
    try {
      // A double click within a minute reuses the same session.
      session = await stripe.checkout.sessions.create(params(customer), { idempotencyKey: `checkout:${orgId}:${planId}:${minute}` });
    } catch (error) {
      // The saved Stripe customer was deleted in Stripe: start fresh with the owner's email.
      const e = error as { code?: string; param?: string };
      if (!customer || e.code !== "resource_missing" || e.param !== "customer") throw error;
      log.warn("billing.customer_missing", { organizationId: orgId });
      session = await stripe.checkout.sessions.create(params(null), { idempotencyKey: `checkout:${orgId}:${planId}:${minute}:fresh` });
    }
    url = session.url;
    log.info("billing.checkout_started", { organizationId: orgId, plan: planId, session: session.id });
  } catch (error) {
    log.error("billing.checkout_failed", { organizationId: orgId, plan: planId, error });
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
