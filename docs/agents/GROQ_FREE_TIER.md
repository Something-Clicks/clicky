# Groq, free tier only: limits, pacing and how to run the evaluation

Owner decision (Nov 28 2026): **Groq's FREE tier only.** No payment method, no paid inference, no automatic switch to a paid model.
Initial model: `openai/gpt-oss-120b`. OpenRouter stays off. Production never gets a model (`getModelProvider()` is null when
`VERCEL_ENV=production`).

## The limits (read from Groq, Nov 28 2026)
Source: Groq's own "Free Plan Limits" table (console.groq.com/docs/rate-limits), and live `x-ratelimit-*` response headers from this key.

| Model | Requests / minute | Requests / day | Tokens / minute | Tokens / day |
|---|---|---|---|---|
| `openai/gpt-oss-120b` | 30 | 1,000 | 8,000 | 200,000 |
| `openai/gpt-oss-20b` | 30 | 1,000 | 8,000 | 200,000 |
| `qwen/qwen3.8-27b` | 30 | 1,000 | 8,000 | 200,000 |

Headers confirmed RPD 1,000 and TPM 8,000 for all three; RPM and TPD are only in the table (headers do not show them). Limits are per
model, so three models have three separate allowances. Groq counts a request's input plus part of its requested `max_completion_tokens`
against the minute when it is admitted (measured: a 6,000-token allowance on a 96-token answer used about 2.8K of the minute; a
100-token allowance about 170). One request therefore has to fit under 8,000 tokens in total.

## What this means for Clicky
A full workflow (understand, findings, plan, two drafts) is about 6 calls and 10 to 15K tokens, so one model allows roughly **13 to 20
workflows a day** and about **2 calls a minute**. The frozen dataset (14 cases, about 25K tokens per case with the owner-note variants)
needs **more than one day per model**: that is why the evaluation checkpoints each case.

## How Clicky behaves (`providers/groq-limits.ts`, `providers/groq.ts`)
- **Price is $0**, recorded as $0 in `model_usage` with the real token counts. Free usage is never shown as paid. The dollar caps are
  therefore inert on the free tier; the real bounds are the governor below, Groq's own 429s, one-at-a-time agent slots per business and the
  existing workflow limits.
- **Pacing.** A rolling-minute and rolling-day governor (kept 10% under each ceiling) reserves input plus the output this kind of task
  produced last time, waits for the minute window inside the request deadline, and learns from Groq's `x-ratelimit-remaining-tokens`.
- **Sensible output limits.** The output allowance shrinks to what fits under 8,000 with the input; if even a short answer would not fit
  the request is refused as "too large for the free tier" (a plain outcome, not a crash). `openai/gpt-oss-*` default to
  `reasoning_effort: low` so reasoning does not eat the allowance. Every draft prompt states each field's hard character limit.
- **Retries.** A minute limit is waited out (up to 2 times) inside the deadline; a transient 5xx is retried once; invalid output gets
  the existing single validated retry.
- **Throttling is its own outcome.** `ModelThrottled` carries the time the work can resume. Workflows keep their fixed results, record
  "Skipped: our free AI allowance is used up for now. This can continue around HH:MM UTC", and never show it as a failure or a payment
  prompt. A daily limit is never waited for.
- **Fails closed on a plan change.** If Groq's headers ever show higher limits than the free tier, the adapter stops sending and says
  so; nothing switches to paid by itself. `GROQ_TIER=paid` exists only for a future explicit owner decision and then needs both published
  prices.
- **No fallback.** There is no automatic switch to another model or provider.

Variables: `MARKETING_MODEL_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_MODEL`; optional `GROQ_REASONING_EFFORT`, `GROQ_STRICT=0`,
`GROQ_ATTEMPT_TIMEOUT_MS`, `GROQ_RPM|TPM|RPD|TPD` (override the table), `GROQ_LIMITER_STATE_FILE` (share the rolling usage between
separate runs). In the cloud sandbox the key is injected by the network proxy and Node needs `NODE_USE_ENV_PROXY=1`.

## Running the checks
```bash
# strict structured-output acceptance on every real agent schema (about 6 minutes, ~45K tokens)
NODE_USE_ENV_PROXY=1 MODELCHECK_PROVIDER=groq GROQ_API_KEY=<key> GROQ_MODEL=openai/gpt-oss-120b \
  GROQ_LIMITER_STATE_FILE=/var/tmp/groq/limiter-openai_gpt-oss-120b.json pnpm exec vitest run --project modelcheck evals/model/schemacheck.eval.ts

# the frozen evaluation, resumable; rerun the SAME command after a "PAUSED" message once the allowance returns
MODELCHECK_SET=dev MODELCHECK_LABEL=dev-r1 <same environment> pnpm modelcheck
```
A provider throttle never counts as a model failure: the interrupted case is dropped and redone whole. Scores that need a person (the
blind sheet, rubric scores, confirmed invented items) are **not** produced by this tooling and stay "pending" until a person fills them in.
Do not change any case, threshold or rubric (`pnpm modelfreeze` verifies them).

## Privacy flags for the owner (not edited here)
- Website text of a customer's business is sent to Groq when a model runs. Groq's free-tier data-use terms were not verified here; confirm
  them and review the Privacy Policy and Terms wording before any customer data reaches a model (acceptance gate G8b).
- Competitor discovery sends only a place name and a short service phrase to OpenStreetMap (Nominatim, Overpass) and DuckDuckGo; never the
  business name, email or customer data. OpenStreetMap data needs the attribution shown on the Compare screen.
