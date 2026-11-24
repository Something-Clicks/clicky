/**
 * THE product catalog: names, descriptions, prices and Stripe ids, in one place.
 *
 * - Prices and names match the products created in Stripe (Nov 2026).
 * - Stripe ids are kept per mode. LIVE ids are filled in; TEST ids are empty until
 *   test-mode products exist. A missing id for the active mode is a configuration
 *   error: checkout refuses to start and says which id is missing. Ids are never
 *   borrowed from the other mode.
 * - Nothing here grants access. Paid access comes only from verified Stripe webhooks.
 */
export type PlanId = "marketing_plan" | "single_site" | "business_plus" | "multi_site";
export type Interval = "one_time" | "month" | "year";
export type StripeMode = "live" | "test";

export interface Plan {
  id: PlanId;
  /** Exact Stripe product name. */
  name: string;
  /** Exact Stripe product description (approved copy). */
  stripeDescription: string;
  /** Amounts in cents, per billing interval this plan offers. */
  amounts: Partial<Record<Interval, number>>;
  /**
   * False when the product promises something the app cannot do yet. Such plans are
   * not offered to customers (see docs/launch/LAUNCH_CHECKLIST.md, "Product promises").
   */
  available: boolean;
}

export const PLANS = {
  marketing_plan: {
    id: "marketing_plan",
    name: "Marketing Plan",
    stripeDescription: "See what needs work and get a clear plan for your marketing.",
    amounts: { one_time: 4900 },
    available: true,
  },
  single_site: {
    id: "single_site",
    name: "Single Site",
    stripeDescription: "Get marketing recommendations and ready-to-use content for your business.",
    amounts: { month: 7900, year: 75600 },
    available: true,
  },
  business_plus: {
    id: "business_plus",
    name: "Business Plus",
    stripeDescription: "Get more marketing insights, content and automated actions to grow your business.",
    amounts: { month: 17900, year: 171600 },
    // "Automated actions" don't exist yet, and nothing else sets it apart from Single Site.
    available: false,
  },
  multi_site: {
    id: "multi_site",
    name: "Multi-Site",
    stripeDescription: "Manage marketing across multiple websites or business locations.",
    amounts: { month: 39900, year: 382800 },
    // One subscription cannot cover several websites yet.
    available: false,
  },
} as const satisfies Record<PlanId, Plan>;

export const SUBSCRIPTION_PLANS = ["single_site", "business_plus", "multi_site"] as const satisfies PlanId[];

interface StripeIds {
  product: string;
  prices: Partial<Record<Interval, string>>;
}

/** Stripe product and price ids per mode. */
export const STRIPE_CATALOG: Record<StripeMode, Partial<Record<PlanId, StripeIds>>> = {
  live: {
    marketing_plan: { product: "prod_Vg9MOCNzSD7QlV", prices: { one_time: "price_1Uen3OFnFMCbDhHEw36S1zXr" } },
    single_site: {
      product: "prod_Vg9PQyz53iF3nS",
      prices: { month: "price_1Uen6xFnFMCbDhHEm8XTUgNR", year: "price_1Uen6xFnFMCbDhHEVERLfWyA" },
    },
    business_plus: {
      product: "prod_Vg9QSKyOjmg9oL",
      prices: { month: "price_1Uen7RFnFMCbDhHEjuPCIKjK", year: "price_1Uen7uFnFMCbDhHE7l1ZLhw7" },
    },
    multi_site: {
      product: "prod_Vg9Rsw79aaZCgs",
      prices: { month: "price_1Uen8GFnFMCbDhHE4Bx85tPA", year: "price_1Uen8ZFnFMCbDhHEYeMMWK7K" },
    },
  },
  // Stripe TEST mode (created Nov 24 2026 with the same names, descriptions, amounts and intervals).
  test: {
    marketing_plan: { product: "prod_VgWCuvuzJqbNPr", prices: { one_time: "price_1Uf9AQFnFMCbDhHEIoXcE8yg" } },
    single_site: {
      product: "prod_VgWCIEn78ciboM",
      prices: { month: "price_1Uf9AQFnFMCbDhHEdFmjNCCM", year: "price_1Uf9ARFnFMCbDhHEnfWuOh5u" },
    },
    business_plus: {
      product: "prod_VgWCAxqTXhlgg8",
      prices: { month: "price_1Uf9ARFnFMCbDhHEf32O0EzC", year: "price_1Uf9ARFnFMCbDhHEzY6QKJXT" },
    },
    multi_site: {
      product: "prod_VgWCrguEmvyU4Y",
      prices: { month: "price_1Uf9ASFnFMCbDhHEI4dkmgWg", year: "price_1Uf9ASFnFMCbDhHEMPdzx4qH" },
    },
  },
};

export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && Object.hasOwn(PLANS, v);
export const isInterval = (v: unknown): v is Interval => v === "one_time" || v === "month" || v === "year";

export type PriceLookup =
  | { ok: true; priceId: string; productId: string; amount: number }
  | { ok: false; missing: string };

/** The Stripe price for a plan and interval in one mode. Never falls back to the other mode. */
export function resolvePrice(plan: PlanId, interval: Interval, mode: StripeMode): PriceLookup {
  const amount = (PLANS[plan].amounts as Partial<Record<Interval, number>>)[interval];
  if (amount === undefined) return { ok: false, missing: `${plan} has no ${interval} price` };
  const ids = STRIPE_CATALOG[mode][plan];
  const priceId = ids?.prices[interval];
  if (!ids?.product || !priceId) return { ok: false, missing: `${mode.toUpperCase()} price id for ${PLANS[plan].name} (${interval})` };
  return { ok: true, priceId, productId: ids.product, amount };
}

/** Which plan and interval a Stripe price id belongs to, in one mode. */
export function planForPrice(priceId: string, mode: StripeMode): { plan: PlanId; interval: Interval } | null {
  for (const [plan, ids] of Object.entries(STRIPE_CATALOG[mode]) as [PlanId, StripeIds][]) {
    for (const [interval, id] of Object.entries(ids.prices) as [Interval, string][]) {
      if (id === priceId) return { plan, interval };
    }
  }
  return null;
}

/** "$79", "$1,716": whole dollars when there are no cents. */
export function formatAmount(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Customer-facing price label: "$49 one-time", "$79/month", "$756 billed yearly". */
export function priceLabel(plan: PlanId, interval: Interval): string {
  const cents = (PLANS[plan].amounts as Partial<Record<Interval, number>>)[interval];
  if (cents === undefined) return "";
  const amount = formatAmount(cents);
  return interval === "one_time" ? `${amount} one-time` : interval === "month" ? `${amount}/month` : `${amount} billed yearly`;
}

/** Names of plans from before the launch catalog (kept for old records). */
export const LEGACY_PLAN_NAMES: Record<string, string> = {
  diagnostic_audit: "Diagnostic Audit",
  starter_ai: "Starter AI",
  growth_ai: "Growth AI",
  scale_automation: "Scale & Automation",
};

export const planName = (id: string | null | undefined) =>
  id ? (isPlanId(id) ? PLANS[id].name : (LEGACY_PLAN_NAMES[id] ?? id)) : null;
