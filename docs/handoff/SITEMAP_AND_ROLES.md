# Sitemap and Roles

## Public website
- `/` — Home: clear promise, how it works, product preview, primary CTA to diagnostic audit.
- `/how-it-works` — Connect → Analyze → Recommend → Execute → Measure.
- `/pricing` — Diagnostic Audit and subscription plans; prices from typed catalog only.
- `/diagnostic-audit` — Explain $39 one-time audit, collect only required details, checkout or next step.
- `/about` — Company purpose and approach; no fabricated team or testimonials.
- `/faq` — Plain-language product, AI, data, billing, and approval answers.
- `/privacy`, `/terms` — approved legal copy only; do not invent legal assurances.
- `/login`, `/signup` — authentication.

## Authenticated customer app
- `/app` — Overview: welcome, business health summary if real data exists, next recommended action, pending approvals, recent activity.
- `/app/onboarding` — business details, website, goals, optional connections.
- `/app/actions` — prioritized Action Card list with filters.
- `/app/actions/[id]` — evidence, why it matters, recommended action, draft/result, approval, status.
- `/app/analysis` — latest analysis, data freshness, source coverage, findings.
- `/app/connections` — connect/disconnect supported data sources, scopes, last sync, errors.
- `/app/approvals` — drafts awaiting approval, preview, approve/reject, copy/download.
- `/app/activity` — immutable activity timeline for analysis, approvals, agent runs, and completed work.
- `/app/billing` — plan, subscription state, invoices/portal link when configured.
- `/app/settings` — user profile, organization, members, notifications, security.

## Admin (restricted)
- `/admin` — operational overview, system health, user/organization support.
- `/admin/organizations` — organization lookup and support actions, audited.
- `/admin/agent-runs` — execution logs and failures.
- `/admin/integrations` — provider status/configuration without exposing secrets.
- `/admin/audit-log` — security and admin activity.

## Roles
- Anonymous: public pages, signup/login.
- Organization owner: manage organization, connections, approvals, billing, members, settings.
- Organization member: access only organization data according to explicit role permissions.
- Platform admin: limited, audited administrative access; no broad data access by default.

All customer data access must be tenant-scoped and enforced in the database with RLS plus server-side authorization. Hiding UI is not authorization.
