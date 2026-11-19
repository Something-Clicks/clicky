# Phase 6: Payments and entitlements — report

**Status:** complete in Stripe **test mode** (November 19, 2026). Live payments are blocked in code (`sk_live_` keys and live events are refused) until you approve them and set `STRIPE_ALLOW_LIVE=true`.

## What was built
- **Checkout** (`src/app/actions/billing.ts`): Stripe Checkout with prices from the typed catalog (`src/config/pricing.ts`) — no Stripe dashboard products needed. The audit is a one-time payment; plans are monthly subscriptions. Business id and plan travel in Stripe metadata; double clicks reuse one session (idempotency key); a deleted Stripe customer falls back to a fresh one.
- **Webhook** (`/api/webhooks/stripe`) — the only way access is granted:
  signature verified on the raw body → event recorded once (duplicates acknowledged, failed ones retryable) → applied → result logged.
  Audit payments must be paid, in USD, for exactly the catalog amount. Subscriptions are always **re-read from Stripe** (out-of-order events cannot roll access back) and must match the catalog price.
- **Billing key**: the webhook writes through four `billing_*` database functions authorized by `BILLING_WEBHOOK_KEY`; the database stores only its SHA-256 hash, and the key can do nothing else (no service-role key needed for billing).
- **Entitlements, enforced in the database** (`plan_entitlements`; working defaults — confirm or change):

  | | No purchase | Diagnostic Audit | Starter AI | Growth AI | Scale & Automation |
  |---|---|---|---|---|---|
  | Website analysis | — | 1 | ✓ | ✓ | ✓ |
  | Weekly re-analysis | — | — | ✓ | ✓ | ✓ |
  | AI drafts | — | — | page title & description | all | all |

  `start_analysis`, `start_agent_run` and the weekly worker check them, so calling the API directly cannot skip payment. Past-due, unpaid or canceled subscriptions lose access.
- **Billing page** per the reference: current plan with status and renewal/ending date, Manage billing (Stripe customer portal), plans, payment history. Returning from checkout shows "Confirming your payment…" until the webhook confirms — the redirect grants nothing.
- **Pricing → Billing**; **Diagnostic Audit form** is live: details are carried (HTTP-only cookie, never the URL) through sign-up and business setup to the $39 checkout.
- UI: "Choose a plan to start" instead of Run analysis without a plan; drafts outside the plan explain why.

## Tests
| Suite | Result |
|---|---|
| Database | 78/78 — 11 new: catalog ↔ entitlements, no plan blocks analysis, billing key refuses wrong/short/missing keys, event idempotency and retry, no direct reads/writes, audit is single-use, customer id owner-only, Starter vs Growth drafts, past-due/canceled lose access, status changes logged, tenant isolation |
| Unit | 100/100 — 7 new: catalog-amount checks, not-ours and unpaid ignored, subscription re-read from Stripe, price mismatch refused, invoice re-sync, unconfigured 503 and bad signatures 400 |
| Live (Stripe test mode + Supabase + browser) | Forged event rejected; wrong amount refused; signed audit payment granted exactly one audit; replay no-op; a **real Stripe test subscription** granted Growth from Stripe's state (the event claimed otherwise); billing page showed it; canceling in Stripe removed access; choosing a plan opened **real Stripe Checkout**; redirect alone granted nothing; audit form → sign-up with pre-filled email, nothing personal in the URL. Stripe test objects were cleaned up. |

## To switch on in production (Phase 7 deploy checklist)
- `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET` from a webhook endpoint at `https://<domain>/api/webhooks/stripe` with events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created/updated/deleted/paused/resumed`, `invoice.paid`, `invoice.payment_failed`.
- `BILLING_WEBHOOK_KEY` (random) and its hash in Supabase (SQL in the deploy guide).
- Stripe → Settings → Billing → Customer portal: turn on (for Manage billing).
