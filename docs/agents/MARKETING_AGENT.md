# The Something Clicks Marketing Agent: architecture map and status

The owner's specification (`AI_MARKETING_AGENT.docx`) is the architecture. This document maps each part
of it to the code and says honestly what is built. Updated Nov 25 2026.

**Status words.** *Built*: runs in the app and is covered by unit and database tests (local Postgres; the
migrations also on clicky-dev). *Not built*: designed, reports "blocked" if a workflow asks for it.
Nothing below has yet been verified against real customer websites, and no language model is connected.

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
| Business Intelligence (§3, §14) | `business-intelligence.ts` | **Built (deterministic part).** Proposes phone and email (verified: observed) and services (inferred, basis stated) from the website; `understand()` merges the owner's profile, confirmed facts and current proposals, lists what is missing, and sets aside stale website facts (older than 180 days). Facts are stored in `business_facts`. Model-derived facts (what the business does, audience, value proposition, brand voice) not built. No customer screen yet. |
| Website Intelligence (§5) | `website-intelligence.ts` | **Built.** Safe discovery (SSRF defense, redirect/size/time limits) of the homepage and up to 4 key pages; metadata, text, link labels, email links; failures recorded; mobile speed when available. |
| SEO Intelligence (§4.3) | `seo-intelligence.ts` | **Partly built.** On-page signals per page and SEO findings. Keyword and visibility data not connected (Semrush manual import planned). |
| Marketing Analysis (§6) | `marketing-analysis.ts` | **Built for fixed checks.** Findings with category (seo / technical / conversion / content / local), evidence class, ranking (impact → evidence strength → confidence → owner-doable first). Messaging and conversion judgment needs a model: not built. |
| Performance Intelligence (§11) | `performance-intelligence.ts` | **Partly built.** Verified fixed / still found / awaiting (verification runs in the database on each check). Traffic and search data not connected. |
| Market Research (§4) | `unavailable.ts` | Not built (needs a model and a research source). |
| Marketing Strategy (§7) | `unavailable.ts` | Not built. |
| Content Creation (§8) | `unavailable.ts` | Not built. Older draft code (`drafts.ts`) is dormant and will be ported onto the provider interface. |
| Campaign Planning (§9) | `unavailable.ts` | Not built. |
| Marketing Execution (§10) | `unavailable.ts` | Not built (needs authorized integrations). |

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
Provider-neutral interface, no provider registered in the app, an API key alone enables nothing (tested).
Temporary development provider (engineering decision): Claude Sonnet 5.5, development and Preview only, one
replaceable adapter, not yet added. Selection rationale: already a project dependency, structured output
verified against the official documentation, mid-tier price. The optional comparison tool is in
`evals/providers/` and is not a prerequisite.

## Security (§16)
Server-side only; RLS on every table; tenant-isolation tests for every new table and function; owner-only
review of business facts and approvals; website text treated as data; audit log. Not built: cost monitoring
and spend caps (needed before any model runs for customers).

## Next, in order
1. Development provider adapter (Claude Sonnet 5.5) behind `provider.ts`, development and Preview only.
2. Model-assisted Business Intelligence: what the business does, audience, value proposition, proposed with
   evidence classes; the owner review screen (behind a feature flag until approved).
3. Model-assisted Marketing Analysis: messaging, conversion, content findings (origin `model`).
4. Content Creation: homepage copy and SEO titles/descriptions → editable versions → owner approval.
5. Cost tracking and per-business caps for model calls.
Later: research and strategy, campaign planning, authorized execution, performance data.
