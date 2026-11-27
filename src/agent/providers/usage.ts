import { BudgetExceededError } from '../core/errors';

export interface Usage { inputTokens: number; outputTokens: number; costUsd: number; calls: number }
export const zeroUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 });
export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens,
  costUsd: a.costUsd + b.costUsd, calls: a.calls + b.calls,
});

/** USD per million tokens. Configurable per model; unknown models cost 0 (mock/self-hosted). */
export interface PriceTable { [model: string]: { inPerM: number; outPerM: number } }

export class UsageMeter {
  constructor(
    private readonly prices: PriceTable = {},
    private readonly limits: { maxCostUsdPerRun?: number; maxTokensPerRun?: number } = {},
  ) {}
  cost(model: string, i: number, o: number): number {
    const p = this.prices[model];
    return p ? (i * p.inPerM + o * p.outPerM) / 1_000_000 : 0;
  }
  assertWithin(current: Usage): void {
    const { maxCostUsdPerRun, maxTokensPerRun } = this.limits;
    if (maxCostUsdPerRun !== undefined && current.costUsd >= maxCostUsdPerRun)
      throw new BudgetExceededError(`Run cost limit reached ($${maxCostUsdPerRun})`);
    if (maxTokensPerRun !== undefined && current.inputTokens + current.outputTokens >= maxTokensPerRun)
      throw new BudgetExceededError(`Run token limit reached (${maxTokensPerRun})`);
  }
}
