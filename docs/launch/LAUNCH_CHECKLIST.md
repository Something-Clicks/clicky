# Launch checklist

Working branch: `claude/ecstatic-curie-9shvjf` (preview deployments only).
Built from: `claude/fervent-knuth-0fo94q` (the app, 21 commits; fast-forward, nothing rewritten).
Production branch: `main` (Vercel). `main` and `claude/fervent-knuth-0fo94q` are never pushed to.

## How to resume
1. `git checkout claude/ecstatic-curie-9shvjf && pnpm install`
2. `service postgresql start` (local Postgres for `pnpm test:db`)
3. Read the first unchecked P0 item below and its "Remaining" note.
4. After each item: run the checks, tick the box, add the commit, commit.

## Baseline (before this work, Nov 24 2026)
Lint ✓ · typecheck ✓ · unit 100/100 ✓ · database 78/78 ✓ · build ✓. Production Supabase: 7 migrations applied, 0 users, 0 businesses, 0 subscriptions.

## P0 items

- [ ] **P0.0 Foundation** — launch migration (not applied), catalog, docs
- [ ] **P0.1 Homepage and responsive design**
- [ ] **P0.2 Website analysis and first result**
- [ ] **P0.3 Save this and signup**
- [ ] **P0.4 Pricing and Stripe**
- [ ] **P0.5 Workspace and marketing work**
- [ ] **P0.6 Feedback and funnel**
- [ ] **P0.7 Consent and analytics**
- [ ] **P0.8 Legal drafts**
- [ ] **P0.9 Final testing**
- [ ] **P0.10 Launch readiness**

## Needs the owner's approval
- [ ] Apply `supabase/migrations/20261124120000_launch_redesign.sql` to production (rollback: `supabase/rollback/20261124120000_launch_redesign_down.sql`).
- [ ] Attorney review and approval of `/privacy` and `/terms` before they are published as final.
- [ ] Turn on the free first result (`FREE_PREVIEW_ENABLED=true`) only after the Privacy Policy is published.
- [ ] Choose a homepage headline (`src/config/site.ts`).
- [ ] Business Plus and Multi-Site: keep "Coming soon" or change the Stripe descriptions (see "Product promises").

## External configuration blockers
See `docs/launch/INTEGRATIONS.md` for exact steps.
