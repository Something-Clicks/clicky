import "server-only";

import { log } from "@/lib/log";

import { estimateInputTokens } from "../metering";
import { DEFAULT_MAX_OUTPUT_TOKENS, registerPrice } from "../pricing";
import type { ModelProvider, ModelRawResponse } from "../provider";
import { groqStrictSchema } from "./groq-schema";
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
 * Cost accounting (the free tier costs nothing, but the app's caps are in dollars, so they need a price):
 *   GROQ_PRICE_INPUT_PER_MTOK / GROQ_PRICE_OUTPUT_PER_MTOK
 *                                  Groq's PUBLISHED paid per-million-token rates for that model (groq.com/pricing). Used as a
 *                                  "shadow price" so every existing cap bounds usage as if it were billed. Without both, the
 *                                  model is unpriced and metering refuses every call (fail closed).
 * Optional:
 *   GROQ_STRICT                    "0" switches to best-effort schema mode for a model without strict support (default strict)
 *   GROQ_REASONING_EFFORT          low | medium | high, sent only when set (reasoning models)
 *   GROQ_ATTEMPT_TIMEOUT_MS        longest one attempt may run (default 60,000; 10,000 to 300,000)
 *
 * Free-tier limits are per model and per organization (requests and tokens per minute and per day). A 429 with a short Retry-After is
 * waited out once inside the request deadline; anything else is a plain failure that metering settles as "never ran".
 */

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_ATTEMPT_MS = 60_000;
const MAX_RETRY_AFTER_S = 15;
const SCHEMA_MISMATCH = /does not match the expected schema/i;

export interface GroqConfig {
  key: string;
  model: string;
  strict: boolean;
  reasoningEffort: "low" | "medium" | "high" | null;
  attemptTimeoutMs: number;
  price: { input: number; output: number } | null;
}

/** Error from Groq. `status` is the HTTP status when it answered; metering settles a 4xx as "never ran". Never carries Groq's text. */
export class GroqError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "GroqError";
  }
}

const num = (v: string | undefined) => {
  const n = v === undefined || v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

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
  const input = num(env.GROQ_PRICE_INPUT_PER_MTOK);
  const output = num(env.GROQ_PRICE_OUTPUT_PER_MTOK);
  return {
    key, model,
    strict: env.GROQ_STRICT?.trim() !== "0",
    reasoningEffort: (effort as GroqConfig["reasoningEffort"]) || null,
    attemptTimeoutMs: attempt === null ? DEFAULT_ATTEMPT_MS : Math.min(300_000, Math.max(10_000, Math.round(attempt))),
    price: input !== null && output !== null ? { input, output } : null,
  };
}

interface ChatResponse {
  model?: unknown;
  choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `baseUrl` exists only so tests can aim the adapter at a local stand-in; no environment variable reaches it. */
export function groqProvider(env: Record<string, string | undefined> = process.env, options: { baseUrl?: string } = {}): ModelProvider | null {
  const cfg = readGroqConfig(env);
  if (!cfg) return null;
  const endpoint = options.baseUrl ?? GROQ_ENDPOINT;
  // The shadow price comes only from the owner's published-rate variables. Without it the model stays unpriced and metering refuses.
  if (cfg.price) registerPrice("groq", cfg.model, cfg.price);

  async function post(body: string, signal: AbortSignal): Promise<Response> {
    const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${cfg!.key}` }, body, signal, cache: "no-store", redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      throw new GroqError("Groq tried to redirect the request; refused.", res.status);
    }
    return res;
  }

  return {
    id: "groq",
    model: cfg.model,
    attemptTimeoutMs: cfg.attemptTimeoutMs,
    async generate(req): Promise<ModelRawResponse> {
      const userText = typeof req.input === "string" ? req.input : JSON.stringify(req.input ?? "");
      const body = JSON.stringify({
        model: cfg.model,
        stream: false,
        temperature: DECODING.temperature,
        top_p: DECODING.topP,
        max_completion_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: userText },
        ],
        response_format: { type: "json_schema", json_schema: { name: schemaName(req.task), schema: groqStrictSchema(req.jsonSchema), strict: cfg.strict } },
      });

      const startedAt = Date.now();
      const budget = req.timeoutMs ?? cfg.attemptTimeoutMs;
      let res = await post(body, AbortSignal.timeout(budget));
      if (res.status === 429) {
        // A rate-limited request never ran. Wait once if Groq says the wait is short and the deadline still allows a full attempt.
        const header = res.headers.get("retry-after");
        const wait = header === null || header.trim() === "" ? NaN : Number(header);
        await res.body?.cancel();
        const waitMs = Number.isFinite(wait) && wait >= 0 && wait <= MAX_RETRY_AFTER_S ? Math.ceil(wait * 1000) + 250 : null;
        if (waitMs === null || budget - (Date.now() - startedAt) - waitMs < 12_000) throw new GroqError("Groq's rate limit was reached.", 429);
        log.warn("model.groq_rate_limited_waiting", { task: req.task, waitMs });
        await sleep(waitMs);
        res = await post(body, AbortSignal.timeout(Math.max(1_000, budget - (Date.now() - startedAt))));
      }
      if (!res.ok) {
        // Best-effort mode reports a schema mismatch as HTTP 400. That is "not usable", not a crash, so the caller's one validated retry applies.
        let mismatch = false;
        if (res.status === 400) {
          try { mismatch = SCHEMA_MISMATCH.test((await readCapped(res, 16_000)).slice(0, 16_000)); } catch { mismatch = false; }
        } else {
          await res.body?.cancel();
        }
        if (mismatch) {
          return { output: null, model: cfg.model, usage: { inputTokens: estimateInputTokens(`${req.system}${userText}`), outputTokens: 0 }, refused: false };
        }
        throw new GroqError(`Groq answered with status ${res.status}.`, res.status);
      }

      let json: ChatResponse;
      try {
        json = JSON.parse(await readCapped(res, MAX_RESPONSE_BYTES)) as ChatResponse;
      } catch (error) {
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
      if (choice?.finish_reason === "length") log.warn("model.groq_truncated", { task: req.task, outputTokens });

      return {
        output: refused || choice?.finish_reason === "length" ? null : extractJson(content),
        model: typeof json.model === "string" && json.model ? json.model.slice(0, 100) : cfg.model,
        usage: { inputTokens: Math.round(inputTokens), outputTokens: Math.round(outputTokens) },
        refused,
      };
    },
  };
}
