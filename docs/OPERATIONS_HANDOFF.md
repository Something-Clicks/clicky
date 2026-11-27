# Operations handoff

Everything below is **not done by this repository** and needs the owner's go-ahead. Nothing in the development
build touches Supabase, Stripe, Resend, a model provider, Vercel or any production system.

## 1. Supabase

1. Create (or choose) the project. Apply `supabase/migrations/0001_schema.sql` **to a development/branch database first**.
   It creates the tenant tables and all Row Level Security policies. RLS behaviour is covered by `tests/rls.test.ts`,
   which runs the migration in a real Postgres engine (PGlite).
2. Auth: enable email + password, set the Site URL and add `https://<app-domain>/auth/callback` as a redirect URL.
   Turn on email confirmation (the app handles both confirmed and unconfirmed flows).
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only).
4. The Supabase adapter (`src/agent/store/supabase.ts`) is written against the same `Table` interface the tests exercise, but
   **has not been run against a live project** in this build. First task after the migration: run the Playwright journeys
   against a real dev Supabase project (`DEV_MODE` off) and fix anything the adapter surfaces.

## 2. Stripe: four products, configured by price id

The app never creates or edits Stripe objects. It reads price ids from the environment:

| Product | Environment variable(s) |
| --- | --- |
| Marketing Report ($49 one-time) | `STRIPE_PRICE_MARKETING_REPORT` |
| Marketing Assistant ($79/mo · $756/yr) | `STRIPE_PRICE_MARKETING_ASSISTANT_MONTHLY`, `STRIPE_PRICE_MARKETING_ASSISTANT_ANNUAL` |
| Marketing Studio ($179/mo · $1,716/yr) | `STRIPE_PRICE_MARKETING_STUDIO_MONTHLY`, `STRIPE_PRICE_MARKETING_STUDIO_ANNUAL` |
| Marketing Suite ($399/mo · $3,828/yr) | `STRIPE_PRICE_MARKETING_SUITE_MONTHLY`, `STRIPE_PRICE_MARKETING_SUITE_ANNUAL` |

Also `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. A plan's button on the Plan page is disabled ("Not available to purchase
yet") until its price id is configured, so nothing can be sold by accident.

* Webhook endpoint: `https://<app-domain>/api/stripe/webhook`. Events: `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
* Entitlements are derived from the **price id** on the subscription (not from product metadata), so upgrades/downgrades made
  in the Stripe customer portal take effect when the `subscription.updated` event arrives.
* Configure the Stripe **customer portal** to allow switching between the three subscription products and cancellation.
* Confirm each price's interval (monthly vs annual) matches the variable it is assigned to, and that test-mode and
  live-mode ids are not mixed.
* The existing Stripe product metadata (`sc_plan` = `marketing_plan` / `single_site` / `business_plus` / `multi_site`) uses
  older internal names. The app does not read it. Updating it is optional and only with your approval.

## 3. Model provider (not connected)

Set `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` for any OpenAI-compatible endpoint (hosted, or a self-hosted server later).
Until then the app answers "No AI model is connected" instead of producing output. Before enabling for customers:

* Run the evaluation tasks from the specification against the chosen model (`evals/` holds the harness placeholder; no real
  model has been evaluated: every test in this repo uses the labelled mock).
* Set per-run cost limits (`UsageMeter` in `src/server/container.ts`) from measured cost per preview and per saved output.

## 4. Email (Resend)

`RESEND_API_KEY` and `EMAIL_FROM` (verified sending domain). Today it is used only for the "email me a test copy" action,
which can only send to the authorizing user. No marketing or transactional-to-customers email is sent by the platform.

## 5. Background work and scheduled reviews

* Workflows run after the response (`after()`), are checkpointed, and can be resumed by `POST /api/jobs/run`
  (`{businessId}` recovers stale runs; `{businessId, executionId}` runs one) with `Authorization: Bearer $CRON_SECRET`.
* `vercel.json` registers a daily cron on `GET /api/jobs/run`, which queues the **regular website reviews** for active
  Assistant / Studio / Suite subscribers (a site is re-reviewed when its last review is 7+ days old; no drafts are used).
  Set `CRON_SECRET`. Trigger.dev can call the same endpoint later; it needs no code change.

## 6. Production switches (all default to the safe value)

* `ANONYMOUS_PREVIEW_ENABLED` stays `false` until the privacy policy is published.
* Never set `DEV_MODE`, `DEV_FIXTURE_SITES` or `LLM_PROVIDER=mock` in production (they are refused).

## 7. Decisions that need the owner

* **Suite allowances.** The business plan leaves website/location allowances "to be confirmed". The build uses
  5 websites and 25 locations for Marketing Suite and 1 website / 1 location for Report, Assistant and Studio (single constants in
  `src/server/billing/plans.ts`). Monthly drafts follow the plan's proposed 20 / 80 / 250.
* **Free-use features.** Free uses behave like the Assistant's drafting level without ongoing tracking.
* **Privacy policy, terms and cancellation terms** must exist before launch.
