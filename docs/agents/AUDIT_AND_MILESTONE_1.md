> **Historical (written before the Nov 25 2026 independence decision).** It describes an Anthropic-based plan that is no longer used; `ai.ts`, `drafts.ts` and the Anthropic adapter it discusses were removed. Current direction: `docs/agents/OWN_MODEL_PLAN.md`.

# Marketing Agent: specification audit and Milestone 1 scope

Specification: `AI_MARKETING_AGENT.docx` (Nov 2026; same content as the earlier PDF).
Branch: `claude/ecstatic-curie-9shvjf`. Audited Nov 25 2026. "Works" below means it runs and is tested
locally (unit + database tests on local Postgres; migration cycle on clicky-dev). Nothing has been
verified against real websites or a real model yet: the sandbox cannot reach public sites, and no
provider is configured.

## 1. Audit

### Implemented (works; not yet verified on real sites)
| Spec | What exists |
|---|---|
| 2.1 / 12 Central orchestrator | `src/lib/server/agent/orchestrator.ts`: a controlled workflow (not a prompt) that runs every website check: understand business → plan → analyze → rank → prepare → owner review. Records in `marketing_workflows`. |
| 12.2 Workflow selection | Six request kinds mapped to only the capabilities each needs (`workflows.ts`). Only `website_review` is implemented; the rest report themselves blocked. |
| 12.3 Execution management | Workflow id, org, request, capabilities, status, start/end, steps, result, provider/model/usage fields, errors, audit log; one running per kind (no duplicates); 15-minute abandonment; 50/day cap. |
| 5.1 Website discovery | URL validation, redirects followed by hand (max 3, each re-validated), homepage plus up to 4 prioritized pages (contact, services, about, pricing, locations), metadata, readable text, failures recorded. |
| 5.3 Limits and safety | SSRF defense (private IPs refused at connect), size and time limits, plain-language failure reasons for bot blocks, 404s, redirect loops, timeouts. |
| 5.2 Analysis (fixed checks) | Titles, meta descriptions, H1, viewport, HTTPS, image alt text, tap-to-call, thin homepage, service area, PageSpeed (measured by Google when available). |
| 6.3 Evidence (part) | Evidence kinds observed / measured / missing; ranking maps them to verified / unknown. |
| 7.2 Prioritization (part) | Deterministic ranking: impact → evidence strength → confidence → owner changes first. |
| 13 Action Cards (most fields) | Title, category, finding, evidence, why it matters, recommendation, priority, confidence, stage, approval flag, execution type. |
| 10.2 Approval separation | Draft (agent_runs) ≠ owner approval (`decide_approval`, `approve_action_card`, owner only, server-side) ≠ completed (marked done, or verified fixed by a later check). Generated work is never "completed". |
| 11 Performance (part) | Re-check verifies done/approved work as fixed or still found; PageSpeed before/after. |
| 15 Provider architecture | Provider-neutral interface with schema validation and one retry; no provider registered; no mock. |
| 16 Security | Server-side only, RLS on every table, tenant-isolation tests, privileged writes via checked functions, rate limits, output guards, audit log. |

### Partially implemented
| Spec | Gap |
|---|---|
| 3 Business Profile | Only name, website, service area, main goal, ZIP. No services, audience, value proposition, brand voice, contact methods, provenance or freshness. |
| 6.3 Evidence classes | No "inferred"; "estimated" exists as a kind but is never produced; no stated basis per claim. |
| 8 Content creation | `drafts.ts` prepares 4 draft types but is Anthropic-specific, dormant, and hidden (`FEATURES.drafts = false`). |
| 8.7 Editable before approval | Not possible: the owner can only approve, reject or request changes. No version history. |
| 5.2 Messaging / conversion / content judgment | Needs a model (is the value proposition clear, is the next step clear); fixed checks can't judge these. |
| 13.1 Action Card fields | No estimated effort, dependencies, or link to the prepared deliverable as a field. |
| 16 Cost monitoring | Tokens are recorded per draft; no per-plan or global spend caps. |

### Missing
Market and competitor research (4), keyword research and the manual Semrush import (4.3), marketing strategy (7), email/social/blog content (8.2–8.5), campaign planning (9), execution integrations (10.1), performance data from Search Console/analytics (11.1–11.2), Brand and Customer profiles and the Research Library (14), the evaluation dataset (17.5).

### Needs correction
1. **`ai.ts` turns itself on if `ANTHROPIC_API_KEY` is set** (`wordFindings` rewrites card wording). Setting that key anywhere, for example for this evaluation, would activate a model in the app without the provider decision. Gate it on the provider registry and port it onto the provider interface.
2. **`drafts.ts` bypasses the provider interface** (calls the Anthropic SDK directly). Port it.
3. **Privacy Policy says no AI service is used.** It must be updated (with attorney review) before any model touches customer data.
4. **Terms describe subscriptions**, which are not sold now (Marketing Assistant on hold). Attorney review.
5. **Stripe** still shows old product names at checkout; the TEST customer portal has no configuration. If a portal is configured, it must not offer Marketing Assistant.

### Dependencies
Provider decision and API keys; network access from wherever the evaluation and tests run (provider APIs, the chosen websites); 3–5 real small-business websites the owner may test; clicky-dev test accounts re-enabled for journey tests; `STRIPE_SECRET_KEY` (test) and `SUPABASE_SECRET_KEY` on Preview; attorney review of privacy disclosures; 5–10 business owners for usability testing.

## 2. Milestone 1: one complete working workflow

**Business profile → website analysis → findings → drafted website copy and SEO titles/descriptions → editable draft → owner approval.**

Out of scope: competitor research, campaign planning, execution, performance tracking. Semrush stays manual.

### Build (after the provider is approved)
1. **Provider adapter** for the approved provider, implementing `ModelProvider`, registered in `PROVIDERS`, enabled by `MARKETING_MODEL_PROVIDER` on the server. Port `ai.ts` and `drafts.ts` onto it; remove the `ANTHROPIC_API_KEY` self-activation.
2. **Business profile** (additive migration): services, audiences, geography, value proposition, contact methods. Each item stores its source (owner / website / model), evidence class, evidence keys, basis, confirmed flag and date. The model proposes from the website; the owner confirms or edits; confirmed owner facts win.
3. **Four evidence classes**: `verified` (cites observed/measured evidence), `inferred` (cites evidence and states its basis), `estimated` (states assumptions), `unknown` (cites nothing, says what's missing). Stored on findings and profile items; the database refuses a `verified` item without observed evidence, and `inferred`/`estimated` without a basis.
4. **Findings**: fixed checks stay as they are (origin `website_check`); model findings on messaging, conversion and content are added with origin `model`, must cite evidence from the same analysis, and are ranked with the same rules.
5. **Drafts**: homepage headline, subheadline and call to action; SEO title and meta description per reviewed page. Built from the confirmed profile, findings and evidence; placeholders for missing facts; promise and invented-figure guards.
6. **Editing**: a `draft_versions` table; the generated draft is version 1; each owner edit is a new version (who, when). Approval is of a specific version.
7. **Approval**: owner-only, on a version; approval ≠ completed (completed still needs "marked done" or a later check that verifies it).
8. **Customer experience**: on a card, "Prepare a draft" → edit in place → Approve. Same navigation; no new dashboard. Drafts stay switched off for customers until the Privacy Policy is updated.

### Acceptance criteria
- On each of 3–5 real small-business sites, the workflow completes end to end on Preview (clicky-dev) with the approved provider; failures show a plain reason and record the error.
- Every profile item and finding has one of the four evidence classes; 0 `verified` items without observed evidence; 0 `inferred`/`estimated` without a basis (database-enforced and tested).
- Drafts contain no figures, awards, guarantees or contact details absent from the source (automatic check), and use placeholders instead.
- 100% of stored model outputs passed schema validation (one retry, then a clear error; no fallback).
- The owner can edit a draft, each edit is a version, and only the owner can approve a version; a member cannot (database test).
- Approved ≠ completed is enforced (database test); History shows prepared, edited, approved, done.
- Website content cannot change instructions (prompt-injection test pages in the regression suite).
- Cost and latency per workflow recorded; per-business daily cap enforced.
- Signed-in Preview journey passes with real test accounts; regression tests listed in Step 5 exist and pass.
- Owner reviews outputs for the test sites and signs off before customers see drafts.

## 3. Proposed milestones
| # | Milestone | Done when |
|---|---|---|
| 0 | Foundation (done) | Orchestrator, workflow records, stages, provider interface, SEO |
| 1 | First working workflow (above) | Acceptance criteria met on real sites; owner sign-off |
| 2 | Sellable Marketing Assistant | Weekly re-check + drafts working for paying customers; Privacy/Terms approved; Stripe names aligned; owner decides to lift the hold |
| 3 | Research and strategy | Manual Semrush import, competitor review from public sites, a business-specific plan |
| 4 | More deliverables | Service pages, FAQs, Google Business Profile posts, content briefs |
| 5 | Authorized execution | One integration (e.g. Google Business Profile) with explicit authorization |
| 6 | Performance | Search Console / analytics data, results tied back to completed work |
