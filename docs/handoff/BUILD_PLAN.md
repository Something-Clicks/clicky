# Build Plan — Phases 0–7

## Phase 0 — Repository and Supabase audit
No code changes. Inventory architecture, routes, components, dependencies, database, auth, RLS, integrations, billing, secrets, deployment, tests, and existing UI. Classify each capability as working/partial/missing. Identify legacy agency-only code and propose disposition without deleting. Deliver `docs/AUDIT.md` and prioritized backlog.

## Phase 1 — Platform foundation
Auth, organizations, memberships, business profile, migrations, RLS default-deny, cross-tenant isolation tests, protected routes, settings, basic admin, error handling, logging. Exit: auth and tenant boundaries proven by automated tests.

## Phase 2 — Product shell and customer journey
Implement public site and authenticated app shell from `ui/PRODUCT_UI_REFERENCE.html`; responsive navigation, onboarding, empty states, business profile, connect website flow, settings, help/legal placeholders only where approved. Exit: customer can sign up, create organization, complete profile, and reach dashboard without dead ends.

## Phase 3 — Marketing intelligence
Safe website fetch and analysis; supported PageSpeed source; optional Search Console and GBP connection flows only where credentials/scopes and verification are available. Persist analysis and evidence. Generate prioritized Action Cards. Exit: a test business receives evidence-backed, understandable cards; no fabricated data.

## Phase 4 — AI preparation and controlled execution
Server-side Claude abstraction; permission model; agent runs; prepare drafts for page copy, metadata, GBP posts, review replies, and blog drafts. Approval queue and copy/download. Only implement verified publish integrations. Exit: full audit trail and approval tests; no unrestricted actions.

## Phase 5 — Measurement, activity, and retention
Activity history, completed-action outcomes, before/after comparisons only when comparable verified data exists, notifications, stale-data indicators, recurring analysis where infrastructure supports it. Exit: customer can understand what was done and what evidence shows.

## Phase 6 — Payments and entitlements
Typed price catalog; Stripe test-mode products/prices; Checkout; verified webhooks; idempotency; subscription status; billing portal link only after configured; entitlement gating. Exit: tests prove unpaid users cannot access paid features and payment events update access correctly.

## Phase 7 — Hardening and launch readiness
Accessibility, responsive QA, security review, rate limits, error/retry handling, observability, backups/restore review, privacy and terms review, performance, deployment checks, production readiness checklist. No production launch without explicit approval.

## Dependencies
Phase 1 precedes all tenant-owned data. Phase 2 uses Phase 1 auth/organization model. Phase 3 depends on secure profiles and connections. Phase 4 depends on analysis/evidence and permissions. Phase 5 depends on agent-run and action outcomes. Phase 6 can be developed in parallel after product/entitlement model is stable, but production enablement follows approval. Phase 7 validates all prior phases.
