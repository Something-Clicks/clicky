import "server-only";

import { z } from "zod";

import { log } from "@/lib/log";

import { selfHostedProvider } from "./providers/self-hosted";

/**
 * Provider-neutral interface for language-model calls made by the marketing agent.
 *
 * STATUS: one adapter is registered, "self-hosted" (providers/self-hosted.ts): it speaks the common chat-completions
 * HTTP protocol to an open-weight model server that Something Clicks runs itself. It is inert unless the server's URL, token
 * and model id are configured, it never runs in Production, and an unpriced model is never called, so with nothing
 * configured `getModelProvider()` returns null and every capability that needs a model reports "blocked" (never
 * placeholder output). No external hosted AI provider is used (owner decision, Nov 25 2026; docs/agents/OWN_MODEL_PLAN.md).
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
  /** When the whole request must be finished (epoch ms). No attempt starts, and none is allowed to run, past it. */
  deadlineAt?: number;
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
  /** Longest one attempt may run. Slower self-hosted models declare more than the default; the request deadline still wins. */
  readonly attemptTimeoutMs?: number;
  generate(request: Omit<ModelRequest<unknown>, "schema" | "deadlineAt"> & { jsonSchema: unknown; timeoutMs?: number }): Promise<ModelRawResponse>;
}

export interface ModelResult<T> {
  output: T;
  provider: string;
  model: string;
  usage: ModelUsage;
}

/** The longest one attempt may take, and the least time worth starting one with. */
export const ATTEMPT_TIMEOUT_MS = 75_000;
export const MIN_ATTEMPT_MS = 12_000;

export class ModelProviderNotConfigured extends Error {
  constructor() {
    super("No language model is available yet. Something Clicks uses no external AI provider; its own model hosting is not built yet.");
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
 * Registered adapters: the self-hosted one only. Tests use stand-ins to prove the checking rules; a stand-in is never
 * evidence of model capability.
 */
const PROVIDERS: Record<string, (env: Record<string, string | undefined>) => ModelProvider | null> = {
  "self-hosted": (env) => selfHostedProvider(env),
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
  const { schema, deadlineAt, ...rest } = request;
  // The adapter passes this to the provider's structured-output feature; validation still happens here.
  const jsonSchema = z.toJSONSchema(schema);
  let lastReason = "unknown";
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
  const started = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    // A retry only fits if the first answer came back quickly, and no attempt may run past the request's deadline.
    if (attempt === 2 && Date.now() - started > (provider.attemptTimeoutMs ? provider.attemptTimeoutMs / 2 : 40_000)) throw new ModelOutputInvalid("too_slow_to_retry");
    const attemptCap = provider.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
    const remaining = deadlineAt === undefined ? attemptCap : deadlineAt - Date.now();
    if (remaining < MIN_ATTEMPT_MS) throw new ModelOutputInvalid("out_of_time");
    const raw = await provider.generate({ ...rest, jsonSchema, timeoutMs: Math.min(attemptCap, remaining) });
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
