import "server-only";

import { log } from "@/lib/log";

import type { Db } from "../analysis";
import { costMicro } from "./pricing";
import type { ModelProvider } from "./provider";

/**
 * Cost control for every model call the Marketing Agent makes, per business.
 *
 * meteredProvider wraps any provider adapter. Before each call it asks the database whether the business is
 * within its daily and monthly caps and the global daily cap (model_budget). After each call it records
 * tokens and cost (record_model_usage), including refusals and failed calls. Retries are separate calls and
 * are counted. Each adapter declares the model it will use; a model without a published price is refused
 * before any call is made.
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

interface Budget {
  allowed: boolean;
  reason: string | null;
}

export function meteredProvider(inner: ModelProvider, ctx: MeterContext): ModelProvider {
  return {
    id: inner.id,
    model: inner.model,
    async generate(req) {
      if (!inner.model || costMicro(inner.id, inner.model, 0, 0) === null) throw new ModelBudgetExceeded("unpriced_model");
      const { data, error } = await ctx.db.rpc("model_budget", { p_org: ctx.orgId });
      if (error) throw new ModelBudgetExceeded("budget_unavailable");
      const budget = data as unknown as Budget;
      if (!budget?.allowed) throw new ModelBudgetExceeded(budget?.reason ?? "unknown");

      let outcome: "ok" | "refused" | "error" = "error";
      let model = inner.model;
      let usage = { inputTokens: 0, outputTokens: 0 };
      try {
        const raw = await inner.generate(req);
        model = raw.model;
        usage = raw.usage;
        outcome = raw.refused ? "refused" : "ok";
        return raw;
      } finally {
        // A served model name with a date suffix still prices as the declared model.
        const cost = costMicro(inner.id, model, usage.inputTokens, usage.outputTokens) ?? costMicro(inner.id, inner.model, usage.inputTokens, usage.outputTokens) ?? 0;
        const { error: recError } = await ctx.db.rpc("record_model_usage", {
          p_org: ctx.orgId, p_capability: ctx.capability, p_provider: inner.id, p_model: model.slice(0, 100),
          p_input: usage.inputTokens, p_output: usage.outputTokens, p_cost_micro: Math.min(cost, 5_000_000),
          p_outcome: outcome, p_workflow: ctx.workflowId ?? null, p_agent_run: ctx.agentRunId ?? null,
        });
        if (recError) log.error("model.usage_record_failed", { orgId: ctx.orgId, error: recError.message });
      }
    },
  };
}
