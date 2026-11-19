# Phase 1: Platform foundation — report

**Status:** complete and verified (November 18–19, 2026).

## What was built
- Next.js 16 + TypeScript (strict) app with plain CSS ported rule-for-rule from the UI reference.
- Email/password auth (sign up with email confirmation, sign in, sign out, confirmation callback), session refresh proxy, server-side guards on `/app` and `/admin`.
- Organizations, members (owner/member), business profiles, platform admins, activity log.
- All 15 reference screens. Screens whose features ship later show the reference's sample content, labeled "Sample", with their action buttons disabled and explained.
- Basic admin (`/admin`): counts and account names only; every view is logged; non-admins get a 404.
- Structured JSON logging with redaction, error boundaries, request-error instrumentation, security headers.
- Clicky icon set generated from the approved artwork (favicon, app icons, manifest, UI sizes).

## Database (Supabase project "Clicky")
- `20261118120000_platform_foundation`: 6 tables, RLS default-deny, privileges revoked then granted back per policy, `app_private` helpers, audit triggers, `create_organization`, `admin_overview`, `current_user_is_platform_admin`.
- `20261118121000_lock_down_function_defaults`: closes Supabase advisor 0028/0029 on `rls_auto_enable()`; new functions are not executable by API roles unless granted.
- Remaining advisor notices are intentional: the three API functions are meant for signed-in users and check the caller; `platform_admins` is deny-all by design.

## Tests
| Suite | Result |
|---|---|
| Database (local Postgres mimicking Supabase roles) | 27/27 — Customer B cannot read, update, insert, delete or join Customer A's data on any table; members cannot edit; admin RPC refuses non-admins and logs admins |
| Live Supabase isolation check (rolled back) | A sees own org; B sees 0 orgs/profiles/activity, updates 0 rows, cannot join; anon reads nothing |
| Unit | 29/29 — open-redirect guard, website validation, log redaction, price catalog |
| End-to-end against live Supabase (Playwright) | 46/46 functional checks: signed-out redirects, wrong password, open-redirect attempt, onboarding validation and save, all 15 screens, members, profile and business saves, activity entries, non-admin 404, admin overview, mobile no-overflow on every screen, sign out |

The temporary end-to-end test user and its data were deleted afterwards.

## Deviations from the reference (and why)
- Navigation: the reference shows every group in one sidebar. Public pages show the Public website and Account groups; signed-in pages show the Customer app group. Showing app links to visitors would be a dead end.
- Action detail is reached from an Action Card rather than the sidebar (it needs a specific card).
- Developer notes in the reference's subtitles were replaced with customer-facing lines of the same length.
