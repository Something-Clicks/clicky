import Link from "next/link";

import { CheckoutButton } from "@/components/billing-buttons";
import { PLANS, priceLabel, type Interval, type PlanId } from "@/config/pricing";

/**
 * What the Marketing Report includes, in plain words. Only things the app does today.
 * (Stripe descriptions are kept unchanged in src/config/pricing.ts.)
 */
export const INCLUDES: Partial<Record<PlanId, string[]>> = {
  marketing_plan: ["A full check of your website", "A clear, ranked list of what to fix", "The evidence behind every item"],
};

/** Plans that exist in the catalog but can't be bought yet, in display order. */
const PLANNED = (["single_site", "business_plus", "multi_site"] as const).filter((id) => PLANS[id].tier === "planned");

type Mode = { kind: "link" } | { kind: "checkout"; canBuy: boolean };

function Buy({ plan, interval, label, mode, light }: { plan: PlanId; interval: Interval; label: string; mode: Mode; light?: boolean }) {
  if (!PLANS[plan].available) return null;
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

/** The plan list: the Marketing Report (the only plan for sale), then planned plans that can't be bought. */
export function Plans({ mode, highlight }: { mode: Mode; highlight?: string }) {
  const mp = PLANS.marketing_plan;
  return (
    <div className="stack">
      <section className="card" aria-labelledby="plan-mp" style={highlight === "marketing_plan" ? { outline: "3px solid var(--blue)" } : undefined}>
        <h2 id="plan-mp">{mp.name}</h2>
        <p className="price">{priceLabel("marketing_plan", "one_time")}</p>
        <p className="muted">{mp.description}</p>
        <ul className="small">
          {INCLUDES.marketing_plan!.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <Buy plan="marketing_plan" interval="one_time" label="Get my report" mode={mode} light />
      </section>
      <section className="card quiet" aria-labelledby="plan-soon">
        <h3 id="plan-soon">Planned</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          These plans aren&apos;t available yet and can&apos;t be bought.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Monthly</th>
              <th scope="col">Annual</th>
            </tr>
          </thead>
          <tbody>
            {PLANNED.map((id) => (
              <tr key={id}>
                <th scope="row">
                  {PLANS[id].name}
                  {PLANS[id].description ? <div className="muted small" style={{ fontWeight: 400 }}>{PLANS[id].description}</div> : null}
                </th>
                <td className="nowrap">{priceLabel(id, "month")}</td>
                <td>{priceLabel(id, "year")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
