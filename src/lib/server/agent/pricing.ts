/**
 * Per-token prices for the models the Marketing Agent may call, used to compute the cost of every call
 * (model_usage.cost_micro). A model without a price here is never called: the agent refuses rather than spend an
 * unknown amount. There are no entries: Something Clicks uses no hosted provider. For a self-hosted model the price
 * is its amortized GPU cost per million tokens at MEASURED utilization (OWN_MODEL_PLAN.md, section 4.4); it is added
 * with the adapter, from a measurement, never guessed.
 *
 * Prices in US dollars per 1M tokens.
 */
const PRICES: Record<string, { input: number; output: number }> = {};

/** An adapter (or a test) declares the measured price of the model it serves. */
export function registerPrice(provider: string, model: string, price: { input: number; output: number }): void {
  PRICES[`${provider}/${model}`] = price;
}

/** Cost in millionths of a dollar, or null if the model has no known price. */
export function costMicro(provider: string, model: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICES[`${provider}/${model}`] ?? PRICES[`${provider}/${model.replace(/-\d{8}$/, "")}`];
  if (!p) return null;
  return Math.ceil(inputTokens * p.input + outputTokens * p.output);
}

export const hasPrice = (provider: string, model: string) => costMicro(provider, model, 0, 0) !== null;

export const formatMicro = (micro: number) => `$${(micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2)}`;

/** Output allowance used when a request names none (adapters and metering must agree, so it lives here, free of imports). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 16000;
