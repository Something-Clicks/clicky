/**
 * Verifies the configured Stripe price ids against the REAL Stripe account that STRIPE_SECRET_KEY belongs to, and prints
 * a pass/fail row per price. Read-only. Exit code 1 if any price is unverified.
 *   STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_MARKETING_REPORT=price_... (and the six subscription prices) npm run stripe:verify
 */
import Stripe from 'stripe';
import { verifyCatalog, type CatalogKey } from '../src/server/billing/catalog';

const key = process.env.STRIPE_SECRET_KEY; if (!key) throw new Error('STRIPE_SECRET_KEY is required');
const e = process.env;
const ids: Partial<Record<CatalogKey, string>> = { marketing_report: e.STRIPE_PRICE_MARKETING_REPORT, 'marketing_assistant:month': e.STRIPE_PRICE_MARKETING_ASSISTANT_MONTHLY, 'marketing_assistant:year': e.STRIPE_PRICE_MARKETING_ASSISTANT_ANNUAL, 'marketing_studio:month': e.STRIPE_PRICE_MARKETING_STUDIO_MONTHLY, 'marketing_studio:year': e.STRIPE_PRICE_MARKETING_STUDIO_ANNUAL, 'marketing_suite:month': e.STRIPE_PRICE_MARKETING_SUITE_MONTHLY, 'marketing_suite:year': e.STRIPE_PRICE_MARKETING_SUITE_ANNUAL };
const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
const checks = await verifyCatalog(stripe as never, ids, { production: process.env.NODE_ENV === 'production', key });
for (const c of checks) console.log(`${c.ok ? 'VERIFIED ' : 'REJECTED '} ${c.key.padEnd(26)} ${c.priceId ?? '(not set)'}${c.reason ? '  — ' + c.reason : ''}`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
