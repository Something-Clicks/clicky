# Real-world acceptance record (development only)

Everything below ran against real services: the live website somethingclicks.com, a real open-weight model (Qwen3-4B-Instruct-2507,
Apache-2.0, llama.cpp `llama_cpp.server`, CPU, 4 cores, no cost), the real clicky-dev Supabase project, real customer sessions, the real app
(Next.js dev server) driven through a real browser. No fixtures, no mock provider. **One** real business was tested (the only business
website the sandbox network policy permits); three industries were NOT tested.

## Workflow: customer onboards somethingclicks.com (account `sc-test-new`, free plan)
| Step | Result | Time | Model tokens in/out |
| --- | --- | --- | --- |
| Website retrieval (SSRF-guarded crawler) | 5 real pages read | 2 s | none |
| Business intelligence (real model) | 27 profile fields saved; 8 claims downgraded to "inferred" because no matching quote existed | 673 s | 3,284 / 1,943 |
| SEO intelligence (deterministic checks) | 5 local-SEO issues | <1 s | none |
| Marketing analysis (real model + rules) | 13 Action Cards, each with evidence, location, why it matters, confidence, recommendation | 897 s | 4,602 / 1,363 |
| Content creation (real model) | Homepage copy draft + FAQ draft saved, editable, in review | ~650 s per attempt | 12,934 / 1,171 |

Model speed on this hardware: roughly 3 output tokens/s. Far too slow for a customer experience; a hosted GPU is needed (not purchased).

## What the model produced, honestly assessed
* Findings are tied to real retrieved text (e.g. the pricing-page finding quotes "Start with a one-time audit, or choose a monthly plan. No retainers." from /pricing).
  Several rule findings are correctly evidenced but harsh for a deliberately minimal site; some model findings are debatable (e.g. says AI explanations are unclear while the site's FAQ explains them). Quality across more sites is **unmeasured**.
* The homepage-copy draft keeps the site's existing headline and mostly rephrases existing copy: grounded, but not a creative improvement. The FAQ draft largely restates the site's own FAQ. A 4B model anchors heavily on supplied text.
* The claim guard flagged an unsupported price ("$49") in the FAQ for the customer to resolve before approval, as designed.

## Failures found by the real run, and fixed (each with a regression test)
1. llama.cpp server rejects `response_format: json_schema` -> new `json_object_schema` structured mode.
2. Node's built-in fetch aborts at 5 minutes without headers (long CPU generations) -> undici with timeouts matching `LLM_TIMEOUT_MS`.
3. Small model returned a list where the profile expects text ("pricing") -> shape fitting (words untouched).
4. Model-inferred "avoid terms" ("retainers", "jargon", taken from the site's own "no retainers, no jargon") were enforced as the customer's rules and blocked content creation -> only customer-confirmed terms are enforced.
5. One undraftable deliverable failed the entire run -> per-draft isolation, failure reported as a limitation.
6. Retry duplicated an already-saved draft -> retry links the existing draft.
7. Claim guard flagged "no one can honestly guarantee rankings" as a guarantee -> disclaimers are not promises.
8. Container memory limit killed the model server -> smaller context + quantized KV cache; documented.

## Database and customer-account verification on the real saved output (`tests/real-business-acceptance.test.ts`, real sessions)
Reopened findings (13, each with evidence) and drafts; profile separates verified/inferred; another tenant gets 403 on board, drafts and profile; a member edits a draft but cannot
approve or reject (403); the owner approves and rejects; the edit persists on reopen. Browser (`e2e-real/real-reopen.spec.ts`): board, a finding with its quoted evidence, the drafts list with approved/rejected/in-review states,
the editor with claims-to-check, the profile, all rendered from the database.

## Discovery sources in practice (from this sandbox)
* OpenStreetMap Nominatim geocoding: **works live**.
* OpenStreetMap Overpass (business lists): the main host and two mirrors reset the connection from this network; **untested live**. Failover across mirrors is implemented.
* Nominatim category search returned nothing useful for "plumber in Austin".
* DuckDuckGo: its HTML endpoint serves a bot-check page to automated clients; evading that is not acceptable, so it is **opt-in only** (`DISCOVERY_WEB=duckduckgo`). SearXNG (`SEARXNG_URL`) is supported; no instance was available to test.
* Consequence: business-name -> website discovery and automatic competitor discovery are implemented and unit-tested, but have **not** been proven against live sources here.

## Not done / not proven
Market and competitor research with real data, keyword data, strategy, campaigns, performance intelligence and authorized execution have not been run with the real model. Multiple industries not tested.
