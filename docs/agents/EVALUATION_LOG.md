# Evaluation log

One section per round. Fill from the read-only SQL in `EVALUATION.md`. Never paste secrets or customer-private data; use the test businesses only.

## Round template
- Date, branch/commit, the model and adapter used (none exist yet), sites (name only), who ran it.
- Per site: pass/fail per line of the quality standard, with the specific items that failed (quote the item, the site text it contradicts or lacks).
- Failures grouped by cause → the change made (file, test added).
- Cost and time per business.
- Verdict: round met every line? Consecutive clean rounds so far: N.

## Rounds
**No official round yet** (the scored test set, human scoring and two consecutive passes are all still to do). Consecutive clean rounds: 0. Below: development-set measurements, which are not a round.

None yet as official rounds. No real-model run has happened (no external provider is used and no self-hosted model exists yet, Nov 25). Consecutive clean rounds: 0.


## Development-set bake-off on Groq's free tier (Nov 28 2026): NOT an official round
Frozen dev set (D1 to D4, fictional businesses, dataset `c0b4dd983603`, frozen match true). Automatic measurements only; no person has scored anything, and no case, threshold or rubric was changed (`pnpm modelfreeze` passes). Spend: $0 (free tier). Provider throttles are never counted as model failures. Commits differ slightly between runs (noted); the retry-rule fix (`372bf45`) and the figure-check fix (`57154bf`) came after the first runs.

| Model | Strict schema accepted by Groq (10 real schemas) | Dev tasks usable | First attempt | Findings kept / proposed (D1..D4) | Plans rejected | Notes |
|---|---|---|---|---|---|---|
| `openai/gpt-oss-120b` (dev-r1, `4ebe20f`) | 10 of 10 | 20 of 20 (100%) | 95% | 4/5, 4/5, 3/5, 0/1 | 0 | 90.6% of proposed items survive grounding; 27.5K in / 21.0K out tokens |
| `openai/gpt-oss-20b` (dev-r2, `372bf45`) | 8 of 10 (HTTP 400 on the plan schema once; findings cut off with no complete JSON) | 17 of 20 (85%) | 75% | n/a (3 findings tasks unusable) | 0 | its reasoning uses the whole output allowance, so slow cut-off first attempts get no retry (`too_slow_to_retry` x3, genuinely slow) |
| `qwen/qwen3.8-27b` (dev-r3, `57154bf`) | 10 of 10 | 18 of 20 (90%) | 90% | 0/0, 0/0, 0/0, 0/0 (no findings at all) | 2 (`no_usable_priority`, grounding) | 8.1K output tokens in total; also 3 of 4 drafts flagged for missing the business or a banned claim |

Reading: on every measurable line `gpt-oss-120b` is ahead and is the only candidate that produces findings and plans. This does NOT decide quality: understanding, evidence, strategy, usefulness and content need a person with the blind sheet (`MODELSCORE_BLIND=1`), and the flags the harness raised (for example possible inventions in D2 and an empty-headline placeholder in D4) still need a person's confirmation.

Official test-set round (`MODELCHECK_SET=test`, label `test-r1`, `gpt-oss-120b`): **4 of 10 cases done (T1 to T4)**, saved in a checkpoint; stopped to keep allowance for the real-model app run. The rolling day returns the allowance about 24 hours after the earliest use; rerun the same command (with `MODELCHECK_RESUME_ANY=1` if the commit changed and `git diff` of `src/lib/server/agent` and `evals/model` is empty) until `modelrun-*test-r1*.json` appears, then blind, score and evaluate. Failure causes found by these runs and fixed: the retry rule counted our own pacing wait as a slow model (agent), `page_copy` prompts never stated field limits (agent), list numbering and `### 1.` headings were refused as invented figures or a "#1" claim (agent). Provider-side: Groq's 20b model rejects the plan schema once and truncates on reasoning; free-tier minute limits were waited out; none of the calls hit the daily limit except where noted.
