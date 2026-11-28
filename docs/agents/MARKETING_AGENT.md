# The Something Clicks Marketing Agent: architecture map and status

The owner's specification (`AI_MARKETING_AGENT.docx`) is the architecture. This document maps each part
of it to the code and says honestly what is built. Updated Nov 26 2026 (request understanding, memory, execution, results).

**Status words.** *Built*: runs in the app and is covered by unit and database tests (local Postgres; the
migrations also on clicky-dev). *Built, not verified live*: the code path runs end to end with a test-double
model in tests, but has never been run with a real model or on a real website (see Verification).
*Not built*: designed, reports "blocked" if a workflow asks for it.

## Independence and what is verified (Nov 25 2026)
Something Clicks uses no external hosted AI. Plan to run our own: `docs/agents/OWN_MODEL_PLAN.md`. The agent software is ours; a future model would be an open-weight base we host (licence-bound), never described as a model we created.

| Capability | Without a model | Functionality verified | Model inference verified | Model quality verified |
|---|---|---|---|---|
| Website Intelligence, SEO checks, ranking, Action Cards, approvals, verification | Complete | Yes (unit, database, build; fixtures, not yet real sites) | n/a | n/a |
| Business Intelligence: contact details, services from links, schema.org data, quoted trust statements, review screen | Complete | Yes | n/a | n/a |
| Marketing Strategy | **Rules-based plan** (fixed rules; no prose generation; no notes) | Yes (unit + database) | n/a (it is not a model) | n/a |
| Language understanding of a site; model findings; plan wording; Content Creation (drafts) | **Blocked** (needs a model) | Checking rules only, with test doubles | **No** | **No** |
| Market Research (named public homepages), Campaign Planning (fixed playbooks), guided task tracking | **Complete** (behind `FEATURE_CAMPAIGNS`, never Production) | Yes (unit + database; fixtures, not real sites; screens not yet browser-tested) | n/a | n/a |
| Request understanding (Ask), all six workflows through the orchestrator, Research Library (keyword imports), Performance History (supplied figures), execution records (save approved draft, record done), effort and dependencies | **Complete** (behind `FEATURE_AGENT`, never Production) | Yes (unit + database + browser on the local stack, desktop and phone, real public site) | n/a | n/a |
| Execution that publishes or sends | Not implemented (no authorized integration exists; requests are recorded as "unsupported" and never run) | Refusal verified | No | No |


```
Customer request ─► Orchestrator (src/lib/server/agent/orchestrator.ts)
                      │  plans with workflows.ts (only the capabilities a request needs)
                      │  records every run in marketing_workflows (steps, capabilities, result, errors)
                      ▼
                    Capability modules (src/lib/server/agent/modules/, one per capability, §2.2)
                      │  contract: typed input → { done, output, detail } | { blocked, reason }
                      ▼
                    Data: business_facts · analyses / analysis_evidence · action_cards · approvals ·
                          agent_runs · marketing_workflows · activity_log  (RLS on all; writes via checked functions)
                      ▼
                    Model provider (provider.ts): provider-neutral, validated structured output,
                    one retry, no mock. Registry empty in the app.
```

## Capabilities (§2.2)
| Capability | Module | Status |
|---|---|---|
| Business Intelligence (§3, §14) | `business-intelligence.ts`, `business-understanding.ts` | **Built.** Fixed extraction (phone, email: verified; services: inferred with basis). **Model part built, not verified live:** what the business does, services, products, audience, customer problems, value proposition, voice and tone, positioning, trust signals, price positioning, buyer objections and decision factors (no guessing: an honest "unknown" beats a guess), each with quotes that Something Clicks checks against the page. Owner review screen `/app/business` (confirm, correct, reject, add) behind `businessProfile`. |
| Website Intelligence (§5) | `website-intelligence.ts` | **Built.** Safe discovery of the homepage and up to 4 key pages; metadata, text, link labels, email links; failures recorded; mobile speed when available. |
| SEO Intelligence (§4.3) | `seo-intelligence.ts`, `lib/research-import.ts` | **Built for on-page signals and supplied keyword data.** Keyword research comes from the owner's existing manual Semrush workflow (CSV export) or a Search Console Queries export, parsed as untrusted data and stored in `research_items` with source, measured date and evidence class (Semrush volumes/difficulty = *estimated*, with the basis; Search Console = *verified* measurement; own list = the owner's terms, no figures). No keyword API is connected. |
| Marketing Analysis (§6) | `marketing-analysis.ts`, `marketing-analysis-model.ts` | **Built for fixed checks.** **Model part built, not verified live:** messaging, conversion and content findings with quoted evidence, saved as Action Cards (origin `model`) behind `modelFindings`; never marked "verified fixed". |
| Performance Intelligence (§11) | `performance-intelligence.ts` | **Built on real data only.** Outcomes (verified fixed / still found / awaiting), executed work and whether a check verified it, and figures the owner supplies (`performance_metrics`: per period and source). Compares a metric only with the adjacent earlier period of the same length and source; "meaningful" needs ≥10% and a minimum absolute change; always states it cannot attribute a change to a piece of work or account for seasons. Follow-ups: reopen work still found, look at drops, ask for data when there is none. No traffic integration. |
| Content Creation (§8) | `content-creation.ts` | **Built, not verified live.** Homepage copy and SEO title/description from the business understanding and the card's evidence; content rules enforced; version 1 → edits as versions → owner approves a version. Behind `drafts`. |
| Market Research (§4) | `market-research.ts`, `lib/research.ts` | **Built (no model).** Reads the public homepage of up to 5 sites the owner names and the owner's own; records what each visibly shows (phone, tap-to-call, service area, reviews, prices, search markup) as verified-as-observed signals; comparison table on `/app/research`; saved in `competitor_scans` (re-read keeps the earlier result). Does not find competitors, and has no keyword or traffic data. |
| Marketing Strategy (§7) | `marketing-strategy.ts` | **Built, not verified live.** A proposed plan from the business understanding and the open Action Cards: summary, ≤3 objectives, ≤8 ordered priorities that point at real open actions (by short reference, never ids the model could invent), effort, dependencies that must come earlier, next steps, questions for the owner, what to leave for later. Grounding drops unknown or repeated actions, promises, figures not in the material and generic advice. Owner reviews, revises (adds notes → a new proposal), approves or rejects at `/app/plan` behind `strategy`. Approval = agreement, never completion. Market research is not connected, so plans use only the business's own details and website findings. |
| Campaign Planning (§9) | `campaign-planning.ts`, `lib/campaigns.ts` | **Built (no model for the plan; a model writes optional drafts).** Campaigns now carry a **brief** (aim, audience, offer, message, channels, measurement; unknown parts stay empty), a **channel, schedule and dependencies per task** (a task cannot be marked done before what it depends on: no email to a page that is not live; enforced in the database), and a fifth playbook **promote a service** (only for a service the owner confirmed). Content Creation can write a draft for each page, email, social post, Google post or text (`runCampaignDrafts`, metered, one at a time per business), stored beside the fixed template and the owner's edit by `save_task_model_draft` (server key + database switch). Migration 20261205120000. Earlier: Four fixed playbooks (fix what visitors notice first, close gaps other sites show, ask for reviews, Google Business Profile), each offered only when something observed calls for it. Tasks carry a reason, an evidence class and a basis, with fixed-template drafts filled only from owner-given or confirmed facts (unknowns stay `[blanks]`). The owner approves a campaign (`decide_campaign`, owner only), edits drafts (original kept), does each task and marks it done (`set_task_status`, only after approval); a campaign completes when every task is done or skipped. Results: tasks done, and for fixes what the next website check verified. Migration 20261203120000. |
| Marketing Execution (§10) | `marketing-execution.ts`, `execution_records` | **Built for what the application itself can do.** `save_to_workspace` (copies the exact approved draft version into the record) and `record_completed` (the team did it; reported until a check verifies it). Requested by any member → authorized by the owner only → carried out → verified by the next website check (trigger on `action_cards.verification`): five separate recorded events. Idempotency key per request, one open request per action and target, 100 requests per business per day. `publish_website`, `send_email`, `schedule_social`, `spend_ads` have no integration: recorded as *unsupported*, never authorized or run. |

## Feature switches
`src/config/features.ts`: `drafts`, `businessProfile`, `modelFindings`, `strategy`, `campaigns` (Compare and Campaigns screens; needs no model). Off unless `FEATURE_<NAME>=1`; always off
in Production. Customers in Production see none of the model-assisted work.

## Cost control (§16)
**Built; database side tested on a throwaway Postgres (including 12 parallel reservations against one cap, and a mutation check that the test fails without the lock) and on clicky-dev (migrations 20261129, 20261130).**
Every model call goes through `meteredProvider` (`metering.ts`):
1. **Reserve.** Before the call the app asks the database to reserve the call's worst-case cost (`reserve_model_call`): the business's daily ($0.50) and monthly ($5) caps and the global daily cap ($20) are checked and the reservation is recorded in one step under a lock, so parallel requests cannot together pass a cap. The worst case is the full output allowance plus an input estimate that cannot be pushed under by unusual text (CJK, emoji).
2. **Settle.** After the call the reservation is replaced by the actual tokens and cost (`settle_model_call`). A call that failed after being sent is settled at the full reservation (it may have been billed); a request the provider rejected outright (4xx) at nothing. A lost settlement leaves the reservation counted.
3. **Key.** Both functions need `MODEL_USAGE_KEY`, a server-only secret (only its hash is in `app_private.secrets`), so a signed-in customer cannot create, change or inflate usage. `record_model_usage` no longer exists. Without the key, or without a published price for the model (`pricing.ts`), no call is made. The dev adapter does not retry on its own (`maxRetries: 0`), so each attempt is a metered call.
Each business counts toward the global cap at most up to its own daily cap. Customers see only "usage limit reached, try again later". Platform admins see spend per business, with failed and unsettled calls (`admin_model_usage`). If the migrations or the key are missing, model calls are refused (fail closed).
**Known limits:** (1) a few dozen accounts could together use up the $20 global cap for a day (each can spend its own $0.50, and a plan has no per-person rate limit); fine on Preview where only testers exist, needs an admission limit before any customer-facing release. (2) Costs are computed by the app from published prices, so a wrong price table means wrong costs. (3) Duplicate submits: the "one plan at a time" guard reads reservations in the app, so two clicks within milliseconds can both pass it (and the schema retry leaves a short gap); the caps still bound the spend, so the cost is a duplicate plan, not a cap bypass. The fix is to make the check part of `reserve_model_call`. (4) A call that fails before it is sent without a status code (for example a bug that throws before the request) settles at the full reservation, so a deterministic failure can use up a business's daily allowance in a few tries; it errs toward spending less. (5) A website review makes two model calls after the fetch and could pass the 120 s page limit in a bad case; the process is then killed, reservations stay counted and the workflow record stays 'running' for up to 15 minutes (the customer's check itself finishes first). Needs one request-wide deadline or a background job before any customer release. (6) A model call is made before the database is asked to store its result: if a `FEATURE_*` switch is on but `agent_functions_enabled` is 0 on that database, the call is paid for and then refused; keep the two settings together. (7) Rolling back 20261130 restores the old open recording function and drops in-flight reservations: only for a deliberate revert.

## Admission, slots and deadlines (migration 20261202, Opus-reviewed)
The four model-storing functions need the server key as a request header (`x-agent-key`, sent by the server-side Supabase clients only; checked against the same hashed secret as reserve/settle) as well as the database switch. Per business: at most 30 model calls an hour. Per person: at most $1 of model spend a day across every business they act for. Plans take a database slot (`acquire_agent_slot`, 150 s expiry, released in `finally`), so repeated submissions get "already being prepared". Every model call gets what is left of one request-wide deadline (about 100 s from the start of the request); no attempt starts with under 12 s left. The weekly worker checks at most 2 businesses per run (300 s limit). Output allowances are 4,000 tokens for a plan, 5,000 for findings, 6,000 for understanding, 4,000 for a draft, which keeps worst-case reservations small.
**Known and accepted:** the worker (service role) has no person, so the per-person cap does not apply to it (the business caps do); a few timeouts settle at their full reservation and can use a person's $1 for the day (conservative; tune the cap with real numbers); one member can use a business's shared limits or hold the plan slot for up to 150 s (members are legitimate users); the server key is sent on every server-side Supabase request, including sign-in checks, to the same Supabase project that already receives it in RPC bodies, never to the browser.

## Server-only functions (independent review, Nov 25)
`add_model_findings`, `propose_business_facts`, `save_marketing_plan` and `complete_agent_run` are called by the app on behalf of the signed-in member, so a member could call them directly. Migration 20261201 makes them refuse unless `app_config.agent_functions_enabled` = 1 (0 in every migration, on only on clicky-dev), so Production stays closed even if the app's switches were bypassed. They now also require the server key (migration 20261202), so a tester cannot call them directly either. The orchestrator no longer learns about the business or calls a model at all unless one of the switches needs it.

## Quality screening and admin review (§3.4, §6)
**Built.** `src/lib/agent-quality.ts` scores evidence, support for claims, business relevance, usefulness and actionability
(0-100, or "nothing to judge") and lists flags: facts or findings without quoted evidence, inferences without a basis,
promises, figures the evidence does not show, generic advice, not-specific items, vague actions. It is fixed code applying the
same rules every time: a screening aid, not a verdict; it cannot tell whether a quote was understood or advice is right.
`/admin/agent-review` (platform admins; **not available in Production**: the page is hidden there and the database function is off unless `app_config.agent_review_enabled` = 1, which is set only on clicky-dev; contact details are left out; each view logged) shows recent runs with facts, findings and the plan
beside their evidence, the flags, and model spend. Generation-time safeguards (generic advice, promises, unsupported figures) drop items before they are stored.

## Verification
| What | Status |
|---|---|
| Grounding and rejection rules, versions, owner-only approval, evidence classes, isolation | Verified by unit and database tests |
| Database functions on clicky-dev | Verified (apply → checks → rollback → re-apply), including 20261129 (existing rows kept: 4 businesses, 42 cards) |
| Independent security review (Opus) of the migration, metering, plan and admin paths | Done; findings fixed or recorded above (global-cap bound, plan shape validated in the database, stricter promise rule, review switch, no unmetered provider path, prompt escaping) |
| Metering, strategy grounding, quality screening | Verified by unit tests with hand-written inputs and a test double (**simulated**: proves the rules, not model quality) |
| Real model output (inference) and its quality (understanding, findings, drafts) | **Not verified, and not possible yet**: no external AI provider is used (owner decision), and no self-hosted model exists. The path is `OWN_MODEL_PLAN.md` (phases 1–2) |
| Real websites | **Not verified.** The sandbox cannot reach public websites |
| Signed-in screens (`/app/business`, draft editing) in a browser | **Not verified.** Needs the Preview with test accounts |

## Orchestrator and workflows (§12)
**Request understanding** (`intake.ts`, `routeRequest`): fixed phrase rules pick one of the six workflows; a tie or no match
returns a choice for the customer (never a guess); web addresses in the request are extracted for comparison. The text only
selects a workflow and is never executed or passed on as instructions. A model can replace `scoreKinds` later behind the same
result type. **Workflow planning** records, per capability, how it runs: `checks`, `model`, `rules` (Marketing Strategy's labelled
fixed-rules path when no model exists) or `unavailable` (Content Creation without a model).
**Context** (`context.ts`, `loadAgentContext`): each kind loads only the memory it needs (`CONTEXT_NEEDS`): business facts,
open/tracked cards, previous decisions (dismissed actions with notes, rejected plans, dismissed campaigns), the Research Library
(older than 90 days is flagged and not used as current), performance figures and executions, the approved plan. Always as the
signed-in user, so RLS bounds it.
**All six kinds run and are recorded in `marketing_workflows`:**
- `website_review` (`runWebsiteReview`): understand → plan → Website Intelligence → Marketing Analysis → SEO → BI proposals →
  rank → **effort and order saved on the cards** (`card-dependencies.ts` → `annotate_action_cards`) → Action Cards → drafts → owner.
- `marketing_plan` (`runMarketingPlan`; `preparePlan` and Ask both use it through `plan-run.ts`): BI + decisions → Research
  Library → latest check → open actions with dependencies → Marketing Strategy (model, metered against the workflow; or fixed
  rules that order by dependencies, do not push previously dismissed advice again, ask for fresher research, and add a next step
  from the owner's own keyword data) → saved proposal → owner decides.
- `results_review` (`runResultsReview`): Performance Intelligence → follow-ups → next action and approved-plan progress.
- `homepage_headline` (`runHomepageHeadline`): BI → latest check → the homepage-messaging action → Content Creation (a draft on
  that action when a model and drafts exist; otherwise recorded as blocked and nothing is written).
- `competitor_research`, `promotional_campaign`: as before (no model).
`ask` (`src/app/actions/agent.ts`) is the customer entry point for all of them.

## Evidence and confidence (§6.3)
**Built.** Four classes in `src/lib/evidence.ts`, enforced in the database (migration 20261127120000):
- Action Cards from fixed checks: class derived from the evidence they cite; cannot be set otherwise.
- Model findings (future, origin `model`): verified must cite observed/measured evidence; inferred must cite
  evidence and state a basis; estimated must state a basis. Checked at commit.
- Business facts: the same rules, plus owner-supplied or owner-confirmed facts count as verified; unknown
  facts record what is missing and carry no value.

## Action Cards, approvals, execution (§10, §13)
**Built:** card fields, stages prepared → approved (owner only) → completed (marked done or verified fixed),
evidence class per card, **effort and dependencies** (fixed rules: HTTPS and viewport before speed, title before description,
headline and service area before homepage content), editable drafts with versions, and the execution record on each card
(`ExecutionPanel`). Generated work is never "completed".

## Customer context and memory (§14)
**Built:** Business, Brand and Customer profile (`business_facts`, provenance and freshness, owner review at `/app/business`);
Research Library (`research_items` + `competitor_scans` + website checks, `/app/library`); Marketing Strategy store
(`marketing_plans`); Marketing History (cards, workflows, execution records, activity log); Performance History
(`performance_metrics`, `/app/results`); previous decisions read back into planning.
**Not built:** detecting *conflicting* facts between sources and asking the owner to resolve them (stale research is flagged).

## Model providers (§15)
Provider-neutral interface with **one adapter, `self-hosted`** (built Nov 26 2026): the chat-completions protocol to an open-weight model server Something Clicks operates (`providers/self-hosted.ts`; configuration in `.env.example`). It is inert until our server is configured, never runs in Production, fails closed when unpriced, follows no redirects, caps response size, never puts the token or server text in an error, and estimates token use high if the server omits it. **Verified so far: protocol, limits and metering with a local stand-in server (unit tests). Not verified: any real model, ever.** The Anthropic adapter was removed Nov 25; Something Clicks uses no hosted AI provider (`OWN_MODEL_PLAN.md`). Every model output is validated
against its schema (one retry) and grounded by Something Clicks (`grounding.ts`) before it is stored. Model and
token usage are recorded on each workflow and draft run.

### Groq (owner decision, Nov 27 2026)
Groq is the primary provider (`providers/groq.ts`, `providers/groq-schema.ts`); Modal and self-hosted are deferred; **OpenRouter is not built or enabled** (its free models can run on hosts that may train on prompts; verify per host first). Same grounding, metering, caps, slots and deadlines as before. Free-tier calls are priced with a shadow price (Groq's published paid rates in `GROQ_PRICE_*`) so the dollar caps still bind. **Verified:** adapter logic against a local stand-in server (25 checks: request shape, fixed address, key secrecy, no redirects, 429 handling, schema-mismatch retry, unpriced = refused). **Not verified:** any real Groq call, whether the chosen model accepts the prepared schemas, and model quality: no session so far could reach api.groq.com. Run `MODELCHECK_PROVIDER=groq MODELCHECK_SET=dev pnpm modelcheck` with the key, model and prices set. Production still refuses any model (`VERCEL_ENV=production`): enabling it for customers is a separate owner decision and code change.

### Adding a provider (the self-hosted adapter will be the first)
Capabilities never import a provider: they receive a `ModelProvider` (`id`, `model`, `generate`) and ask for a schema-validated answer through `generateStructured`. To switch: (1) add `providers/<name>.ts` implementing `generate` (structured output, per-request timeout, no SDK retries, report tokens and refusals); (2) register it in `PROVIDERS` in `provider.ts`; (3) add its model's published prices to `pricing.ts` (an unpriced model is never called); (4) set `MARKETING_MODEL_PROVIDER=<name>` and its key. Nothing else changes: grounding, metering, caps, slots, deadlines, screening and every screen are provider-independent. Tests that prove it: an unknown provider id and a key alone activate nothing; Production never has a provider; the metering and deadline tests use a provider that is not Anthropic's adapter.

## Security (§16)
Server-side only; RLS on every table; tenant-isolation tests for every new table and function; owner-only
review of business facts and approvals and plans; website text and owner notes treated as data; audit log; per-business
and global model spend caps (see Cost control). Not built: alerting on spend, a customer-visible usage screen.

## Real inference (Nov 26 2026)
First run of the whole loop on a real site (somethingclicks.com) with a real model (a 1.5B CPU model, Apache 2.0, local only): see
`END_TO_END_RUN.md`. **Model inference verified** (pipeline) for that model; **model quality not verified and that model is not good
enough**; the approved candidates have not run (they need a GPU). The run found a real hole (hollow model findings passed grounding)
that is now closed by guards in `marketing-analysis-model.ts`. Request deadlines now depend on where work runs (`deadline.ts`).

## Durable background jobs (Trigger.dev, Nov 27 2026)
**Built; registration with Trigger.dev not yet verified (needs the owner's login).** `trigger.config.ts` (project
`proj_zkgvxkwwahbxpdtqspfe`, `dirs: ["./src/trigger"]`, `maxDuration` 600 s, default retries 3 with backoff, `react-server`
build condition so `server-only` imports work in the worker). Tasks in `src/trigger/`:
- `smoke-test`: validates `{ message }` and echoes it; touches nothing else.
- `website-review`: runs a check a customer (or onboarding) already started, through `runWebsiteReview`; queue
  `marketing-agent` (4 at once); 3 attempts; a retry after the check finished does nothing; `onFailure` closes a still-running
  check as failed. The workflow record gets a `run_in_background` step with the attempt number.
- `weekly-recheck`: one business's weekly re-check (idempotency key per business per day); a retry continues the analysis its
  first attempt started instead of starting (and counting) another; `onFailure` closes it.
Where work runs is decided only in `src/lib/server/agent/background.ts`: on when `BACKGROUND_JOBS=trigger` and
`TRIGGER_SECRET_KEY` are set, never in Production. When off, or if queueing fails, the Check button and onboarding run
in-process with `after()` exactly as before, and the Vercel cron runs 2 businesses inline as before; when on, the cron queues
up to 25 due businesses. Tasks are thin wrappers: every decision stays in the orchestrator. The worker uses the same
service-role client as the cron worker (`createWorkerClient`), never a customer session, so it needs `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `MODEL_USAGE_KEY` and the same `FEATURE_*` values in its environment.
**Verified:** unit tests for the switch, idempotency keys, inline fallback, retry and failure rules (`tests/unit/background.test.ts`);
the worker bundle builds with the config's condition and all three tasks load (esbuild + Node, `react-server`). Found and fixed:
`src/lib/server/site.ts` imported `next/headers` at load time, which crashes a non-Next worker; it is now imported only where
request headers are read. **Not verified:** `trigger dev` / dashboard registration and any run on Trigger.dev: the login is waiting for the owner to approve it in a browser
(`pnpm exec trigger login --no-browser`, then `--code`). A retried `website-review` closes the workflow record its crashed attempt left
running; only the Vercel cron schedules (a test fails if a task adds its own schedule). The script is `pnpm trigger:dev` (the CLI binary is `trigger`).
**Not moved to background yet:** plans, results reviews and research (they finish within a request today).

## Next, in order
1. Turn `FEATURE_AGENT` on for Preview (owner decision) and run the Ask → Research → Execute → Results loop on 3–5 permissioned
   real small-business sites with test accounts; record defects.
2. Conflict detection in business memory (two sources disagree → ask the owner), and a decisions note on dismiss.
3. More execution only where a real, authorized integration exists (for example, a Google Business Profile connection after the
   owner approves the integration and its permissions); until then nothing publishes or sends.
4. `OWN_MODEL_PLAN.md` phases 1–2: connect our own model server to the existing provider interface; Content Creation and the
   model plan path then light up with no workflow changes.
