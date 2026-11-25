import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";
import { reapplyFrom, rollbackFrom } from "./migrations";

/** Migration 20261201: the functions that store model-produced work refuse unless the database is switched on for them. */
let db: TestDb;
let owner: string;
let org: string;
let analysis: string;
const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]]);
const setSwitch = (v: string) => db.admin.query("update public.app_config set value = $1 where key = 'agent_functions_enabled'", [v]);

const fact = { category: "business", field: "service", value: "Drain cleaning", source: "website", evidence_class: "verified", basis: null, evidence: [{ kind: "observed", url: "https://a.example/", excerpt: "We clear drains" }] };
const plan = (card: string) => ({
  summary: "s", objectives: [], next_steps: [], questions: [], not_now: [],
  priorities: [{ card_id: card, order: 1, why_now: "w", effort: "small", depends_on: [] as string[], based_on: [] as string[] }],
});

beforeAll(async () => {
  db = await setupTestDb();
  owner = await db.createUser("Owner");
  [{ id: org }] = await q<{ id: string }>(owner, "select public.create_organization('Sunrise','https://a.example','','') as id");
  await db.grantPlan(org);
  [{ id: analysis }] = await q<{ id: string }>(owner, "select public.start_analysis($1) as id", [org]);
  await q(owner, "select public.complete_analysis($1,$2,$3,'{}','s','template')", [analysis, JSON.stringify([{ key: "w", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://a.example/", observation: "No title." }]),
    JSON.stringify([{ check_key: "meta.title_missing", title: "t", explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x", impact_priority: "high", confidence: "high", ai_capable: true, execution_type: "meta", approval_required: true, evidence_keys: ["w"] }])]);
}, 60_000);
afterAll(async () => db?.teardown());

describe("agent functions switch", () => {
  it("is off by default: the migration's own value, read straight after running it (not through the test helper that switches it on)", async () => {
    await rollbackFrom(db.admin, "20261201120000_agent_functions_switch");
    await db.admin.query(readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261201120000_agent_functions_switch.sql"), "utf8"));
    expect((await db.admin.query("select value from public.app_config where key = 'agent_functions_enabled'")).rows[0].value).toBe(0);
  });

  it("while off, a member cannot store model findings, business details, plans or draft output by calling the functions directly", async () => {
    const [{ id: card }] = await q<{ id: string }>(owner, "select id from public.action_cards where analysis_id = $1 limit 1", [analysis]);
    const [{ id: run }] = await q<{ id: string }>(owner, "select public.start_agent_run($1, null) as id", [card]);
    for (const [sql, params] of [
      ["select public.add_model_findings($1,'[]','[]')", [analysis]],
      ["select public.propose_business_facts($1,$2,$3)", [org, analysis, JSON.stringify([fact])]],
      ["select public.save_marketing_plan($1,$2,$3,'p','m')", [org, analysis, JSON.stringify(plan(card))]],
      ["select public.complete_agent_run($1,$2,'m','{}')", [run, JSON.stringify({ fields: [{ key: "page_title", label: "Page title", text: "x" }] })]],
    ] as [string, unknown[]][]) {
      await expect(q(owner, sql, params), sql).rejects.toThrow(/Not available yet/);
    }
    expect((await db.admin.query("select count(*)::int n from public.business_facts")).rows[0].n).toBe(0);
    expect((await db.admin.query("select count(*)::int n from public.marketing_plans")).rows[0].n).toBe(0);
  });

  it("while on, the same calls work (as on clicky-dev)", async () => {
    await setSwitch("1");
    const [{ n }] = await q<{ n: number }>(owner, "select public.propose_business_facts($1,$2,$3) as n", [org, analysis, JSON.stringify([fact])]);
    expect(n).toBe(1);
  });

  it("rolls back to the original bodies and re-applies", async () => {
    await rollbackFrom(db.admin, "20261201120000_agent_functions_switch");
    expect((await db.admin.query("select count(*)::int n from public.app_config where key = 'agent_functions_enabled'")).rows[0].n).toBe(0);
    expect((await db.admin.query("select pg_get_functiondef('public.propose_business_facts(uuid,uuid,jsonb)'::regprocedure) d")).rows[0].d).not.toContain("agent_functions_enabled");
    await q(owner, "select public.propose_business_facts($1,$2,$3)", [org, analysis, JSON.stringify([{ ...fact, field: "industry", value: "Plumbing" }])]);
    await reapplyFrom(db.admin, "20261201120000_agent_functions_switch");
    expect((await db.admin.query("select pg_get_functiondef('public.propose_business_facts(uuid,uuid,jsonb)'::regprocedure) d")).rows[0].d).toContain("agent_functions_enabled");
  });
});
