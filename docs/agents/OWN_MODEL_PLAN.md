# Technical plan: an independent Something Clicks Marketing Agent

Decision (owner, Nov 25 2026): Something Clicks does **not** use Anthropic, will never hold an Anthropic key, and will not replace it with another paid hosted AI API (OpenAI, Gemini or similar). The product must not depend on a paid external AI provider to function. Everything below follows from that.

Status: **plan only. No model infrastructure has been built or bought.** Items marked *needs your approval* are not started.

## 0. Ownership, stated precisely
| Layer | Who owns it | Honest label |
|---|---|---|
| Agent software: orchestrator, capability modules, workflows, grounding, evidence rules, quality screening, metering, approvals, Action Cards, customer data model | **Something Clicks** (written here, in this repository) | "Our agent" |
| Business knowledge: confirmed facts, approvals, edits, outcomes, evaluation sets | **Something Clicks and its customers** (permissions apply, see section 4) | Our data |
| Model weights, if we run an open-weight model (for example Qwen, Mistral, Gemma, DeepSeek families) | **The model's developer.** We hold a *licence* to run it; its terms (Apache 2.0, MIT, or a custom licence) set our rights | "An open-weight model we host", never "a model we created" |
| Model weights after fine-tuning on our data | A **derivative** of the base model, bound by the base licence. We own the adapter/delta and the training data, not the base | "Adapted from <base model>" |
| A model trained from scratch by us | Us, fully | Does not exist and is not planned for the near term (section 4, phase 5) |

Rule for all customer and investor wording: we may say "our Marketing Agent" and "runs on infrastructure we control". We may not say "our own model" or "proprietary model" unless the weights were trained from scratch by us.

## 1. What we already own and have built (verified in this repo)
- **Orchestrator and workflow records** (`agent/orchestrator.ts`, `workflows.ts`, `marketing_workflows`): plan → analyze → rank → prepare → owner review; every run recorded.
- **Capability modules** (`agent/modules/`): Website Intelligence, SEO Intelligence, Marketing Analysis (fixed checks), Business Intelligence (structured profile), Performance Intelligence (verified-fixed tracking), Marketing Strategy, Content Creation, with Market Research / Campaign Planning / Execution reporting "blocked".
- **Website ingestion**: SSRF-safe fetch, page scan, structured data, speed measurement.
- **Evidence system**: four classes, enforced in the database; grounding (quotes must exist on the cited page, figures must be in the source, promises refused); quality screening and an admin review page.
- **Persistent business knowledge**: `business_facts` with source, class, basis, freshness; owner confirms.
- **Action Cards, approvals, versions, execution stages**; activity history.
- **Control layer**: per-business and per-person limits, reservation-based cost metering (works for any provider), deadlines, one-plan slot, server-held keys, RLS isolation, 182 database tests.
- **Provider-neutral model interface** (`provider.ts`): the one seam where a model plugs in. It stays.

## 2. What depended on external AI (before this change) and what happened to it
| Dependency | Was | Now |
|---|---|---|
| `providers/anthropic-dev.ts`, `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`, price table entry | The only registered provider | **Removed.** Registry is empty; `getModelProvider()` returns null |
| `ai.ts`, `drafts.ts` (legacy Anthropic wording and drafts, dormant) | Dormant, SDK-bound | **Removed.** Card wording is, and was, fixed text |
| `evals/providers` (benchmark of OpenAI, Anthropic, Gemini) | A paid-API comparison harness | **Removed** (history keeps it). A harness for *self-hosted* candidates replaces it in phase 2 |
| Model-written steps: business understanding (language part), model findings, drafts, plan wording | Needed a provider | Still need a model. They report **blocked**, never placeholder output |
| Launch blocker "Anthropic key" | Scope B blocker | **Gone.** Scope B now depends on phase 2 below |

## 3. What operates independently today (no model, verified)
Verification vocabulary used everywhere in this repo:
- **Functionality verified**: runs and is covered by tests (unit, database, build).
- **Model inference verified**: a real model produced real output in our environment. **None. Never done.**
- **Model quality verified**: output met `EVALUATION.md`'s standard in two consecutive rounds. **None.**
- **Not implemented.**

| Capability | Without a model | Status |
|---|---|---|
| Website check, evidence, ranking, Action Cards, approvals, stages, verification, weekly re-check | Fully | Functionality verified (not yet on real sites; see checklist) |
| Business Intelligence: contact details, services from links, **structured website data (schema.org: address, area served, rating, price range, offered services) and quote-grounded trust statements** | Deterministic extraction with exact evidence | Functionality verified (unit tests, fixtures) |
| Business profile review (confirm, correct, reject, add; what is missing and stale) | Fully | Functionality verified; browser run pending |
| Marketing Strategy | **Rules-based plan**: orders the open Action Cards by impact, evidence strength, confidence, effort and the owner's stated goal; asks the questions the profile is missing. Does not read free-text notes and does not write prose | Functionality verified (unit + database tests). **Not AI reasoning; labelled "built with fixed rules" in the product** |
| Content Creation | Blocked: writing a headline in a business's voice needs language generation. Templates would be canned text, so none is offered | Not implemented without a model |
| Market Research, Campaign Planning, Execution | Not built | Not implemented |
| Language understanding of a site (value proposition, positioning, objections, voice) | Needs a model | Blocked; code and grounding exist and are tested with a stand-in that proves the *checking rules only* |

Test doubles in the test suite prove rules (grounding, limits, deadlines, shape). They are never evidence of model capability.

## 4. What is needed to run our own model
### 4.1 Options evaluated
| Option | What it is | Independence | Verdict |
|---|---|---|---|
| **A. Self-hosted open-weight model on a dedicated GPU server we rent or own** | We run the weights in our account behind our own authenticated endpoint | No per-token fee, no third party sees prompts (the GPU host is a processor and goes in the privacy policy). Depends on the licence of the base model | **Recommended first step** |
| B. Local inference on developer or office hardware | Same software, small/quantized model on a workstation | Good for development and evaluation; not for customers (availability) | Use for phase 2 experiments only |
| C. Managed "dedicated deployment" of an open-weight model by a hosting vendor | Vendor runs it for us | Moves operations, not ownership; still a paid vendor | Rejected for now (conflicts with the decision); revisit only as a fallback you approve |
| D. Fine-tuning an open-weight base on our data | LoRA/adapter on our approved examples | Increases fit and reduces size needed; still a derivative | Phase 4, after we have data and an evaluation set |
| E. Training our own model from scratch | Pre-training on a large corpus | True ownership of weights | Not feasible now. Frontier-class pre-training costs millions of dollars and a research team; a small model trained from scratch would be worse than free open-weight ones. Decision gate in phase 5 |

### 4.2 Candidate base models (shortlist to test, not a recommendation)
The searches available to this session returned low-quality, mostly marketing pages ([model comparison](https://bestllmfor.com/best/structured-data-extraction-json/), [roundup](https://dev.to/nishilbhave/best-open-source-llm-in-2026-open-weights-worth-running-1p12)); **none of their claims is verified**. Candidates named there that must be checked directly against their own model cards and licence files: Qwen 3.x family (including a ~30B class), Mistral Small / Large 3, Gemma 3 27B class, and, if the licence is acceptable, DeepSeek V4. Selection criteria, fixed in advance: (1) a licence that allows commercial use and fine-tuning without usage-based fees; (2) reliable schema-constrained JSON output; (3) quality on **our** evaluation tasks (section 6 phase 2), not public leaderboards; (4) fits one 48–80 GB GPU quantized, so the first deployment is one machine; (5) tokens per second under our request deadline.

### 4.3 Serving stack
TypeScript stays the product language. The model server is off-the-shelf open-source inference software (vLLM or llama.cpp class; vLLM supports JSON-schema constrained output, though its request syntax has changed across versions: [docs](https://docs.vllm.ai/en/v0.10.0/features/structured_outputs.html)), not a new Python product. The app talks to it through **one new provider adapter** (`providers/self-hosted.ts`, an OpenAI-*compatible* HTTP protocol spoken to *our* server, not to OpenAI), behind the existing metering, deadlines, grounding and slots. Authentication: a server-only secret; the endpoint is not public.

### 4.4 Hard constraints found in this code (they shape the design)
1. **Latency vs the request deadline.** Today model steps get at most ~100 s. A 30B-class model on one GPU produces tens of tokens per second per stream (a planning estimate, **to be measured**), so a 4,000-token answer can take 1–3 minutes. Self-hosting therefore needs **background jobs** (queue, status screen, notification), not in-request calls. This is already listed as post-launch work; it becomes phase 3.
2. **Cost metering** assumes dollars per token. For our own server the honest price is *amortized GPU cost per million tokens at measured utilization*; it replaces the published-price table once we have measurements. Until measured, no price exists and no call is made (the existing fail-closed rule).
3. **Vercel cannot host GPUs.** The model server is a separate machine reachable over HTTPS.
4. **Availability.** One GPU is one point of failure; the agent must degrade to the deterministic features when the model is down (it already reports "blocked").
5. **Privacy and terms.** Prompts contain business details the owner entered. Even self-hosted, the GPU host is a sub-processor; `LEGAL_AI_DRAFT.md` must be rewritten for that (it currently discusses a third-party model provider). Needs attorney review.
6. **Training data consent.** Using customer content (confirmed facts, edits, approvals) to train needs explicit terms and opt-in; public website text is also not automatically free to train on. No customer data is used for training under the current terms.

### 4.5 Hardware and infrastructure requirements (first deployment)
| Item | Estimate | Basis |
|---|---|---|
| GPU | one 48 GB (L40S class) for ≤ ~30B quantized, or one 80 GB (A100/H100 class) for more headroom | model memory plus context; confirm per model in phase 2 |
| CPU / RAM / disk | 16+ cores, 64 GB RAM, 500 GB NVMe | weights, logs, caching |
| Network | private endpoint (VPN or allow-listed HTTPS with token), TLS | not public |
| Ops | health checks, restart, metrics, log without secrets, nightly image rebuild | needed before customers |
| Evaluation | a labelled set of ≥ 30 real sites with human-written checklists | section 6 |

## 5. Costs (estimates; every figure to be replaced by measurement or a quote)
GPU rental market (sources conflict; some are low-quality): H100 80 GB on demand roughly $2–4 per GPU-hour, a median near $2.5–3.9 depending on tracker; A100 80 GB roughly $0.9–1.9; L40S roughly $1.1–1.6 ([price index](https://alpha-one-index.github.io/ai-infra-index/specs/cloud-gpu-pricing.html), [H100 2026](https://akash.network/the-bid/h100-rental-price-2026-cost-per-hour/), [comparison](https://intuitionlabs.ai/articles/cloud-gpu-rental-prices-comparison)). One-year commitments reportedly rose ~40% during 2026, so quote before assuming.

| Cost | Order of magnitude | Notes |
|---|---|---|
| Always-on single GPU, rented (24×730 h) | L40S ≈ $800–1,200/month; A100 ≈ $650–1,400; H100 ≈ $1,800–2,900 | fixed whether or not customers use it |
| Evaluation phase (bursts, a few days of GPU time) | ≈ $100–500 | rented by the hour |
| Fine-tuning run (LoRA on a 7–32B model) | ≈ $50–500 per run in GPU time | the large cost is **data preparation and labelling**, not compute |
| Engineering (adapter, job queue, ops, evaluation harness) | roughly 6–10 engineer-weeks for phases 1–3 | planning figure |
| Buying hardware instead | one 80 GB-class server ≈ five figures up front plus power, hosting and spares | only worth it at sustained high utilization |
| Training from scratch | millions of dollars and a research team | not planned |
Break-even: a fixed ~$1,000–2,500/month GPU is cheaper than hosted per-token pricing only above a few thousand model-assisted workflows a month; below that it is a deliberate price for independence. That trade is yours to accept.

## 6. Phased roadmap
**Phase 0 (this change, done):** remove Anthropic code and variables; keep the provider interface; deterministic agent improvements (structured website data, trust statements, rules-based plan); honest status labels; tests that need no credentials.
**Phase 1: serving contract (needs your approval to spend):** `self-hosted` adapter against an OpenAI-compatible endpoint; endpoint auth; health check; tests against a local stub server for protocol/timeouts, plus one real run on a rented or local GPU. Output: "model inference verified" for the first time.
**Phase 2: model selection by our own evaluation (needs approval of candidates and rented GPU hours):** build an evaluation set from 20–30 real, permissioned small-business sites (`EVALUATION.md` standard, unchanged); run each candidate on the same tasks; record quality, invented-fact count, latency, tokens, measured cost in `EVALUATION_LOG.md`. Pick one, or conclude none meets the standard (then the model-written features stay off and the deterministic product ships).
**Phase 3: production serving:** background jobs and status UI, redundancy plan, monitoring and alerts, cost table from measurements, privacy policy and terms updated, attorney review, final independent review.
**Phase 4: adaptation (needs consent terms first):** collect owner-approved examples (confirmed facts, approved edits) with opt-in; supervised fine-tune (adapter) of the chosen base; A/B against base on the frozen evaluation set; ship only if better and with the "adapted from" label.
**Phase 5: decision gate on deeper ownership (not before phase 4 results):** options are continued pretraining on a base, distillation of the adapted model into a smaller one, or from-scratch training; each needs a data, cost and benefit case. The default outcome is to keep adapting open-weight bases.

## 7. Remaining work to make the Marketing Agent operational
1. **Real sites** (not just fixtures): run the deterministic agent end to end on 3–5 permissioned sites on Preview; this needs no model and tests extraction and ranking truthfully.
2. Owner review screens in a real browser; phone checklist.
3. Phase 1–2 above (the first real model output).
4. Content Creation (needs a model), Market Research (needs a data source we hold or license), Campaign Planning, authorized Execution.
5. Production migrations, variables, attorney review, final review, owner approvals (unchanged; none done).

## 8. Decisions (ANSWERED Nov 26 2026)
Owner answers: (1) capped evaluation approved, ≤ $500, ≤ 3 models, temporary usage-billed GPUs, no always-on server; (2) Apache 2.0 / MIT only for production; (3) no training on customer data at launch; V1 (the $49 report, no AI claims) first, V2 the destination. The evaluation is specified in `MODEL_EVALUATION_PLAN.md` and spending is tracked in `EVALUATION_SPEND.md`. The original questions are kept below for the record.

1. Approve phase 1 and the rented-GPU budget, or tell me to stay deterministic-only for now.
2. Approve the candidate shortlist rules (section 4.2) or add licence requirements.
3. Approve a consent and terms approach before any customer data is used for adaptation (phase 4).
