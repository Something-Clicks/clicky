import Stripe from 'stripe';
import { AppError, ValidationError } from '@/agent/core/errors';
import { nowIso } from '@/agent/core/util';
import type { Db } from '@/agent/store/db';
import type { SubscriptionPlan } from './plans';
import { env } from '../env';

let client: Stripe | undefined;
export const stripe = (): Stripe => { if (!env.stripeSecret) throw new AppError('billing_not_configured', 'Billing is not configured yet', 503); return (client ??= new Stripe(env.stripeSecret)); };

export type Product = 'marketing_report' | 'marketing_assistant' | 'marketing_studio' | 'marketing_suite';
const P = () => env.stripePrices;
/** Price ids come only from configuration; nothing about the Stripe catalog is created or changed by this app. */
export const priceFor = (p: Product, interval: 'month' | 'year' = 'month'): string => {
  const y = interval === 'year';
  const id = p === 'marketing_report' ? P().marketingReport : p === 'marketing_assistant' ? (y ? P().assistantAnnual : P().assistantMonthly) : p === 'marketing_studio' ? (y ? P().studioAnnual : P().studioMonthly) : (y ? P().suiteAnnual : P().suiteMonthly);
  if (!id) throw new AppError('billing_not_configured', 'This plan is not available for purchase yet', 503);
  return id;
};
/** Which plan a subscription price grants. Unknown prices grant nothing. */
export const planForPrice = (id?: string): SubscriptionPlan | undefined => {
  if (!id) return undefined; const p = P();
  return [p.assistantMonthly, p.assistantAnnual].includes(id) ? 'assistant' : [p.studioMonthly, p.studioAnnual].includes(id) ? 'studio' : [p.suiteMonthly, p.suiteAnnual].includes(id) ? 'suite' : undefined;
};
export const available = (p: Product, interval: 'month' | 'year' = 'month'): boolean => { try { priceFor(p, interval); return true; } catch { return false; } };

export async function createCheckout(db: Db, o: { userId: string; businessId: string; email?: string; product: Product; interval?: 'month' | 'year' }): Promise<string> {
  const price = priceFor(o.product, o.interval); const bill = (await db.billing.list(o.businessId, { userId: o.userId }))[0];
  const meta = { userId: o.userId, businessId: o.businessId, product: o.product };
  const s = await stripe().checkout.sessions.create({
    mode: o.product === 'marketing_report' ? 'payment' : 'subscription', line_items: [{ price, quantity: 1 }], metadata: meta,
    ...(o.product !== 'marketing_report' ? { subscription_data: { metadata: meta } } : {}),
    ...(bill?.stripeCustomerId ? { customer: bill.stripeCustomerId } : o.email ? { customer_email: o.email } : {}),
    success_url: `${env.appUrl}/billing?status=success`, cancel_url: `${env.appUrl}/billing?status=cancelled`, allow_promotion_codes: false,
  });
  if (!s.url) throw new AppError('checkout_failed', 'Could not start checkout', 502);
  return s.url;
}
export async function createPortal(db: Db, o: { userId: string; businessId: string }): Promise<string> {
  const bill = (await db.billing.list(o.businessId, { userId: o.userId }))[0];
  if (!bill?.stripeCustomerId) throw new ValidationError('No billing account yet');
  return (await stripe().billingPortal.sessions.create({ customer: bill.stripeCustomerId, return_url: `${env.appUrl}/billing` })).url;
}

async function upsertBilling(db: Db, businessId: string, userId: string, patch: Partial<{ stripeCustomerId: string; reportCredits: number; subscription: NonNullable<Awaited<ReturnType<Db['billing']['get']>>>['subscription'] }>, incCredits = 0) {
  const cur = (await db.billing.list(businessId, { userId }))[0];
  if (!cur) return db.billing.insert({ businessId, userId, reportCredits: incCredits, ...patch });
  return db.billing.update(businessId, cur.id, { ...patch, reportCredits: cur.reportCredits + incCredits }, cur.version);
}

/** Verifies the signature, processes each event exactly once (insert-on-id), and ignores anything outside the launch catalog (Marketing Report and Marketing Assistant). */
export async function handleWebhook(db: Db, raw: string, signature: string | null, secret = env.stripeWebhookSecret): Promise<{ handled: boolean; duplicate?: boolean; type: string }> {
  if (!secret || !signature) throw new AppError('bad_signature', 'Missing webhook signature', 400);
  let ev: Stripe.Event;
  try { ev = Stripe.webhooks.constructEvent(raw, signature, secret); } catch { throw new AppError('bad_signature', 'Invalid webhook signature', 400); }
  try { await db.stripeEvents.insert({ id: ev.id, businessId: 'public', type: ev.type, processedAt: nowIso() }); }
  catch (e) { if ((e as AppError).code === 'conflict') return { handled: false, duplicate: true, type: ev.type }; throw e; }
  const isSub = (o: Stripe.Subscription) => !!planForPrice(o.items.data[0]?.price.id);
  switch (ev.type) {
    case 'checkout.session.completed': {
      const s = ev.data.object; const { userId, businessId, product } = s.metadata ?? {};
      if (!userId || !businessId) return { handled: false, type: ev.type };
      const cust = typeof s.customer === 'string' ? s.customer : s.customer?.id;
      if (product === 'marketing_report' && s.mode === 'payment' && s.payment_status === 'paid') { await upsertBilling(db, businessId, userId, { ...(cust ? { stripeCustomerId: cust } : {}) }, 1); return { handled: true, type: ev.type }; }
      if (cust) await upsertBilling(db, businessId, userId, { stripeCustomerId: cust });
      return { handled: true, type: ev.type };
    }
    case 'customer.subscription.created': case 'customer.subscription.updated': case 'customer.subscription.deleted': {
      const sub = ev.data.object; if (!isSub(sub)) return { handled: false, type: ev.type };
      const { userId, businessId } = sub.metadata ?? {}; if (!userId || !businessId) return { handled: false, type: ev.type };
      const item = sub.items.data[0]!;
      await upsertBilling(db, businessId, userId, { stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id, subscription: {
        id: sub.id, plan: planForPrice(item.price.id)!, interval: item.price.recurring?.interval === 'year' ? 'year' : 'month', status: ev.type === 'customer.subscription.deleted' ? 'canceled' : sub.status,
        currentPeriodStart: new Date(item.current_period_start * 1000).toISOString(), currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(), cancelAtPeriodEnd: sub.cancel_at_period_end } });
      return { handled: true, type: ev.type };
    }
    default: return { handled: false, type: ev.type };
  }
}
