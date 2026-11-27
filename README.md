# Something Clicks

A customer-facing platform with an integrated AI Marketing Agent for small businesses.
Stack: **Next.js 16 (App Router) · TypeScript · Supabase (Postgres, Auth, RLS) · Stripe · Resend · Vercel.**

This repository is the **development product**. Nothing here has been deployed, no production migrations have
been run, and no Stripe products or prices have been created or changed. See [docs/STATUS.md](docs/STATUS.md) for
exactly what works, what is blocked, and what needs your approval.

## What the customer experiences

1. Enters their **website and ZIP code** on the home page → an anonymous **preview** (one evidence-backed result).
2. **Signs up** → the preview becomes their saved workspace (profile facts keep their source; findings become Action Cards).
3. **Action Board**: findings ranked by priority, each with evidence (exact quotes / metrics), why it matters, a
   recommendation, confidence, effort and status.
4. **Drafts**: real, editable deliverables (headlines, page copy, SEO titles, service pages, blog articles, emails,
   social posts, FAQs, campaigns…) with version history. Unsupported claims (awards, statistics, guarantees,
   testimonials…) are flagged and block approval until the customer confirms them.
5. **Approve → request → authorize → execute → verify** are separate, server-enforced, audited steps.
6. **Business Profile**, **Research library**, **Insights**, **Progress**, **Strategy**, **Campaigns** (with dependencies),
   **Performance** reports, **Sites & Brand** (multiple websites/locations), **Plan & billing** (Stripe, four products).

## One agent, four plans

All four plans are levels of the same central Marketing Agent. The plan decides which capabilities are unlocked; the limits are
enforced server-side (services call the plan gate, so they hold whichever way work is started).

| | Marketing Report | Marketing Assistant | Marketing Studio | Marketing Suite |
| --- | --- | --- | --- | --- |
| Price | $49 one-time | $79/mo or $756/yr | $179/mo or $1,716/yr | $399/mo or $3,828/yr |
| Website review, evidence-backed findings, priorities, next steps | one review | yes, ongoing | yes | yes |
| Regular (scheduled) website reviews; fixed issues auto-marked resolved | | yes | yes | yes |
| Drafts to edit & approve (headlines, page copy, SEO, service pages, FAQs, emails, social) | | yes (20/mo) | yes (80/mo) | yes (250/mo) |
| Approval, action tracking, progress tracking, results reporting | | yes | yes | yes |
| Competitor / keyword / market research, insights | | | yes | yes |
| Advanced content (articles, briefs, sequences, newsletters, lead magnets, scripts, calendars, local pages) | | | yes | yes |
| Marketing plan, campaign planning with dependencies | | | yes | yes |
| Multiple websites, business locations, shared brand + per-site overrides, brand consistency checks | | | | yes (5 sites, 25 locations*) |

\* Website/location allowances were "to be confirmed" in the business plan; these are working defaults awaiting owner approval.

Free use (business plan): 3 free uses (1 anonymous preview + 2 after signup); a use counts only when a completed output is saved:
errors, blocked attempts and retries never count. Saved work stays readable after a plan changes or is cancelled.

## Architecture

```
src/
  agent/                 Framework-agnostic Marketing Agent (no Next.js imports)
    orchestrator/        Central orchestrator: classify → authorize → preflight → plan → queue → checkpointed run
    capabilities/        Business Intelligence · Market Research · SEO · Analysis/Action Cards · Strategy ·
                         Content · Campaigns · Execution · Performance
    plans.ts sites.ts    Plan gate (features per plan) · websites & locations · brand.ts · insights.ts (Studio, progress)
    providers/           Provider-neutral LLM interface, validated structured output (zod, retries), OpenAI-compatible
                         adapter (hosted or self-hosted), dev-only mock
    website/             SSRF-safe fetcher (DNS pinning, redirect re-validation), HTML extraction, priority crawler
    profile/             Persistent Business Profile with provenance, trust ranking, conflicts, freshness
    security/            Claim guard, untrusted-content fencing, rate limiting
    store/               Tenant-scoped Table interface: in-memory (tests/dev) and Supabase adapter; authz; audit log
  server/                App services: Supabase clients, auth, container, entitlements, Stripe, Resend, previews
  app/                   Next.js pages, server actions, route handlers (stripe webhook, jobs runner, export)
supabase/migrations/     Schema + Row Level Security
tests/  e2e/  scripts/   Vitest, Playwright (browser), Lighthouse
```

Key design rules (from the specification): one orchestrator, modular capabilities; structured, validated model output;
evidence classes (verified / inferred / estimated / unknown) on every finding; website text is untrusted data;
the model can never grant a permission; every approval and execution check runs server-side.

## Run it locally (no external services needed)

```bash
npm install
cp .env.example .env.local   # then for local-only development add:
#   DEV_MODE=1  DEV_FIXTURE_SITES=1  LLM_PROVIDER=mock  ANONYMOUS_PREVIEW_ENABLED=true
npm run dev
```

`DEV_MODE` gives in-memory data and cookie sign-in, `DEV_FIXTURE_SITES` serves fake websites (e.g. `summitplumbing.example`),
and `LLM_PROVIDER=mock` uses a deterministic stand-in. **All three are refused in production** (see "Safety" below). Mock
output is labelled "Demo mode" everywhere it is shown.

## Test it

```bash
npm run typecheck
npm test                 # Vitest: agent, security, isolation, billing, RLS (real Postgres engine via PGlite)
npm run e2e              # Playwright: full customer journeys in a real browser, mobile + desktop, axe accessibility
npm run build && PORT=3222 npx next start -p 3222 &
BASE=http://localhost:3222 npm run lighthouse:public   # performance/accessibility/best-practices/SEO, mobile + desktop
```

## Connecting real services (operations stage, not done here)

See [docs/OPERATIONS_HANDOFF.md](docs/OPERATIONS_HANDOFF.md): Supabase project + migration, model provider
(`LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY`), Stripe price IDs and webhook, Resend, background runner, cron.

## Safety

* The mock provider throws in production; `LLM_PROVIDER=mock` is ignored in production; with no model configured the
  app returns "No AI model is connected" rather than fabricating output.
* `DEV_MODE` (in-memory data, cookie auth) aborts startup in production. Fixture websites load only in `DEV_MODE`.
* Mock-generated drafts and strategies cannot be approved or actioned in production, even if they somehow exist.
* The agent can only prepare drafts. Publishing, email-campaign sending, social scheduling, ad spend, billing changes,
  account changes and contractual commitments are **not implemented**; spend/billing/account/contract/third-party
  actions are permanently refused server-side.
