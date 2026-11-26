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
- Next.js 16 App Router, strict TypeScript, plain CSS (`src/app/globals.css`, mobile first at 390px), Supabase (Postgres, Auth, RLS), Stripe, Resend, Vercel (+ Cron), Vitest, pnpm.
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
- **No external AI provider, ever (owner decision, Nov 25 2026).** Something Clicks does not use Anthropic, OpenAI, Gemini or any paid hosted AI API, never holds such a key, and never treats its absence as a blocker. Do not add one, request one, or add an SDK for one. The plan to run our own model is `docs/agents/OWN_MODEL_PLAN.md` (an open-weight model we host; say "adapted from <base>" never "our own model" unless we trained it from scratch).
- Model calls go only through `src/lib/server/agent/provider.ts`. One adapter is registered: `self-hosted` (`providers/self-hosted.ts`), the chat-completions protocol to a model server WE run. It is inert unless `MARKETING_MODEL_PROVIDER=self-hosted` and `SELF_HOSTED_MODEL_URL/TOKEN/ID` are valid, never runs in Production, and an unpriced model is refused by metering (`SELF_HOSTED_PRICE_*` come from measurement only). With nothing configured `getModelProvider()` is null and model-written capabilities report "blocked" (tested). **No model server exists yet: the adapter is protocol-tested against a stand-in only (model inference verified: none).** Evaluation: the frozen dataset (14 fictional cases, ground truth, 8-capability 1-5 scoring, pass thresholds, two-consecutive-rounds rule) is in `evals/model/`, documented in `docs/agents/EVALUATION_FREEZE.md` (generated; `pnpm modelfreeze` verifies it). Commands: `pnpm modelcheck` (run cases against our model server), `pnpm modelscore` (blind, score, compare, record rounds). **Never change a case, threshold or rubric after a model has run without a logged re-freeze; never lower a bar to make a model pass.** Tests use answer-key stand-ins that prove the machinery, not model quality. Never add a mock model or stand-in answers; test doubles in tests prove checking rules only, never capability. Verification words: *functionality verified* (tests), *model inference verified* (a real model ran: none yet), *model quality verified* (met `EVALUATION.md`: none yet), *not implemented*.
- Feature switches (`src/config/features.ts`): `drafts`, `businessProfile`, `modelFindings`, `strategy`, `campaigns`, `agent`. Off unless `FEATURE_<NAME>=1`, and always off in Production. Releasing one to customers is an owner decision and a code change. Server-only: pass booleans to client components.
- Every model output is grounded by Something Clicks before it is stored (`agent/grounding.ts`): quotes must appear on the cited page, figures must be in the source, promises are refused.
- The old Anthropic-specific wording and draft code (`ai.ts`, `drafts.ts`), the `anthropic-dev` adapter and the hosted-API evaluation harness were removed (Nov 25 2026). Card wording is fixed text; drafts need a model and are blocked without one.
- Works without any model today: website checks, ranking, Action Cards, approvals, structured business profile (contact details, schema.org data, quoted trust statements), and a **rules-based plan** (`modules/rules-strategy.ts`; labelled "fixed rules" in the product; not AI reasoning; ignores free-text notes).

## Marketing Agent
- Map of the specification to the code, what is built and what is not: `docs/agents/MARKETING_AGENT.md`. Keep it current.
- One orchestrator (`src/lib/server/agent/orchestrator.ts`) runs all six workflow kinds and records each in `marketing_workflows`: it understands the request (`intake.ts`, fixed rules; asks when unclear), loads only the memory that kind needs (`context.ts`), plans the capabilities (each runs as checks, model, labelled fixed rules, or is unavailable), runs them through the module registry (`src/lib/server/agent/modules/`) and saves the results. Customer entry point: `ask` in `src/app/actions/agent.ts`. Never put workflow logic in a server action; never export a function taking an org id from a `"use server"` file (put it in a server-only module, like `plan-run.ts`). A capability that cannot run reports "blocked" and never returns placeholder output.
- Four evidence classes (verified / inferred / estimated / unknown, `src/lib/evidence.ts`) on findings and business facts, enforced in the database.
- Business Intelligence stores facts in `business_facts` with source, evidence class, basis and freshness. The agent only proposes; the owner confirms (`/app/business`, behind `businessProfile`).
- Drafts: Content Creation prepares version 1; edits are new versions (`draft_versions`); only the owner approves a specific version. Model findings never count as verified fixed.
- Memory and execution (`agent` switch, no model; migration 20261204120000): Research Library (`research_items`: owner-supplied Semrush / Search Console exports or own list, with source, measured date, evidence class; Semrush figures are *estimated*), Performance History (`performance_metrics`: supplied figures only; compare only adjacent equal periods; never attribute a change to work), execution records (request → owner authorizes → carried out → verified by a later check; only `save_to_workspace` and `record_completed` are supported; publishing, sending, social scheduling and ad spend are recorded as unsupported and never run), Action Card `effort` / `depends_on` (fixed rules, `card-dependencies.ts`). Screens: `/app/ask`, `/app/library`, `/app/results`, and the "Getting it done" panel on each action.
- Durable background jobs (Trigger.dev, `trigger.config.ts`, tasks in `src/trigger/`): tasks are thin wrappers that call the orchestrator through `src/lib/server/agent/background.ts`; never put business logic in a task. On only with `BACKGROUND_JOBS=trigger` + `TRIGGER_SECRET_KEY`, never in Production; otherwise work runs in-process as before. `TRIGGER_SECRET_KEY` (development key) goes in `.env.local` only. Code loaded by the worker must not import `next/headers`, `next/cache` or other request APIs at module load.
- Compare + Campaigns (`campaigns` switch, no model): `market-research.ts` reads only public homepages the owner names; `campaign-planning.ts` runs fixed playbooks (`src/lib/campaigns.ts`) offered only when something observed calls for them; tasks carry evidence class + basis; drafts are fixed templates filled only from owner-given or confirmed facts; owner approves (`decide_campaign`), members mark tasks done; nothing is published or sent.
- Stages: prepared → approved (owner only) → completed (marked done, or verified fixed). Never mark generated work completed.
- Every model call is metered per business (`agent/metering.ts`: reserve the worst-case cost before the call and settle after, both through key-gated `reserve_model_call` / `settle_model_call` that need the server-only `MODEL_USAGE_KEY`; daily/monthly/global caps; unpriced models and calls without the key are never made). Wrap any new model call with `meteredProvider`. Functions that store model-produced work also refuse unless `app_config.agent_functions_enabled` = 1 (0 in Production).
- Marketing Strategy (`agent/modules/marketing-strategy.ts`, `/app/plan`, behind `strategy`): proposed plans only; priorities point at real open Action Cards; the owner approves; approval is agreement, never completion.
- Quality: `src/lib/agent-quality.ts` screens output; `/admin/agent-review` (platform admins, never Production) shows output beside evidence. Generic advice, promises and unsupported figures are dropped at generation.
- Internal identity is "the Something Clicks Marketing Agent". Customer-facing words stay simple and match the website; that copy rule governs wording, not what we build.
- Plan names (app only; Stripe unchanged): Marketing Report $49; Marketing Assistant ($79/$756) is on hold and cannot be bought; Marketing Studio and Marketing Suite are planned tiers.
