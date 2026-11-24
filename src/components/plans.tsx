import Link from "next/link";

import { CheckoutButton } from "@/components/billing-buttons";
import { PLANS, priceLabel, type Interval, type PlanId } from "@/config/pricing";

/**
 * What each plan includes, in plain words. Only things the app does today.
 * (Stripe descriptions are kept unchanged in src/config/pricing.ts.)
 */
export const INCLUDES: Partial<Record<PlanId, string[]>> = {
  marketing_plan: ["A full check of your website", "A clear, ranked list of what to fix", "The evidence behind every item"],
  single_site: [
    "Everything in Marketing Plan",
    "Drafts: page titles, homepage copy, Google Business Profile posts, blog posts",
    "You review and approve every draft",
    "Your website checked again every week",
  ],
};

type Mode = { kind: "link" } | { kind: "checkout"; canBuy: boolean };

function Buy({ plan, interval, label, mode, light }: { plan: PlanId; interval: Interval; label: string; mode: Mode; light?: boolean }) {
  if (mode.kind === "link") {
    // On the public pricing page the one filled button is "Start free".
    return (
      <Link className="btn block light" href={`/app/upgrade?plan=${plan}&interval=${interval}`}>
        {label}
      </Link>
    );
  }
  if (!mode.canBuy) return null;
  return <CheckoutButton plan={plan} interval={interval} label={label} variant={light ? "light" : undefined} />;
}

/** The plan list: Marketing Plan (one-time), then subscriptions with monthly and yearly prices. */
export function Plans({ mode, highlight }: { mode: Mode; highlight?: string }) {
  const mp = PLANS.marketing_plan;
  const ss = PLANS.single_site;
  return (
    <div className="stack">
      <div className="two">
        <section className="card" aria-labelledby="plan-mp" style={highlight === "marketing_plan" ? { outline: "3px solid var(--blue)" } : undefined}>
          <h2 id="plan-mp">{mp.name}</h2>
          <p className="price">{priceLabel("marketing_plan", "one_time")}</p>
          <ul className="small">
            {INCLUDES.marketing_plan!.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <Buy plan="marketing_plan" interval="one_time" label="Get my plan" mode={mode} light />
        </section>
        <section className="card" aria-labelledby="plan-ss" style={highlight === "single_site" ? { outline: "3px solid var(--blue)" } : undefined}>
          <div className="row">
            <h2 id="plan-ss" style={{ margin: 0 }}>
              {ss.name}
            </h2>
            <span className="pill green">Subscription</span>
          </div>
          <p className="price" style={{ marginTop: 8 }}>
            {priceLabel("single_site", "month")}
          </p>
          <p className="muted" style={{ marginTop: -8 }}>
            or {priceLabel("single_site", "year")}
          </p>
          <ul className="small">
            {INCLUDES.single_site!.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div className="stack">
            <Buy plan="single_site" interval="month" label="Choose monthly" mode={mode} />
            <Buy plan="single_site" interval="year" label="Choose yearly" mode={mode} light />
          </div>
        </section>
      </div>
      <section className="card quiet" aria-labelledby="plan-soon">
        <h3 id="plan-soon">Coming soon</h3>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Monthly</th>
              <th scope="col">Annual</th>
            </tr>
          </thead>
          <tbody>
            {(["business_plus", "multi_site"] as const).map((id) => (
              <tr key={id}>
                <th scope="row">{PLANS[id].name}</th>
                <td className="nowrap">{priceLabel(id, "month")}</td>
                <td>{priceLabel(id, "year")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 8 }}>
          Business Plus adds hands-off work for you. Multi-Site covers several websites or locations. Neither is ready yet.
        </p>
      </section>
    </div>
  );
}
