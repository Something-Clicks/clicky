import "server-only";

import { readFileSync, writeFileSync } from "node:fs";

import { log } from "@/lib/log";

import { estimateInputTokens } from "../metering";
import { registerPrice } from "../pricing";
import { ModelThrottled, type ModelProvider, type ModelRawResponse } from "../provider";
import { groqStrictSchema } from "./groq-schema";
import { FREE_TIER_LIMITS, Governor, MIN_OUTPUT_TOKENS, parseDuration, parseLimitHit, realClock, type Clock, type GovernorState, type GroqLimits, type StateStore } from "./groq-limits";
import { DECODING, extractJson, readCapped, schemaName } from "./self-hosted";

/**
 * Groq adapter (owner decision, Nov 27 2026: Groq is the primary model provider; supersedes the earlier "no hosted provider" rule).
 * Same chat-completions protocol and the same rules as the self-hosted adapter: server-only key, structured output validated by
 * the caller, no redirects, size-capped answers, errors that never carry the key or Groq's text, usage estimated HIGH when missing.
 * The address is FIXED to Groq's API (no environment variable can point it elsewhere, so the key can only ever go to Groq).
 *
 * Configuration (server-only; the adapter is inert unless the key and model are valid):
 *   GROQ_API_KEY                   the key; never logged, never sent anywhere but api.groq.com
 *   GROQ_MODEL                     model id. Strict structured output is documented for openai/gpt-oss-120b, openai/gpt-oss-20b,
 *                                  qwen/qwen3.8-27b and meta-models/muse-spark-open (console.groq.com/docs/structured-outputs)
 * FREE TIER ONLY (owner decision, Nov 28 2026). The default tier is "free": calls cost $0 and are recorded at $0 (never presented as
 * paid), and the adapter paces itself to Groq's Free Plan limits (groq-limits.ts): requests and tokens per minute and per day.
 * It never adds a payment method, never switches to a paid model, and fails closed if Groq's own headers ever show higher limits than
 * the free tier (a sign the key's plan changed): nothing more is sent until the owner decides. GROQ_TIER=paid exists only for a future
 * explicit owner decision; it then needs both published prices (GROQ_PRICE_INPUT_PER_MTOK, GROQ_PRICE_OUTPUT_PER_MTOK) as before.
 * Optional:
 *   GROQ_STRICT                    "0" switches to best-effort schema mode for a model without strict support (default strict)
 *   GROQ_REASONING_EFFORT          low | medium | high, sent only when set; openai/gpt-oss-* default to "low" so reasoning does not
 *                                  eat the small free-tier output allowance
 *   GROQ_ATTEMPT_TIMEOUT_MS        longest one attempt may run (default 90,000; 10,000 to 300,000)
 *   GROQ_RPM / GROQ_TPM / GROQ_RPD / GROQ_TPD   override the free-tier limits for a model whose table differs (default 30 / 8,000 / 1,000 / 200,000)
 *   GROQ_LIMITER_STATE_FILE        share the rolling usage between separate runs (the evaluation) through a small JSON file
 *
 * A request over the minute ceiling gets a smaller output allowance, or is refused as too large when even a short answer would not
 * fit. A rate limit is waited out inside the request deadline; a longer wait (and every daily limit) ends as ModelThrottled with the
 * time the work can resume, so a workflow can be queued or the owner told when, in plain words. A transient 5xx is retried once.
 */

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_ATTEMPT_MS = 90_000;
/** Output allowance when a request names none: enough for every agent answer, small enough for the free minute. */
const FREE_DEFAULT_OUTPUT = 2_000;
const MAX_PACE_WAIT_MS = 90_000;
const MAX_429_RETRIES = 2;
const SCHEMA_MISMATCH = /does not match the expected schema/i;

export interface GroqConfig {
  key: string;
  model: string;
  strict: boolean;
  reasoningEffort: "low" | "medium" | "high" | null;
  attemptTimeoutMs: number;
  /** "free" (default): $0, paced to the Free Plan. "paid" only by a future explicit owner decision. */
  tier: "free" | "paid";
  limits: GroqLimits;
  price: { input: number; output: number } | null;
}

/** Error from Groq. `status` is the HTTP status when it answered; metering settles a 4xx as "never ran". Never carries Groq's text. */
export class GroqError extends Error {
  /** `neverRan`: the request never left (no connection was made), so it used nothing at Groq and must not count against the allowance. */
  constructor(message: string, public readonly status?: number, public readonly neverRan = false) {
    super(message);
    this.name = "GroqError";
  }
}

const num = (v: string | undefined) => {
  const n = v === undefined || v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const whole = (v: string | undefined, fallback: number) => { const n = num(v); return n === null ? fallback : Math.round(n); };

export function readGroqConfig(env: Record<string, string | undefined>): GroqConfig | null {
  const key = env.GROQ_API_KEY?.trim() ?? "";
  const model = env.GROQ_MODEL?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(key) || !/^[A-Za-z0-9._\-/:]{1,100}$/.test(model)) return null;
  const effort = env.GROQ_REASONING_EFFORT?.trim().toLowerCase();
  if (effort && !["low", "medium", "high"].includes(effort)) {
    log.warn("model.groq_config_invalid", { field: "GROQ_REASONING_EFFORT" });
    return null; // fail closed: a malformed option is never silently ignored
  }
  const attempt = num(env.GROQ_ATTEMPT_TIMEOUT_MS);
  const tier = env.GROQ_TIER?.trim().toLowerCase() || "free";
  if (tier !== "free" && tier !== "paid") {
    log.warn("model.groq_config_invalid", { field: "GROQ_TIER" });
    return null;
  }
  const input = num(env.GROQ_PRICE_INPUT_PER_MTOK);
  const output = num(env.GROQ_PRICE_OUTPUT_PER_MTOK);
  return {
    key, model, tier,
    strict: env.GROQ_STRICT?.trim() !== "0",
    reasoningEffort: (effort as GroqConfig["reasoningEffort"]) || null,
    attemptTimeoutMs: attempt === null ? DEFAULT_ATTEMPT_MS : Math.min(300_000, Math.max(10_000, Math.round(attempt))),
    limits: { rpm: whole(env.GROQ_RPM, FREE_TIER_LIMITS.rpm), tpm: whole(env.GROQ_TPM, FREE_TIER_LIMITS.tpm), rpd: whole(env.GROQ_RPD, FREE_TIER_LIMITS.rpd), tpd: whole(env.GROQ_TPD, FREE_TIER_LIMITS.tpd) },
    // Free tier: the real price is $0. A paid tier needs both published prices; without them the model stays unpriced and metering refuses.
    price: tier === "free" ? { input: 0, output: 0 } : input !== null && output !== null ? { input, output } : null,
  };
}

interface ChatResponse {
  model?: unknown;
  choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/** One governor per endpoint and model, shared by every provider instance in the process (a per-request provider must not reset pacing). */
const GOVERNORS = new Map<string, Governor>();
function governorFor(endpoint: string, cfg: GroqConfig, env: Record<string, string | undefined>, clock: Clock): Governor {
  const id = `${endpoint}::${cfg.model}::${cfg.limits.rpm}/${cfg.limits.tpm}/${cfg.limits.rpd}/${cfg.limits.tpd}`;
  let g = GOVERNORS.get(id);
  if (!g) {
    g = new Governor(cfg.limits, clock, fileStore(env.GROQ_LIMITER_STATE_FILE?.trim(), cfg.model));
    GOVERNORS.set(id, g);
  }
  return g;
}

/** Optional JSON file so separate runs (the evaluation, run on different days) share one rolling day. Best effort; never throws. */
function fileStore(path: string | undefined, model: string): StateStore | null {
  if (!path) return null;
  return {
    load() { try { const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, GovernorState>; return all[model] ?? null; } catch { return null; } },
    save(state) { try { let all: Record<string, unknown> = {}; try { all = JSON.parse(readFileSync(path, "utf8")); } catch { /* new file */ } all[model] = state; writeFileSync(path, JSON.stringify(all)); } catch { /* best effort */ } },
  };
}

/**
 * Groq charges a request's INPUT plus (a capped part of) its requested output against the minute allowance when it is admitted, and the
 * real use afterwards. Reserving the whole output allowance would let only one call through a minute, so pacing reserves the input plus
 * what this kind of task actually produced last time (never more than the allowance asked for). A miss costs a 429, which is waited out.
 */
const TYPICAL_OUTPUT = new Map<string, number>();
const FIRST_GUESS_OUTPUT = 2_500;
const expectedOutput = (task: string, maxOut: number) => Math.min(maxOut, Math.ceil((TYPICAL_OUTPUT.get(task) ?? FIRST_GUESS_OUTPUT) * 1.25));

/** Prompt tokens for pacing. JSON, URLs and digits cost more than prose; this errs HIGH so the minute is never overrun. */
export const estimatePromptTokens = (text: string) => Math.ceil(text.length / 3) + 40;

const headerNumber = (res: Response, name: string) => { const v = res.headers.get(name); const n = v === null || v.trim() === "" ? NaN : Number(v); return Number.isFinite(n) ? n : null; };

/** `baseUrl` and `clock` exist only so tests can aim the adapter at a local stand-in and skip real waiting; no environment variable reaches them. */
export function groqProvider(env: Record<string, string | undefined> = process.env, options: { baseUrl?: string; clock?: Clock } = {}): ModelProvider | null {
  const cfg = readGroqConfig(env);
  if (!cfg) return null;
  const endpoint = options.baseUrl ?? GROQ_ENDPOINT;
  const clock = options.clock ?? realClock;
  const governor = governorFor(endpoint, cfg, env, clock);
  // Free tier: $0. A paid tier (a future owner decision) uses the published prices; without them the model stays unpriced and metering refuses.
  if (cfg.price) registerPrice("groq", cfg.model, cfg.price);
  const effort = cfg.reasoningEffort ?? (/^openai\/gpt-oss/.test(cfg.model) ? "low" : null);
  /** Set when Groq's own headers show limits above the free tier: the key's plan changed, so nothing more is sent. */
  let notFree = false;

  async function post(body: string, signal: AbortSignal): Promise<Response> {
    const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${cfg!.key}` }, body, signal, cache: "no-store", redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      throw new GroqError("Groq tried to redirect the request; refused.", res.status);
    }
    const remaining = headerNumber(res, "x-ratelimit-remaining-tokens");
    governor.observe({ remainingTokens: remaining, resetTokensMs: parseDuration(res.headers.get("x-ratelimit-reset-tokens")) });
    const limit = headerNumber(res, "x-ratelimit-limit-tokens");
    if (cfg!.tier === "free" && limit !== null && limit > cfg!.limits.tpm) {
      notFree = true;
      log.error("model.groq_not_free_tier", { model: cfg!.model, reportedTokensPerMinute: limit });
    }
    return res;
  }

  return {
    id: "groq",
    model: cfg.model,
    attemptTimeoutMs: cfg.attemptTimeoutMs,
    async generate(req): Promise<ModelRawResponse> {
      if (notFree) throw new GroqError("Groq reports higher limits than the free tier, so the key may be on a paid plan. Nothing is sent until the owner confirms.");
      const userText = typeof req.input === "string" ? req.input : JSON.stringify(req.input ?? "");
      const schema = groqStrictSchema(req.jsonSchema);
      const estIn = estimatePromptTokens(`${req.system}${userText}${JSON.stringify(schema)}`);
      const wanted = req.maxOutputTokens ?? FREE_DEFAULT_OUTPUT;
      // Groq counts input plus the requested output against the minute allowance, so the output allowance shrinks to what fits.
      const maxOut = cfg.tier === "free" ? governor.clampOutput(estIn, wanted) : wanted;
      if (maxOut === null) throw new ModelThrottled("too_large", 0, Date.now(), `This request is too large for the free tier (about ${estIn} input tokens against ${governor.requestCeiling} per minute).`);
      if (maxOut < wanted) log.info("model.groq_output_clamped", { task: req.task, wanted, maxOut, estIn });

      const startedAt = clock.now();
      const attemptMs = req.timeoutMs ?? cfg.attemptTimeoutMs;
      const deadline = req.deadlineAt ?? startedAt + attemptMs + MAX_PACE_WAIT_MS;
      // Waiting for the minute window must leave room for one real attempt before the request deadline.
      const reserveOut = expectedOutput(req.task, maxOut);
      const lease = await governor.acquire(estIn + reserveOut, Math.min(MAX_PACE_WAIT_MS, Math.max(0, deadline - clock.now() - 12_000)));

      const body = JSON.stringify({
        model: cfg.model,
        stream: false,
        temperature: DECODING.temperature,
        top_p: DECODING.topP,
        max_completion_tokens: maxOut,
        ...(effort ? { reasoning_effort: effort } : {}),
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: userText },
        ],
        response_format: { type: "json_schema", json_schema: { name: schemaName(req.task), schema, strict: cfg.strict } },
      });

      let queuedMs = clock.now() - startedAt;
      let settled = false;
      const settle = (actual: number | null) => { if (!settled) { settled = true; governor.settle(lease, actual); } };
      try {
        let rateRetries = 0;
        let transientRetried = false;
        for (;;) {
          const left = Math.max(1_000, Math.min(attemptMs, deadline - clock.now()));
          let res: Response;
          try {
            res = await post(body, AbortSignal.timeout(left));
          } catch (error) {
            if (error instanceof GroqError) throw error;
            // A dropped connection or timeout: the request may or may not have run. Retry once if the deadline allows, else fail.
            if (!transientRetried && deadline - clock.now() > 25_000) { transientRetried = true; queuedMs += 1_500; await clock.sleep(1_500); continue; }
            throw new GroqError("Groq could not be reached.", undefined, true);
          }
          if (notFree) { await res.body?.cancel(); throw new GroqError("Groq reports higher limits than the free tier, so the key may be on a paid plan. Nothing is sent until the owner confirms."); }

          if (res.status === 429) {
            // A rate-limited request never ran. Which limit was hit decides everything: a minute limit is waited out inside the
            // deadline, a daily limit ends the request with the exact time the allowance returns. Groq's wording is never kept.
            let text = "";
            try { text = (await readCapped(res, 16_000)).slice(0, 16_000); } catch { await res.body?.cancel(); }
            const hit = parseLimitHit(text, res.headers.get("retry-after"));
            const waitMs = hit.waitMs ?? (hit.kind === "day" ? 3_600_000 : 20_000);
            settle(0);
            if (hit.kind === "day") {
              governor.blockFor(waitMs);
              throw new ModelThrottled("day", waitMs, Date.now() + waitMs, "The free daily allowance is used up.");
            }
            governor.blockFor(waitMs + 250);
            if (rateRetries >= MAX_429_RETRIES || deadline - clock.now() - waitMs - 12_000 < 0) throw new ModelThrottled("minute", waitMs, Date.now() + waitMs, "The free per-minute allowance is busy.");
            rateRetries += 1;
            log.warn("model.groq_rate_limited_waiting", { task: req.task, waitMs, unit: hit.unit });
            queuedMs += waitMs + 250;
            await clock.sleep(waitMs + 250);
            // The retry needs its own room in the window.
            const waitedFrom = clock.now();
            const again = await governor.acquire(estIn + reserveOut, Math.min(MAX_PACE_WAIT_MS, Math.max(0, deadline - clock.now() - 12_000)));
            queuedMs += clock.now() - waitedFrom;
            lease.id = again.id; lease.tokens = again.tokens; settled = false;
            continue;
          }
          if (res.status >= 500 && !transientRetried && deadline - clock.now() > 25_000) {
            await res.body?.cancel();
            transientRetried = true;
            queuedMs += 1_500;
            await clock.sleep(1_500);
            continue;
          }
          return await finish(res);
        }
      } catch (error) {
        // Anything thrown after a request left (a timeout, a server error) may have used tokens: keep the reservation counted.
        settle(error instanceof ModelThrottled || (error instanceof GroqError && (error.neverRan || (typeof error.status === "number" && error.status >= 400 && error.status < 500))) ? 0 : null);
        throw error;
      }

      async function finish(res: Response): Promise<ModelRawResponse> {
        if (!res.ok) {
          // Best-effort mode reports a schema mismatch as HTTP 400. That is "not usable", not a crash, so the caller's one validated retry applies.
          let mismatch = false;
          if (res.status === 400) {
            try { mismatch = SCHEMA_MISMATCH.test((await readCapped(res, 16_000)).slice(0, 16_000)); } catch { mismatch = false; }
          } else {
            await res.body?.cancel();
          }
          settle(0);
          if (mismatch) {
            return { output: null, model: cfg!.model, usage: { inputTokens: estimateInputTokens(`${req.system}${userText}`), outputTokens: 0 }, refused: false };
          }
          throw new GroqError(`Groq answered with status ${res.status}.`, res.status);
        }

        let json: ChatResponse;
        try {
          json = JSON.parse(await readCapped(res, MAX_RESPONSE_BYTES)) as ChatResponse;
        } catch (error) {
          settle(null);
          if (error instanceof Error && error.name === "SelfHostedError") throw new GroqError("Groq's answer was too large.");
          throw new GroqError("Groq's answer could not be read.");
        }
        const choice = json.choices?.[0];
        const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
        const refused = (typeof choice?.message?.refusal === "string" && choice.message.refusal.length > 0) || choice?.finish_reason === "content_filter";

        let inputTokens = Number(json.usage?.prompt_tokens);
        let outputTokens = Number(json.usage?.completion_tokens);
        if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || inputTokens < 0 || outputTokens < 0) {
          log.warn("model.groq_usage_missing", { task: req.task });
          inputTokens = estimateInputTokens(`${req.system}${userText}`);
          outputTokens = Math.ceil(content.length / 2);
        }
        settle(Math.round(inputTokens + outputTokens));
        TYPICAL_OUTPUT.set(req.task, Math.max(200, Math.round(outputTokens)));
        const truncated = choice?.finish_reason === "length";
        if (truncated) log.warn("model.groq_truncated", { task: req.task, outputTokens, maxOut });
        log.info("model.groq_call", { task: req.task, inputTokens, outputTokens, estIn, maxOut, ...governor.usage() });

        return {
          output: refused || truncated ? null : extractJson(content),
          model: typeof json.model === "string" && json.model ? json.model.slice(0, 100) : cfg!.model,
          usage: { inputTokens: Math.round(inputTokens), outputTokens: Math.round(outputTokens) },
          refused,
          queuedMs,
        };
      }
    },
  };
}

export { MIN_OUTPUT_TOKENS };
