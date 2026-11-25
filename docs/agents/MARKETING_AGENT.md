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
**Built, tested on a throwaway Postgres and on clicky-dev (migration 20261129).** Every model call goes through
`meteredProvider` (`metering.ts`): before the call the database says whether the business is within its daily
($0.50) and monthly ($5) caps and the global daily cap ($20) (`model_budget`; defaults in `app_config`, per-business
overrides in `organization_model_limits`, set only by platform admins); after the call tokens and cost are recorded
(`record_model_usage`), including refusals and failed calls. A model without a published price (`pricing.ts`) is never
called. Customers see only "usage limit reached, try again later". Platform admins see spend per business (`admin_model_usage`).
Known limits: the check and the record are separate calls, so calls running in parallel can overshoot a cap by the cost of those calls
(bounded by one request's few calls); costs are computed by the app from published prices, so a wrong price table means wrong costs.
If migration 20261129 is not applied, the budget check fails and model calls are refused (fail closed).

## Quality screening and admin review (§3.4, §6)
**Built.** `src/lib/agent-quality.ts` scores evidence, support for claims, business relevance, usefulness and actionability
(0-100, or "nothing to judge") and lists flags: facts or findings without quoted evidence, inferences without a basis,
promises, figures the evidence does not show, generic advice, not-specific items, vague actions. It is fixed code applying the
same rules every time: a screening aid, not a verdict; it cannot tell whether a quote was understood or advice is right.
`/admin/agent-review` (platform admins; **not available in Production**; each view logged) shows recent runs with facts, findings and the plan
beside their evidence, the flags, and model spend. Generation-time safeguards (generic advice, promises, unsupported figures) drop items before they are stored.

## Verification
| What | Status |
|---|---|
| Grounding and rejection rules, versions, owner-only approval, evidence classes, isolation | Verified by unit and database tests |
| Database functions on clicky-dev | Verified (apply → checks → rollback → re-apply), including 20261129 (existing rows kept: 4 businesses, 42 cards) |
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
