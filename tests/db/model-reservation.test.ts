import { createHash, randomBytes } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";
import { reapplyFrom, rollbackFrom } from "./migrations";

/**
 * Migration 20261130: model cost control that customers cannot forge and parallel requests cannot overspend.
 * (Budget, caps, plans and admin functions are covered in model-strategy.test.ts.)
 */
let db: TestDb;
let owner: string;
let member: string;
let outsider: string;
let org: string;
let otherOrg: string;
const KEY = randomBytes(32).toString("hex");
const PERMISSION_DENIED = /permission denied/;
const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]]);
const reserve = (user: string | null, o: string, cost: number, key = KEY, extra: { wf?: string | null; run?: string | null } = {}) =>
  q<{ id: string }>(user, "select public.reserve_model_call($1,$2,'marketing_strategy.plan','anthropic-dev','claude-sonnet-5-5',$3,$4,$5) as id", [key, o, cost, extra.wf ?? null, extra.run ?? null]);
const settle = (user: string | null, id: string, cost: number, outcome = "ok", key = KEY) =>
  q(user, "select public.settle_model_call($1,$2,'claude-sonnet-5-5',1200,300,$3,$4)", [key, id, cost, outcome]);
const budget = async (user: string, o: string) => (await q<{ b: Record<string, number | boolean | string> }>(user, "select public.model_budget($1) b", [o]))[0].b;

beforeAll(async () => {
  db = await setupTestDb();
  owner = await db.createUser("Owner");
  member = await db.createUser("Member");
  outsider = await db.createUser("Outsider");
  [{ id: org }] = await q<{ id: string }>(owner, "select public.create_organization('Sunrise','https://a.example','','') as id");
  [{ id: otherOrg }] = await q<{ id: string }>(outsider, "select public.create_organization('Other','https://b.example','','') as id");
  await db.admin.query("insert into public.organization_members values ($1,$2,'member',now())", [org, member]);
  await db.grantPlan(org);
  await db.grantPlan(otherOrg);
  await db.admin.query("insert into app_private.secrets (name, hash) values ('model_usage', $1)", [createHash("sha256").update(KEY).digest()]);
}, 60_000);
afterAll(async () => db?.teardown());

describe("usage cannot be forged", () => {
  it("the old open-to-members recording function is gone", async () => {
    await expect(q(owner, "select public.record_model_usage($1,'a.b.c','p','m',1,1,1,'ok',null,null)", [org])).rejects.toThrow(/does not exist/);
  });

  it("reserving or settling needs the server key, even for a member of the business", async () => {
    for (const bad of [null, "", "short", randomBytes(32).toString("hex")]) {
      await expect(reserve(owner, org, 100, bad as unknown as string)).rejects.toThrow(/Forbidden/);
    }
    const [{ id }] = await reserve(owner, org, 100);
    await expect(settle(owner, id, 50, "ok", randomBytes(32).toString("hex"))).rejects.toThrow(/Forbidden/);
    await expect(reserve(null, org, 100)).rejects.toThrow(PERMISSION_DENIED);
    await expect(settle(null, id, 50)).rejects.toThrow(PERMISSION_DENIED);
    await settle(owner, id, 50);
  });

  it("the key alone is not enough: the caller must act for the business, and workflows or runs must be its own", async () => {
    await expect(reserve(outsider, org, 100)).rejects.toThrow(/Forbidden/);
    const [{ id }] = await reserve(owner, org, 100);
    await expect(settle(outsider, id, 50)).rejects.toThrow(/Forbidden/);
    await settle(owner, id, 50);
    await expect(reserve(owner, org, 100, KEY, { wf: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/Forbidden/);
    await expect(reserve(owner, org, 100, KEY, { run: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/Forbidden/);
  });

  it("usage rows are not writable or deletable by customers, in any way", async () => {
    await expect(q(owner, "insert into public.model_usage (organization_id, capability, provider, model, cost_micro, outcome) values ($1,'x.y.z','p','m',1,'ok')", [org])).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "update public.model_usage set cost_micro = 0")).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "delete from public.model_usage")).rejects.toThrow(PERMISSION_DENIED);
  });

  it("a reservation is settled once, can only be settled with valid values, and nothing can settle a finished row", async () => {
    const [{ id }] = await reserve(owner, org, 1000);
    await expect(settle(owner, id, 5_000_001)).rejects.toThrow(/Invalid settlement/);
    await expect(settle(owner, id, 10, "reserved")).rejects.toThrow(/Invalid settlement/);
    await settle(owner, id, 400);
    await expect(settle(owner, id, 0)).rejects.toThrow(/Forbidden/); // already settled: cannot be lowered afterwards
    await expect(settle(owner, "00000000-0000-0000-0000-000000000000", 1)).rejects.toThrow(/Forbidden/);
    const [row] = await q<{ outcome: string; cost_micro: number; input_tokens: number; model: string }>(owner, "select outcome, cost_micro, input_tokens, model from public.model_usage where id = $1", [id]);
    expect(row).toEqual({ outcome: "ok", cost_micro: "400", input_tokens: 1200, model: "claude-sonnet-5-5" });
  });

  it("an unrealistic reservation is refused, so no single call can claim or burn a huge amount", async () => {
    await expect(reserve(owner, org, 5_000_001)).rejects.toThrow(/Invalid reservation/);
    await expect(reserve(owner, org, -1)).rejects.toThrow(/Invalid reservation/);
  });
});

describe("caps hold at the moment of reservation", () => {
  it("a reservation counts as spent straight away and is refused if it would pass a cap", async () => {
    await db.admin.query("delete from public.model_usage");
    await db.admin.query("insert into public.organization_model_limits (organization_id, daily_cap_micro, monthly_cap_micro) values ($1, 300000, 100000000) on conflict (organization_id) do update set daily_cap_micro = 300000, monthly_cap_micro = 100000000", [org]);
    const [{ id: a }] = await reserve(owner, org, 200_000);
    expect((await budget(owner, org)).spent_today_micro).toBe(200_000);
    await expect(reserve(owner, org, 150_000)).rejects.toThrow(/Model budget reached/);
    const err = await reserve(owner, org, 150_000).catch((e) => e as { hint?: string });
    expect((err as { hint?: string }).hint).toBe("daily");
    await settle(owner, a, 20_000); // the call used far less than reserved: the rest is available again
    expect((await budget(owner, org)).spent_today_micro).toBe(20_000);
    await reserve(owner, org, 150_000);
  });

  it("refuses with the right reason for the monthly and the global cap", async () => {
    await db.admin.query("delete from public.model_usage");
    await db.admin.query("update public.organization_model_limits set daily_cap_micro = 100000000, monthly_cap_micro = 100000 where organization_id = $1", [org]);
    expect(((await reserve(owner, org, 100_001).catch((e) => e)) as { hint: string }).hint).toBe("monthly");
    await db.admin.query("update public.organization_model_limits set monthly_cap_micro = 100000000 where organization_id = $1", [org]);
    await db.admin.query("update public.app_config set value = '1000' where key = 'model_global_daily_cap_micro'");
    expect(((await reserve(outsider, otherOrg, 1001).catch((e) => e)) as { hint: string }).hint).toBe("global_daily");
    await db.admin.query("update public.app_config set value = '20000000' where key = 'model_global_daily_cap_micro'");
  });

  it("parallel requests cannot together pass the cap: exactly as many succeed as fit", async () => {
    await db.admin.query("delete from public.model_usage");
    await db.admin.query("update public.organization_model_limits set daily_cap_micro = 500000, monthly_cap_micro = 100000000 where organization_id = $1", [org]);
    const clients = await Promise.all(Array.from({ length: 12 }, async () => {
      const c = new pg.Client({ host: process.env.PGHOST ?? "localhost", user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: (await db.admin.query("select current_database() d")).rows[0].d });
      await c.connect();
      return c;
    }));
    try {
      const results = await Promise.all(clients.map(async (c) => {
        await c.query("begin");
        try {
          await c.query("set local role authenticated");
          await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owner, role: "authenticated" })]);
          await c.query("select public.reserve_model_call($1,$2,'x.y.z','anthropic-dev','claude-sonnet-5-5',100000,null,null)", [KEY, org]);
          // Hold the transaction open after reserving, so without the lock all twelve would check the cap before any commits.
          await c.query("select pg_sleep(0.15)");
          await c.query("commit");
          return "ok";
        } catch (e) {
          await c.query("rollback");
          return (e as { hint?: string }).hint ?? String(e);
        }
      }));
      expect(results.filter((r) => r === "ok")).toHaveLength(5); // $0.50 cap, $0.10 each
      expect(results.filter((r) => r === "daily")).toHaveLength(7);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
    expect((await budget(owner, org)).spent_today_micro).toBe(500_000);
  });

  it("a call that never settles stays counted at its reserved cost", async () => {
    await db.admin.query("delete from public.model_usage");
    await reserve(owner, org, 123_000);
    expect((await budget(member, org)).spent_today_micro).toBe(123_000);
    const [{ n }] = (await db.admin.query<{ n: number }>("select count(*)::int n from public.model_usage where outcome = 'reserved'")).rows as [{ n: number }];
    expect(n).toBe(1);
  });
});

describe("rollback", () => {
  it("rolls back to the earlier recording function, keeps settled usage, and re-applies", async () => {
    await db.admin.query("delete from public.model_usage");
    const [{ id }] = await reserve(owner, org, 1000);
    await settle(owner, id, 700);
    await reserve(owner, org, 5000); // never settled
    await rollbackFrom(db.admin, "20261130120000_model_reservations");
    expect((await db.admin.query("select to_regprocedure('public.reserve_model_call(text,uuid,text,text,text,bigint,uuid,uuid)') f, to_regprocedure('public.record_model_usage(uuid,text,text,text,integer,integer,bigint,text,uuid,uuid)') g")).rows[0]).toMatchObject({ f: null });
    expect((await db.admin.query("select count(*)::int n, coalesce(sum(cost_micro),0)::int c from public.model_usage")).rows[0]).toEqual({ n: 1, c: 700 });
    expect((await db.admin.query("select count(*)::int n from app_private.secrets where name = 'model_usage'")).rows[0].n).toBe(0);
    await reapplyFrom(db.admin, "20261130120000_model_reservations");
    expect((await db.admin.query("select to_regprocedure('public.reserve_model_call(text,uuid,text,text,text,bigint,uuid,uuid)') f")).rows[0].f).not.toBeNull();
  });
});
