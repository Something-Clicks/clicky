# `clicky-dev`: existing schema vs. the `sc_` schema, and how to consolidate

Read-only inventory of project `ofstvbgaoznipsiqbjjp` (development), taken 2026-11-27. No rows were read except counts and the
`app_config` key names/types. Nothing here was changed beyond the additive `sc_` tables already applied.

## 1. What is already there (from the earlier product)

An **organization-centred, normalized** backend: 31 tables, ~50 `public` functions (one overloaded) plus helpers in `app_private`.

* **Security model:** every table has RLS with `SELECT`-only policies for `authenticated`. **All writes go through `SECURITY DEFINER`
  RPCs** that check membership (`app_private.is_org_member`, `has_org_role`, `can_act_for`) and validate state transitions. This is
  already a "customer-session" design; no service-role key is needed for customer operations.
* **Two kinds of RPC.** (a) Plain customer RPCs, membership-checked: `create_organization`, `start_analysis`, `approve_action_card`,
  `start_agent_run`, `decide_approval`, `edit_draft`, `approve_draft_version`, `add_business_fact`, `review_business_fact`,
  `save_marketing_plan`, `decide_marketing_plan`, `start_marketing_workflow`, `finish_marketing_workflow`, `free_uses`,
  `current_entitlements`... (b) **Server-secret RPCs** gated by a `p_key` argument whose SHA-256 is stored in `app_private.secrets`:
  `reserve_model_call`/`settle_model_call` (model spend), `acquire_agent_slot`/`release_agent_slot`, `billing_*` (Stripe webhook
  writes), `site_preview_*` + `site_track` + `site_submit_feedback` (anonymous preview and funnel). These are callable with the public
  key plus the server-held `p_key`; they are how the old design did privileged work without a service-role key.
* **Strong, database-enforced rules worth keeping:** `business_facts` CHECKs (an *inferred* fact must carry evidence and a basis;
  *verified* needs observed/measured evidence or owner confirmation; *estimated* needs a basis; owner facts are verified+confirmed);
  `agent_runs.permission = 'draft_only'`; append-only `draft_versions` (max 100, key set fixed by `edit_draft`); `approvals` bound to
  a specific `approved_version_id`; model spend caps in `app_config` (per business per day $0.50, per month $5, per person per day $1,
  global per day $20, per-business hourly call cap) enforced inside `reserve_model_call`; free-use limit of 3 in `app_config`
  (`free_use` flags on `analyses`/`agent_runs`); per-day analysis/workflow limits; row locks against double-starts.
* **Data:** 4 organizations, 12 analyses, 42 action cards, 12 previews, 374 funnel events, 12 auth users (all confirmed). Billing tables empty.

## 2. Mapping: existing -> `sc_` (what to reuse, what is missing)

| Capability | Existing | My `sc_` | Verdict |
| --- | --- | --- | --- |
| Tenancy, members | `organizations`, `organization_members` (roles: `owner`,`member` only), `create_organization` (caps 5 orgs/user) | `sc_businesses`, `sc_members` (owner/admin/editor/viewer) | **Reuse existing.** Drop my duplicates. Needs a **role decision** (below). |
| Business profile | `business_profiles` (name, website, service area, goal, zip) + `business_facts` (category/field/value/source/evidence_class/status, strong CHECKs) | `sc_profiles` (field map with provenance, trust ranking, conflicts, freshness) | **Reuse `business_facts` as the store.** My merge/trust/freshness logic runs in the app on top. Field list needs extending (`business_fact_field_ok`). |
| Website analysis + evidence | `analyses`, `analysis_evidence` (source, kind, check_key, url, observation, excerpt, measurement) | `sc_scans`, `sc_workflows(website_audit)` | **Reuse.** Evidence rows map 1:1 to my evidence items. Full page text/scan JSON has no home (small addition). |
| Action Cards | `action_cards` (+ `action_card_evidence`): title, explanation, why_it_matters, recommended_action, impact_priority, confidence, evidence_class, status new/approved/in_progress/done/failed/dismissed, verification fixed/still_found | `sc_cards` (+ priority score/rank, effort, dependencies, deliverable link, execution info, resolved status) | **Reuse, extend.** Missing columns: `priority_score`, `rank`, `effort`, `dependencies`, `site_id`, `deliverable_id`, `resolved`. `verification` already equals my auto-resolve idea. |
| Drafts, versions, approval | `agent_runs`, `draft_versions` (fields array of key/label/text), `approvals`, RPCs `edit_draft`, `approve_draft_version`, `decide_approval` | `sc_deliverables` (versions, claim flags, content hash, mock marker) | **Reuse the structure.** `draft_type` allows only 5 types (`page_copy, meta, gbp_post, review_reply, blog_draft`); my 21 types need the CHECK widened. Add claim-flag + hash columns. |
| Strategy | `marketing_plans` + `save_marketing_plan`, `decide_marketing_plan` | `sc_strategies` | **Reuse.** My richer shape must fit its `plan` JSON CHECK (`priorities` array 1-10, <=40 KB). |
| Workflow runs | `marketing_workflows` (kind: website_review, homepage_headline, competitor_research, marketing_plan, promotional_campaign, results_review), steps/result/usage | `sc_workflows` | **Reuse.** Add kinds `seo_research`, `content_request`, `business_profile`; add checkpoint `state` column. |
| Model spend control | `model_usage`, `organization_model_limits`, `reserve_model_call`/`settle_model_call` | in-memory `UsageMeter` | **Replace mine with existing.** Needs the `p_key` server secret (see section 4). |
| Free uses | `free_uses()`, `analyses.free_use`, limit in `app_config` | `sc_uses` + Entitlements | **Reuse.** My "only saved outputs count" rule must set `free_use` on completion. |
| Plans / entitlements | `plan_entitlements` (8 **old** plan ids; drafts none/meta/all), `subscriptions` (stripe_price_id, interval), `purchases`, `billing_customers`, `current_entitlements()` | `sc_billing`, plan matrix in code | **Reuse tables; migrate plan ids.** CHECK lists only the old ids; need `report, assistant, studio, suite` + feature flags + quotas (drafts 20/80/250, sites, locations). |
| Stripe webhook writes | `billing_record_event`, `billing_record_purchase`, `billing_upsert_subscription` (price+interval aware), idempotent `integration_events` | `sc_stripe_events`, `sc_billing` | **Reuse.** Needs the `p_key` secret. |
| Anonymous preview + claim | `previews` (hashed tokens, IP caps, claim tokens), `site_preview_*`, `claim_preview` | `sc_previews` | **Reuse.** Needs `p_key`. (Anonymous sign-ins are disabled, so no alternative without it.) |
| Audit / notifications / feedback / funnel / connections / admin | `activity_log`, `notifications`+preferences, `feedback`, `funnel_events`, `data_connections` (website, pagespeed, search_console, GBP), `admin_*`, `platform_admins` | `sc_audit` | **Reuse all.** `data_connections` is the right home for Search Console/GA later. |
| **Multiple websites, locations, brand overrides (Suite)** | **nothing** | `sc_sites`, site-scoped profiles, brand report | **Genuinely missing -> new tables** `sites`, `locations`; `site_id` on analyses, cards, runs, workflows, plans, facts. |
| **Research library** (competitors, keywords, content gaps, local SEO, market notes) | **nothing** (only own-site evidence) | `sc_research`, competitor scans | **Missing -> new table** `research_items`. |
| **Campaigns with task dependencies** | **nothing** | `sc_campaigns` | **Missing -> new tables** `campaigns`, `campaign_tasks`. |
| **Performance metrics + reports** | **nothing** | `sc_metrics`, `sc_reports` | **Missing -> new tables** `metrics`, `performance_reports`. |
| **Execution requests** (request -> authorize -> execute -> verify) | only card status + approvals | `sc_execution_requests` | **Missing -> new table** `execution_requests` (+ RPCs). |
| **Plan-gated features / insights / progress** | `plan_entitlements` is coarse (analyses, weekly, drafts) | feature gate in code | **Extend** entitlements with a feature list; insights/progress are read models (no tables). |

## 3. Can the two systems be consolidated safely?

**Yes, and the existing schema should be the base.** It is stricter than mine where it matters most (tenancy, billing, spend caps,
evidence rules, approvals bound to versions, RPC-only writes), it matches the specification's own vocabulary (workflow kinds,
evidence classes, draft-only runs), and it is a design the product owner already built. Mine should shrink to the parts it lacks.

Safe because: the old data set is small (4 organizations, billing tables empty), my `sc_` tables are empty, and `sc_` objects
are namespaced (nothing existing is altered). Risk is concentrated in **my application code**, not the database: the agent persists
through a document-style `Table<T>` interface; consolidation means writing normalized repositories that call the existing RPCs
(about 8 aggregates: organization/profile facts, analyses+evidence, cards, drafts+versions+approvals, plans, workflows, usage, billing).
That is a real piece of work (est. several focused sessions), not a rename.

Alternative, cheaper path (**hybrid**, recommended as step 1): keep `sc_` document tables **only for what is missing** (sites,
locations, research, campaigns, metrics, reports, execution requests, deliverable extras), but re-point their RLS to
`organization_members` and key them by `organizations.id`. Replace my duplicated tenancy/billing/previews/usage tables with the
existing ones immediately, and migrate cards/drafts/plans/workflows to the existing tables in a later step.

## 4. What needs a server secret (not a service-role key)

The existing design's privileged operations use RPCs gated by a `p_key` (hash in `app_private.secrets`). I have **not** requested or
used it. Without it these remain **unverified**: model-spend reservation/settlement (`reserve_model_call`, `settle_model_call`),
the Stripe webhook writes (`billing_*`), anonymous previews (`site_preview_*`), agent slots, funnel tracking. Everything else runs under
a normal customer session. Because `p_key` RPCs are callable with the public key by anyone who has the secret, the secret must be
kept server-side only; it is lower-privilege than a service-role key (it can only call those functions).

## 5. Exact changes needed before any large rewrite (decisions first)

1. **Roles.** Existing: `owner` | `member`; only the owner approves. Mine: owner/admin/editor/viewer, editor approves, admin authorizes.
   Decide: keep existing (simplest, matches the current customer experience) or extend `organization_members.role` and the RPC checks.
2. **Plan ids.** Retire or map the old ids (`starter_ai`, `growth_ai`, `scale_automation`, `business_plus`, `multi_site`, `single_site`,
   `marketing_plan`, `diagnostic_audit`) to `report`/`assistant`/`studio`/`suite`; widen `plan_entitlements_plan_id_check`; add feature + quota columns.
   (Note the Stripe test catalog still carries the old names; the live catalog uses the approved four.)
3. **Widen CHECKs**: `agent_runs.draft_type` (5 -> my types), `action_cards.execution_type`, `marketing_workflows.kind` (+3), `business_fact_field_ok` (my profile fields incl. `zip_codes`, brand fields).
4. **New tables** (all with `organization_id` + RLS via `app_private.is_org_member` + RPC-only writes): `sites`, `locations`, `research_items`,
   `campaigns`, `campaign_tasks`, `metrics`, `performance_reports`, `execution_requests`; add `site_id` to the site-scoped tables.
5. **Model-output RPCs.** `add_model_findings`, `complete_analysis`, `save_marketing_plan`, `finish_marketing_workflow` accept model output from
   a *customer session* (`can_act_for`). A member calling the API directly could store fabricated "model" findings. I have **not** reviewed
   their bodies; before relying on them for "never present invented research as fact", verify they re-check evidence shape/ownership
   server-side or move them behind `p_key`.
6. **Existing advisor findings** (not caused by my work): several `SECURITY DEFINER` RPCs executable by `anon` (all `p_key`-gated: `billing_*`,
   `site_*`), 49 executable by `authenticated`, leaked-password protection disabled, `app_config` has agent flags documented "development only".
7. **Application work** (after 1-4): normalized repositories + RPC calls for the aggregates above; per-request customer-session client (cookie
   session; background runs carry the access token); keep in-memory repositories for fast tests.

## 6. What I will do next without waiting on those decisions

Provider/model layer (OpenAI-compatible adapter: JSON-schema constrained output, reasoning-tag stripping), `server-only` guard and project-ref
allowlist, adapter hardening (error mapping, pagination), and continued agent quality work. None of it depends on the database decision.

## Model-output RPC review (clicky-dev, verified)

| RPC | Gate before | Verdict | Action |
| --- | --- | --- | --- |
| `complete_analysis` | org membership only | **Unsafe**: any member could write fabricated evidence and cards | Gated behind server key (migration 0002). Verified: authenticated member gets 42501; implementation in `app_private` has no client grant |
| `finish_marketing_workflow` | org membership only | **Unsafe**: any member could write workflow results | Same fix, same verification |
| `add_model_findings` | dev flag + server key + membership | Gated, but no DB rule that verified/inferred cards cite evidence, and "observed" excerpts are caller-supplied | **Open**: add evidence-citation CHECK/trigger in the next migration |
| `save_marketing_plan` | dev flag + server key + membership | Sound (shape/ownership validated) | None |
| `complete_agent_run`, `propose_business_facts` | dev flag + server key + membership | Gated | None |

Consequence: without the server secret (`x-agent-key`), none of the model-output writes can succeed. A customer session cannot
fabricate AI findings, but the real agent cannot save them either. That path is **unverified end to end** until the user
supplies or approves the protected credential. Not requested.

## Old plan IDs (clicky-dev): history
`subscriptions` and `purchases` are empty in dev, so there are no historical records to remap there. `plan_entitlements` has 8 rows
and both tables FK to it. Proposed read-time mapping (no rows altered, no Stripe change):
marketing_plan, diagnostic_audit -> report; single_site (and starter_ai/growth_ai/scale_automation pending a check against any
production history) -> assistant; business_plus -> studio; multi_site -> suite. Needs your confirmation before the production
history is inspected.

## Still not done in this consolidation
Re-pointing sc_ RLS to `organization_members`, dropping duplicate sc_ tables, new org-scoped tables (sites, locations, research,
campaigns, tasks, metrics, reports, execution requests), the per-request customer-session data layer, and browser journeys
against clicky-dev. The app still runs on the in-process store plus the sc_ adapter.

## Consolidation result (clicky-dev only; production untouched)

Migrations applied to clicky-dev (project `ofstvbgaoznipsiqbjjp`), in order: `0001` schema (earlier), `gate_model_output_rpcs_behind_server_key` (0002),
`ground_model_findings` (0003), `consolidate_org_tenancy` (0004). Nothing was applied to production.

* Tenancy/roles/billing now use the EXISTING tables: `organizations`, `organization_members` (owner|member), `subscriptions`, `purchases`, `plan_entitlements`.
  The agent's working data stays in `sc_*` tables keyed by organization id, with RLS via `organization_members`.
* Dropped (verified empty, unreferenced): `sc_businesses`, `sc_members`, `sc_billing`, `sc_stripe_events`, `sc_previews`.
* Owners keep approval authority, enforced in the database (guard trigger): only an owner can approve a deliverable or strategy or authorize an execution request.
* `sc_uses` rows can only be written for yourself; `sc_audit` is append-only and owner-readable; row identity is immutable; `version` must advance by one.
* Plan ids: `report/assistant/studio/suite` added to `plan_entitlements`. Read-time mapping in `src/agent/store/org.ts`:
  marketing_plan, diagnostic_audit -> report; single_site -> assistant; business_plus -> studio; multi_site -> suite. **`starter_ai`, `growth_ai`, `scale_automation` are
  intentionally unmapped** (a subscription on them grants nothing until you confirm). Their old definitions in `plan_entitlements`: starter_ai = weekly reviews, `meta` drafts;
  growth_ai and scale_automation = weekly reviews, `all` drafts (identical to single_site/business_plus/multi_site rows). No billing terms (prices, intervals) for them exist in the
  database (subscriptions/purchases are empty), so their commercial meaning cannot be established from clicky-dev alone. Awaiting your decision.
* No service-role key exists anywhere in the app. Operations that need a protected credential are refused explicitly (`server_credential_required`):
  Stripe webhook (writes subscriptions/purchases via `billing_*` RPCs that need the server key), scheduled reviews across tenants, anonymous previews, model-output RPCs
  (`complete_analysis`, `finish_marketing_workflow`, `add_model_findings`, `save_marketing_plan`, `record_analysis_pages`), invitations of additional members.

## What was verified against real clicky-dev with real customer sessions (supabase-js, publishable key + user JWT)
`tests/real-customer-sessions.test.ts` (9 tests) and `e2e-real/real-db.spec.ts` (5 browser tests; real login through the UI). Test accounts/organizations (`sc-test-*`) were
created through the admin SQL channel because signup email is rate-limited and invitations/billing writes need the server credential; test rows are cleaned out-of-band.
