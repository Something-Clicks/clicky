# First real evaluation run: checklist (Nov 26 2026)

Nothing here has been run. No account, GPU, rental or cost exists. Every box marked OWNER needs your approval before anyone acts.

## 0. Decisions needed first (OWNER)
- [ ] Approve or reject `docs/agents/review/proposed-dataset-fixes.patch` (see `EVALUATION_DATASET_REVIEW.md`). Applying it re-freezes: new dataset hash `cd59922fed9bafad00c7f0d9e52827a3a733ea28275f628541d4a352b314005f`. Until applied, the frozen hash is `c0b4dd9836030d2703966688a4b02f746af412bd9f72e593ce5f661069b34cf3` and the rounds counter is at zero either way.
- [ ] Approve the scoring-method fixes already in code (human confirmation of recall and invented facts, workflow time excludes extra note plans, tolerant keyword matching).
- [ ] Choose the third model: C `openai/gpt-oss-20b` (OpenAI-authored weights, extra `USAGE_POLICY` file) or `Qwen/Qwen3-32B`.
- [ ] Name an independent reviewer for cases T1, T3, T7 (`docs/agents/review/`), and for at least 20% of scoring later.
- [ ] Choose the GPU provider and class, and give the exact hourly price. Approve the credit or card and the cap.

## 1. Candidates (verified Nov 26 2026, commits pinned)
| | Repo @ commit | Licence (LICENSE file = plain Apache 2.0 apart from the copyright line) | Weights | GPU |
|---|---|---|---|---|
| A | `Qwen/Qwen3.8-27B-FP8` @ `c3a462cc3d38cf351f3b26cbd763469eeb74ef81` (base `Qwen/Qwen3.8-27B` @ `37561816e66b…`) | Apache 2.0, "Alibaba Cloud" | 30.9 GB | 48 GB card (estimate ~35-38 GB) |
| B | `Qwen/Qwen3-30B-A3B-Instruct-2507-FP8` @ `5a5a776300a41aaa681dd7ff0106608ef2bc90db` (base @ `0d7cf23991f4…`) | Apache 2.0 | 31.2 GB | 48 GB card (estimate ~36-39 GB) |
| C | `openai/gpt-oss-20b` @ `6cee5e81ee83917806bbde320786a8fb61efebee` | Apache 2.0 plus a `USAGE_POLICY` file ("comply with all applicable law"); legal review item | 13.8 GB | 24 GB card (estimate ~16-18 GB) |
| C alt | `Qwen/Qwen3-32B-FP8` @ `aa55da1ecc13d006e8b8e4f54579b1ea8c3db2df` (base @ `9216db5781bf…`) | Apache 2.0, "2024 Alibaba Cloud" | 34.3 GB FP8 | 48 GB card |
GPU memory figures are estimates from file sizes; they are confirmed only by starting the server. Unverified: FP8 speed on the rented GPU generation; how C's reasoning level is set through the chat API (confirm on first start; record what was used).

## 2. Frozen inputs (check before any run; `pnpm modelfreeze` must pass)
- Scored set: the 10 `T*`/test cases only; dev cases `D*` are never counted.
- Dataset hash, standards hash: `evals/model/dataset/FREEZE.json`.
- Decoding: temperature 0.2, top-p 0.95, schema-strict JSON; Qwen3.8 thinking off through `SELF_HOSTED_EXTRA_BODY`; 2507 instruct has no thinking mode; same prompts and schemas for every model.
- Thresholds: `evals/model/thresholds.ts` (pinned by a test). Two consecutive passing rounds on the same hash are required.

## 3. Commands (on the rented GPU box; a laptop only runs `pnpm`)
```
# 1. one-time on the box: install Node 20+, pnpm, python3, vllm (pin the version in use and write it in the run record); clone the repo at the run commit
# 2. terminal 1
scripts/model-eval/serve.sh A          # or B / C
# 3. terminal 2
scripts/model-eval/smoke.sh            # expect model listed and 401 without the token
export MODELCHECK_GPU_USD_PER_HOUR=<approved price> MODELCHECK_GPU_CLASS="<gpu name>"
scripts/model-eval/run-eval.sh A       # runs pnpm modelfreeze, then pnpm modelcheck on the scored set
MODELSCORE_BLIND=1 pnpm modelscore     # blind sheet + key; independent person scores; then MODELSCORE_RECORD=1 to record the round
```
The server listens on 127.0.0.1 only with a random token kept in `~/.eval-token` (mode 600). Nothing is exposed publicly. Nothing from this repo reaches Vercel, Supabase or Stripe.

## 4. Cost (formula; exact figure needs the approved hourly price)
`cost = hourly price x billed hours`. Billed hours per model = start-up and download (assume 0.5 h) + run + scoring waits (box is shut down while people score).
Run time bound: the pass threshold allows up to 10 min per business, so at most ~1.7 h for 10 cases; plan 2.5 h per model including start-up.
Example only (not a quote): at $1.50/h, 3 models x 2.5 h = $11.25; at $3/h = $22.50; at $6/h = $45. One full round of three models is far below the $500 cap at any single-GPU price. A second round repeats it. Stop and ask at $450.

## 5. After the run
- [ ] `pnpm modelscore` output saved; round recorded only if gates were evaluated (never hand-edited).
- [ ] Shutdown and proof: `scripts/model-eval/shutdown.md`. Write the real billed amount into `EVALUATION_SPEND.md`.
- [ ] Report passes, failures and cost. If nothing passes: do not lower a bar, stop and ask.
