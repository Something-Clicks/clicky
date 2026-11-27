import { RateLimitError } from '../core/errors';

/** In-memory token bucket (per process). Swap for a shared store when running multiple instances. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly capacity: number, private readonly perMinute: number, private readonly clock: () => number = Date.now) {}
  take(key: string, cost = 1): void {
    const t = this.clock();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.at) / 60_000) * this.perMinute);
    b.at = t;
    if (b.tokens < cost) { this.buckets.set(key, b); throw new RateLimitError(); }
    b.tokens -= cost;
    this.buckets.set(key, b);
  }
}
