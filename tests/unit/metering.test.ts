/**
 * Cost metering (src/lib/server/agent/metering.ts): reserve before every model call, settle after, fail closed.
 * SIMULATED: the database is a recording stub and the provider is a test double (priced as the dev adapter so the
 * price lookup applies). The database side (caps, locking, key check) is tested in tests/db/model-reservation.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { meteredProvider, ModelBudgetExceeded, worstCaseCostMicro } from "@/lib/server/agent/metering";
import { costMicro } from "@/lib/server/agent/pricing";
import type { ModelProvider } from "@/lib/server/agent/provider";

const KEY = "k".repeat(40);
const req = { task: "t", system: "You are a test.", input: { a: "hello" }, jsonSchema: { type: "object" }, maxOutputTokens: 1000 };
const inner = (generate: ModelProvider["generate"]): ModelProvider => ({ id: "anthropic-dev", model: "claude-sonnet-5-5", generate });
const rpcStub = (overrides: Record<string, unknown> = {}) =>
  vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    if (name in overrides) return overrides[name] as { data: unknown; error: unknown };
    return { data: name === "reserve_model_call" ? "res-1" : null, error: null };
  });

beforeEach(() => { process.env.MODEL_USAGE_KEY = KEY; });
afterEach(() => { delete process.env.MODEL_USAGE_KEY; });

describe("meteredProvider", () => {
  it("reserves the worst case before the call and settles the actual tokens and cost after it", async () => {
    const rpc = rpcStub();
    const generate = vi.fn(async () => ({ output: { ok: 1 }, model: "claude-sonnet-5-5-20261101", usage: { inputTokens: 1000, outputTokens: 200 } }));
    await meteredProvider(inner(generate), { db: { rpc } as never, orgId: "o1", capability: "x.y.z", workflowId: "wf" }).generate(req);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["reserve_model_call", "settle_model_call"]);
    const reserve = rpc.mock.calls[0]![1]!;
    expect(reserve).toMatchObject({ p_key: KEY, p_org: "o1", p_capability: "x.y.z", p_provider: "anthropic-dev", p_workflow: "wf", p_agent_run: null });
    expect(reserve.p_max_cost_micro).toBe(worstCaseCostMicro("anthropic-dev", "claude-sonnet-5-5", req));
    expect(rpc.mock.calls[1]![1]).toMatchObject({
      p_reservation: "res-1", p_model: "claude-sonnet-5-5-20261101", p_input: 1000, p_output: 200, p_outcome: "ok",
      p_cost_micro: costMicro("anthropic-dev", "claude-sonnet-5-5", 1000, 200),
    });
    expect(reserve.p_max_cost_micro as number).toBeGreaterThan(costMicro("anthropic-dev", "claude-sonnet-5-5", 1000, 200)!);
  });

  it("the reservation covers the full output allowance, so a call can never cost more than was reserved", () => {
    const big = { ...req, input: "x".repeat(30_000), maxOutputTokens: 8000 };
    const worst = worstCaseCostMicro("anthropic-dev", "claude-sonnet-5-5", big)!;
    expect(worst).toBeGreaterThanOrEqual(costMicro("anthropic-dev", "claude-sonnet-5-5", 10_000, 8000)!);
    expect(worstCaseCostMicro("anthropic-dev", "claude-sonnet-5-5", { ...req, maxOutputTokens: undefined })).toBeGreaterThan(160_000); // 16,000 default tokens at $10/M
  });

  it("does not call the model when the budget refuses, and says which cap", async () => {
    const generate = vi.fn();
    for (const hint of ["daily", "monthly", "global_daily"]) {
      const rpc = rpcStub({ reserve_model_call: { data: null, error: { message: "Model budget reached", hint } } });
      await expect(meteredProvider(inner(generate), { db: { rpc } as never, orgId: "o1", capability: "x.y.z" }).generate(req)).rejects.toMatchObject({ name: "ModelBudgetExceeded", reason: hint });
      expect(rpc.mock.calls.map((c) => c[0])).toEqual(["reserve_model_call"]);
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it("fails closed when the budget cannot be checked, the key is missing, or the model has no price", async () => {
    const generate = vi.fn();
    const broken = rpcStub({ reserve_model_call: { data: null, error: { message: "boom" } } });
    await expect(meteredProvider(inner(generate), { db: { rpc: broken } as never, orgId: "o", capability: "x.y.z" }).generate(req)).rejects.toMatchObject({ reason: "budget_unavailable" });
    delete process.env.MODEL_USAGE_KEY;
    const rpc = rpcStub();
    await expect(meteredProvider(inner(generate), { db: { rpc } as never, orgId: "o", capability: "x.y.z" }).generate(req)).rejects.toMatchObject({ reason: "budget_unavailable" });
    expect(rpc).not.toHaveBeenCalled();
    process.env.MODEL_USAGE_KEY = KEY;
    const unpriced: ModelProvider = { id: "other", model: "some-model", generate };
    await expect(meteredProvider(unpriced, { db: { rpc } as never, orgId: "o", capability: "x.y.z" }).generate(req)).rejects.toBeInstanceOf(ModelBudgetExceeded);
    await expect(meteredProvider({ id: "anthropic-dev", generate }, { db: { rpc } as never, orgId: "o", capability: "x.y.z" }).generate(req)).rejects.toMatchObject({ reason: "unpriced_model" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("settles a failed call as an error at zero tokens, and a refusal as refused", async () => {
    const rpc = rpcStub();
    await expect(meteredProvider(inner(async () => { throw new Error("network"); }), { db: { rpc } as never, orgId: "o", capability: "x.y.z" }).generate(req)).rejects.toThrow("network");
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_outcome: "error", p_input: 0, p_output: 0, p_cost_micro: 0 });
    const rpc2 = rpcStub();
    await meteredProvider(inner(async () => ({ output: null, model: "claude-sonnet-5-5", usage: { inputTokens: 50, outputTokens: 5 }, refused: true })), { db: { rpc: rpc2 } as never, orgId: "o", capability: "x.y.z" }).generate(req);
    expect(rpc2.mock.calls[1]![1]).toMatchObject({ p_outcome: "refused", p_input: 50, p_output: 5 });
  });

  it("a lost settlement does not break the call (the reservation stays counted)", async () => {
    const rpc = rpcStub({ settle_model_call: { data: null, error: { message: "gone" } } });
    const r = await meteredProvider(inner(async () => ({ output: { ok: 1 }, model: "claude-sonnet-5-5", usage: { inputTokens: 1, outputTokens: 1 } })), { db: { rpc } as never, orgId: "o", capability: "x.y.z" }).generate(req);
    expect(r.output).toEqual({ ok: 1 });
  });
});
