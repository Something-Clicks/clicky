# Status: what works, what is blocked, what needs your approval

Development product, verified on the development environment only. **Nothing is deployed, no production migration was run,
no Stripe product or price was created or changed, no model hosting was bought.**

## What was verified, and how

| Check | Result |
| --- | --- |
| Type check (`npm run typecheck`) | clean |
| Unit + integration (`npm test`, Vitest) | **137 tests, 10 files, all pass** |
| Row Level Security, run in a real Postgres engine (PGlite) | 6 tests pass: tenant read isolation, **no client writes**, previews/Stripe events unreadable by clients, audit owner/admin-only |
| Browser, real Chromium, real running app (`npm run e2e`, Playwright) | **30 tests pass**: 3 customer journeys + desktop *and* mobile (390px) sweeps |
| Accessibility (axe, WCAG 2.0/2.1 A+AA, serious/critical) | no violations on all 16 signed-in pages (incl. Suite pages with data) and 4 public pages, mobile + desktop |
| No horizontal scroll | verified on every page above at 390px and 1280px |
| Lighthouse, production build, public pages (`/`, `/pricing`, `/login`, `/signup`), mobile + desktop | performance **100**, accessibility **98-100**, best-practices **100**, SEO **100** |
| Lighthouse, signed-in pages (dev server; performance not enforced there) | see "Lighthouse (signed-in)" below |
| Production build (`next build`) | succeeds, 30 routes |

The browser journeys go through the real UI, real server actions, the real Stripe webhook route (genuinely signed test events),
and the real in-process data layer. Bugs the browser found and that are fixed (each with a regression test): bare-domain
websites crashed repeat runs ("Invalid URL"); saving the profile form silently confirmed AI assumptions; existing cards blocked
draft preparation; a run counted its own in-flight reservation against the free allowance; keyword "no page targets X" overstated
body-text-only matches; the campaign list showed stale progress.

## The four products (one central agent, plans unlock capabilities)

Plan limits are enforced **server-side inside the services** (not just hidden in the UI) and verified per plan in
`tests/plans-features.test.ts` and in the browser (`e2e/journey3.spec.ts`).

| | Works today | Locked (verified refused) |
| --- | --- | --- |
| **Marketing Report** ($49) | one website review: findings with evidence, priorities, next steps | drafts, research, plans, campaigns, results, insights, progress, sites, brand |
| **Marketing Assistant** ($79/$756) | + scheduled reviews that auto-resolve fixed issues, 8 basic draft types (20/mo), approval + action tracking, progress page, results upload/report | advanced content, research, insights, plan, campaigns, extra sites/brand |
| **Marketing Studio** ($179/$1,716) | + competitor/keyword/market research, insights page, advanced content (13 more draft types), marketing plan, campaign planning with enforced dependencies (80 drafts/mo) | extra sites/locations/brand |
| **Marketing Suite** ($399/$3,828) | + up to 5 websites and 25 locations (each site has its own findings, drafts, plan, results), shared brand + per-site overrides, brand-consistency checks that become Action Cards (250 drafts/mo) | n/a |

Free use: 3 uses (1 anonymous preview + 2). Verified: failed / refused / needs-input runs never count; a run never counts
against itself; parallel runs cannot overshoot; saved work stays readable after cancellation or downgrade (extra sites become
read-only).

## What is NOT working or NOT verified (be precise)

1. **No real AI model has ever been connected or tested.** Every test, journey and eval uses the deterministic mock, which derives
   its answers from the retrieved site text and is labelled "Demo mode" everywhere. The quality of real model output (analysis,
   copy, strategy) is **unmeasured**. The code paths that validate and constrain model output (schema validation, retries,
   evidence grounding, claim guard, brand-term enforcement) are tested with scripted providers, but a real model may behave
   differently. `npm run eval` exists to measure this once a model is connected; it reports plumbing only against the mock.
2. **Supabase has not been used.** The schema/RLS are verified in PGlite; the Supabase adapter and Supabase Auth (signup, email
   confirmation, `/auth/callback`) are written but have **not run against a real project**. Browser journeys use the in-memory
   store and a development-only cookie login.
3. **Stripe checkout and the customer portal have not been exercised against Stripe.** The webhook (signature, idempotency,
   four-product price mapping, upgrades, cancellation) is tested with genuinely signed events; creating a Checkout session and
   opening the portal call Stripe and were not run (no keys). Price ids are configuration only.
4. **No external publishing or sending exists.** The agent can save, export and record work; "publish to website", "send email
   campaign" and "schedule social" are **not implemented** and are refused with a clear message. "Record that I published it"
   is customer-attested and never reported as verified. Spend, billing, account and contract actions are permanently refused.
   The test-email action (Resend) is implemented but was only tested with a fake sender.
5. **Scheduled reviews run only if a scheduler calls `/api/jobs/run`.** The runner, the 7-day logic and `vercel.json` cron are
   built and tested; nothing is scheduled until deployed with `CRON_SECRET`.
6. **Website analysis limits (stated to customers):** reads initial HTML only; mobile rendering, Core Web Vitals, broken links and
   JavaScript-rendered content are not tested. Competitor research covers only competitors the customer supplies. Keyword/search
   figures exist only if the customer uploads an export; no Semrush API integration.
7. **Not built:** invitations/team management UI (roles are enforced but members must be added in the database), data export /
   account deletion, rate limiting that works across multiple server instances (in-memory), cost monitoring dashboards, an
   evaluation dataset of real customer websites.
8. **Lighthouse for signed-in pages** cannot run on the production build because the production build correctly refuses the
   development-only login; those pages were audited on the dev server (performance is meaningless there and not enforced).

## Needs your approval / decision

* **Marketing Suite allowances (5 websites, 25 locations)** and the 1 site / 1 location limit for the other plans: the business
  plan says "to be confirmed". Constants in `src/server/billing/plans.ts`. Do not sell Suite until you confirm.
* Whether the **free uses** should include basic drafts (they currently do, without ongoing tracking).
* **Stripe**: which account/mode (test or live) the ids belong to; the portal must allow switching between the three subscription
  products; optionally updating the product metadata (`sc_plan`) to the current plan names (not read by the app).
* Applying the migration to a Supabase **development** project, connecting a model provider, and any deployment.
* Privacy policy, terms and cancellation terms before `ANONYMOUS_PREVIEW_ENABLED` is turned on.

See [OPERATIONS_HANDOFF.md](OPERATIONS_HANDOFF.md) for the exact steps.

## Next tasks, in order

1. Apply `supabase/migrations/0001_schema.sql` to a dev Supabase project; run the Playwright journeys with `DEV_MODE` off against it.
2. Connect a model (`LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY`) in dev; run `npm run eval` and review outputs by hand; tune prompts.
3. Stripe test mode: set the seven price env vars, run a real Checkout and portal plan change end to end.
4. Team invitations UI, data export/deletion, shared rate limiting.
