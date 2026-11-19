# Phase 7: Hardening and launch readiness — report

**Status:** deployed to production at **https://somethingclicks.com** (November 19, 2026). Payments in Stripe test mode. Remaining owner actions are in [docs/LAUNCH.md](../LAUNCH.md).

## Hardening
- **Accessibility (WCAG 2.2 AA):** axe scan of all 20 public and signed-in screens → **0 violations**. Fixed: an invalid ARIA attribute, and small-text colors from the reference that sat just under 4.5:1 — each darkened only as far as needed (cobalt `#3977d5` text/buttons → `#346dc3`; brand cobalt kept for non-text uses). Keyboard focus, labels, roles and reduced motion were in place from Phase 1.
- **Content Security Policy:** per-request nonce (`script-src 'nonce' 'strict-dynamic'`, no inline scripts), `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action` limited to the site and Stripe. Verified: 0 violations across 11 screens including client-side navigation, locally and in production.
- **Security review:** see [docs/SECURITY_REVIEW.md](../SECURITY_REVIEW.md) — no high-confidence vulnerabilities; one defense-in-depth fix (evidence links only for http/https).
- **Webhook resilience:** signature verification no longer depends on the Stripe API key, so verified events are always recorded; work that needs the API is retried by Stripe once the key is set.
- **Observability:** structured JSON logs (redacted) for every important event and error, with a digest shown to users on error pages; Vercel collects them (Project → Logs).
- **Rate limits:** analyses (10/day/business) and drafts (20/day/business) in the database; sign-in, sign-up and reset use Supabase Auth's limits.

## Deployment
- Vercel project `something-clicks` linked to `Something-Clicks/clicky`; production domain `somethingclicks.com` (+ `www`), DNS verified. `*.vercel.app` addresses are behind Vercel login (Deployment Protection); the custom domain is public.
- Environment variables set by script without exposing values (see LAUNCH.md). Stripe **test-mode** webhook endpoint created for `https://somethingclicks.com/api/webhooks/stripe`.
- Vercel Cron: daily call to the weekly-analysis worker (runs once `SUPABASE_SECRET_KEY` is set).

## Production verification (https://somethingclicks.com)
| Check | Result |
|---|---|
| 8 public pages | 200, CSP + HSTS + `X-Frame-Options: DENY` present, 0 CSP violations |
| Signed-out `/app` | redirected to login |
| Sign in and all 8 workspace screens | 200 |
| **Real website analysis from Vercel** (somethingclicks.com) | complete: 5 pages reviewed, 3 evidence-backed Action Cards; PageSpeed honestly recorded as missing (shared quota — add `PAGESPEED_API_KEY`) |
| **Real Stripe webhooks** (test subscription created and canceled in Stripe) | `invoice.paid`, `customer.subscription.created`, `customer.subscription.deleted` delivered to production, signature-verified and recorded; processing waits for `STRIPE_SECRET_KEY` on Vercel (Stripe retries automatically) |

Test users, their data and Stripe test objects were removed afterwards.

## Totals across all phases
- Database tests: **78** (tenant isolation, roles, analysis, approvals, outcomes, worker, notifications, billing)
- Unit tests: **100** (SSRF, scan/checks, AI guards, drafts, notifications, Stripe, validation, logging)
- Live end-to-end runs against Supabase (and Stripe test mode) for every phase, plus production verification above.
