# Launch checklist

**Live:** https://somethingclicks.com (Vercel project `something-clicks`, team `matt-hills-projects`). `www.somethingclicks.com` redirects to it. The `*.vercel.app` addresses require a Vercel login (Deployment Protection); the custom domain is public.

**Payments are in Stripe test mode.** Live keys and live events are refused in code until `STRIPE_ALLOW_LIVE=true` is set — a separate go-live decision.

## Already set on Vercel (Production + Preview)
| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://somethingclicks.com` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project "Clicky" (public values) |
| `STRIPE_WEBHOOK_SECRET` | From the Stripe **test-mode** endpoint `https://somethingclicks.com/api/webhooks/stripe` (created by API with the 9 events listed in docs/phases/PHASE6.md) |
| `BILLING_WEBHOOK_KEY` | Random; its SHA-256 is stored in Supabase `app_private.secrets` |
| `CRON_SECRET` | Random; Vercel Cron sends it to `/api/cron/weekly-analysis` |

## You need to add (Vercel → something-clicks → Settings → Environment Variables), then Redeploy
| Variable | Where to get it | Without it |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys (test: `sk_test_…`) | Checkout shows "Checkout isn't switched on yet"; webhooks still verify but cannot re-read subscriptions |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys (set a spend limit) | Cards use template wording; AI drafts are off |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys (secret) | Weekly re-analysis does not run |
| `PAGESPEED_API_KEY` | Google Cloud → APIs → PageSpeed Insights API → credentials | PageSpeed often "busy" (shared quota) and shown as missing |
| `RESEND_API_KEY`, `EMAIL_FROM` (+ optional `EMAIL_REPLY_TO`) | Resend → API keys; verify `somethingclicks.com` as a sending domain | Notification emails are skipped (logged) |

## Supabase settings (dashboard)
1. **Authentication → URL Configuration**: Site URL `https://somethingclicks.com`; Redirect URLs add `https://somethingclicks.com/auth/callback`. *Without this, confirmation and reset links point at localhost.*
2. **Authentication → Emails → SMTP**: use Resend's SMTP (host `smtp.resend.com`, user `resend`, password = Resend API key, sender on your verified domain). *Without this, Supabase's built-in email only reaches your own team and is heavily rate-limited — real customers cannot confirm sign-ups.*
3. **Authentication → Passwords**: turn on leaked-password protection.
4. **Plan**: upgrade from Free before real customers (daily backups, no pausing).

## Stripe settings
1. **Settings → Billing → Customer portal**: activate (powers "Manage billing").
2. When going live: create a live webhook endpoint for the same URL and events, set the live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and `STRIPE_ALLOW_LIVE=true`.

## Before announcing
- [ ] Approved **Privacy Policy** and **Terms** pages (not published — need your legal text).
- [ ] GitHub repository set to **private**.
- [ ] Merge `claude/fervent-knuth-0fo94q` into `main` (production builds from `main` afterwards; the current production deploy was made from the branch).
- [ ] Google OAuth app if you want Search Console / Business Profile connections (Business Profile also needs Google's API approval).
- [ ] Confirm the plan entitlements table in docs/phases/PHASE6.md.

## Make yourself a platform admin
After signing up on the live site, run in Supabase → SQL Editor (replace the email):
```sql
insert into public.platform_admins (user_id, note)
select id, 'founder' from auth.users where email = 'you@example.com';
```
