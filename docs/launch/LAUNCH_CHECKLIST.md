# Launch checklist

Working branch: `claude/ecstatic-curie-9shvjf` (Vercel makes **Preview** deployments only).
Built from: `claude/fervent-knuth-0fo94q` (the app, 21 commits; fast-forward, nothing rewritten).
Vercel production branch: `main` (confirmed in Vercel project settings). Nothing here was ever pushed to `main` or the app branch.
Commits: `c6da947` foundation · `1cef428` homepage, consent, legal · `489fa38` migration header · `ed7a445` Stripe TEST ids · later commits are listed in `git log`.

## How to resume
1. `git checkout claude/ecstatic-curie-9shvjf && pnpm install && service postgresql start`
2. Read "Status" and "Needs the owner" below.
3. Checks before every commit: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build`.
4. Journey tests (see "Journey tests") only ever run against **clicky-dev** (`ofstvbgaoznipsiqbjjp`), never production (`ysmwnxvyjougetdlpnba`).

## Item status (every item is in exactly one group)

"Real" means the actual service was exercised (real Supabase on clicky-dev, real Stripe TEST API). "Stand-in" items are listed in group 2 or 4, never in group 1.

### 1. Complete and verified (with real services, not fixtures)
- **Database on clicky-dev:** 8 migrations applied in order; rollback → re-apply cycle passed with in-transaction checks; all 52 function bodies match the repo; advisor has no errors. Real Supabase.
- **Auth with a password** on real Supabase Auth (sign-in, redirects, `/claim` hard navigation). Real.
- **Cross-browser claim rules on real Supabase:** a different browser claims for the same verified email; replay, wrong email and signed-out visitor are handled; the database refuses the fourth free use. Real database and Auth, with a saved result created through the real functions (the scan content itself was a fixture; see group 2).
- **Stripe TEST checkout configuration:** Marketing Plan, Single Site monthly and yearly create real TEST Checkout Sessions with the right price id, product, mode, business id and metadata. Real Stripe API.
- **Entitlements from real Stripe objects:** real TEST subscriptions and their stored events grant Single Site; replay is a no-op; forged and wrong-amount events are refused; "$756 billed yearly" displays. Real Stripe objects and real database; the delivery path was a stand-in (group 2).
- **Customer isolation, admin-only funnel page, feedback and funnel counts** on real Supabase.
- **Environment separation:** the six formerly shared Vercel variables are Production-only; this branch resolves to clicky-dev (Vercel's own resolver, before and after a redeploy). Production Vercel values unchanged. Real Vercel API.
- **Consent and analytics gating** (nothing loads before Yes) in a real browser; **public pages**: 50/50 at 390px (iPhone profile) and desktop, axe 0 violations.
- **Local checks:** lint, types, build; 143 unit tests; 98 database tests (local Postgres).

### 2. Complete but awaiting my verification (stand-ins used, or needs a real device or real email)
- **Plain-words scan failure messages** (bot-blocked, not found, down, bad address, redirect loop, too big, timeout): fixed and unit-tested with injected errors; **not yet seen against real sites**.
- **First result with a real site:** only fixture HTML scanned so far (the sandbox has no public internet). Needs the real scan (group 4: hosts and sites).
- **Save this email → link → claim:** database and routes verified; **the real email was never sent or opened**, so `/auth/confirm` with a real Supabase link and the email templates are unverified.
- **Webhook delivery:** Stripe's real events were re-sent to a local route (stand-in). Real delivery needs your local Stripe CLI run (INTEGRATIONS, "Webhook testing: local Stripe CLI").
- **Drafts and model wording:** output handling is unit-tested with a stub client. **No real model call has been made**: no Anthropic key reached this environment.
- **Model-output safeguards added this round** (shared leak/jargon guard, plain draft errors, every template fallback logged with its reason, "AI-worded" only when every card has the model's words; also fixed a filter that let "40%" and "#1" through). Unit-tested only.
- **Real iPhone / Safari / WebKit** (the 10-step checklist below is yours to run; WebKit could not be installed here).
- **Resend** sending and the weekly worker: not run.
- **Stripe hosted checkout page, customer portal use** (plan change, cancel): not run.
- **Deployed preview:** never browsed or exercised end to end (login wall; host not reachable from the sandbox).

### 3. Still requiring code
- Nothing known right now. Changes will be needed only if the real scan, real model output, real email or the real checkout and portal runs reveal defects.
- Business Plus and Multi-Site stay "Coming soon" (they need product features: automated actions; several websites under one plan).

### 4. Still requiring external configuration
See "Needs from me" in the latest report and INTEGRATIONS. Open items, with the exact thing needed:
- **Network and credentials do not match your description.** The live environment shows only `ofstvbgaoznipsiqbjjp.supabase.co` allowed, and only the Stripe and Vercel credentials. Missing here: Anthropic, PageSpeed and Resend credentials; hosts `api.resend.com`, `checkout.stripe.com`, `billing.stripe.com`, `cdn.playwright.dev`, the preview host, and the scan sites. The tool accepts exact host names (no wildcards): the preview needs `something-clicks-git-claude-94123f-matt-hills-projects-54d303a1.vercel.app`.
- **Scan sites** (3–4 real public sites incl. slow, redirecting, JavaScript-heavy, bot-blocking, invalid) and a **test email address you control**.
- **Resend sending domain** name and its verified status.
- **Stripe TEST customer portal:** Stripe's API shows **0 portal configurations** in this TEST account, so it is not activated here (check the account and mode).
- **Preview secrets** `STRIPE_SECRET_KEY` (test) and `SUPABASE_SECRET_KEY` on this branch, plus `ANTHROPIC_API_KEY`, `PAGESPEED_API_KEY`, and Resend values if previews should use them.
- **Your local Stripe CLI run** and, at that step only, the local-key hash swap (Vercel Preview values must be updated to match).
- **Stripe TEST webhook endpoints:** decision pending (see below); no change made.
- **Dashboard confirmation:** delivery attempts for the 24 failed production events (Stripe Dashboard → Developers → Webhooks → endpoint → Event deliveries).

### 5. Requires my explicit production approval
- Applying `20261124120000_launch_redesign.sql` to production, then the Production variables, merge and deploy, live Stripe, and the free first result flag (go-live runbook below).
- Fast-forwarding `main` (decided: not now).
- Setting `EMAIL_FROM` on Production (decided: stays unset).
- Attorney approval of `/privacy` and `/terms` before they are final.
- Changing, disabling or deleting any Stripe webhook endpoint (inventory below).

### Stripe TEST webhook inventory (read-only, Nov 24; no endpoint was changed)
| Endpoint | Points to | Events | Assessment |
|---|---|---|---|
| `we_1UTXVOFnFMCbDhHEJUw9R9kt` (Oct 23) "Adds buyer credits when payments succeed; removes them on refunds." | Production | `charge.refunded`, 4 × `checkout.session.*` | Looks like another project's endpoint, created before this app; overlaps on two checkout events. Probably obsolete. |
| `we_1UdMKLFnFMCbDhHEe4L3M6V7` "Something Clicks (Vercel production, test mode)" (Nov 19) | Production | the 9 handled events | Production's current TEST endpoint (its secret is production's `STRIPE_WEBHOOK_SECRET`). Delivered the 24 events. |
| `we_1Uf9ApFnFMCbDhHEbQoz3sYP` "launch preview" (Nov 24) | Preview alias | the 9 handled events | Cannot receive events while Deployment Protection is on (Vercel login page, non-2xx). Not needed now that webhook tests use the local CLI. |

### The 24 failed production events (Nov 24 02:25:17–02:33:05 UTC; all TEST)
8 × `customer.subscription.created`, 8 × `invoice.paid`, 8 × `customer.subscription.deleted`; only endpoints 2 and 3 subscribe to those types, so endpoint 2 delivered them (inferred from subscriptions). Each is one `failed` row ("Stripe is not configured"); 22 handled once, 2 show a second processing about 17 s later. Stripe reports `pending_webhooks: 2` on all 24: none has been delivered successfully on either subscribed endpoint. Attempt timestamps, HTTP codes and whether retries are exhausted are not available through Stripe's API (Dashboard only). No customer billing impact: production has no businesses or subscriptions. All rows preserved.


## Production state (investigated Nov 24, read-only; nothing changed)
- **What is live:** deployment `dpl_ph62pF1pwkzicecUCHdEz79UFHcT`, a Vercel **redeploy** created Nov 24 01:34 UTC by Vercel user `hiyamattie-3986` (the account owner). It redeployed the original production deployment `dpl_9x3WmjWztUq7y1FpCTte71P3hnWu` (Nov 19 03:56 UTC, same user, not a git push). Both were built from branch `claude/fervent-knuth-0fo94q` at `063cca4`. `RESEND_API_KEY` was added to Production at 01:33 UTC, one minute before the redeploy.
- **`main`:** still the single "Initial commit" `9b14f91` (`README.md`, `.gitignore`). `063cca4` is 19 commits ahead of it (146 files added, 2 modified, ~15,260 lines). Production is **not** running `main`.
- **Intended for Preview only?** No. `063cca4` is the finished Phase 7 app that docs/LAUNCH.md says was deployed to production from the branch on purpose. None of the launch-redesign features exist in it (no free first result, claim flow, `FREE_PREVIEW_ENABLED`, new pricing): it still shows Diagnostic Audit $39, Starter AI $49, Growth AI $149, Scale & Automation $399.
- **Database match:** production Supabase has exactly the 7 migrations that `063cca4` expects and none of the launch objects; 0 users, businesses and subscriptions. No mismatch today. **The mismatch risk is in the future:** merging this branch into `main` (which auto-deploys Production) would ship code that calls launch-migration functions, so the migration must be applied first (go-live runbook step 1).
- **Production variables the code reads but are not set:** `STRIPE_SECRET_KEY` (checkout says "isn't switched on yet"), `ANTHROPIC_API_KEY` (template wording, drafts off), `PAGESPEED_API_KEY`, `SUPABASE_SECRET_KEY` (the daily cron answers 503 "Worker not configured"), `EMAIL_FROM` (with it unset, `RESEND_API_KEY` alone sends nothing), `EMAIL_REPLY_TO`, `STRIPE_ALLOW_LIVE`.
- **Production webhook log:** `integration_events` holds 32 rows. 8 are from the Nov 19 verification (3 processed, 5 failed). **24 failed rows were recorded Nov 24 02:25–02:33 UTC, caused by the journey tests**: the TEST Stripe account has two endpoints that point at production, so Stripe delivered my test subscriptions' events there. They failed safely (`Stripe is not configured`; no such businesses exist in production; nothing granted) but they are production rows that testing caused, and Stripe may keep retrying for up to three days.
- **Risks:** a push or merge to `main` deploys to Production; the production-branch setting and what is live disagree; the old TEST endpoints keep sending test events to production.
- **Recommendation (no action taken):** leave Production as is (no rollback needed); disable the two production-pointing TEST webhook endpoints in Stripe; set `EMAIL_FROM`; before any merge, get approval to apply the launch migration to production, set the Production variables, then merge. Optionally make `main` match what is live first (a fast-forward of `main` to `063cca4`), which triggers a production build of identical code and needs your approval.

## Preview environment (branch `claude/ecstatic-curie-9shvjf`, target Preview only)
Branch-scoped Preview variables for this branch point at clicky-dev and Stripe TEST. Since Nov 24 the six formerly shared variables are **Production-only**, so other branches' previews no longer inherit production values (verified with Vercel's resolver: another branch resolves none of them). Preview URL: `https://something-clicks-git-claude-94123f-matt-hills-projects-54d303a1.vercel.app` (read from Vercel).

| Variable | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | clicky-dev URL (given) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clicky-dev publishable key (given) |
| `NEXT_PUBLIC_SITE_URL` | the branch's preview domain (read from Vercel) |
| `FREE_PREVIEW_ENABLED` = `true` | requested, Preview only |
| `SITE_SERVER_KEY` (sensitive) | generated; only its hash is in clicky-dev |
| `BILLING_WEBHOOK_KEY` (sensitive) | generated new for dev; only its hash is in clicky-dev |
| `STRIPE_WEBHOOK_SECRET` (sensitive) | signing secret of TEST endpoint `we_1Uf9ApFnFMCbDhHEbQoz3sYP` (preview URL) |

**Not added (needs you; I never see secret values):** `STRIPE_SECRET_KEY` (test) and `SUPABASE_SECRET_KEY` (clicky-dev) — see INTEGRATIONS "Preview: two values only you can add". Not added on purpose: GA4, Clarity, Resend, cron, Anthropic, PageSpeed, any live Stripe value. This branch no longer has a `CRON_SECRET` (it only existed as a shared Production row).

## Journey tests (clicky-dev + Stripe TEST)
1. clicky-dev has all migrations. Seed users: SQL editor, `set app.allow_e2e_seed = 'on';` then run `tests/e2e/dev-seed.sql`. Reset between runs: same guard, `tests/e2e/dev-reset.sql`. The 12 e2e accounts are **disabled** after each session (known throwaway password, one is an admin): re-enable with `update auth.users set banned_until = null where email like '%@e2e.test';` and disable again afterwards. Keep the GitHub repository private.
2. Insert the dev server-key hashes (INTEGRATIONS S2 pattern for `site_server` and `billing_webhook`).
3. Build with the clicky-dev `NEXT_PUBLIC_*` values and `NEXT_PUBLIC_SITE_URL=http://localhost:3100`; start `pnpm exec next start -p 3100` with `SITE_SERVER_KEY`, `BILLING_WEBHOOK_KEY`, `STRIPE_WEBHOOK_SECRET`, `FREE_PREVIEW_ENABLED=true`, `STRIPE_SECRET_KEY=<test key>` (in the cloud sandbox: `proxy-injected` and `NODE_USE_ENV_PROXY=1`).
4. `E2E_FULL=1 E2E_SUPABASE_URL=… E2E_SUPABASE_KEY=<publishable> SITE_SERVER_KEY=… STRIPE_WEBHOOK_SECRET=… pnpm exec playwright test tests/e2e/journey.spec.ts --trace off` (add `--project=iphone-chromium` or `desktop-chromium`). Public pages: `pnpm e2e` against a server with `FREE_PREVIEW_ENABLED` unset.
5. Stripe TEST ids live in `STRIPE_CATALOG.test`; the tests read them from there.

## Go-live runbook (nothing below has been executed)
Do these in order. Stop if any check fails.

**1. Approve the production migration**
- Also `supabase/migrations/20261126120000_marketing_workflow.sql` (clicky-dev, Nov 24: applied → in-transaction checks → rolled back (42 cards kept, statuses unchanged) → re-applied; function fingerprints equal the repo; advisor: no errors) (marketing agent foundation, after the two below). The app tolerates it missing (website checks still run; workflow records and the Approve button do not), but apply it before merging.
- Review `supabase/migrations/20261124120000_launch_redesign.sql` **and then** `supabase/migrations/20261125120000_funnel_events_and_local_keys.sql` (adds five funnel steps and optional `*_local` server keys; production has none), and their rollbacks in `supabase/rollback/`. Apply in that order. Both were applied, rolled back and re-applied on clicky-dev with in-transaction checks.
- Tell Claude "apply the launch migration to production". It will confirm the target ref is `ysmwnxvyjougetdlpnba`, apply, then verify tables/functions and run the security advisor.
- Store the server-key hash in production (INTEGRATIONS S2) with a **new** production `SITE_SERVER_KEY` (not the dev one).

**2. Add Production variables** (Vercel → Settings → Environment Variables, Production only; names only here)
`SITE_SERVER_KEY` (new) · `STRIPE_SECRET_KEY` (test key first) · `SUPABASE_SECRET_KEY` · `ANTHROPIC_API_KEY` · `PAGESPEED_API_KEY` · `EMAIL_FROM` (+ optional `EMAIL_REPLY_TO`) · `NEXT_PUBLIC_GA_MEASUREMENT_ID` · `NEXT_PUBLIC_CLARITY_PROJECT_ID`. Already set: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `BILLING_WEBHOOK_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `STRIPE_WEBHOOK_SECRET`. **Do not** set `FREE_PREVIEW_ENABLED` or `STRIPE_ALLOW_LIVE` yet.
Production Supabase dashboard: URL configuration, email templates, Resend SMTP, leaked-password protection, Pro plan (INTEGRATIONS S3–S6, S8). Resend domain DNS verified.

**3. Merge and deploy**
- Open a pull request from `claude/ecstatic-curie-9shvjf` to `main`, review, merge (you do this; Claude never merges).
- Vercel builds production from `main`. Check the deployment is Ready and `https://somethingclicks.com` loads.

**4. Switch Stripe to live (live IDs)**
- Stripe live mode: create the webhook endpoint `https://somethingclicks.com/api/webhooks/stripe` with the 9 events (INTEGRATIONS), activate the customer portal.
- Vercel Production: replace `STRIPE_SECRET_KEY` with the live key, `STRIPE_WEBHOOK_SECRET` with the live endpoint's secret, add `STRIPE_ALLOW_LIVE=true`; redeploy. The app then uses the LIVE ids in `STRIPE_CATALOG.live` automatically.
- Publish the attorney-approved Privacy Policy and Terms (remove the draft banner), then set `FREE_PREVIEW_ENABLED=true` and redeploy.

**5. Smoke tests**
Homepage; free result for a real site; Save this → email link (try a different browser); three free uses → upgrade; one real purchase of the cheapest plan with a real card, then refund it in Stripe; billing page + portal; admin page; funnel counts rising; cancel the test subscription.

## 10-step real-iPhone checklist (Safari, against the preview URL)
Prereqs: add `STRIPE_SECRET_KEY` and `SUPABASE_SECRET_KEY` to Preview (INTEGRATIONS), set clicky-dev Auth URLs, and use an email that is a member of your Supabase team (clicky-dev uses Supabase's built-in mailer, which only emails team members).
1. Open the preview URL in Safari (sign in to Vercel when asked). The page fits, no sideways scroll, the headline reads "Know exactly what to fix next".
2. Type a real website and ZIP, tap **Check my website**. A loading screen with Clicky appears.
3. Within about a minute you see results. Tap **What to do and why** on a card; evidence says Observed, Measured or Missing.
4. Tap 👍, type a few words, tap **Send**.
5. Tap **Save this**, enter your team email, tap **Email me a link**.
6. Open Mail, tap the link (let it open wherever iOS opens it). You land on your home screen with "Your results are saved" and "2 free uses left".
7. Tap **Check again** and request a draft; approve it under **Drafts**.
8. Use the last free use; the home pill turns "Free uses used up". Tap it: the plans show Marketing Plan and Single Site only; Business Plus and Multi-Site are under "Coming soon".
9. Tap **Choose monthly**, pay with test card 4242 4242 4242 4242 (any future date, any CVC). Back on **Plan and payments** it says Single Site, Active (needs the webhook bypass, INTEGRATIONS).
10. Tap **Manage billing** (portal opens), return, sign out, sign back in with the emailed link. Check every screen once in portrait and landscape; the bottom tab bar stays reachable.

## Database validation (read-only on production, applied on clicky-dev)
- Production: constraint name, `auth.users` columns, roles, pgcrypto, no name collisions; the 3 functions the migration replaces are byte-identical to the repo, so the rollback restores them exactly.
- clicky-dev: migrations applied in order (8 files), rollback asserted gone, re-applied; fingerprints equal the repo's; security advisor: no errors (INFO: tables with RLS and deliberately no policies; WARN: public functions that run as the database owner, each checking the caller or a server key).

## Product promises (Stripe descriptions vs. the app)
| Product | Stripe description | Supported today? | Shown to customers |
|---|---|---|---|
| Marketing Plan | See what needs work and get a clear plan for your marketing. | Yes | Yes |
| Single Site | Get marketing recommendations and ready-to-use content for your business. | Yes (recommendations, four kinds of drafts, approval, weekly re-check) | Yes |
| Business Plus | …more marketing insights, content and automated actions… | **No.** Nothing is automated; nothing beyond Single Site is added | "Coming soon" |
| Multi-Site | Manage marketing across multiple websites or business locations. | **No.** One subscription covers one business | "Coming soon" |

To offer Business Plus: build something it adds (recurring drafts, or a verified publishing integration) or change its Stripe description. To offer Multi-Site: one subscription must cover several businesses (entitlements by subscription owner, a business switcher, per-site limits).

## Entitlements (old → new)
| Old plan | New plan | Checks | Weekly re-check | Drafts |
|---|---|---|---|---|
| Diagnostic Audit ($39, one check) | Marketing Plan ($49, one check) | 1 | — | — |
| Starter AI (title drafts only) | Single Site | ✓ | ✓ | all four kinds |
| Growth AI | Business Plus (hidden) | ✓ | ✓ | all |
| Scale & Automation | Multi-Site (hidden) | ✓ | ✓ | all |
Old plan rows stay in the database (production has 0 customers). No monthly draft quota is invented; the existing 20 drafts/day safety cap remains.


## Resume notes
- Keep pushing only to `claude/ecstatic-curie-9shvjf`. Re-enable the 12 e2e accounts only for a test run and disable them again immediately (see Journey tests).
