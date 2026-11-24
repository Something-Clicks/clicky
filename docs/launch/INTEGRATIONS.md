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

## Resend
1. Resend → Domains → Add `somethingclicks.com` → region US East.
2. Add the DNS records Resend shows (at your DNS provider): **MX** and **TXT (SPF)** on the `send` subdomain, **TXT (DKIM)** `resend._domainkey`. Copy the exact values from Resend.
3. Add **DMARC**: TXT on `_dmarc` with `v=DMARC1; p=none; rua=mailto:YOUR_INBOX` (tighten to `p=quarantine` after a few clean weeks).
4. Wait for "Verified", then do Supabase S5 and set `RESEND_API_KEY` / `EMAIL_FROM` in Vercel.
5. Test: sign up with a personal address; the email should arrive within a minute and pass SPF/DKIM (Gmail → Show original).

## Stripe
The four products and seven prices already exist in **LIVE** mode; their ids are in `src/config/pricing.ts`.

**Test mode first (needed for safe end-to-end payment tests):**
1. Stripe → switch to Test mode → Products → create the same four products and seven prices.
2. Send Claude the test product and price ids; they go into `STRIPE_CATALOG.test` (no logic change).
3. Developers → Webhooks → Add endpoint `https://somethingclicks.com/api/webhooks/stripe` (or the preview URL) with events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`,
   `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`.

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
- **Previews:** every push to a `claude/*` branch makes a preview deployment behind Vercel login. Preview deployments use the **Preview** environment variables — today those point at the production Supabase project. Either keep previews private (current setting) or point Preview at a separate Supabase project.
- **Cron:** `vercel.json` schedules `/api/cron/weekly-analysis` daily at 14:17 UTC.

## DNS
Only the Resend records above. No other DNS change is needed.

## Legal
`/privacy` and `/terms` are **drafts for attorney review** and say so on the page. Have your attorney review and
approve them, fill the [bracketed] items, then remove the draft banner. Keep `FREE_PREVIEW_ENABLED` unset until the
Privacy Policy is published.
