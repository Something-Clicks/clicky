# Something Clicks: Repository and Supabase Audit

**Date:** November 18, 2026
**Phase:** 0 (audit). No code, schema, configuration or data was changed during the audit.
**Scope:** the `Something-Clicks/clicky` repository, the Supabase project **Clicky** (`ysmwnxvyjougetdlpnba`), and the handoff in `docs/handoff/`.

This is a new product built from a clean repository. The handoff documents in `docs/handoff/` are the only source of product, brand and UI direction.

---

## 1. Current architecture and status

| Area | Finding |
|---|---|
| Repository | `Something-Clicks/clicky` contains one commit: a Node `.gitignore` and a one-line README. There is no application, framework, tests, CI or deployment yet. |
| Repository visibility | **Public.** Make it private before business logic, schema and AI prompts go in. |
| Supabase project | **Clicky** `ysmwnxvyjougetdlpnba` (us-west-2, Postgres 17, healthy). Empty: no tables, migrations, auth users or storage buckets. |
| Supabase safety net | The `ensure_rls` event trigger turns on RLS for every new `public` table. Default function privileges are locked down (new functions are not executable by `anon`/`authenticated` unless granted). |
| Hosting | No Vercel project is linked to this repository yet. |
| Brand assets | The approved Joyful Aha emoji (`public/brand/clicky-source.png`, 1254×1254, opaque white background) is the visual identity. No vector master exists. |

## 2. What works, is partial, or is missing

| Capability | Status |
|---|---|
| Authentication | Missing |
| Organizations, members, roles | Missing |
| Business profile and settings | Missing |
| RLS and tenant isolation tests | Missing (the database-level RLS safety net exists) |
| Protected routes and admin | Missing |
| Error handling and structured logging | Missing |
| Public website (`/`, `/how-it-works`, `/pricing`, ...) | Missing |
| Website analysis, Action Cards, AI preparation | Missing |
| Stripe billing and entitlements | Missing |
| CI, secret scanning, tests | Missing |

## 3. Security findings

| # | Finding | Severity | Action |
|---|---|---|---|
| S-1 | Repository is public. | High once code lands | Make private (your action in GitHub settings). |
| S-2 | Supabase grants table privileges to `anon` and `authenticated` on new `public` tables by default. RLS is the only barrier unless privileges are revoked. | Medium | Every new table revokes all privileges from API roles and grants back only what its policies need. |
| S-3 | If on the Free plan: no managed backups; the project pauses after inactivity. | Medium before real customers | Upgrade before real customer data or payments (decision needed before Phase 6 goes live). |
| S-4 | No secrets exist in the repository. | OK | Keep `.env*` ignored, add secret scanning in CI. |
| S-5 | Supabase Auth URL configuration (Site URL, redirect allow-list) is not yet set for this app. | Required for sign-up email links | Set in Supabase → Authentication → URL Configuration once the domain/preview URL is known. |

## 4. Reuse, replace, adapt, retire

The repository and the Supabase project are empty, so there is nothing to reuse, replace or retire. Agency-only features (account managers, team inbox, proposals, CRM sync) are out of scope and will not be built.

## 5. Recommended architecture

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router) + TypeScript (strict), one app for public site, customer app and admin. |
| UI | Tailwind CSS 4 with the design tokens from `DESIGN_SYSTEM.md`; Inter; components modeled on `PRODUCT_UI_REFERENCE.html`. |
| Data and auth | Supabase Postgres + Auth via `@supabase/ssr` (cookie sessions). The user's session is used for all customer requests, so RLS always applies. |
| Privileged access | `SECURITY DEFINER` functions in a non-exposed `app_private` schema, each checking membership/role and writing `activity_log`. No service-role key is needed in Phase 1. |
| Route protection | `src/proxy.ts` refreshes the session and redirects anonymous visitors away from `/app` and `/admin`; each page also re-checks on the server. |
| Validation | Zod schemas shared by forms and server actions; database `check` constraints as the last line. |
| Logging | Structured JSON logs to stdout (Vercel captures them) with secret/PII redaction. |
| Tests | Vitest unit tests; database tests that apply every migration to a throwaway Postgres that mimics Supabase roles, then prove cross-tenant isolation. |
| Later | Claude API (server-side only), Stripe (test mode), Resend, Google Analytics, Google Search Console / PageSpeed / Business Profile (customer-authorized). |

### Database tables

| Table | Phase | Purpose |
|---|---|---|
| `profiles` | 1 | One per auth user: display name. |
| `organizations` | 1 | The customer's business account (tenant). |
| `organization_members` | 1 | User ↔ organization with role `owner` or `member`. |
| `business_profiles` | 1 | One per organization: business name, website, service area, main goal. |
| `platform_admins` | 1 | Users with limited, audited platform access. Not readable by API roles. |
| `activity_log` | 1 | Insert-only record of account, settings and admin actions. |
| `data_connections` | 3 | Provider, scopes, account identity, token reference (never a raw token client-side), sync and revocation state. |
| `analyses` (+ `analysis_evidence`) | 3 | Analysis runs and the evidence each finding cites (source, observation, timestamp, URL, excerpt, observed/estimated). Evidence is its own table because every card must trace to one or more records. |
| `action_cards` | 3 | The schema in `PRODUCT_SPEC.md`. |
| `agent_runs` | 4 | Inputs, outputs, permissions, results of each AI run. |
| `approvals` | 4 | Approval decisions, enforced server-side. |
| `subscriptions` | 6 | Verified Stripe state and entitlements. |
| `integration_events` | 6 | Webhook dedupe (provider + event id unique). |

## 6. Roadmap

| Phase | Scope | Complexity | Depends on |
|---|---|---|---|
| 1 Platform foundation | Auth, organizations, members, business profile, RLS, isolation tests, protected routes, settings, basic admin, errors, logging, brand icons | Medium | — |
| 2 Product shell | Public pages and app shell from the UI reference, onboarding flow, empty states, legal placeholders where approved | Medium | 1 |
| 3 Marketing intelligence | SSRF-safe website fetch, PageSpeed, optional GSC/GBP OAuth, analyses + evidence, Action Cards | High | 1, 2 |
| 4 AI preparation | Claude abstraction, agent runs, drafts, approval queue, copy/download | High | 3 |
| 5 Measurement | Activity timeline, outcomes, stale-data flags, notifications | Medium | 4 |
| 6 Payments | Typed price catalog, Stripe test mode, verified webhooks, entitlements | Medium | 1 (parallel after 2) |
| 7 Hardening | Accessibility, security review, rate limits, observability, backups, launch checklist | Medium | all |

## 7. Prioritized backlog

1. Next.js + TypeScript scaffold, design tokens, Clicky icons (P1).
2. Phase 1 migration: tables, helpers, RLS, privileges (P1).
3. Cross-tenant isolation tests in CI (P1).
4. Supabase Auth with email + password, callback, sign out (P1).
5. Proxy + server-side guards for `/app` and `/admin` (P1).
6. Create organization + business profile; settings (P1).
7. Platform admin overview with audited access (P1).
8. Structured logging and error boundaries (P1).
9. CI: lint, types, unit, database tests, build, secret scan (P1).
10. Public site and app shell (P2).
11. Website analysis with SSRF defenses (P3).

## 8. First task

Scaffold the app and land the Phase 1 migration with its isolation tests, so every later table starts from a proven tenant boundary.

## Decisions needing your approval

1. **Make the repository private.**
2. **Apply the Phase 1 migration to the Supabase project.** It only adds new tables and functions to the empty project. (Done in Phase 1 after local tests pass; reversible by dropping the new objects.)
3. **Supabase Auth URL configuration** once a domain or Vercel preview URL exists.
4. **Supabase plan upgrade** before real customer data or payments.
