/**
 * Evaluation-only adapters for the three candidate providers. Each implements the app's
 * provider-neutral ModelProvider interface (src/lib/server/agent/provider.ts), so the evaluation
 * exercises the same interface, validation and single retry the app would use.
 *
 * These are NOT registered in the app (PROVIDERS stays empty) and activate nothing. Each uses the
 * provider's native JSON-schema structured output with the same schema. Keys come from environment
 * variables only. There is no fallback model and no stand-in: any error is recorded as a failure.
 *
 * Anthropic uses the official SDK already in the project. OpenAI and Gemini use their documented REST
 * endpoints through fetch (their SDKs are not dependencies); if an endpoint shape has changed, the
 * first run reports the error and the adapter is corrected before results are trusted.
 */
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

import type { ModelProvider, ModelRawResponse } from "@/lib/server/agent/provider";

export type ProviderId = "openai" | "anthropic" | "gemini";

export interface ProviderConfig {
  id: ProviderId;
  model: string;
  apiKey: string;
  /** Optional reasoning setting passed through unchanged (e.g. "medium"); unset = provider default. */
  effort: string | null;
  /** US dollars per million tokens, supplied by the person running the evaluation. */
  inputPerMTok: number;
  outputPerMTok: number;
}

type Request = Parameters<ModelProvider["generate"]>[0];

class ProviderError extends Error {
  constructor(provider: string, public readonly status: number | null, detail: string) {
    super(`${provider} ${status ?? "network"}: ${detail.slice(0, 300)}`);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { __unparseable: text.slice(0, 500) };
  }
}

function anthropicAdapter(cfg: ProviderConfig): ModelProvider {
  const client = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 0, timeout: 180_000 });
  return {
    id: "anthropic",
    async generate(req: Request): Promise<ModelRawResponse> {
      const format = jsonSchemaOutputFormat(req.jsonSchema as { type: "object" } & Record<string, unknown>);
      const response = await client.messages.create({
        model: cfg.model,
        max_tokens: req.maxOutputTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user", content: String(req.input) }],
        output_config: { format: { type: "json_schema", schema: format.schema }, ...(cfg.effort ? { effort: cfg.effort as "medium" } : {}) },
      });
      const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
      if (response.stop_reason === "refusal") return { output: null, model: response.model, usage, refused: true };
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { output: parseJson(text), model: response.model, usage };
    },
  };
}

function openaiAdapter(cfg: ProviderConfig): ModelProvider {
  return {
    id: "openai",
    async generate(req: Request): Promise<ModelRawResponse> {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          instructions: req.system,
          input: String(req.input),
          max_output_tokens: req.maxOutputTokens ?? 16000,
          text: { format: { type: "json_schema", name: req.task.replace(/[^a-zA-Z0-9_-]/g, "_"), schema: req.jsonSchema, strict: true } },
          ...(cfg.effort ? { reasoning: { effort: cfg.effort } } : {}),
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new ProviderError("openai", res.status, JSON.stringify(body.error ?? body));
      const output = (body.output ?? []) as { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
      const parts = output.flatMap((o) => (o.type === "message" ? (o.content ?? []) : []));
      const usageRaw = (body.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
      const usage = { inputTokens: usageRaw.input_tokens ?? 0, outputTokens: usageRaw.output_tokens ?? 0 };
      if (parts.some((p) => p.type === "refusal")) return { output: null, model: String(body.model ?? cfg.model), usage, refused: true };
      const text = parts.filter((p) => p.type === "output_text").map((p) => p.text ?? "").join("");
      return { output: parseJson(text), model: String(body.model ?? cfg.model), usage };
    },
  };
}

function geminiAdapter(cfg: ProviderConfig): ModelProvider {
  return {
    id: "gemini",
    async generate(req: Request): Promise<ModelRawResponse> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: String(req.input) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: req.jsonSchema,
            maxOutputTokens: req.maxOutputTokens ?? 16000,
            ...(cfg.effort ? { thinkingConfig: { thinkingLevel: cfg.effort } } : {}),
          },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new ProviderError("gemini", res.status, JSON.stringify(body.error ?? body));
      const cand = ((body.candidates ?? []) as { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[])[0];
      const meta = (body.usageMetadata ?? {}) as { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      // Thinking tokens are billed as output, so they count toward output here too.
      const usage = { inputTokens: meta.promptTokenCount ?? 0, outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0) };
      const model = String(body.modelVersion ?? cfg.model);
      if (!cand || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"].includes(cand.finishReason ?? "")) return { output: null, model, usage, refused: true };
      const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      return { output: parseJson(text), model, usage };
    },
  };
}

export function makeAdapter(cfg: ProviderConfig): ModelProvider {
  return cfg.id === "anthropic" ? anthropicAdapter(cfg) : cfg.id === "openai" ? openaiAdapter(cfg) : geminiAdapter(cfg);
}
