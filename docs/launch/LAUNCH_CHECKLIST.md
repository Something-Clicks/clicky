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

## Status (Nov 24 2026)

| Check | Result |
|---|---|
| Lint, typecheck, build | pass |
| Unit tests | 106 / 106 |
| Database tests (local Postgres, all 8 migrations) | 98 / 98 |
| Public-page browser tests (iPhone profile 390px + desktop Chromium), axe | 50 / 50, 0 violations |
| **Signed-in journey on clicky-dev + Stripe TEST** (iPhone profile + desktop) | **32 / 32** (16 each) |
| Real iPhone WebKit | not run: the WebKit download is blocked in this sandbox |
| clicky-dev: all migrations applied in order, rollback → re-apply cycle | pass; all 52 function bodies match the repo files |
| Production Supabase | **untouched** (launch migration not applied) |
| Production Vercel variables | **values unchanged**; 7 Production rows intact. Six rows that used to be shared with every Preview branch were scoped to **Production only** (Option B, approved Nov 24); their values and Production targets are untouched |

### What the journey tests cover (real: Supabase Auth/REST/RLS, Stripe TEST, the app)
Anonymous first result (cached path, unreachable site, spam trap, minimum fill time) · Save this stores the email against the result · a link opened in a **different browser** claims the saved result for the same verified email · replay refused · wrong email refused · signed-out visitor sent to sign in · three free uses, then the database refuses the fourth · upgrade page offers only Marketing Plan and Single Site (Business Plus and Multi-Site under "Coming soon") · "What stopped you?" + follow-up permission stored apart from feedback · draft approval · checkout for Marketing Plan, Single Site monthly and yearly (real TEST sessions: price id, product, mode, org, metadata) · real Stripe subscription events grant access, replays are no-ops, forged events refused, wrong amount refused · "$756 billed yearly" · Marketing Plan allows exactly one paid check · onboarding saves business name, website and ZIP · admin funnel page for admins only (others get 404) · cross-customer isolation and anonymous access · axe and 390px layout on every signed-in screen.

### Stand-ins used (be aware)
- **Website scan:** this sandbox has no public internet, so results come from the real analyzer run over fixture HTML (`tests/e2e/fixtures/analysis.json`) and are saved through the real database functions. Real scanning was verified in earlier phases on production.
- **Sign-in:** test users were created in clicky-dev with a known password (`tests/e2e/dev-seed.sql`), so no email was sent. **Real email delivery and the `/auth/confirm` link have not been exercised on clicky-dev.**
- **Stripe webhooks:** Stripe cannot reach localhost, so Stripe's own stored events were re-sent to the local route, signed with the TEST endpoint's secret. Hosted Stripe Checkout was not completed in a browser (host unreachable); the sessions were verified through the Stripe API.
- **Drafts:** no Anthropic key, so draft text was saved through the real `complete_agent_run` function; wording used the template fallback. Real AI output is untested.
- **Deployed preview:** the preview URL sits behind Vercel login (and this sandbox cannot reach it), so tests ran locally against the same clicky-dev and Stripe TEST configuration the preview uses.

## P0 items
- [x] **P0.0 Foundation** — `c6da947`: launch migration + rollback, mode-aware catalog, docs.
- [x] **P0.1 Homepage and responsive design** — headline slot (`src/config/site.ts`, now "Know exactly what to fix next"), website + ZIP form, 390px-first. Browser-verified.
- [x] **P0.2 Website analysis and first result** — verified on clicky-dev (with fixture scan). Remaining: real scan of a live site, real AI wording, on the deployed preview.
- [~] **P0.3 Save this and signup** — claim, limits, three free uses verified in a real browser on real Supabase. **Remaining: real email delivery** (Supabase email settings: INTEGRATIONS S4, S5) and a click-through on a real phone. Fixed during testing: after a password login the address bar kept the one-time claim code; now a full page load.
- [x] **P0.4 Pricing and Stripe** — LIVE ids + TEST ids in `src/config/pricing.ts`; checkout and webhook verified in TEST mode. Remaining: customer portal not configured in Stripe test (not exercised); live go-live (runbook step 4).
- [x] **P0.5 Workspace and marketing work** — phone tab bar, home, free-use counter, draft approval, History copy cleaned (found and fixed "AI …" and raw labels by test).
- [x] **P0.6 Feedback and funnel** — verified: funnel counts for every step, feedback rows, follow-up email in its own table, admin page admin-only.
- [x] **P0.7 Consent and analytics** — verified: nothing loads before Yes.
- [x] **P0.8 Legal drafts** — `/privacy`, `/terms` labeled "Draft for attorney review".
- [~] **P0.9 Final testing** — see Status. Remaining: WebKit, real devices, real scan/email/AI.
- [~] **P0.10 Launch readiness** — see report; **not ready for customers yet** (see "Needs the owner").

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
- Review `supabase/migrations/20261124120000_launch_redesign.sql` and the rollback in `supabase/rollback/`.
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

## Needs the owner
- [ ] **Add two Preview secrets** (`STRIPE_SECRET_KEY` test, `SUPABASE_SECRET_KEY` clicky-dev) — see INTEGRATIONS.
- [ ] **Webhook testing without changing Vercel:** Deployment Protection stays on and no bypass secret is added. Use the local Stripe CLI procedure in INTEGRATIONS ("Webhook testing: local Stripe CLI", guarded by `scripts/stripe-local-webhook.sh`). Decide whether to disable the TEST webhook endpoints that point at production and at the preview (same section, warning).
- [ ] **clicky-dev Auth URLs and email settings** (the Supabase connector cannot change Auth settings) — INTEGRATIONS "clicky-dev Auth".
- [ ] Approve and apply the launch migration to production (runbook step 1).
- [ ] Attorney review of `/privacy` and `/terms`; fill the [bracketed] items.
- [ ] Anthropic and PageSpeed keys if you want real wording and drafts on Preview/Production.
- [ ] Business Plus / Multi-Site decision; Stripe customer portal activation (test and live).
- [ ] Revoke the Vercel token and remove the saved credentials from the Default environment's network secrets once you have read the report.

## Not ready
Real email delivery (Supabase email), the `/auth/confirm` link on real Supabase, real website scans on the deployed app, real AI drafts, Stripe's hosted checkout page and webhook delivery to the preview, customer portal, weekly worker, real iPhone/WebKit, attorney-approved legal pages, and everything in the go-live runbook.
