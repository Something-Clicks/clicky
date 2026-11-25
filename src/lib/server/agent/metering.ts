import "server-only";

import { log } from "@/lib/log";

import type { Db } from "../analysis";
import { costMicro, DEFAULT_MAX_OUTPUT_TOKENS } from "./pricing";
import type { ModelProvider } from "./provider";

/**
 * Cost control for every model call the Marketing Agent makes, per business.
 *
 * meteredProvider wraps any provider adapter. Before each call it asks the database to RESERVE the call's
 * worst-case cost (reserve_model_call): the daily, monthly and global caps are checked and the reservation is
 * recorded in one locked step, so parallel requests cannot together exceed a cap. After the call it SETTLES the
 * reservation with the actual tokens and cost (settle_model_call), including refusals and failed calls. A call
 * whose settlement is lost stays counted at its reserved cost. Retries are separate calls and are counted.
 *
 * Both database functions require MODEL_USAGE_KEY, a server-only secret (only its hash is in the database), so a
 * signed-in customer cannot create, change or inflate usage records. Without the key, or without a price for the
 * model, no call is made. Each adapter declares the model it will use.
 */

export class ModelBudgetExceeded extends Error {
  constructor(public readonly reason: string) {
    super(`Model budget reached (${reason}).`);
    this.name = "ModelBudgetExceeded";
  }
}

export interface MeterContext {
  db: Pick<Db, "rpc">;
  orgId: string;
  capability: string;
  workflowId?: string | null;
  agentRunId?: string | null;
}

/** Worst case for one call: all the input we send (3 characters per token, plus overhead) and the full output allowance. */
export function worstCaseCostMicro(provider: string, model: string, req: { system: string; input: unknown; jsonSchema?: unknown; maxOutputTokens?: number }): number | null {
  const cost = costMicro(provider, model, estimateInputTokens(`${req.system}${JSON.stringify(req.input ?? "")}${JSON.stringify(req.jsonSchema ?? "")}`), req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS);
  return cost === null ? null : Math.min(cost, MAX_CALL_COST_MICRO);
}

/**
 * Upper bound for the input tokens of a text: ordinary ASCII text costs about 1 token per 4 characters, but URLs, ids and
 * digits cost more, so ASCII is counted at 1 token per 2 characters; every other UTF-16 unit (accents, CJK, emoji) is
 * counted as 3 tokens, because such text can cost 1-3 tokens per character.
 */
export function estimateInputTokens(text: string): number {
  let ascii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 2) + (text.length - ascii) * 3 + 500;
}

export const MAX_CALL_COST_MICRO = 5_000_000;
const REASONS = new Set(["daily", "monthly", "global_daily"]);

export function meteredProvider(inner: ModelProvider, ctx: MeterContext): ModelProvider {
  return {
    id: inner.id,
    model: inner.model,
    async generate(req) {
      const key = process.env.MODEL_USAGE_KEY?.trim();
      if (!key) {
        log.error("model.usage_key_missing", { orgId: ctx.orgId });
        throw new ModelBudgetExceeded("budget_unavailable");
      }
      const maxCost = inner.model ? worstCaseCostMicro(inner.id, inner.model, req) : null;
      if (!inner.model || maxCost === null) throw new ModelBudgetExceeded("unpriced_model");

      const { data: reservation, error } = await ctx.db.rpc("reserve_model_call", {
        p_key: key, p_org: ctx.orgId, p_capability: ctx.capability, p_provider: inner.id, p_model: inner.model,
        p_max_cost_micro: maxCost, p_workflow: ctx.workflowId ?? null, p_agent_run: ctx.agentRunId ?? null,
      });
      if (error || typeof reservation !== "string") {
        const hint = (error as { hint?: string } | null)?.hint ?? "";
        throw new ModelBudgetExceeded(REASONS.has(hint) ? hint : "budget_unavailable");
      }

      let outcome: "ok" | "refused" | "error" = "error";
      let model = inner.model;
      let usage = { inputTokens: 0, outputTokens: 0 };
      // A call that fails after it was sent (a timeout, a dropped connection, a server error) may still have been
      // billed, and we cannot know how much, so it is settled at the full reservation. Only a request the provider
      // rejected outright (a 4xx answer) is known not to have run, and settles at nothing.
      let rejected = false;
      try {
        const raw = await inner.generate(req);
        model = raw.model;
        usage = raw.usage;
        outcome = raw.refused ? "refused" : "ok";
        return raw;
      } catch (error) {
        const status = (error as { status?: unknown } | null)?.status;
        rejected = typeof status === "number" && status >= 400 && status < 500;
        throw error;
      } finally {
        // A served model name with a date suffix still prices as the declared model. If settling fails, the
        // reservation stays counted (never less than was reserved), so a lost settlement cannot hide spend.
        const actual = costMicro(inner.id, model, usage.inputTokens, usage.outputTokens) ?? costMicro(inner.id, inner.model, usage.inputTokens, usage.outputTokens) ?? maxCost;
        const cost = outcome === "error" && !rejected ? maxCost : actual;
        const { error: settleError } = await ctx.db.rpc("settle_model_call", {
          p_key: key, p_reservation: reservation, p_model: model.slice(0, 100),
          p_input: usage.inputTokens, p_output: usage.outputTokens, p_cost_micro: Math.min(cost, MAX_CALL_COST_MICRO), p_outcome: outcome,
        });
        if (settleError) log.error("model.usage_settle_failed", { orgId: ctx.orgId, error: settleError.message });
      }
    },
  };
}
