import { ProviderError } from '../core/errors';
import type { LLMProvider, ProviderRequest, ProviderResponse } from './types';

/**
 * Primary (hosted GPU) with a fallback (local model). Only INFRASTRUCTURE failures fall back: unreachable host, timeout, 429/5xx, cold-start 503.
 * A rejected request (4xx) or a model that answered badly is never retried elsewhere here (the StructuredClient handles bad output),
 * and the provider that actually answered is reported in `model` so results are never attributed to the wrong model.
 * After a failure the primary is skipped for `coolDownMs` so a down GPU endpoint does not add its timeout to every call.
 */
export class FailoverProvider implements LLMProvider {
  readonly isMock = false;
  private downUntil = 0;
  constructor(private readonly primary: LLMProvider, private readonly fallback: LLMProvider, private readonly opts: { coolDownMs?: number; now?: () => number; onFallback?: (why: string) => void } = {}) {}
  get name() { return `${this.primary.name}|fallback:${this.fallback.name}`; }
  private now() { return (this.opts.now ?? Date.now)(); }
  async complete(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    if (this.now() >= this.downUntil) {
      try { return await this.primary.complete(req, signal); }
      catch (e) {
        if (signal?.aborted) throw e;
        if (!(e instanceof ProviderError) || !e.retryable) throw e;
        this.downUntil = this.now() + (this.opts.coolDownMs ?? 60_000);
        this.opts.onFallback?.(`${this.primary.name} failed (${e.message}); using ${this.fallback.name}`);
      }
    }
    return this.fallback.complete(req, signal);
  }
}
