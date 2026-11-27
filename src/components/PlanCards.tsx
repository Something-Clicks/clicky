import Link from 'next/link';
import { openPortal, startCheckout } from '@/app/actions';
import { CATALOG, type PlanId } from '@/server/billing/plans';
import { keyOf } from '@/server/billing/catalog';
import { catalogStatus, type Product } from '@/server/billing/stripe';

/** The four plans of the one central agent. Marketing pages link to signup; the billing page starts real Stripe checkout. */
export default async function PlanCards({ mode, current, subscribed }: { mode: 'marketing' | 'billing'; current?: PlanId; subscribed?: boolean }) {
  const ok = new Set((await catalogStatus()).filter((c) => c.ok).map((c) => c.key));
  const can = (p: Product, i: 'month' | 'year' = 'month') => mode === 'billing' && ok.has(keyOf(p, i));
  return (
    <div className="grid plans">
      {CATALOG.map((p) => {
        const isCurrent = current === p.id; const product = p.product as Product;
        return (
          <section className="card plan" key={p.id} aria-labelledby={`plan-${p.id}`}>
            <h3 id={`plan-${p.id}`}>{p.name}</h3>
            <p className="price"><strong>{p.price}</strong>{'annual' in p && <span className="mut small"> or {p.annual}</span>}</p>
            <p className="mut">{p.description}</p>
            <ul className="ticks">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            {mode === 'marketing' && <Link className="btn" href="/signup">Get started</Link>}
            {mode === 'billing' && (isCurrent ? <p><span className="pill e-verified">Your current plan</span></p> : p.id === 'report'
              ? (can(product) ? <form action={startCheckout}><input type="hidden" name="product" value={product} /><button>Get the {p.name}</button></form> : <p className="mut small">Not available to purchase yet.</p>)
              : subscribed ? <form action={openPortal}><button className="sec">Change plan in billing</button></form>
              : (can(product) || can(product, 'year')) ? <form action={startCheckout} className="row"><input type="hidden" name="product" value={product} />{can(product) && <button name="interval" value="month">Monthly</button>}{can(product, 'year') && <button className="sec" name="interval" value="year">Annual</button>}</form>
              : <p className="mut small">Not available to purchase yet.</p>)}
          </section>
        );
      })}
    </div>
  );
}
