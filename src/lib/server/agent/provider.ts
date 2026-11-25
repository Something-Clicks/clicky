import "server-only";

import { z } from "zod";

import { log } from "@/lib/log";

import { anthropicDevProvider } from "./providers/anthropic-dev";

/**
 * Provider-neutral interface for language-model calls made by the marketing agent.
 *
 * STATUS: one temporary development adapter is registered ("anthropic-dev", Claude Sonnet 5.5).
 * It runs only when MARKETING_MODEL_PROVIDER=anthropic-dev and ANTHROPIC_API_KEY are set, and never
 * in Production. Otherwise `getModelProvider()` returns null and model-dependent capabilities report
 * themselves as blocked. There is no mock model. Replacing the provider means one new adapter file
 * and one entry in `PROVIDERS`.
 *
 * (The older Anthropic-specific code in ../ai.ts and ../drafts.ts stays dormant and unconfigured;
 * it is ported onto this interface once a provider is chosen.)
 *
 * Rules every adapter must keep:
 * - Server-side only; keys come from server environment variables, never NEXT_PUBLIC_.
 * - Structured output only: the caller passes a schema, and the result is validated here before
 *   anything is stored or shown.
 * - Website text, uploads and other retrieved content go in `input` as data, never in `system`.
 */

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelRequest<T> {
  /** Short name of the task, for logs and usage records (e.g. "content_creation.homepage_headline"). */
  task: string;
  /** Fixed instructions owned by Something Clicks. */
  system: string;
  /** Business context, evidence and owner notes. Treated as data by the model. */
  input: unknown;
  /** The shape the answer must have. */
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}

export interface ModelRawResponse {
  /** The parsed JSON the model returned (validated by the caller-supplied schema here, not by the adapter). */
  output: unknown;
  model: string;
  usage: ModelUsage;
  /** True when the provider declined to answer. */
  refused?: boolean;
}

export interface ModelProvider {
  readonly id: string;
  /** The model this adapter calls (used to price calls before they are made). */
  readonly model?: string;
  generate(request: Omit<ModelRequest<unknown>, "schema"> & { jsonSchema: unknown }): Promise<ModelRawResponse>;
}

export interface ModelResult<T> {
  output: T;
  provider: string;
  model: string;
  usage: ModelUsage;
}

export class ModelProviderNotConfigured extends Error {
  constructor() {
    super("No model provider is configured. The provider decision is pending.");
    this.name = "ModelProviderNotConfigured";
  }
}

export class ModelOutputInvalid extends Error {
  constructor(public readonly reason: string) {
    super(`The model's answer could not be used: ${reason}`);
    this.name = "ModelOutputInvalid";
  }
}

/**
 * Registered adapters. One temporary development adapter (see providers/anthropic-dev.ts); the
 * product's provider for customers is an owner decision and is not registered here.
 */
const PROVIDERS: Record<string, (env: Record<string, string | undefined>) => ModelProvider | null> = {
  "anthropic-dev": (env) => anthropicDevProvider(env),
};

export const registeredProviders = () => Object.keys(PROVIDERS);

/**
 * The configured provider, or null. Never falls back to a default or a stand-in.
 * Requires MARKETING_MODEL_PROVIDER to name a registered adapter, and that adapter's key.
 * Always null in Production (VERCEL_ENV=production): enabling a model for customers is an owner
 * decision and a code change, never just an environment variable.
 */
export function getModelProvider(env: Record<string, string | undefined> = process.env): ModelProvider | null {
  const id = env.MARKETING_MODEL_PROVIDER?.trim();
  if (!id) return null;
  if (env.VERCEL_ENV === "production") {
    log.warn("model.provider_refused_in_production", { provider: id });
    return null;
  }
  const make = PROVIDERS[id];
  if (!make) {
    log.warn("model.provider_unknown", { provider: id });
    return null;
  }
  return make(env);
}

/**
 * One structured model call with validation. The caller always passes the provider (wrapped by meteredProvider for
 * anything that runs for a business): there is deliberately no default, so no call can skip cost metering.
 * and one controlled retry for invalid output.
 * Throws ModelProviderNotConfigured when there is no provider, ModelOutputInvalid when the
 * answer still does not match the schema, and rethrows transport errors.
 */
export async function generateStructured<T>(request: ModelRequest<T>, provider: ModelProvider | null): Promise<ModelResult<T>> {
  if (!provider) throw new ModelProviderNotConfigured();
  const { schema, ...rest } = request;
  // The adapter passes this to the provider's structured-output feature; validation still happens here.
  const jsonSchema = z.toJSONSchema(schema);
  let lastReason = "unknown";
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await provider.generate({ ...rest, jsonSchema });
    usage.inputTokens += raw.usage.inputTokens;
    usage.outputTokens += raw.usage.outputTokens;
    if (raw.refused) throw new ModelOutputInvalid("refused");
    const parsed = schema.safeParse(raw.output);
    if (parsed.success) {
      log.info("model.call_ok", { task: request.task, provider: provider.id, model: raw.model, attempt, ...usage });
      return { output: parsed.data, provider: provider.id, model: raw.model, usage };
    }
    lastReason = "schema_mismatch";
    log.warn("model.invalid_output", { task: request.task, provider: provider.id, attempt });
  }
  throw new ModelOutputInvalid(lastReason);
}
