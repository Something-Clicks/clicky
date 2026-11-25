import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

import type { ModelProvider, ModelRawResponse } from "../provider";

/**
 * TEMPORARY DEVELOPMENT PROVIDER (engineering decision, Nov 25 2026): Anthropic Claude Sonnet 5.5.
 * Development and Preview only (provider.ts refuses every provider in Production). Replaceable: this
 * file is the only Anthropic-specific code the Marketing Agent uses; capabilities see only the
 * provider-neutral interface.
 *
 * Request shape (official SDK): messages.create with output_config.format = JSON schema (the SDK's
 * jsonSchemaOutputFormat transform drops keywords the API does not support). Validation against the
 * capability's own schema, and the single retry, happen in provider.ts, not here.
 */
export const DEV_MODEL = "claude-sonnet-5-5";

export function anthropicDevProvider(env: Record<string, string | undefined> = process.env): ModelProvider | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
  const effort = env.MARKETING_MODEL_EFFORT?.trim() as "low" | "medium" | "high" | undefined;
  return {
    id: "anthropic-dev",
    async generate(req): Promise<ModelRawResponse> {
      const format = jsonSchemaOutputFormat(req.jsonSchema as { type: "object" } & Record<string, unknown>);
      const response = await client.messages.create({
        model: DEV_MODEL,
        max_tokens: req.maxOutputTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user", content: typeof req.input === "string" ? req.input : JSON.stringify(req.input) }],
        output_config: { format: { type: "json_schema", schema: format.schema }, ...(effort ? { effort } : {}) },
      });
      const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
      if (response.stop_reason === "refusal") return { output: null, model: response.model, usage, refused: true };
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      let output: unknown = null;
      try {
        output = JSON.parse(text);
      } catch {
        output = { __unparseable: text.slice(0, 300), stop_reason: response.stop_reason };
      }
      return { output, model: response.model, usage };
    },
  };
}
