import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";
import { reapplyFrom, rollbackFrom } from "./migrations";

/** Migration 20261202: server-held key on model-storing functions, admission limits, one-at-a-time slots. */
let db: TestDb;
let owner: string;
let other: string;
let org: string;
let org2: string;
let otherOrg: string;
let analysis: string;
const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = [], customer = false) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]], { customer });
const reserve = (user: string, o: string, cost: number) =>
  q<{ id: string }>(user, "select public.reserve_model_call($1,$2,'marketing_strategy.plan','anthropic-dev','claude-sonnet-5-5',$3,null,null) as id", [db.modelKey, o, cost]);
const hint = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as { hint?: string }).hint;

const fact = { category: "business", field: "service", value: "Drain cleaning", source: "website", evidence_class: "verified", basis: null, evidence: [{ kind: "observed", url: "https://a.example/", excerpt: "We clear drains" }] };

beforeAll(async () => {
  db = await setupTestDb();
  owner = await db.createUser("Owner");
  other = await db.createUser("Other");
  [{ id: org }] = await q<{ id: string }>(owner, "select public.create_organization('Sunrise','https://a.example','','') as id");
  [{ id: org2 }] = await q<{ id: string }>(owner, "select public.create_organization('Sunset','https://c.example','','') as id");
  [{ id: otherOrg }] = await q<{ id: string }>(other, "select public.create_organization('Other','https://b.example','','') as id");
  for (const o of [org, org2, otherOrg]) await db.grantPlan(o);
  [{ id: analysis }] = await q<{ id: string }>(owner, "select public.start_analysis($1) as id", [org]);
  await q(owner, "select public.complete_analysis($1,'[]','[]','{}','s','template')", [analysis]);
}, 60_000);
afterAll(async () => db?.teardown());

describe("server-held key on the functions that store model-produced work", () => {
  it("a customer calling them directly (no server key header) is refused; the app server (key header) is not", async () => {
    for (const [sql, params] of [
      ["select public.add_model_findings($1,'[]','[]')", [analysis]],
      ["select public.propose_business_facts($1,$2,$3)", [org, analysis, JSON.stringify([fact])]],
      ["select public.save_marketing_plan($1,$2,'{}','p','m')", [org, analysis]],
      ["select public.complete_agent_run(gen_random_uuid(),'{}','m','{}')", []],
    ] as [string, unknown[]][]) {
      expect(await hint(q(owner, sql, params, true)), sql).toBe("agent_key");
    }
    expect((await q<{ n: number }>(owner, "select public.propose_business_facts($1,$2,$3) as n", [org, analysis, JSON.stringify([fact])]))[0].n).toBe(1);
  });

  it("a wrong, malformed or missing header does not work either", async () => {
    for (const headers of [{ "x-agent-key": "x".repeat(40) }, { "x-agent-key": "short" }, { "X-Other": db.modelKey }, "not json"]) {
      const err = await db.as(owner, async (c) => {
        await c.query("select set_config('request.headers', $1, true)", [typeof headers === "string" ? headers : JSON.stringify(headers)]);
        await c.query("select public.propose_business_facts($1,$2,'[]')", [org, analysis]);
      }).catch((e) => e as { hint?: string });
      expect((err as { hint?: string }).hint).toBe("agent_key");
    }
  });

  it("the key is also what a customer would need for reserve/settle/slots, so none of it opens without it", async () => {
    await expect(q(owner, "select public.acquire_agent_slot('x', $1, 'marketing_strategy.plan', 60)", [org])).rejects.toThrow(/Forbidden/);
  });
});

describe("admission limits", () => {
  it("a business can start only so many model calls per hour", async () => {
    await db.admin.query("delete from public.model_usage");
    await db.admin.query("update public.app_config set value = '3' where key = 'model_org_hourly_calls'");
    for (let i = 0; i < 3; i++) await reserve(owner, org, 100);
    expect(await hint(reserve(owner, org, 100))).toBe("hourly");
    await reserve(other, otherOrg, 100); // another business is unaffected
    await db.admin.query("update public.app_config set value = '30' where key = 'model_org_hourly_calls'");
  });

  it("one person's spend counts across every business they act for, so more businesses do not mean more allowance", async () => {
    await db.admin.query("delete from public.model_usage");
    await db.admin.query("update public.app_config set value = '300000' where key = 'model_user_daily_cap_micro'");
    await reserve(owner, org, 200_000);
    expect(await hint(reserve(owner, org2, 200_000))).toBe("user_daily"); // second business, same person
    await reserve(owner, org2, 90_000); // still within the person's allowance
    await reserve(other, otherOrg, 200_000); // a different person is unaffected
    const [row] = await q<{ requested_by: string }>(owner, "select requested_by from public.model_usage where organization_id = $1 limit 1", [org]);
    expect(row.requested_by).toBe(owner);
    await db.admin.query("update public.app_config set value = '1000000' where key = 'model_user_daily_cap_micro'");
  });
});

describe("one-at-a-time slots", () => {
  const acquire = (user: string, o = org, key = db.modelKey) => q<{ t: string }>(user, "select public.acquire_agent_slot($1,$2,'marketing_strategy.plan',60) as t", [key, o]);
  const release = (user: string, token: string, o = org) => q(user, "select public.release_agent_slot($1,$2,'marketing_strategy.plan',$3)", [db.modelKey, o, token]);

  it("a second request is refused while the first holds the slot, and can go once it is released", async () => {
    const [{ t }] = await acquire(owner);
    expect(await hint(acquire(owner))).toBe("busy");
    await acquire(other, otherOrg); // other business, other slot
    await release(owner, "00000000-0000-0000-0000-000000000000"); // wrong token releases nothing
    expect(await hint(acquire(owner))).toBe("busy");
    await release(owner, t);
    await acquire(owner);
  });

  it("an expired slot (a crashed request) can be taken over; a stale holder cannot release the new one", async () => {
    await db.admin.query("delete from app_private.agent_slots");
    const [{ t: old }] = await acquire(owner);
    await db.admin.query("update app_private.agent_slots set expires_at = now() - interval '1 second'");
    const [{ t: fresh }] = await acquire(owner);
    expect(fresh).not.toBe(old);
    await release(owner, old);
    expect(await hint(acquire(owner))).toBe("busy"); // still held by the new request
  });

  it("only people who act for the business, with the key, and valid names and times", async () => {
    await expect(acquire(other, org)).rejects.toThrow(/Forbidden/);
    await expect(acquire(owner, org, "x".repeat(40))).rejects.toThrow(/Forbidden/);
    await expect(q(owner, "select public.acquire_agent_slot($1,$2,'Bad Name!',60)", [db.modelKey, org])).rejects.toThrow(/Invalid slot/);
    await expect(q(owner, "select public.acquire_agent_slot($1,$2,'marketing_strategy.plan',5000)", [db.modelKey, org])).rejects.toThrow(/Invalid slot/);
    await expect(q(owner, "select * from app_private.agent_slots")).rejects.toThrow(/permission denied/);
  });

  it("ten simultaneous submissions: exactly one gets the slot", async () => {
    await db.admin.query("delete from app_private.agent_slots");
    const database = (await db.admin.query("select current_database() d")).rows[0].d;
    const clients = await Promise.all(Array.from({ length: 10 }, async () => {
      const c = new pg.Client({ host: process.env.PGHOST ?? "localhost", user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database });
      await c.connect();
      return c;
    }));
    try {
      const results = await Promise.all(clients.map(async (c) => {
        await c.query("begin");
        try {
          await c.query("set local role authenticated");
          await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owner, role: "authenticated" })]);
          await c.query("select public.acquire_agent_slot($1,$2,'marketing_strategy.plan',60)", [db.modelKey, org]);
          await c.query("select pg_sleep(0.1)");
          await c.query("commit");
          return "ok";
        } catch (e) {
          await c.query("rollback");
          return (e as { hint?: string }).hint ?? String(e);
        }
      }));
      expect(results.filter((r) => r === "ok")).toHaveLength(1);
      expect(results.filter((r) => r === "busy")).toHaveLength(9);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("rollback", () => {
  it("restores the earlier functions and removes the new objects, then re-applies", async () => {
    await rollbackFrom(db.admin, "20261202120000_agent_admission");
    expect((await db.admin.query("select to_regprocedure('public.acquire_agent_slot(text,uuid,text,integer)') f, to_regclass('app_private.agent_slots') t")).rows[0]).toEqual({ f: null, t: null });
    expect((await db.admin.query("select pg_get_functiondef('public.propose_business_facts(uuid,uuid,jsonb)'::regprocedure) d")).rows[0].d).not.toContain("agent_key_ok");
    expect((await db.admin.query("select count(*)::int n from information_schema.columns where table_name = 'model_usage' and column_name = 'requested_by'")).rows[0].n).toBe(0);
    await reapplyFrom(db.admin, "20261202120000_agent_admission");
    expect((await db.admin.query("select pg_get_functiondef('public.propose_business_facts(uuid,uuid,jsonb)'::regprocedure) d")).rows[0].d).toContain("agent_key_ok");
  });
});
