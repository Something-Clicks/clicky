# Provider evaluation (OpenAI, Anthropic, Gemini): optional tool

**Status (Nov 25 2026, owner direction):** optional. A provider comparison is not a prerequisite for
building the Marketing Agent; the provider is a replaceable implementation detail behind
`src/lib/server/agent/provider.ts`. This tool has not been run. Known gap: the Gemini adapter uses
`generateContent`, which Google's docs now call legacy (the Interactions API is their default).
Update it before relying on Gemini results.


Disclosure: this harness was written by Claude, an Anthropic model, and Anthropic is one of the
providers being compared. To keep that from mattering, every provider gets identical inputs,
instructions, schemas, validation and mechanical checks; quality judgments come only from blind
human ratings. Claude does not grade outputs.

## What it measures
Each provider runs the Milestone 1 workflow on the same 3–5 real websites, `EVAL_RUNS` times each
(default 2): **business profile → findings (with evidence classes) → homepage copy and SEO drafts**,
each step on its own previous outputs, from one identical source packet per site built with the
app's own safe fetcher, scan and checks.

**Measured (automatic, `report.md`):** complete-workflow rate (reliability), valid structured output
first try and after one retry, latency per workflow (median, p90), cost per complete workflow, invalid
citations, "verified" claims without observed evidence, inferred/estimated claims without a basis,
evidence-class mix, numbers in drafts not found in the source, promises, SEO length compliance.

**Subjective (blind, human):** accuracy, evidence quality, business specificity, copy quality (1–5),
from `review/*.md` where providers are labeled A/B/C.

## Run it (on a machine with internet access)
The cloud sandbox used to build this cannot reach public websites or OpenAI, so run it locally:

```bash
git checkout claude/ecstatic-curie-9shvjf && pnpm install
cp evals/providers/sites.example.json evals/providers/sites.json   # then list 3–5 real sites you may test
export OPENAI_API_KEY=… ANTHROPIC_API_KEY=… GEMINI_API_KEY=…        # your keys; never commit them
export EVAL_OPENAI_MODEL=… EVAL_ANTHROPIC_MODEL=… EVAL_GEMINI_MODEL=…  # comparable tiers
export EVAL_OPENAI_INPUT_PER_MTOK=… EVAL_OPENAI_OUTPUT_PER_MTOK=…      # current list prices, US$ per 1M tokens
export EVAL_ANTHROPIC_INPUT_PER_MTOK=… EVAL_ANTHROPIC_OUTPUT_PER_MTOK=…
export EVAL_GEMINI_INPUT_PER_MTOK=… EVAL_GEMINI_OUTPUT_PER_MTOK=…
export PAGESPEED_API_KEY=…            # optional; without it PageSpeed is "missing" for every provider alike
pnpm eval:providers
```

Optional: `EVAL_<PROVIDER>_EFFORT` (reasoning setting, passed through unchanged), `EVAL_RUNS` (1–5),
`EVAL_OUT` (default `eval-results/`), `EVAL_PACKETS_DIR` (reuse saved packets so a re-run sees exactly
the same website content). Use only the sites file you created; keys stay in your shell.

A provider with missing settings is shown as NOT RUN with the missing names; nothing is guessed.
No fallback model is used (Anthropic's server-side refusal fallback is deliberately off, so a refusal
counts as a failure rather than another model's answer).

## Blind review
1. Copy `ratings.template.csv` to `ratings.csv` in the results folder. Give reviewers only `review/`.
2. Each reviewer fills one row per site and label (no commas in notes).
3. `EVAL_REPORT_DIR=eval-results/<run> pnpm eval:providers` rebuilds `report.md` with the unblinded averages.

## Choosing comparable models
Pick one model per provider in the same price/capability tier, and record why. For Anthropic, current
models and list prices (Anthropic's pricing table, Nov 3 2026): `claude-opus-5-5` $4/$20, `claude-sonnet-5-5`
$2/$10, `claude-haiku-5-5` $0.10/$0.50 per 1M input/output tokens. Take OpenAI and Gemini model names and
prices from their current pricing pages on the day you run it.
