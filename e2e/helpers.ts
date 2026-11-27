import type { Page } from '@playwright/test';
import Stripe from 'stripe';

/** Delivers a genuinely signed Stripe subscription event to the real webhook route for the signed-in customer. */
export async function subscribe(page: Page, price: string, eventId: string) {
  const who = await (await page.request.get('/api/dev/whoami')).json() as { userId: string; businessId: string };
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: eventId, object: 'event', type: 'customer.subscription.created', data: { object: { id: `sub_${eventId}`, customer: `cus_${eventId}`, status: 'active', cancel_at_period_end: false, metadata: who, items: { data: [{ price: { id: price, recurring: { interval: price.endsWith('y') ? 'year' : 'month' } }, current_period_start: now - 86400, current_period_end: now + 29 * 86400 }] } } } });
  const res = await page.request.post('/api/stripe/webhook', { data: body, headers: { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_e2e' }), 'content-type': 'application/json' } });
  return { res, body, who };
}

/** Switch the active website and wait until the server action has set it (the action redirects to /dashboard). */
export async function switchTo(page: Page, label: string) {
  await page.selectOption('#siteId', { label }); await Promise.all([page.waitForURL('**/dashboard'), page.getByRole('button', { name: 'Switch' }).click()]);
}
