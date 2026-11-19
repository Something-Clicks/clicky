# Security review — Phase 7

**Date:** November 19, 2026 · **Scope:** the whole application (all code on `claude/fervent-knuth-0fo94q`), the Supabase schema, and the Stripe and cron endpoints.

**Result: no high-confidence vulnerabilities found.** One defense-in-depth change made (below). Accepted risks are listed with their reasons.

## What was checked
| Area | Finding |
|---|---|
| Tenant isolation | Every table has RLS; API roles get SELECT only (column-level UPDATE where needed); writes go through SECURITY DEFINER functions with fixed `search_path` that check membership/role. 78 database tests prove Customer B cannot read, change, join or delete Customer A's data on any table. |
| Privilege escalation | Owner-only actions (business profile, approvals, billing customer, recurring setting) are enforced in SQL, not just the UI. Platform admin functions check `platform_admins` (no API access to that table) and are logged. |
| Payment bypass | Entitlements are checked inside `start_analysis` / `start_agent_run` / the worker. Only verified Stripe webhooks change billing data (signature on raw body, live mode refused, catalog-amount checks, subscription state re-read from Stripe). The billing key's hash is stored; the key can call only 4 functions. Return URLs grant nothing. |
| Service role | Used only by the weekly cron route, behind a ≥16-char `CRON_SECRET` compared in constant time. `is_service()` reads the role from the verified JWT claims, which customers cannot set. |
| SSRF | Website fetching allows only http(s) on 80/443, blocks private/loopback/link-local/metadata/IPv6-mapped/NAT64 ranges and internal host names, resolves DNS inside the socket (no re-binding), re-validates every redirect, caps size and time. 30 unit tests. |
| Injection | No string-built SQL (parameterized RPCs and query builder); no `eval`, shell or `dangerouslySetInnerHTML`. Emails escape HTML. |
| XSS | React escaping everywhere; per-request nonce CSP (`script-src 'nonce' 'strict-dynamic'`, no inline scripts), `frame-ancestors 'none'`, `object-src 'none'`. |
| Auth & sessions | Supabase cookie sessions; server verifies with `getUser()`; redirect targets restricted to same-site paths; password reset answers the same whether or not an account exists. |
| Secrets & data | Secrets only in server env; none committed (CI secret scan). Logs redact keys matching password/secret/token/key/email/phone/cookie/jwt. AI and analysis calls are server-only. |
| Headers | HSTS, X-Frame-Options DENY, nosniff, strict referrer, permissions policy, CSP. |

## Change made
- Evidence links render only for `http(s)` URLs (`src/components/intelligence.tsx`). React 19 and the CSP already block `javascript:` URLs; this removes reliance on them.

## Accepted risks (by design)
1. A member can submit hand-made analysis results or drafts **for their own business** through the public functions. No other tenant is affected; every call is logged. Closing it fully needs a privileged worker for all analysis writes.
2. Members can see teammates' email addresses (needed to send notifications), only within their own business.
3. Sign-up, sign-in and password-reset rate limits are Supabase Auth's built-in limits; analysis (10/day) and drafts (20/day) are capped in the database.

## Needs your action before launch
- Turn on **Leaked password protection** (Supabase → Authentication).
- Make the GitHub repository **private**.
- Approved **Privacy Policy and Terms** (none are published yet).
