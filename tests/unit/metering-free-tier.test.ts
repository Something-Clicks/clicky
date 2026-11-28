/**
 * Free-tier protection: a call costs $0, so dollars cannot bound a business; its tokens over the last 24 hours are bounded instead.
 * The database is a stand-in that answers the two reads metering makes; no model is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { meteredProvider, ModelBudgetExceeded, orgDailyTokenCap } from "@/lib/server/agent/metering";
import { registerPrice } from "@/lib/server/agent/pricing";
import type { ModelProvider } from "@/lib/server/agent/provider";

registerPrice("groq", "free/test-model", { input: 0, output: 0 });
registerPrice("groq", "paid/test-model", { input: 1, output: 2 });
const inner = (model: string): ModelProvider & { calls: number } => { const p = { calls: 0, id: "groq", model, async generate() { p.calls += 1; return { output: { a: "x" }, model, usage: { inputTokens: 10, outputTokens: 5 } }; } }; return p; };
const req = { task: "t.x", system: "s", input: "i", jsonSchema: {}, maxOutputTokens: 100 };
const dbWith = (rows: { input_tokens: number; output_tokens: number }[] | null, error: object | null = null) => {
  const q = { select: () => q, eq: () => q, gt: () => q, limit: async () => ({ data: rows, error }) };
  return { rpc: vi.fn(async (name: string) => ({ data: name === "reserve_model_call" ? "res-1" : null, error: null })), from: vi.fn(() => q) } as never;
};

beforeEach(() => { process.env.MODEL_USAGE_KEY = "k".repeat(40); });
afterEach(() => { delete process.env.MODEL_USAGE_KEY; delete process.env.MODEL_ORG_DAILY_TOKENS; });

describe("per-business token cap on the free tier", () => {
  it("defaults to 60,000 tokens a day and can be set (not below 1,000)", () => {
    expect(orgDailyTokenCap({})).toBe(60_000);
    expect(orgDailyTokenCap({ MODEL_ORG_DAILY_TOKENS: "25000" })).toBe(25_000);
    expect(orgDailyTokenCap({ MODEL_ORG_DAILY_TOKENS: "5" })).toBe(60_000);
  });

  it("lets a business under its cap through, and settles the call at $0", async () => {
    const db = dbWith([{ input_tokens: 20_000, output_tokens: 10_000 }]);
    const p = inner("free/test-model");
    await meteredProvider(p, { db, orgId: "o", capability: "x.y.z" }).generate(req);
    expect(p.calls).toBe(1);
    expect((db as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc.mock.calls.map((c: unknown[]) => c[0])).toEqual(["reserve_model_call", "settle_model_call"]);
  });

  it("refuses a business at its cap BEFORE reserving or calling the model, with the plain 'daily' outcome", async () => {
    const db = dbWith([{ input_tokens: 40_000, output_tokens: 20_000 }]);
    const p = inner("free/test-model");
    await expect(meteredProvider(p, { db, orgId: "o", capability: "x.y.z" }).generate(req)).rejects.toMatchObject({ name: "ModelBudgetExceeded", reason: "daily" });
    expect(p.calls).toBe(0);
    expect((db as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });

  it("honours MODEL_ORG_DAILY_TOKENS", async () => {
    process.env.MODEL_ORG_DAILY_TOKENS = "2000";
    await expect(meteredProvider(inner("free/test-model"), { db: dbWith([{ input_tokens: 1_500, output_tokens: 600 }]), orgId: "o", capability: "x.y.z" }).generate(req)).rejects.toBeInstanceOf(ModelBudgetExceeded);
  });

  it("fails closed when usage cannot be read", async () => {
    await expect(meteredProvider(inner("free/test-model"), { db: dbWith(null, { message: "boom" }), orgId: "o", capability: "x.y.z" }).generate(req)).rejects.toMatchObject({ reason: "budget_unavailable" });
  });

  it("does not apply to a priced (paid) model, whose dollar caps bind instead, and never reads usage", async () => {
    const db = dbWith([{ input_tokens: 900_000, output_tokens: 900_000 }]);
    const p = inner("paid/test-model");
    await meteredProvider(p, { db, orgId: "o", capability: "x.y.z" }).generate(req);
    expect(p.calls).toBe(1);
    expect((db as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});
