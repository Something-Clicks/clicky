# Production release: new site and model-free Marketing Agent screens (runbook)

Written Nov 28 2026. Model stays OFF in Production. Nothing in this file has been run against Production yet.

## What is live today, and what changes
- Live site: the old product ("Make the complicated click", "$39 audit"), deployed **by hand from `claude/fervent-knuth-0fo94q`** (never push there).
- Production database `ysmwnxvyjougetdlpnba`: 7 migrations, **no customers** (0 users, 0 businesses, 0 purchases), 32 payment-webhook events, 4 plan rows.
  Read-only snapshot taken Nov 28 (20 tables, 37 functions, RLS on everywhere).
- `main` holds no app code. The new app is on `claude/marketing-agent-finish`.
- New: homepage and pricing (Marketing Report $49 is the only purchasable plan), free website check, Business details, Compare, Campaigns, Ask,
  Results, Research library, rules-based Plan, approvals, execution records. Released in Production by `src/config/features.ts` (no variable needed;
  `FEATURE_<NAME>=0` is a kill switch). Not in Production: drafts, model findings, any model, competitor discovery (waits for the Privacy Policy wording).

## Proven before touching Production (local copy at Production's exact state)
- All **13** migrations (`20261124120000` to `20261206120000`) apply cleanly in order: 20 tables become 37, RLS on for every table, the model-storing
  functions stay switched off (`agent_functions_enabled` = 0). Each has a rollback file in `supabase/rollback/`.
- The four named in an earlier note (`20261203`-`20261206`) **cannot** be applied alone: they fail with `relation "public.draft_versions" does not exist`.
- No migration deletes or rewrites existing Production data (they add a flag to plan rows, delete expired rows from a new table, and replace one
  internal function in the same migration).
- Browser suite with a Production-mode server and no `FEATURE_*` variables, desktop and phone: 112 passed, 0 failed.

## Order of operations (do not reorder: the new database and the new code ship together)
1. **Owner: Production secrets (never paste secrets in chat).** Generate two keys, put each in Vercel Production, and send me ONLY the SHA-256 hash:
   ```bash
   K=$(openssl rand -hex 32); echo "$K"            # paste into Vercel as MODEL_USAGE_KEY (Production)
   printf %s "$K" | sha256sum                       # send me this hash only
   K=$(openssl rand -hex 32); echo "$K"            # paste into Vercel as SITE_SERVER_KEY (Production)
   printf %s "$K" | sha256sum                       # send me this hash only
   ```
   `MODEL_USAGE_KEY` is needed even with no model: the fixed-rules Plan and the one-at-a-time slots use it, or the Plan screen says "Plans aren't switched on yet".
2. **Claude: apply the 13 migrations to Production in order** (after the owner says go for exactly those 13), then insert the two hashes into
   `app_private.secrets` as `model_usage` and `site_server`, and verify (tables, RLS, functions, `agent_functions_enabled` = 0, advisors).
3. **Owner: Vercel Production environment** (Settings, Environment Variables, Production). Must exist:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SITE_URL` | `https://somethingclicks.com` |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the **Production** project ("Clicky"), not clicky-dev |
   | `SUPABASE_SECRET_KEY` | Production secret key (weekly re-check worker) |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `MODEL_USAGE_KEY`, `SITE_SERVER_KEY` | from step 1 |
   | `BILLING_WEBHOOK_KEY` | already set (its hash is already in the database) |
   | `STRIPE_SECRET_KEY` (`sk_live_…`), `STRIPE_WEBHOOK_SECRET`, `STRIPE_ALLOW_LIVE=true` | live mode, only if you are taking real payment now |
   | `PAGESPEED_API_KEY` | recommended (Google's shared quota is often exhausted) |
   | `RESEND_API_KEY` | optional; `EMAIL_FROM` stays unset per the launch notes |
   | `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `CLARITY_ID` | optional; load only after consent |

   Must NOT be set in Production: `MARKETING_MODEL_PROVIDER`, `GROQ_*`, `FEATURE_DRAFTS`, `FEATURE_MODEL_FINDINGS`, `FREE_PREVIEW_ENABLED`
   (leave unset until the Privacy Policy is published), `DISCOVERY_IN_PRODUCTION`.
4. **Owner: Stripe live mode (Dashboard, live toggle on).** Confirm the one price that can be bought exists and is active:
   product `prod_Vg9MOCNzSD7QlV`, price `price_1Uen3OFnFMCbDhHEw36S1zXr`, **$49.00 USD one-time**. (The $79/$179/$399 plans cannot be bought in the app.)
   Confirm a live webhook endpoint `https://somethingclicks.com/api/stripe/webhook` exists and its signing secret equals `STRIPE_WEBHOOK_SECRET`.
   I can only reach Stripe test mode, so I cannot verify any of this.
5. **Owner: Vercel Production Branch.** Two ways, and I cannot see which applies:
   - **A (your choice):** Settings, Git, Production Branch = `claude/marketing-agent-finish`. Note `INTEGRATIONS.md` says the branch is `main` and "do not
     change it"; if you change it, change it back or merge to `main` later so a later merge does not surprise you.
   - **B (the documented flow):** merge the app into `main` (a fast-forward from this branch); production builds then come from `main` automatically.
   Do **not** use "Promote to Production" on a Preview build: it keeps the Preview's database and Stripe TEST settings.
   Changing the setting does not deploy by itself; push or Redeploy after steps 2 to 4 are done.
6. **Claude: deploy and verify.** Push once, watch the Production build, then check the live site: homepage text, pricing page, sign-up and login, free
   website check, a signed-in walk-through (Business details, Compare, Campaigns, Ask, Results, Plan), the checkout page opens for the $49 report
   (no purchase), `/admin/agent-review` is 404, no model calls, Vercel logs clean.
7. **Rollback if anything fails.** Vercel: Deployments, previous (old-site) deployment, Instant Rollback (seconds, no data involved). Database: run the
   rollback files in reverse order, `20261206120000` down to `20261124120000` (`supabase/rollback/`); the database holds no customer data yet so this is safe
   until the first sign-up. After the first customer, a rollback needs a decision, not a script.

## After the release
Policy wording for the model: `docs/launch/MODEL_POLICY_DRAFT.md` (also lists what needs filling even without the model: the legal pages still contain
`[privacy contact email]`, `[mailing address]`, `[decide a retention period]` and an `[Attorney: …]` note). Turning the model on later is a separate
code change (Production refuses any model today) plus the policy approval, ideally behind a switch for a few testers first.
