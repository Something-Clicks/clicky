# Something Clicks — instructions for Claude Code sessions

Something Clicks is building its own **Marketing Agent** for small businesses: it understands the business, analyzes its marketing, prepares the work, the owner approves, and it tracks the outcome. The architecture is the owner's specification (`AI_MARKETING_AGENT.docx`; map and status in `docs/agents/MARKETING_AGENT.md`). An external language model is only a replaceable intelligence provider; Something Clicks owns the agent, its capabilities, data, controls and customer experience. Live at https://somethingclicks.com.

## Before you change anything
- Read `docs/launch/LAUNCH_CHECKLIST.md` (what's done, what's next, how to resume).
- Branches: `main` is the Vercel production branch. Never push to `main` or `claude/fervent-knuth-0fo94q`. Work on a `claude/*` branch; pushes there make preview deployments only.
- Never force-push, delete branches, or discard uncommitted work.

## Database safety
- Migrations in `supabase/migrations/` are additive and reversible; every one has a rollback in `supabase/rollback/`.
- **Never apply a migration or run write SQL against the production Supabase project ("Clicky", `ysmwnxvyjougetdlpnba`) without the owner's explicit approval.** Read-only inspection is fine.
- **clicky-dev** (`ofstvbgaoznipsiqbjjp`) is the only project where write testing is allowed. Before any write or migration, confirm the target ref is `ofstvbgaoznipsiqbjjp`; abort otherwise. Migrations there were applied in order, then the launch migration.
- Test locally: `pnpm test:db` runs every migration on a throwaway local Postgres (`PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres`). Local Postgres is not full Supabase validation; also check Supabase-specific details (roles, auth.users columns, constraint names, advisors) read-only.

## Architecture
- Next.js 16 App Router, strict TypeScript, plain CSS (`src/app/globals.css`, mobile first at 390px), Supabase (Postgres, Auth, RLS), Stripe, Anthropic, Resend, Vercel (+ Cron), Vitest, pnpm.
- Customer requests run as the signed-in user (RLS always applies). No service-role key in customer paths.
- Privileged writes go through `SECURITY DEFINER` functions that check the caller. Server-only keys, stored hashed in `app_private.secrets`:
  - `BILLING_WEBHOOK_KEY` → `billing_*` functions (Stripe webhook only).
  - `SITE_SERVER_KEY` → `site_*` functions (anonymous first result, feedback, funnel counts).
- Analysis: `src/lib/server/analysis.ts` (`analyzeWebsite`) = safe fetch → scan → checks → optional wording. Shared by the workspace and the anonymous preview. Every card cites evidence labeled observed / measured / missing.
- Drafts: Content Creation module (`agent/modules/content-creation.ts`), draft-only; editable versions; the owner approves a version (`approve_draft_version`). Nothing is ever published for the customer.
- Free uses: three per person/business (`app_config.free_run_limit`), enforced in `start_analysis` / `start_agent_run`. First use can be anonymous; Save this + `claim_preview` moves it into an account (works across browsers; same verified email + single-use token).
- Prices and Stripe ids: only in `src/config/pricing.ts` (per mode; never borrow ids across modes). Paid access only from the verified webhook.
- Homepage headline: only in `src/config/site.ts`.
- SEO: titles, descriptions, canonical URLs and social cards only in `src/config/seo.ts` (production domain `https://somethingclicks.com`). `/sitemap.xml` lists only the pages in `PAGE_SEO`; auth, results, draft legal pages and signed-in areas are noindex. No "AI" in metadata until AI features are live and the Privacy Policy says so (owner decision, Nov 24 2026).
- Analytics (GA4, Clarity) load only after consent (`src/components/consent.tsx`). Supabase `funnel_events` holds counts with no personal data.

## Product and copy rules
- Plain, short, friendly. Show the work, don't explain the technology.
- In customer-facing copy never say "AI", "agents", or "prompts"; say "drafts", never "campaigns". (Exceptions: the draft Privacy Policy/Terms, and the exact research attribution.)
- Never invent business facts, results, integrations or features. Only show features as available when they work; otherwise "Coming soon".
- One primary action per screen. Touch targets ≥ 44px. No horizontal scrolling at 390px.
- Brand: Click Blue `#3977D5` for marks/borders; white text only on `#2A5DAE`. Flat Clicky for icons and small marks, 3D Clicky for homepage/onboarding. Never redraw the artwork; `pnpm icons` regenerates assets from `brand-source/`.

## Environments and secrets
- Vercel Preview for this branch points at clicky-dev and Stripe **TEST**; Production variables are never edited from a session without the owner's explicit approval (run an env snapshot before and after, and compare).
- Never add `STRIPE_ALLOW_LIVE`, never use live Stripe keys in tests. Stripe ids per mode: `src/config/pricing.ts` (`STRIPE_CATALOG`), never borrowed across modes.
- Secrets saved through the secure prompt are never visible to a session (a proxy attaches them); do not ask users to paste secrets in chat. Generated dev keys: print hashes only.
- Signed-in journey tests: `tests/e2e/journey.spec.ts` (`E2E_FULL=1`, clicky-dev + Stripe TEST). Test users/reset: `tests/e2e/dev-seed.sql`, `dev-reset.sql` (clicky-dev only, opt-in guard). Steps: `docs/launch/LAUNCH_CHECKLIST.md`.

## Checks before every commit
`pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build`, plus `pnpm e2e` when the customer journey changed (see the checklist for the local stack).

## Model providers, feature switches and drafts
- Model calls go only through `src/lib/server/agent/provider.ts`. One temporary development adapter is registered (`anthropic-dev`, Claude Sonnet 5.5, `providers/anthropic-dev.ts`). It runs only with `MARKETING_MODEL_PROVIDER=anthropic-dev` and `ANTHROPIC_API_KEY`, and never in Production (`VERCEL_ENV=production` → no provider). An API key alone activates nothing (tested). Never add a mock model or stand-in answers.
- Feature switches (`src/config/features.ts`): `drafts`, `businessProfile`, `modelFindings`. Off unless `FEATURE_<NAME>=1`, and always off in Production. Releasing one to customers is an owner decision and a code change. Server-only: pass booleans to client components.
- Every model output is grounded by Something Clicks before it is stored (`agent/grounding.ts`): quotes must appear on the cited page, figures must be in the source, promises are refused.
- The older Anthropic-specific code (`src/lib/server/ai.ts`, `drafts.ts`) is retired and dormant (needs `MARKETING_LEGACY_WORDING=1`, which nothing sets); do not delete it. Drafts now come from the Content Creation module.

## Marketing Agent
- Map of the specification to the code, what is built and what is not: `docs/agents/MARKETING_AGENT.md`. Keep it current.
- One orchestrator (`src/lib/server/agent/orchestrator.ts`) runs every website check and records it in `marketing_workflows`. It reaches capabilities only through the module registry (`src/lib/server/agent/modules/`), one module per capability in the specification. Unbuilt capabilities report "blocked" and never return placeholder output.
- Four evidence classes (verified / inferred / estimated / unknown, `src/lib/evidence.ts`) on findings and business facts, enforced in the database.
- Business Intelligence stores facts in `business_facts` with source, evidence class, basis and freshness. The agent only proposes; the owner confirms (`/app/business`, behind `businessProfile`).
- Drafts: Content Creation prepares version 1; edits are new versions (`draft_versions`); only the owner approves a specific version. Model findings never count as verified fixed.
- Stages: prepared → approved (owner only) → completed (marked done, or verified fixed). Never mark generated work completed.
- Internal identity is "the Something Clicks Marketing Agent". Customer-facing words stay simple and match the website; that copy rule governs wording, not what we build.
- Plan names (app only; Stripe unchanged): Marketing Report $49; Marketing Assistant ($79/$756) is on hold and cannot be bought; Marketing Studio and Marketing Suite are planned tiers.
