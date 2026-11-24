# Agent roadmap (proposal — not built)

**Status:** proposal only. Nothing here is implemented. Wait for the owner's approval before building any of it.

## Principle
The customer never picks or manages an agent. They see one flow:

**Website Intelligence → Marketing Strategy → Content Creation → Customer Approval → Marketing Measurement**

Each step is a server-side job with typed input and output, built on what already exists.

## The six agents

| # | Agent | Input | Output | Reuses |
|---|---|---|---|---|
| 1 | Website Intelligence | website URL, business profile | evidence + findings | `analyzeWebsite` (safe fetch, scan, checks, PageSpeed) |
| 2 | Marketing Strategy | findings, goals, ZIP | ranked plan (Action Cards) with reasons | `checks.ts` priorities, `ai.ts` wording guard |
| 3 | Content Creation | one card + evidence + owner notes | draft (structured fields) | `drafts.ts`, `agent_runs`, `approvals` |
| 4 | Marketing Research | business category, ZIP, owner-supplied research (e.g. Semrush exports) | opportunities labeled verified / estimate / unknown | new; no external data source is connected today |
| 5 | Marketing Measurement | previous vs. new analysis | verified fixed / still found, before/after scores | `verify_outcomes`, PageSpeed comparison |
| 6 | Recurring Marketing Work | schedule + plan entitlements | queued drafts for approval | weekly cron worker, `worker_*` functions |

Internal business agents (onboarding notes, lead research, reporting, knowledge search; see the owner's "AI Agents" brief) are a separate track and never touch customer-facing flows.

## Architecture
- **Execution:** server-side only (route handlers / Vercel functions / cron). Keys stay on the server.
- **Records:** extend `agent_runs` (already: type, permission, input notes, model, output, usage, status, timing) with `workflow_id`, `step`, `attempt`, `cost_cents`.
- **Orchestration:** a small state machine per workflow (`pending → running → needs_approval → done | failed`), one step at a time, resumable from the database. No external automation platform.
- **Retries:** bounded (e.g. 2) with backoff; failures recorded with a plain reason; never silently skipped.
- **Limits and cost:** per-business daily caps in the database (as today: 10 analyses, 20 drafts), plus a monthly cost ceiling per plan and a global daily spend cap; usage tokens recorded per run.
- **Permissions:** each agent gets a narrow capability (`draft_only` today). No agent can publish, send messages, change billing, or read another business. All data access goes through existing RLS / `SECURITY DEFINER` functions.
- **Provider:** keep a thin model interface (as in `ai.ts` / `drafts.ts`) so the provider can change.
- **Approval:** anything consequential stops at `needs_approval`; only the owner approves (as `decide_approval` does today).
- **Tests:** every agent ships with mocked model responses and database tests for its limits and permissions before any paid API call.

## Never allowed
Inventing business facts; auto-publishing; sending consequential messages without approval; changing billing; accessing other customers' data; bypassing RLS; unlimited model calls.

## Suggested order (after approval)
1. Workflow records + orchestration around the existing analysis → draft → approval path (no new capability, just one flow).
2. Recurring Marketing Work (needs a paid plan that includes it; today it would be "Coming soon").
3. Marketing Research, once a real data source is chosen.
