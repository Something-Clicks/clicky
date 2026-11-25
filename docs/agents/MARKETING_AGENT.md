# The Something Clicks Marketing Agent: architecture map and status

The owner's specification (`AI_MARKETING_AGENT.docx`) is the architecture. This document maps each part
of it to the code and says honestly what is built. Updated Nov 25 2026 (second pass).

**Status words.** *Built*: runs in the app and is covered by unit and database tests (local Postgres; the
migrations also on clicky-dev). *Built, not verified live*: the code path runs end to end with a test-double
model in tests, but has never been run with a real model or on a real website (see Verification).
*Not built*: designed, reports "blocked" if a workflow asks for it.

## How it fits together
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
| SEO Intelligence (§4.3) | `seo-intelligence.ts` | **Partly built.** On-page signals and SEO findings. Keyword data not connected. |
| Marketing Analysis (§6) | `marketing-analysis.ts`, `marketing-analysis-model.ts` | **Built for fixed checks.** **Model part built, not verified live:** messaging, conversion and content findings with quoted evidence, saved as Action Cards (origin `model`) behind `modelFindings`; never marked "verified fixed". |
| Performance Intelligence (§11) | `performance-intelligence.ts` | **Partly built.** Verified fixed / still found / awaiting. Traffic and search data not connected. |
| Content Creation (§8) | `content-creation.ts` | **Built, not verified live.** Homepage copy and SEO title/description from the business understanding and the card's evidence; content rules enforced; version 1 → edits as versions → owner approves a version. Behind `drafts`. |
| Market Research (§4) | `unavailable.ts` | Not built. |
| Marketing Strategy (§7) | `marketing-strategy.ts` | **Built, not verified live.** A proposed plan from the business understanding and the open Action Cards: summary, ≤3 objectives, ≤8 ordered priorities that point at real open actions (by short reference, never ids the model could invent), effort, dependencies that must come earlier, next steps, questions for the owner, what to leave for later. Grounding drops unknown or repeated actions, promises, figures not in the material and generic advice. Owner reviews, revises (adds notes → a new proposal), approves or rejects at `/app/plan` behind `strategy`. Approval = agreement, never completion. Market research is not connected, so plans use only the business's own details and website findings. |
| Campaign Planning (§9) | `unavailable.ts` | Not built. |
| Marketing Execution (§10) | `unavailable.ts` | Not built (needs authorized integrations). |

## Feature switches
`src/config/features.ts`: `drafts`, `businessProfile`, `modelFindings`, `strategy`. Off unless `FEATURE_<NAME>=1`; always off
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
| Real model output quality (understanding, findings, drafts) | **Not verified.** This sandbox cannot hold an Anthropic key (Anthropic hosts cannot use saved network credentials). Needs `ANTHROPIC_API_KEY` as an environment variable in a cloud environment or Vercel Preview |
| Real websites | **Not verified.** The sandbox cannot reach public websites |
| Signed-in screens (`/app/business`, draft editing) in a browser | **Not verified.** Needs the Preview with test accounts |

## Orchestrator and workflows (§12)
**Built:** `runWebsiteReview` runs for every website check (Check button, first check after setup, weekly
re-check): understand business → plan → Website Intelligence → Marketing Analysis → SEO Intelligence →
Business Intelligence proposals → rank → prepare Action Cards → drafts (recorded "blocked") → owner review.
If the workflow record or the fact proposals cannot be saved, the customer's check still completes.
**Not built:** the other five request kinds (homepage headline, competitor research, marketing plan,
promotional campaign, results review) are planned and record themselves as blocked.

## Evidence and confidence (§6.3)
**Built.** Four classes in `src/lib/evidence.ts`, enforced in the database (migration 20261127120000):
- Action Cards from fixed checks: class derived from the evidence they cite; cannot be set otherwise.
- Model findings (future, origin `model`): verified must cite observed/measured evidence; inferred must cite
  evidence and state a basis; estimated must state a basis. Checked at commit.
- Business facts: the same rules, plus owner-supplied or owner-confirmed facts count as verified; unknown
  facts record what is missing and carry no value.

## Action Cards, approvals, execution (§10, §13)
**Built:** card fields, stages prepared → approved (owner only) → completed (marked done or verified fixed),
evidence class per card. Generated work is never "completed".
**Not built:** effort, dependencies, link to the prepared deliverable, editable drafts with versions.

## Customer context and memory (§14)
**Built:** Business, Brand and Customer profile store (`business_facts`) with provenance and freshness;
marketing history via cards, workflows and the activity log.
**Not built:** Research Library, Marketing Strategy store, Performance History beyond verification; the owner
screen for reviewing facts (functions `review_business_fact` and `add_business_fact` exist and are tested).

## Model providers (§15)
Provider-neutral interface; one development adapter (`providers/anthropic-dev.ts`, Claude Sonnet 5.5) used only
with `MARKETING_MODEL_PROVIDER=anthropic-dev` and a key, never in Production. Every model output is validated
against its schema (one retry) and grounded by Something Clicks (`grounding.ts`) before it is stored. Model and
token usage are recorded on each workflow and draft run.

### Replacing or adding a provider (checked Nov 25; Preview runs `anthropic-dev`)
Capabilities never import a provider: they receive a `ModelProvider` (`id`, `model`, `generate`) and ask for a schema-validated answer through `generateStructured`. To switch: (1) add `providers/<name>.ts` implementing `generate` (structured output, per-request timeout, no SDK retries, report tokens and refusals); (2) register it in `PROVIDERS` in `provider.ts`; (3) add its model's published prices to `pricing.ts` (an unpriced model is never called); (4) set `MARKETING_MODEL_PROVIDER=<name>` and its key. Nothing else changes: grounding, metering, caps, slots, deadlines, screening and every screen are provider-independent. Tests that prove it: an unknown provider id and a key alone activate nothing; Production never has a provider; the metering and deadline tests use a provider that is not Anthropic's adapter.

## Security (§16)
Server-side only; RLS on every table; tenant-isolation tests for every new table and function; owner-only
review of business facts and approvals and plans; website text and owner notes treated as data; audit log; per-business
and global model spend caps (see Cost control). Not built: alerting on spend, a customer-visible usage screen.

## Next, in order
1. Live verification on Preview: `ANTHROPIC_API_KEY`, `MARKETING_MODEL_PROVIDER=anthropic-dev` and the four
   switches (`FEATURE_BUSINESS_PROFILE`, `FEATURE_MODEL_FINDINGS`, `FEATURE_DRAFTS`, `FEATURE_STRATEGY` = 1) on Preview only; run on 3–5 real
   sites with test accounts; review the outputs on `/admin/agent-review`, improve weak prompts and rules, repeat.
2. More Content Creation: service page copy, FAQs, Google Business Profile posts (§8.1–8.2).
3. Spend alerts and a usage view for owners; atomic budget reservation if parallel calls ever matter.
Later: research (manual Semrush import), campaign planning, authorized execution, performance data.
