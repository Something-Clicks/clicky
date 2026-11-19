/**
 * THE price catalog: the single source of truth for every price shown or charged.
 * Working prices from the product direction. Stripe test mode comes first, and
 * nothing here grants access by itself: entitlements come only from verified
 * Stripe webhooks (Phase 6).
 */
export type PlanId = "diagnostic_audit" | "starter_ai" | "growth_ai" | "scale_automation";

export interface Plan {
  id: PlanId;
  name: string;
  amountCents: number;
  currency: "usd";
  interval: "one_time" | "month";
  summary: string;
}

export const PLANS = {
  diagnostic_audit: {
    id: "diagnostic_audit",
    name: "Diagnostic Audit",
    amountCents: 3900,
    currency: "usd",
    interval: "one_time",
    summary: "A clear look at your marketing and what deserves attention first.",
  },
  starter_ai: {
    id: "starter_ai",
    name: "Starter AI",
    amountCents: 4900,
    currency: "usd",
    interval: "month",
    summary: "A simple starting point for understanding your marketing.",
  },
  growth_ai: {
    id: "growth_ai",
    name: "Growth AI",
    amountCents: 14900,
    currency: "usd",
    interval: "month",
    summary: "More insight and help turning recommendations into action.",
  },
  scale_automation: {
    id: "scale_automation",
    name: "Scale & Automation",
    amountCents: 39900,
    currency: "usd",
    interval: "month",
    summary: "For businesses ready for more connected workflows.",
  },
} as const satisfies Record<PlanId, Plan>;

/** "$39": whole dollars when there are no cents. */
export function formatPrice(plan: Plan): string {
  const dollars = plan.amountCents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}
