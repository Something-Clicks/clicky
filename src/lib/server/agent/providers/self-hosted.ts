import "server-only";

import { createHmac } from "node:crypto";

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
 * Safety: no redirects are followed except Modal's same-origin 303 result URL (the token cannot be forwarded elsewhere), the response is size-capped, errors never
 * include the server's text or the token, and if the server omits token counts they are estimated high so spend is never
 * hidden. Provider selection and the Production block live in provider.ts.
 */

const PROTECTED_BODY_KEYS = new Set(["model", "messages", "stream", "response_format", "max_tokens", "max_completion_tokens", "n", "tools", "tool_choice", "functions", "function_call", "stop"]);
const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_ATTEMPT_MS = 75_000;
/** Fixed decoding for every request, recorded in each evaluation run so results are reproducible and comparable. */
export const DECODING = { temperature: 0.2, topP: 0.95 } as const;

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

/**
 * Modal endpoints (infra/modal/serve_qwen.py) are protected by a key derived from the Modal API secret, so no second secret has to be
 * created or shared: HMAC-SHA256(MODAL_TOKEN_SECRET, "clicky-llm-endpoint-v1"). Used only when SELF_HOSTED_MODEL_TOKEN is not set
 * AND the endpoint is on a Modal host, so the derived key can never be sent anywhere else.
 */
export function modalEndpointToken(secret: string): string {
  return createHmac("sha256", secret).update("clicky-llm-endpoint-v1").digest("hex");
}
const isModalHost = (endpoint: string) => {
  try { const h = new URL(endpoint).hostname; return h.endsWith(".modal.run") || h.endsWith(".modal.direct"); } catch { return false; }
};

export function readSelfHostedConfig(env: Record<string, string | undefined>): SelfHostedConfig | null {
  const endpoint = parseEndpoint(env.SELF_HOSTED_MODEL_URL);
  const explicit = env.SELF_HOSTED_MODEL_TOKEN?.trim() ?? "";
  const modalSecret = env.MODAL_TOKEN_SECRET?.trim();
  const token = explicit || (endpoint && modalSecret && isModalHost(endpoint) ? modalEndpointToken(modalSecret) : "");
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


/**
 * POSTs to the model server. No redirect is ever followed EXCEPT Modal's own "result URL" for a request that outlived its 150-second
 * HTTP window (HTTP 303, same origin, https): the answer is then fetched with GET from that same origin, still under the one attempt
 * timeout. Any other redirect, or a redirect to another origin, is refused so the token can never be forwarded elsewhere.
 */
export async function postFollowingModalResult(cfg: Pick<SelfHostedConfig, "endpoint" | "token">, body: string, signal: AbortSignal): Promise<Response> {
  const headers = { "content-type": "application/json", authorization: `Bearer ${cfg.token}` };
  const origin = new URL(cfg.endpoint).origin;
  let res = await fetch(cfg.endpoint, { method: "POST", headers, body, signal, cache: "no-store", redirect: "manual" });
  for (let hops = 0; res.status >= 300 && res.status < 400; hops++) {
    const location = res.headers.get("location");
    await res.body?.cancel();
    let next: URL | null = null;
    try { next = location ? new URL(location, cfg.endpoint) : null; } catch { next = null; }
    if (res.status !== 303 || !next || next.origin !== origin || hops >= 20) throw new SelfHostedError("The model server tried to redirect the request; refused.", res.status);
    res = await fetch(next, { method: "GET", headers: { authorization: headers.authorization }, signal, cache: "no-store", redirect: "manual" });
  }
  return res;
}

/** Reads at most `max` bytes of a response body. */
export async function readCapped(res: Response, max: number): Promise<string> {
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

export const schemaName = (task: string) => task.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) || "answer";

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
        temperature: DECODING.temperature,
        top_p: DECODING.topP,
        max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: userText },
        ],
        response_format: { type: "json_schema", json_schema: { name: schemaName(req.task), schema: req.jsonSchema, strict: true } },
      };

      const res = await postFollowingModalResult(cfg, JSON.stringify(body), AbortSignal.timeout(req.timeoutMs ?? cfg.attemptTimeoutMs));
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
