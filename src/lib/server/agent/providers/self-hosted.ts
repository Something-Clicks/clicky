import "server-only";

import { log } from "@/lib/log";

import { estimateInputTokens } from "../metering";
import { DEFAULT_MAX_OUTPUT_TOKENS, registerPrice } from "../pricing";
import type { ModelProvider, ModelRawResponse } from "../provider";

/**
 * The self-hosted model adapter (OWN_MODEL_PLAN.md). Something Clicks runs an open-weight model on a server it controls;
 * this file is the only code that knows how to talk to it. The protocol is the widely used chat-completions HTTP shape
 * with a JSON-schema response format, which common open-source model servers (vLLM, llama.cpp, SGLang) expose. It is
 * NOT a hosted AI API: the URL is whatever machine we operate, and moving hosts means changing a variable.
 *
 * Configuration (server-only environment; the adapter is inert unless all three are valid):
 *   SELF_HOSTED_MODEL_URL    https address of our model server (plain http only for localhost, for development)
 *   SELF_HOSTED_MODEL_TOKEN  the server's bearer token (16+ characters); never logged, never sent anywhere else
 *   SELF_HOSTED_MODEL_ID     the model name the server serves
 * Optional:
 *   SELF_HOSTED_ATTEMPT_TIMEOUT_MS  longest one attempt may run (default 75,000; 10,000 to 600,000)
 *   SELF_HOSTED_EXTRA_BODY          JSON object merged into each request (for example a thinking switch the server
 *                                   understands). Cannot override the model, messages, schema, streaming or token limit.
 *   SELF_HOSTED_PRICE_INPUT_PER_MTOK / SELF_HOSTED_PRICE_OUTPUT_PER_MTOK
 *                                   dollars per million tokens, from MEASURED amortized compute cost. With no price the
 *                                   model is "unpriced" and the app's metering refuses every call (fail closed).
 *
 * Safety: no redirects are followed (the token cannot be forwarded elsewhere), the response is size-capped, errors never
 * include the server's text or the token, and if the server omits token counts they are estimated high so spend is never
 * hidden. Provider selection and the Production block live in provider.ts.
 */

const PROTECTED_BODY_KEYS = new Set(["model", "messages", "stream", "response_format", "max_tokens", "max_completion_tokens", "n", "tools", "tool_choice", "functions", "function_call", "stop"]);
const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_ATTEMPT_MS = 75_000;

export interface SelfHostedConfig {
  endpoint: string;
  token: string;
  model: string;
  attemptTimeoutMs: number;
  extraBody: Record<string, unknown>;
  price: { input: number; output: number } | null;
}

/** Error from the model server. `status` is the HTTP status when the server answered; the metering layer settles a 4xx as "never ran". */
export class SelfHostedError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "SelfHostedError";
  }
}

const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

function parseEndpoint(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLocalHost(u.hostname))) return null;
  const root = `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  return root.endsWith("/v1") ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
}

const num = (v: string | undefined) => {
  const n = v === undefined || v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function readSelfHostedConfig(env: Record<string, string | undefined>): SelfHostedConfig | null {
  const endpoint = parseEndpoint(env.SELF_HOSTED_MODEL_URL);
  const token = env.SELF_HOSTED_MODEL_TOKEN?.trim() ?? "";
  const model = env.SELF_HOSTED_MODEL_ID?.trim() ?? "";
  if (!endpoint || token.length < 16 || !/^[A-Za-z0-9._\-/:]{1,100}$/.test(model)) return null;

  let extraBody: Record<string, unknown> = {};
  const rawExtra = env.SELF_HOSTED_EXTRA_BODY?.trim();
  if (rawExtra) {
    try {
      const parsed: unknown = JSON.parse(rawExtra);
      if (rawExtra.length > 2000 || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("shape");
      const keys = Object.keys(parsed as object);
      if (keys.some((k) => PROTECTED_BODY_KEYS.has(k))) throw new Error("protected key");
      extraBody = parsed as Record<string, unknown>;
    } catch {
      log.warn("model.self_hosted_config_invalid", { field: "SELF_HOSTED_EXTRA_BODY" });
      return null; // fail closed: a malformed option must never be silently ignored
    }
  }

  const attempt = num(env.SELF_HOSTED_ATTEMPT_TIMEOUT_MS);
  const input = num(env.SELF_HOSTED_PRICE_INPUT_PER_MTOK);
  const output = num(env.SELF_HOSTED_PRICE_OUTPUT_PER_MTOK);
  return {
    endpoint, token, model, extraBody,
    attemptTimeoutMs: attempt === null ? DEFAULT_ATTEMPT_MS : Math.min(600_000, Math.max(10_000, Math.round(attempt))),
    price: input !== null && output !== null ? { input, output } : null,
  };
}

/** Reads at most `max` bytes of a response body. */
async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new SelfHostedError("The model server's answer was too large.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Pulls the JSON object out of a model's text: tolerates a reasoning block and code fences. Null when it is not JSON. */
export function extractJson(content: string): unknown {
  const text = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const schemaName = (task: string) => task.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) || "answer";

interface ChatResponse {
  model?: unknown;
  choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

export function selfHostedProvider(env: Record<string, string | undefined> = process.env): ModelProvider | null {
  const cfg = readSelfHostedConfig(env);
  if (!cfg) return null;
  // The price comes only from measurement. Without it the model stays unpriced and metering refuses every call.
  if (cfg.price) registerPrice("self-hosted", cfg.model, cfg.price);

  return {
    id: "self-hosted",
    model: cfg.model,
    attemptTimeoutMs: cfg.attemptTimeoutMs,
    async generate(req): Promise<ModelRawResponse> {
      const userText = typeof req.input === "string" ? req.input : JSON.stringify(req.input ?? "");
      const body = {
        ...cfg.extraBody,
        model: cfg.model,
        stream: false,
        temperature: 0.2,
        top_p: 0.95,
        max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: userText },
        ],
        response_format: { type: "json_schema", json_schema: { name: schemaName(req.task), schema: req.jsonSchema, strict: true } },
      };

      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(req.timeoutMs ?? cfg.attemptTimeoutMs),
        cache: "no-store",
        redirect: "error",
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new SelfHostedError(`The model server answered with status ${res.status}.`, res.status);
      }

      let json: ChatResponse;
      try {
        json = JSON.parse(await readCapped(res, MAX_RESPONSE_BYTES)) as ChatResponse;
      } catch (error) {
        if (error instanceof SelfHostedError) throw error;
        throw new SelfHostedError("The model server's answer could not be read.");
      }
      const choice = json.choices?.[0];
      const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
      const refused = (typeof choice?.message?.refusal === "string" && choice.message.refusal.length > 0) || choice?.finish_reason === "content_filter";

      let inputTokens = Number(json.usage?.prompt_tokens);
      let outputTokens = Number(json.usage?.completion_tokens);
      if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || inputTokens < 0 || outputTokens < 0) {
        // Never let a missing count hide spend: estimate high, the same way the reservation does.
        log.warn("model.self_hosted_usage_missing", { task: req.task });
        inputTokens = estimateInputTokens(`${req.system}${userText}`);
        outputTokens = Math.ceil(content.length / 2);
      }
      if (choice?.finish_reason === "length") log.warn("model.self_hosted_truncated", { task: req.task, outputTokens });

      return {
        // A truncated or non-JSON answer is "not usable", handled by the caller's one validated retry.
        output: refused || choice?.finish_reason === "length" ? null : extractJson(content),
        model: typeof json.model === "string" && json.model ? json.model.slice(0, 100) : cfg.model,
        usage: { inputTokens: Math.round(inputTokens), outputTokens: Math.round(outputTokens) },
        refused,
      };
    },
  };
}
