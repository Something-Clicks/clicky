# Integrations and external setup

Everything here is done by the owner in each dashboard. Nothing in this file has been changed by Claude.
"Public" means the value is sent to browsers (`NEXT_PUBLIC_*`); everything else stays on the server.

## Environment variables (exact names read by the code)

Set in **Vercel → Project `something-clicks` → Settings → Environment Variables**, then **Redeploy**.
`NEXT_PUBLIC_*` values are built into the pages, so a redeploy is required after changing them.

| Variable | Purpose | Public/secret | Where to get it | Environments | Mode | How to test |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Links in emails and redirects | public | `https://somethingclicks.com` | Production (Preview: the preview URL or leave empty) | — | Sign-in link opens the site |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API | public | Supabase → Project Settings → API | Production, Preview | — | Log in works |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase public key (RLS limits it) | public | Supabase → Project Settings → API Keys → Publishable | Production, Preview | — | Log in works |
| `SUPABASE_SECRET_KEY` | Weekly re-check worker only | **secret** | Supabase → Project Settings → API Keys → Secret | Production | — | Vercel → Logs: `worker.*` lines, no "not configured" |
| `CRON_SECRET` | Protects the cron endpoint | **secret** | `openssl rand -hex 32` | Production | — | Vercel → Cron Jobs → run now → 200 |
| `SITE_SERVER_KEY` | **New.** Authorizes the `site_*` database functions (free first result, feedback, funnel counts) | **secret** | `openssl rand -hex 32`; store its hash in Supabase (step S2) | Production, Preview | — | Admin → Funnel shows "Homepage visits" rising |
| `FREE_PREVIEW_ENABLED` | **New.** `true` turns on the free first result without an account | server | — | Production: leave **unset** until the Privacy Policy is published | — | Homepage form opens results instead of sign-up |
| `ANTHROPIC_API_KEY` | Plain-language wording and drafts | **secret** | console.anthropic.com → API Keys (set a monthly spend limit) | Production | — | A draft can be prepared |
| `PAGESPEED_API_KEY` | Google mobile speed test quota | **secret** | Google Cloud → APIs → PageSpeed Insights API → Credentials | Production | — | Results show "Measured" mobile speed |
| `RESEND_API_KEY` | Notification emails | **secret** | Resend → API Keys | Production | — | Settings notification sends an email |
| `EMAIL_FROM` | Sender for notifications | server | e.g. `Something Clicks <hello@somethingclicks.com>` (verified domain) | Production | — | as above |
| `EMAIL_REPLY_TO` | Optional reply-to | server | your inbox | Production | — | — |
| `STRIPE_SECRET_KEY` | Checkout, portal, re-reading subscriptions | **secret** | Stripe → Developers → API keys (`sk_test_…` or `sk_live_…`) | Production | TEST or LIVE — the key decides which catalog ids are used | Upgrade → "Choose monthly" opens Stripe Checkout |
| `STRIPE_WEBHOOK_SECRET` | Verifies webhook signatures | **secret** | Stripe → Developers → Webhooks → endpoint → Signing secret | Production | must match the key's mode | Stripe → endpoint → "Send test event" → 200/ignored |
| `STRIPE_ALLOW_LIVE` | Must be `true` for live keys/events to be accepted | server | — | Production, only after go-live approval | LIVE only | Without it, live keys are refused |
| `BILLING_WEBHOOK_KEY` | Authorizes the webhook's `billing_*` database functions | **secret** | already set (hash in Supabase) | Production | — | Paid test checkout grants access |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | **New.** Google Analytics 4 (loads only after consent) | public | GA4 → Admin → Data streams → Web → Measurement ID (`G-…`) | Production | — | Accept the banner → GA4 Realtime shows you |
| `NEXT_PUBLIC_CLARITY_PROJECT_ID` | **New.** Microsoft Clarity (loads only after consent) | public | clarity.microsoft.com → project → Settings → Overview → Project ID | Production | — | Accept the banner → Clarity live view |

Product and price ids are **not** environment variables: they live in `src/config/pricing.ts`, per mode.

## Supabase (project "Clicky")

**S1. Apply the launch migration** — only after you approve it. Claude will apply
`supabase/migrations/20261124120000_launch_redesign.sql` with the Supabase connector once you say so
(rollback: `supabase/rollback/20261124120000_launch_redesign_down.sql`).

**S2. Store the server key's hash.** Supabase → SQL Editor → New query (replace the value with your `SITE_SERVER_KEY`):
```sql
insert into app_private.secrets (name, hash)
values ('site_server', sha256(convert_to('PASTE_SITE_SERVER_KEY_HERE', 'UTF8')));
```
Then delete the query text from the editor history.

**S3. URL configuration.** Authentication → URL Configuration:
- Site URL: `https://somethingclicks.com`
- Redirect URLs: add `https://somethingclicks.com/auth/confirm**`

**S4. Email templates (needed for links that work in any browser).** Authentication → Emails → Templates.
Replace the link in each template (keep or edit the surrounding text):
- **Magic link** and **Confirm signup**:
  `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}">Open Something Clicks</a>`
- **Reset password**:
  `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Choose a new password</a>`

Without this, Supabase's default links only work in the browser that asked for them (a link opened from the
Mail app in a different browser would fail).

**S5. Custom SMTP (Resend).** Authentication → Emails → SMTP Settings → Enable custom SMTP:
host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key, sender `hello@somethingclicks.com`,
sender name `Something Clicks`. Without this, Supabase only emails members of your Supabase team (rate-limited),
so customers cannot sign up.

**S6. Auth settings.** Authentication → Providers → Email: keep "Confirm email" on.
Authentication → Rate Limits: emails per hour ≥ 30 once SMTP is set. Authentication → Passwords: turn on leaked-password protection.

**S7. Configuration values** (table `public.app_config`, editable in Table Editor):
`free_run_limit` = 3 · `preview_daily_cap` = 200 · `preview_ip_daily` = 5 · `preview_domain_daily` = 3 · `feedback_ip_hourly` = 10.

**S8. Plan.** Upgrade the project from Free to Pro before real customers (daily backups, no pausing).

## Preview: two values only you can add
The secure prompt stores a secret where the network proxy can use it; it never gives Claude the value, so Claude cannot copy it into Vercel. Add these two as **branch-scoped Preview** variables:
1. Vercel → `something-clicks` → Settings → Environment Variables → **Add New**.
2. Name `STRIPE_SECRET_KEY`, value = your Stripe **test** key (`sk_test_…` or `rk_test_…`; never a live key). Environments: **Preview** only → choose branch `claude/ecstatic-curie-9shvjf` → mark **Sensitive** → Save.
3. Name `SUPABASE_SECRET_KEY`, value = clicky-dev's secret key (Supabase → clicky-dev → Project Settings → API Keys → Secret). Preview, same branch, Sensitive, Save. (Only the weekly worker uses it; previews do not run cron, so this one is optional.)
4. Redeploy the branch's latest preview (Deployments → latest `claude/ecstatic-curie-9shvjf` → ⋯ → Redeploy).
Without `STRIPE_SECRET_KEY`, the preview says "Checkout isn't switched on yet" and cannot re-read subscriptions.

## Webhook testing: local Stripe CLI (no Vercel changes)
Deployment Protection stays **on**; no bypass secret is added anywhere (adding one would also expose `VERCEL_AUTOMATION_BYPASS_SECRET` to Production). Stripe cannot reach a protected preview, so webhooks are tested **on your computer**: the Stripe CLI receives TEST events from Stripe and forwards them to the app running locally against **clicky-dev**.

**Safety guard.** Always start forwarding with `scripts/stripe-local-webhook.sh`. It refuses to run if: a live Stripe key is in your shell (`STRIPE_API_KEY`/`STRIPE_SECRET_KEY` starting `sk_live_`/`rk_live_`), `STRIPE_ALLOW_LIVE` is set, any extra flag (such as `--live` or `--api-key`) is passed, `NEXT_PUBLIC_SUPABASE_URL` is not clicky-dev (production is named and refused), or the logged-in CLI does not answer `livemode: false`. (The guard logic was exercised with a stand-in `stripe` command, not the real CLI.) The app adds its own refusal: live-mode events are rejected unless `STRIPE_ALLOW_LIVE=true`.

**Before you start**
- Install the [Stripe CLI](https://docs.stripe.com/stripe-cli), Node 22 and pnpm; clone the repo on `claude/ecstatic-curie-9shvjf`; `pnpm install`.
- You need your own Stripe **test** secret key (`sk_test_…` or `rk_test_…`, Dashboard → Developers → API keys, **Test mode**).
- Keys that must match clicky-dev: the app's `SITE_SERVER_KEY` and `BILLING_WEBHOOK_KEY` are checked against hashes in clicky-dev's `app_private.secrets`, and the Vercel Preview values are write-only, so generate fresh local ones and store their hashes (the table holds **one** row per name, so this replaces the hashes the Preview deployment uses; either put the same new values into the Vercel Preview variables afterwards, or expect the preview's billing/preview functions to fail until you do):
  ```bash
  export SITE_SERVER_KEY=$(openssl rand -hex 32) BILLING_WEBHOOK_KEY=$(openssl rand -hex 32)
  printf "%s\n%s\n" "$(printf %s "$SITE_SERVER_KEY" | sha256sum | cut -d' ' -f1)" "$(printf %s "$BILLING_WEBHOOK_KEY" | sha256sum | cut -d' ' -f1)"   # site_server hash, then billing_webhook hash
  ```
  In the clicky-dev SQL editor (check the project name says **clicky-dev**), replace the two hashes: `insert into app_private.secrets (name, hash) values ('site_server', decode('<first hash>','hex')), ('billing_webhook', decode('<second hash>','hex')) on conflict (name) do update set hash = excluded.hash;`

**1. Log in to the CLI (test mode)**
```bash
stripe login          # choose the Something Clicks account; the CLI uses TEST mode unless you pass --live (the guard refuses that)
```

**2. Start forwarding** (terminal 1)
```bash
export NEXT_PUBLIC_SUPABASE_URL=https://ofstvbgaoznipsiqbjjp.supabase.co
./scripts/stripe-local-webhook.sh
```
The banner prints `Your webhook signing secret is whsec_…`. That secret is **temporary and local only**: use it in step 3 and never put it in Vercel, Git, a chat or a ticket.

**3. Run the app locally against clicky-dev** (terminal 2, same repo)
```bash
export NEXT_PUBLIC_SUPABASE_URL=https://ofstvbgaoznipsiqbjjp.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clicky-dev publishable key>
export NEXT_PUBLIC_SITE_URL=http://localhost:3100
export STRIPE_SECRET_KEY=<your sk_test_ key>
export STRIPE_WEBHOOK_SECRET=<the whsec_ from the step 2 banner>
# SITE_SERVER_KEY and BILLING_WEBHOOK_KEY are already exported from "Before you start"
pnpm build && pnpm exec next start -p 3100
```
Sign in at `http://localhost:3100` with a clicky-dev test account (re-enable the e2e accounts only if you choose to; see the checklist) and note its business's id (`select organization_id from public.organization_members where user_id = '<user id>'`).

**4. Trigger the events we handle.** Stripe sends events to *every* registered endpoint as well as the CLI (see the warning below).

| Event | How to trigger | What you should see |
|---|---|---|
| `checkout.session.completed` (+ `customer.subscription.created`, `invoice.paid`) | In the local app: Plan → **Choose monthly**, pay with `4242 4242 4242 4242` (any future date and CVC) on the real Stripe Checkout page | CLI lines `--> … [200]`; app log `stripe.webhook_processed`; Plan page says **Single Site, Active, $79/month** |
| `customer.subscription.created` (manual) | `stripe customers create -d email=you@example.com` → `stripe payment_methods attach pm_card_visa --customer cus_…` → `stripe customers update cus_… -d "invoice_settings[default_payment_method]=<pm id>"` → `stripe subscriptions create --customer cus_… -d "items[0][price]=price_1Uf9AQFnFMCbDhHEdFmjNCCM"` ... use the **TEST price ids in `src/config/pricing.ts`**, plus `-d "metadata[organization_id]=<org uuid>" -d "metadata[plan_id]=single_site" -d "metadata[interval]=month"` | `[200]`; row appears in `public.subscriptions` |
| `customer.subscription.updated` | `stripe subscriptions update sub_… -d "items[0][id]=si_…" -d "items[0][price]=<single_site yearly TEST price id>"` | `[200]`; plan stays Single Site, interval becomes **year**; page shows **$756 billed yearly** |
| `invoice.payment_failed` | Attach `pm_card_chargeCustomerFail` as the customer's default method, then create a subscription as above | `[200]`; subscription status **incomplete** (no access granted) |
| `customer.subscription.deleted` | `stripe subscriptions cancel sub_…` | `[200]`; status **canceled**; access ends |
| Smoke test only | `stripe trigger customer.subscription.created` (or `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`) | Fixture objects are *not ours* (no business id, other prices): signature is verified, then the event is **ignored** (200) or **refused** (500 "not in the test catalog"). That is correct behaviour. |

**5. What to check afterwards** (clicky-dev SQL editor)
```sql
select received_at, type, status, left(coalesce(error, ''), 80) as note
from public.integration_events order by received_at desc limit 10;   -- processed / ignored / failed, once per event id

select plan_id, status, billing_interval, cancel_at_period_end
from public.subscriptions order by updated_at desc limit 5;
```
- Access comes **only** from the delivered event: the success redirect alone changes nothing (the Plan page shows "Confirming your payment…" until the event is processed).
- Replay: `stripe events resend evt_…` → the app answers 200 `duplicate` and nothing changes.
- Forged: `curl -i -X POST localhost:3100/api/webhooks/stripe -H 'stripe-signature: t=1,v1=bad' -d '{}'` → **400**.
- Wrong amount or an unknown price is refused (`failed`, no access).

**6. Clean up**
```bash
stripe subscriptions cancel sub_…   # any you created
stripe customers delete cus_…       # any you created
```
Stop `stripe listen` (Ctrl-C) and the app, and close the shells (the whsec, keys and test key were only in their environments).

**Warning: events also reach the registered endpoints.** `stripe trigger` and real test subscriptions create real TEST events that Stripe delivers to *all* endpoints in the account, not just your CLI. The TEST account has two endpoints pointing at `https://somethingclicks.com/api/webhooks/stripe` (production) and one for the protected preview URL. On Nov 24 (02:25–02:33 UTC) the clicky-dev journey tests created test subscriptions, and production's webhook recorded **24 failed deliveries** in its `integration_events` table (`Stripe is not configured`: production has no `STRIPE_SECRET_KEY`, and none of those businesses exist there, so nothing was granted). Stripe retries failed deliveries for up to three days, so more rows can appear. To keep testing off production, disable or delete those TEST endpoints in Stripe (Test mode → Developers → Webhooks) before testing; this is your decision.

## clicky-dev Auth (Supabase → clicky-dev → Authentication)
The Supabase connector cannot change these. Click by click:
1. **URL Configuration** → Site URL: `https://something-clicks-git-claude-94123f-matt-hills-projects-54d303a1.vercel.app`.
2. Redirect URLs → Add: `https://*-matt-hills-projects-54d303a1.vercel.app/**` and (for local tests) `http://localhost:3100/**`. Save.
3. **Email → Templates** → Magic link and Confirm signup: replace the link with `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}">Open Something Clicks</a>`; Reset password: `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Choose a new password</a>`. Save each.
4. Optional: custom SMTP with Resend (S5) so people outside your Supabase team can receive links. Until then, only team members get email.
5. Provider → Email: keep "Confirm email" on.

## Rotating the dev keys
`SITE_SERVER_KEY` and `BILLING_WEBHOOK_KEY` for clicky-dev were generated randomly; only their SHA-256 hashes are in clicky-dev's `app_private.secrets`. To rotate: generate new values, update the Vercel Preview variables, and run the S2-style `insert … on conflict (name) do update` with the new hash.

## Resend
1. Resend → Domains → Add `somethingclicks.com` → region US East.
2. Add the DNS records Resend shows (at your DNS provider): **MX** and **TXT (SPF)** on the `send` subdomain, **TXT (DKIM)** `resend._domainkey`. Copy the exact values from Resend.
3. Add **DMARC**: TXT on `_dmarc` with `v=DMARC1; p=none; rua=mailto:YOUR_INBOX` (tighten to `p=quarantine` after a few clean weeks).
4. Wait for "Verified", then do Supabase S5 and set `RESEND_API_KEY` / `EMAIL_FROM` in Vercel.
5. Test: sign up with a personal address; the email should arrive within a minute and pass SPF/DKIM (Gmail → Show original).

## Stripe
The four products and seven prices already exist in **LIVE** mode; their ids are in `src/config/pricing.ts`.

**Test mode (done Nov 24 2026):** the four products and seven prices were created in TEST mode with the same names, descriptions, amounts and intervals as live; their ids are in `STRIPE_CATALOG.test` in `src/config/pricing.ts`. A TEST webhook endpoint `we_1Uf9ApFnFMCbDhHEbQoz3sYP` points at the branch preview URL with the 9 events below. Two older test products and two test endpoints (for somethingclicks.com) were left untouched.
Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`.

**Customer portal:** Settings → Billing → Customer portal → Activate. Allow: update payment method, view invoices,
cancel at period end. Products for plan switching: Single Site (monthly and yearly). Add Business Plus / Multi-Site
only when they become available.

**Going live (separate decision):** create the same webhook endpoint in Live mode, set the live
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and `STRIPE_ALLOW_LIVE=true`. The app then uses the LIVE ids.
Do not make real purchases to test; use test mode.

## Anthropic
Server-side only (`src/lib/server/ai.ts`, `src/lib/server/drafts.ts`), model `claude-opus-5-5`.
Cost controls in place: one wording call per completed check, one call per draft, database caps of 10 checks and
20 drafts per business per day, 200 new anonymous checks per day overall (`preview_daily_cap`).
Set a monthly spend limit in the Anthropic console.

## Google PageSpeed Insights
Create an API key (Google Cloud → APIs & Services → Credentials), restrict it to the PageSpeed Insights API,
set `PAGESPEED_API_KEY`. Without it, mobile speed is often "missing" (shared quota).

## Google Analytics 4
Admin → Create property → Web stream for `somethingclicks.com` → copy the Measurement ID → `NEXT_PUBLIC_GA_MEASUREMENT_ID`.
In the property: Data Settings → Data Collection → leave Google signals **off**; Data Retention → 2 months.
The app sends page views without query strings and only after consent.

## Microsoft Clarity
Create a project for `somethingclicks.com` → Settings → Masking → **Strict** → copy the Project ID →
`NEXT_PUBLIC_CLARITY_PROJECT_ID`. The app also masks forms, results, drafts and the whole workspace.

## Vercel
- **Plan:** commercial use requires **Pro** (Hobby is personal, non-commercial only).
- **Production branch:** Settings → Git → Production Branch = `main`. Do not change it. The current production deployment was made from `claude/fervent-knuth-0fo94q` by hand (LAUNCH.md); production builds come from `main` after a merge.
- **Previews:** every push to a `claude/*` branch makes a preview deployment behind Vercel login. Since Nov 24 the six variables that used to be shared with all Preview branches (production Supabase URL and keys, site URL, billing key, cron secret, webhook secret) are scoped to **Production only**, so other branches' previews no longer inherit production values; `claude/ecstatic-curie-9shvjf` has its own branch-scoped overrides pointing at clicky-dev and Stripe TEST. A new branch's preview needs its own variables to run.
- **Cron:** `vercel.json` schedules `/api/cron/weekly-analysis` daily at 14:17 UTC.

## DNS
Only the Resend records above. No other DNS change is needed.

## Legal
`/privacy` and `/terms` are **drafts for attorney review** and say so on the page. Have your attorney review and
approve them, fill the [bracketed] items, then remove the draft banner. Keep `FREE_PREVIEW_ENABLED` unset until the
Privacy Policy is published.
