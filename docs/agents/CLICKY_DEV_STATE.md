# clicky-dev database state after the parallel "sc_" experiment (Nov 27-28 2026)

A parallel build on branch `claude/great-brown-hffimv` (PR #1) changed shared objects on clicky-dev. This records what was changed and
what was restored, so nothing is a surprise.

**Restored on Nov 28 (to the definitions in this repo's migrations):**
- `public.complete_analysis` and `public.finish_marketing_workflow`: an earlier change had moved them behind the server key. This app
  calls both as the signed-in customer, so website analyses would have failed wherever `MODEL_USAGE_KEY` is not configured. Back to
  the original, ungated definitions (grants: authenticated, service_role).
- `public.add_model_findings`: replaced by a stricter variant that required an `analysis_pages` table this app never fills; restored
  to the version from migration `20261202120000_agent_admission`.
- Removed `public.analysis_pages`, `public.record_analysis_pages(uuid, jsonb)` and `app_private.norm_text(text)` (unused).

**Left in place (additive, unused by this app):** `sc_*` tables and `sc_private` schema (the other build's working data, including
one real-model run of somethingclicks.com); `plan_entitlements` accepts four extra plan ids (`report`, `assistant`, `studio`, `suite`)
with rows for them; test accounts and organizations named `sc-test-*`.

**Not yet applied to clicky-dev** (additive, each has a rollback): `20261203120000_campaigns_and_research`,
`20261204120000_agent_memory_and_execution`, `20261205120000_campaign_brief_and_model_drafts`. Apply them (clicky-dev only) before running
the campaign, research-library and execution screens against it.

**Observation (not changed):** because `complete_analysis` is ungated by design, a signed-in member who calls it directly can write
fixed-check evidence and cards for their own business. Model-produced work is protected by the key-gated functions; fixed-check output
is not. Decide whether to gate it behind a server-side route before launch.
