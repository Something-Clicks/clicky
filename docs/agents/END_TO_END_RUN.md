# End-to-end run with a real website and real model inference (Nov 26 2026)

**What this is:** the whole Marketing Agent loop run through the app on a real public website, with real inference from a
self-hosted open-weight model server. **What it is not:** an evaluation of the approved candidates, or evidence that the product's
model work is good enough. The model used here is a small CPU model chosen only to prove the real-inference path. Verdict at the end.

## Setup (all local to the development container; nothing deployed, no Production, no Stripe, no spend)
| Part | What ran |
|---|---|
| App | this branch, `next start`, local Supabase-compatible stack (`tests/e2e/stack`, throwaway Postgres with every migration) |
| Website | **somethingclicks.com** (the owner's own business; 5 real pages read through the app's safe fetcher) |
| Model server | llama.cpp `b6850` (`59fc1ec8`), localhost only, bearer token, JSON-schema constrained output (`scripts/model-eval/serve-local-cpu.sh`) |
| Model | `Qwen/Qwen2.5-1.5B-Instruct-GGUF` @ `91cad511`, q4_k_m, **Apache 2.0** (the repo's `LICENSE` file is the plain licence, sha256 `832dd9e0…`). Qwen2.5-3B was excluded: its licence is "other" (Qwen Research), not Apache 2.0/MIT |
| Adapter | the existing `self-hosted` provider, metered per business (reserve, call, settle), validated structured output |
| Price used for metering | **nominal $0.01 per million tokens, a placeholder so metering and caps are active; NOT a measured cost** (the container is not billed). Never commit or reuse it |
| Hardware | 4 CPU cores, 15 GB RAM, about 18 tokens per second |
| Evaluation budget | **$0 spent** of the $500 cap. This is not an evaluation round (none of the three candidates ran; `EVALUATION_LOG.md` unchanged) |

Run it again: `scripts/model-eval/serve-local-cpu.sh`, then start the app with the switches and the `SELF_HOSTED_*` variables (see
`.env.example`), `AGENT_DEADLINE_MS=540000` (needed for a slow model; ignored on Vercel), and
`E2E_MODEL=1 E2E_SITE=somethingclicks.com E2E_BUSINESS="Something Clicks" pnpm exec playwright test e2e/specs/11-real-model.spec.ts`.

## What ran and what happened
1. **Website Intelligence / SEO / Marketing Analysis (fixed checks, no model):** read 5 real pages, produced accurate, evidenced Action
   Cards (for example the homepage really has 99 words; the phone visitors cannot tap to call). Effort and order saved. ✔
2. **Business Intelligence with the model:** a real call. Result varied between runs:
   - Run A: timed out at the 300 s per-attempt cap, nothing saved (settled at the full reservation, as designed).
   - Run B: completed in about 8 minutes: **12 details proposed**, several correct and quoted from the site (services *Diagnostic Audit*,
     *Growth AI*, *Scale & Automation*; price *$39*; what the business does). Some were weak or wrong (a "verified" business model
     of "AI-driven", location "Online", trust signal "Reviews and testimonials"). All were saved as **proposed**, so the owner has to
     confirm each one. This is the control that makes weak output safe, and it is why none of it counts as known.
3. **Marketing Analysis with the model:** real call returning 5 findings. They were junk: restatements of page titles, the same boilerplate
   repeated, and self-contradiction ("the title is clear… it should be replaced"). **Our grounding only checked that quotes existed, so all 5
   were saved as Action Cards.** Found by reading the output. Fixed with deterministic guards (restates its own evidence, label titles,
   no concrete action, repeated text). Re-run against the real model: 4 of 5 dropped; the one it still kept was caught by two further rules
   added afterwards (unit-tested on its exact shape; not re-run against the model after the last rule).
4. **Campaign (no model):** after the owner confirmed one service, "promote our marketing recommendations" produced the brief, a page plus
   email, social and Google posts that wait for the page, a before-and-after measure; approval is the owner's. ✔
5. **Content Creation with the model, four campaign drafts:** 4 of 4 passed our content checks and were stored beside the templates;
   6 metered calls were recorded in the ledger; nothing was sent or published. **Quality is poor:** the model mostly copied the template's
   placeholders and added generic filler ("tailored to your needs", "book your consultation", an offer the business never made).
   The content checks (no promises, no unsupported figures) cannot detect generic copy, so a person must read every draft. That is
   what the screens tell the owner.
6. **Timing:** the request-time deadline (about 105 s, sized for Vercel's 120 s limit) is too short for this model on this hardware:
   both model steps ended `out_of_time` at first. Deadlines now depend on where work runs (`deadline.ts`): fixed on Vercel,
   `AGENT_DEADLINE_MS` elsewhere, 540 s for Trigger.dev background jobs.

## Verdict
- **Model inference verified:** yes, for the pipeline, with `qwen2.5-1.5b-instruct-q4_k_m` on CPU in local development.
- **Model quality verified:** **no, and this model is not good enough** (understanding unreliable, findings empty, drafts generic).
  That was expected of a 1.5B model and does not say anything about Qwen3.8-27B or Qwen3-30B-A3B, which need a 48 GB GPU and have not run.
- **The checks are doing their job where they can:** nothing unsupported was stored as fact (details wait for the owner), and the one
  real hole they had (hollow findings) was found by this run and closed. They cannot judge copy quality; people do.
- **Not demonstrated:** the same loop on Trigger.dev (not logged in), on clicky-dev (migrations not applied there), or with a model
  good enough to rely on.

## Exact next step
Run the approved candidates (A `Qwen3.8-27B-FP8`, B `Qwen3-30B-A3B-Instruct-2507-FP8`, and the third once chosen) on a temporary
usage-billed 48 GB GPU under `FIRST_RUN_CHECKLIST.md`, then repeat step 2, 3 and 5 here with the winning model. Needs: a GPU provider
account (host allowed in the environment, key through the secure prompt) and the owner's choice of third model. Until then there is no
production model, and model-written work stays behind its switches.
