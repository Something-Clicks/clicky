# Launch checklist

Working branch: `claude/ecstatic-curie-9shvjf` (preview deployments only).
Built from: `claude/fervent-knuth-0fo94q` (the app, 21 commits; fast-forward, nothing rewritten).
Production branch: `main` (Vercel). `main` and `claude/fervent-knuth-0fo94q` are never pushed to.

## How to resume
1. `git checkout claude/ecstatic-curie-9shvjf && pnpm install`
2. `service postgresql start` (local Postgres for `pnpm test:db`)
3. Public browser tests: build with test env (below), then `pnpm e2e`.
4. Read the first unchecked item and its "Remaining" note. After each item: run the checks, tick it, add the commit.

Test build for `pnpm e2e` (no database needed):
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_e2e NEXT_PUBLIC_GA_MEASUREMENT_ID=G-E2ETEST NEXT_PUBLIC_CLARITY_PROJECT_ID=e2etest pnpm build && pnpm e2e`

## Baseline (before this work, Nov 24 2026)
Lint ✓ · typecheck ✓ · unit 100/100 ✓ · database 78/78 ✓ · build ✓. Production Supabase: 7 migrations applied, 0 users, 0 businesses, 0 subscriptions.

## Current test status
Lint ✓ · typecheck ✓ · unit 104/104 ✓ · database 98/98 ✓ (20 new launch tests) · build ✓ · browser (public) 50/50 ✓ on iPhone 13 profile (390px, Chromium) and desktop Chromium · axe: 0 violations on 10 public pages × 2 viewports.
Not run: real WebKit (not installed here), signed-in browser flows (need the e2e stack or a Supabase dev branch — see tests/e2e/stack/README.md).

## P0 items

- [x] **P0.0 Foundation** — `c6da947`
  Launch migration + rollback (not applied), mode-aware catalog, CLAUDE.md, docs.
- [x] **P0.1 Homepage and responsive design** — this commit
  One-value headline slot (`src/config/site.ts`, placeholder "Enter your website"), website + ZIP form, 390px-first layout, tablet/desktop adaptation, flat/3D Clicky assets. Verified in browser at 390px and 1280px.
- [ ] **P0.2 Website analysis and first result** — implemented, database-tested; browser flow not yet run
  Anonymous preview (`/start`), loading steps, evidence-labeled cards (observed / measured / missing), honeypot, signed form ticket (min 2.5 s), IP/domain/daily limits, 24-hour cache, 7-day cleanup.
  Remaining: run the anonymous result flow in a browser against Supabase Auth/REST.
- [ ] **P0.3 Save this and signup** — implemented, database-tested; browser flow not yet run
  Email binding + hashed single-use claim token (24 h), `/auth/confirm` (token_hash, any browser), `/claim`, emailed sign-in link on the login page, password login kept, three free uses enforced in the database.
  Remaining: cross-browser magic-link test (needs e2e stack), Supabase email templates (INTEGRATIONS S4).
- [ ] **P0.4 Pricing and Stripe** — implemented, unit-tested; no Stripe call made
  Exact names/prices, LIVE ids per mode, checkout by price id, monthly/yearly, webhook takes plan + interval from the billed price, Marketing Plan replaces Diagnostic Audit, entitlement mapping.
  Remaining: Stripe TEST product/price ids from the owner, then a test-mode checkout.
- [ ] **P0.5 Workspace and marketing work** — restyled, copy cleaned; signed-in screens not yet browser-tested
  Tab bar on phones, sidebar on desktop, Home shows next move + free uses, drafts can use free uses, upgrade page.
- [ ] **P0.6 Feedback and funnel** — implemented, database-tested; admin page not browser-tested
- [x] **P0.7 Consent and analytics** — this commit
  Banner; GA4 and Clarity load only after Yes (verified: zero analytics requests before consent or after No); page views carry no query strings; forms, results, drafts and the workspace are masked; Supabase funnel counts hold no personal data.
- [x] **P0.8 Legal drafts** — this commit
  `/privacy` and `/terms`, labeled "Draft for attorney review", name all seven services, disclose AI processing.
- [ ] **P0.9 Final testing**
- [ ] **P0.10 Launch readiness**

## Database validation done (production read-only)
- Constraint `plan_entitlements_plan_id_check`, `auth.users.email_confirmed_at`, roles, `pgcrypto`, `sha256`: present as the migration expects.
- No name collisions with the 5 new tables or 14 new functions.
- The four functions the migration replaces are byte-identical (normalized body hash) in production and in the repo; the rollback restores them exactly (hash checked locally).
- Rollback tested locally: apply → rollback → apply again.
- Not yet: running the migration on real Supabase (needs approval to apply, or a Supabase development branch).

## Product promises (Stripe descriptions vs. the app)
| Product | Stripe description | Supported today? | Shown to customers |
|---|---|---|---|
| Marketing Plan | See what needs work and get a clear plan for your marketing. | Yes: one full check + ranked, evidence-backed list. | Yes |
| Single Site | Get marketing recommendations and ready-to-use content for your business. | Yes: recommendations, four kinds of drafts, approval, weekly re-check. | Yes |
| Business Plus | Get more marketing insights, content and automated actions to grow your business. | **No.** No automated actions exist (nothing is ever published or done for the customer), and there are no extra insights beyond Single Site. | "Coming soon", not purchasable |
| Multi-Site | Manage marketing across multiple websites or business locations. | **No.** One subscription covers one business/website. | "Coming soon", not purchasable |

To offer Business Plus: build something it adds (e.g. recurring drafts or a verified publishing integration), or change its Stripe description to match Single Site + something real.
To offer Multi-Site: one subscription must cover several businesses (entitlements by subscription owner, a business switcher, per-site limits).

## Entitlements (old → new)
| Old plan | New plan | Checks | Weekly re-check | Drafts |
|---|---|---|---|---|
| Diagnostic Audit ($39, one check) | Marketing Plan ($49, one check) | 1 | — | — |
| Starter AI (title drafts only) | Single Site | ✓ | ✓ | all four kinds |
| Growth AI | Business Plus (hidden) | ✓ | ✓ | all |
| Scale & Automation | Multi-Site (hidden) | ✓ | ✓ | all |
Old plan rows stay in the database (no customer records exist; production had 0 subscriptions). No monthly draft quota is invented; the existing 20 drafts/day safety cap remains.

## Needs the owner's approval
- [ ] Apply `supabase/migrations/20261124120000_launch_redesign.sql` to production (rollback: `supabase/rollback/20261124120000_launch_redesign_down.sql`).
- [ ] Run the local e2e stack (third-party release binaries) or create a Supabase development branch, to test signed-in flows.
- [ ] Attorney review and approval of `/privacy` and `/terms` before they are published as final.
- [ ] Turn on the free first result (`FREE_PREVIEW_ENABLED=true`) only after the Privacy Policy is published.
- [ ] Choose a homepage headline (`src/config/site.ts`).
- [ ] Business Plus and Multi-Site: keep "Coming soon" or change the Stripe descriptions.

## External configuration blockers
See `docs/launch/INTEGRATIONS.md` (Supabase S1–S8, Resend, Stripe test products + portal, GA4, Clarity, Vercel Pro).
