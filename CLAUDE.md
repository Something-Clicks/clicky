# Something Clicks — instructions for Claude Code sessions

Marketing help for small businesses: check the website, show what's worth fixing with evidence, draft the work, the owner approves. Live at https://somethingclicks.com.

## Before you change anything
- Read `docs/launch/LAUNCH_CHECKLIST.md` (what's done, what's next, how to resume).
- Branches: `main` is the Vercel production branch. Never push to `main` or `claude/fervent-knuth-0fo94q`. Work on a `claude/*` branch; pushes there make preview deployments only.
- Never force-push, delete branches, or discard uncommitted work.

## Database safety
- Migrations in `supabase/migrations/` are additive and reversible; every one has a rollback in `supabase/rollback/`.
- **Never apply a migration or run write SQL against the production Supabase project ("Clicky", `ysmwnxvyjougetdlpnba`) without the owner's explicit approval.** Read-only inspection is fine.
- Test locally: `pnpm test:db` runs every migration on a throwaway local Postgres (`PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres`). Local Postgres is not full Supabase validation; also check Supabase-specific details (roles, auth.users columns, constraint names, advisors) read-only.

## Architecture
- Next.js 16 App Router, strict TypeScript, plain CSS (`src/app/globals.css`, mobile first at 390px), Supabase (Postgres, Auth, RLS), Stripe, Anthropic, Resend, Vercel (+ Cron), Vitest, pnpm.
- Customer requests run as the signed-in user (RLS always applies). No service-role key in customer paths.
- Privileged writes go through `SECURITY DEFINER` functions that check the caller. Server-only keys, stored hashed in `app_private.secrets`:
  - `BILLING_WEBHOOK_KEY` → `billing_*` functions (Stripe webhook only).
  - `SITE_SERVER_KEY` → `site_*` functions (anonymous first result, feedback, funnel counts).
- Analysis: `src/lib/server/analysis.ts` (`analyzeWebsite`) = safe fetch → scan → checks → optional wording. Shared by the workspace and the anonymous preview. Every card cites evidence labeled observed / measured / missing.
- Drafts: `src/lib/server/drafts.ts`, draft-only, owner approves (`decide_approval`). Nothing is ever published for the customer.
- Free uses: three per person/business (`app_config.free_run_limit`), enforced in `start_analysis` / `start_agent_run`. First use can be anonymous; Save this + `claim_preview` moves it into an account (works across browsers; same verified email + single-use token).
- Prices and Stripe ids: only in `src/config/pricing.ts` (per mode; never borrow ids across modes). Paid access only from the verified webhook.
- Homepage headline: only in `src/config/site.ts`.
- Analytics (GA4, Clarity) load only after consent (`src/components/consent.tsx`). Supabase `funnel_events` holds counts with no personal data.

## Product and copy rules
- Plain, short, friendly. Show the work, don't explain the technology.
- In customer-facing copy never say "AI", "agents", or "prompts"; say "drafts", never "campaigns". (Exceptions: the draft Privacy Policy/Terms, and the exact research attribution.)
- Never invent business facts, results, integrations or features. Only show features as available when they work; otherwise "Coming soon".
- One primary action per screen. Touch targets ≥ 44px. No horizontal scrolling at 390px.
- Brand: Click Blue `#3977D5` for marks/borders; white text only on `#2A5DAE`. Flat Clicky for icons and small marks, 3D Clicky for homepage/onboarding. Never redraw the artwork; `pnpm icons` regenerates assets from `brand-source/`.

## Checks before every commit
`pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build`, plus `pnpm e2e` when the customer journey changed (see the checklist for the local stack).

## Not now
Customer-facing agents are planned in `docs/agents/AGENT_ROADMAP.md`. Do not build them without the owner's approval.
