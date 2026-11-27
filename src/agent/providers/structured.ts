import { z } from 'zod';
import { ProviderError, StructuredOutputError } from '../core/errors';
import { sleep } from '../core/util';
import { SYSTEM_RULES } from '../security/untrusted';
import type { LLMProvider, UntrustedBlock } from './types';
import { addUsage, UsageMeter, zeroUsage, type Usage } from './usage';

export interface GenerateOptions<T> {
  task: string;
  instructions: string;
  input: unknown;
  untrusted?: UntrustedBlock[];
  schema: z.ZodType<T>;
  /** Semantic validation beyond shape. Return an error string to force a controlled retry. */
  validate?: (v: T) => string | null;
  /** Run-level usage accumulator so budgets apply across a whole workflow. */
  usage?: { current: Usage };
  temperature?: number;
  maxOutputTokens?: number;
}
export interface GenerateResult<T> { data: T; model: string; provider: string; mock: boolean; attempts: number; usage: Usage }

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error('Response is not valid JSON');
}

/** Every model output is parsed, schema-validated, semantically validated, and retried with the error
 *  fed back, or fails with a clear error. Nothing unvalidated is stored or shown (spec §15.3). */
export class StructuredClient {
  constructor(
    readonly provider: LLMProvider,
    private readonly opts: { meter?: UsageMeter; maxAttempts?: number; backoffMs?: number } = {},
  ) {}

  async generate<T>(o: GenerateOptions<T>): Promise<GenerateResult<T>> {
    const maxAttempts = this.opts.maxAttempts ?? 3;
    const meter = this.opts.meter ?? new UsageMeter();
    const jsonSchema = z.toJSONSchema(o.schema);
    let priorError: string | undefined;
    let total = zeroUsage();
    let lastRaw: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (o.usage) meter.assertWithin(o.usage.current);
      let res;
      try {
        res = await this.provider.complete({
          task: o.task, system: SYSTEM_RULES, instructions: o.instructions, input: o.input,
          untrusted: o.untrusted, jsonSchema, priorError,
          temperature: o.temperature ?? 0.2, maxOutputTokens: o.maxOutputTokens ?? 4000,
        });
      } catch (err) {
        const retryable = err instanceof ProviderError ? err.retryable : false;
        if (retryable && attempt < maxAttempts) { await sleep((this.opts.backoffMs ?? 0) * attempt); continue; }
        throw err;
      }
      const u: Usage = {
        inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, calls: 1,
        costUsd: meter.cost(res.model, res.usage.inputTokens, res.usage.outputTokens),
      };
      total = addUsage(total, u);
      if (o.usage) o.usage.current = addUsage(o.usage.current, u);
      lastRaw = res.text;
      try {
        const parsed = o.schema.safeParse(extractJson(res.text));
        if (!parsed.success) {
          priorError = 'Schema errors: ' + parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
          continue;
        }
        const semantic = o.validate?.(parsed.data);
        if (semantic) { priorError = semantic; continue; }
        return { data: parsed.data, model: res.model, provider: this.provider.name, mock: this.provider.isMock, attempts: attempt, usage: total };
      } catch (e) {
        priorError = (e as Error).message;
      }
    }
    throw new StructuredOutputError(`Model output for "${o.task}" failed validation after ${maxAttempts} attempts: ${priorError}`, maxAttempts, lastRaw);
  }
}
