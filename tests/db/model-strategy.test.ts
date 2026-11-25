import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FACT_FIELDS } from "../../src/lib/business-profile";
import { setupTestDb, type TestDb } from "./harness";
import { reapplyFrom, rollbackFrom } from "./migrations";

let db: TestDb;
let owner: string;
let member: string;
let outsider: string;
let admin: string;
let org: string;
let otherOrg: string;
let analysis: string;
let cardA: string;
let cardB: string;

const PERMISSION_DENIED = /permission denied/;
const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]]);

const ev = [{ key: "w", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://a.example/", observation: "No title." }];
const card = (check_key: string) => ({
  check_key, title: check_key, explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x",
  impact_priority: "high", confidence: "high", ai_capable: false, execution_type: "manual", approval_required: true, evidence_keys: ["w"],
});
const usage = (o: string, cost: number, extra: Partial<{ cap: string; outcome: string; wf: string | null; run: string | null }> = {}) =>
  q(owner, "select public.record_model_usage($1,$2,'anthropic-dev','claude-sonnet-5-5',100,50,$3,$4,$5,$6)",
    [o, extra.cap ?? "business_intelligence.understand", cost, extra.outcome ?? "ok", extra.wf ?? null, extra.run ?? null]);
const plan = (...ids: string[]) => ({
  summary: "s", objectives: ["o"], next_steps: ["n"], questions: [], not_now: [],
  priorities: ids.map((id, i) => ({ card_id: id, order: i + 1, why_now: "w", effort: "small", depends_on: [] as string[] })),
});

beforeAll(async () => {
  db = await setupTestDb();
  owner = await db.createUser("Owner");
  member = await db.createUser("Member");
  outsider = await db.createUser("Outsider");
  admin = await db.createUser("Admin");
  [{ id: org }] = await q<{ id: string }>(owner, "select public.create_organization('Sunrise','https://a.example','','') as id");
  [{ id: otherOrg }] = await q<{ id: string }>(outsider, "select public.create_organization('Other','https://b.example','','') as id");
  await db.admin.query("insert into public.organization_members values ($1,$2,'member',now())", [org, member]);
  await db.admin.query("insert into public.platform_admins (user_id) values ($1)", [admin]);
  await db.grantPlan(org);
  await db.grantPlan(otherOrg);
  [{ id: analysis }] = await q<{ id: string }>(owner, "select public.start_analysis($1) as id", [org]);
  await q(owner, "select public.complete_analysis($1,$2,$3,'{}','s','template')", [analysis, JSON.stringify(ev), JSON.stringify([card("meta.title_missing"), card("meta.description_missing")])]);
  const cards = await q<{ id: string; check_key: string }>(owner, "select id, check_key from public.action_cards where analysis_id = $1 order by check_key", [analysis]);
  cardA = cards.find((c) => c.check_key === "meta.description_missing")!.id;
  cardB = cards.find((c) => c.check_key === "meta.title_missing")!.id;
}, 60_000);
afterAll(async () => db?.teardown());

describe("model usage and budgets", () => {
  it("records usage for the business, visible to its members only, never writable directly", async () => {
    await usage(org, 1000);
    const mine = await q<{ cost_micro: number }>(member, "select cost_micro from public.model_usage");
    expect(mine).toHaveLength(1);
    expect(await db.as(outsider, async (c) => (await c.query("select 1 from public.model_usage")).rows)).toHaveLength(0);
    await expect(q(owner, "insert into public.model_usage (organization_id, capability, provider, model, cost_micro, outcome) values ($1,'x.y.z','p','m',1,'ok')", [org])).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "update public.model_usage set cost_micro = 0")).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(null, "select public.record_model_usage($1,'a.b.c','p','m',1,1,1,'ok',null,null)", [org])).rejects.toThrow(PERMISSION_DENIED);
  });

  it("refuses usage and budget lookups for other businesses, and bad values", async () => {
    await expect(usage(otherOrg, 1)).rejects.toThrow(/Forbidden/);
    await expect(q(owner, "select public.model_budget($1)", [otherOrg])).rejects.toThrow(/Forbidden/);
    await expect(usage(org, 5_000_001)).rejects.toThrow(/check constraint/);
    await expect(usage(org, 1, { outcome: "great" })).rejects.toThrow(/check constraint/);
    await expect(usage(org, 1, { cap: "Bad Capability!" })).rejects.toThrow(/check constraint/);
    await expect(usage(org, 1, { wf: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/Forbidden/);
    await expect(usage(org, 1, { run: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/Forbidden/);
  });

  it("blocks further calls once the daily cap is spent, and reports why", async () => {
    const [{ b: before }] = await q<{ b: { allowed: boolean; daily_cap_micro: number; spent_today_micro: number } }>(member, "select public.model_budget($1) b", [org]);
    expect(before).toMatchObject({ allowed: true, daily_cap_micro: 500000, spent_today_micro: 1000 });
    await usage(org, 499_000, { outcome: "error" }); // failed calls count too
    const [{ b }] = await q<{ b: { allowed: boolean; reason: string } }>(member, "select public.model_budget($1) b", [org]);
    expect(b).toMatchObject({ allowed: false, reason: "daily" });
  });

  it("another business is unaffected, and a per-business override can raise the cap", async () => {
    const [{ b }] = await q<{ b: { allowed: boolean } }>(outsider, "select public.model_budget($1) b", [otherOrg]);
    expect(b.allowed).toBe(true);
    await db.admin.query("insert into public.organization_model_limits (organization_id, daily_cap_micro) values ($1, 900000)", [org]);
    const [{ b: raised }] = await q<{ b: { allowed: boolean } }>(owner, "select public.model_budget($1) b", [org]);
    expect(raised.allowed).toBe(true);
    await expect(q(owner, "select * from public.organization_model_limits")).rejects.toThrow(PERMISSION_DENIED);
  });

  it("the monthly and global caps also stop calls", async () => {
    await db.admin.query("update public.organization_model_limits set daily_cap_micro = 100000000, monthly_cap_micro = 400000 where organization_id = $1", [org]);
    const [{ b: m }] = await q<{ b: { allowed: boolean; reason: string } }>(owner, "select public.model_budget($1) b", [org]);
    expect(m).toMatchObject({ allowed: false, reason: "monthly" });
    await db.admin.query("update public.organization_model_limits set monthly_cap_micro = 100000000 where organization_id = $1", [org]);
    await db.admin.query("update public.app_config set value = '1' where key = 'model_global_daily_cap_micro'");
    const [{ b: g }] = await q<{ b: { allowed: boolean; reason: string } }>(outsider, "select public.model_budget($1) b", [otherOrg]);
    expect(g).toMatchObject({ allowed: false, reason: "global_daily" });
    await db.admin.query("update public.app_config set value = '20000000' where key = 'model_global_daily_cap_micro'");
  });

  it("admin spend summary is for platform admins only", async () => {
    await expect(q(owner, "select public.admin_model_usage(7)")).rejects.toThrow(/Forbidden/);
    await expect(q(null, "select public.admin_model_usage(7)")).rejects.toThrow(PERMISSION_DENIED);
    const [{ r }] = await q<{ r: { organization: string; calls: number; cost_micro: number; failed_calls: number }[] }>(admin, "select public.admin_model_usage(7) r");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ organization: "Sunrise", calls: 2, cost_micro: 500_000, failed_calls: 1 });
  });
});

describe("profile fields", () => {
  it("accept the new fields, and the database list matches the code list", async () => {
    const declared = Object.entries(FACT_FIELDS).flatMap(([c, fs]) => fs.map((f) => `${c}.${f}`)).sort();
    const { rows } = await db.admin.query<{ k: string }>(
      `select c.category || '.' || f.field as k from unnest(array['business','brand','customer']) c(category),
         unnest($1::text[]) f(field) where app_private.business_fact_field_ok(c.category, f.field) order by 1`, [Object.values(FACT_FIELDS).flat()]);
    expect(rows.map((r) => r.k)).toEqual(declared);
    for (const k of ["business.trust_signal", "business.price_positioning", "brand.positioning"]) {
      const [c, f] = k.split(".");
      expect((await db.admin.query("select app_private.business_fact_field_ok($1,$2) ok", [c, f])).rows[0].ok).toBe(true);
    }
  });
});

describe("marketing plans", () => {
  let p1: string;

  it("a member proposes a plan that points only at open actions of the business", async () => {
    [{ id: p1 }] = await q<{ id: string }>(member, "select public.save_marketing_plan($1,$2,$3,'anthropic-dev','claude-sonnet-5-5') as id", [org, analysis, JSON.stringify(plan(cardA, cardB))]);
    const [row] = await q<{ status: string; created_by: string }>(owner, "select status, created_by from public.marketing_plans where id = $1", [p1]);
    expect(row).toEqual({ status: "proposed", created_by: member });
    await expect(q(owner, "insert into public.marketing_plans (organization_id, plan) values ($1,'{}')", [org])).rejects.toThrow(PERMISSION_DENIED);
    expect(await db.as(outsider, async (c) => (await c.query("select 1 from public.marketing_plans")).rows)).toHaveLength(0);
  });

  it("refuses unknown cards, other businesses' cards, bad dependencies, empty plans, outsiders", async () => {
    const save = (u: string, o: string, p: unknown) => q(u, "select public.save_marketing_plan($1,$2,$3,'p','m')", [o, analysis, JSON.stringify(p)]);
    await expect(save(owner, org, plan("00000000-0000-0000-0000-000000000000"))).rejects.toThrow(/open action/);
    await expect(save(outsider, otherOrg, plan(cardA))).rejects.toThrow(/open action|Forbidden/);
    await expect(save(outsider, org, plan(cardA))).rejects.toThrow(/Forbidden/);
    const selfDep = plan(cardA); selfDep.priorities[0]!.depends_on = [cardA];
    await expect(save(owner, org, selfDep)).rejects.toThrow(/dependency/);
    const stray = plan(cardA); stray.priorities[0]!.depends_on = [cardB];
    await expect(save(owner, org, stray)).rejects.toThrow(/dependency/);
    await expect(save(owner, org, { ...plan(cardA), priorities: [] })).rejects.toThrow(/1 to 10/);
    await expect(q(null, "select public.save_marketing_plan($1,null,'{}','p','m')", [org])).rejects.toThrow(PERMISSION_DENIED);
  });

  it("a new proposal supersedes the earlier proposed one; only the owner decides", async () => {
    const [{ id: p2 }] = await q<{ id: string }>(owner, "select public.save_marketing_plan($1,$2,$3,'p','m') as id", [org, analysis, JSON.stringify(plan(cardB))]);
    expect((await q<{ status: string }>(owner, "select status from public.marketing_plans where id = $1", [p1]))[0].status).toBe("superseded");
    await expect(q(member, "select public.decide_marketing_plan($1,'approved')", [p2])).rejects.toThrow(/Only the account owner/);
    await expect(q(outsider, "select public.decide_marketing_plan($1,'approved')", [p2])).rejects.toThrow(/Forbidden/);
    await expect(q(owner, "select public.decide_marketing_plan($1,'maybe')", [p2])).rejects.toThrow(/Invalid decision/);
    await q(owner, "select public.decide_marketing_plan($1,'approved')", [p2]);
    const [row] = await q<{ status: string; decided_by: string }>(owner, "select status, decided_by from public.marketing_plans where id = $1", [p2]);
    expect(row).toEqual({ status: "approved", decided_by: owner });
    await expect(q(owner, "select public.decide_marketing_plan($1,'rejected')", [p2])).rejects.toThrow(/already decided/);
    // approving a later plan retires the earlier approved one
    const [{ id: p3 }] = await q<{ id: string }>(owner, "select public.save_marketing_plan($1,$2,$3,'p','m') as id", [org, analysis, JSON.stringify(plan(cardA))]);
    await q(owner, "select public.decide_marketing_plan($1,'approved')", [p3]);
    const statuses = await q<{ id: string; status: string }>(owner, "select id, status from public.marketing_plans where id in ($1,$2)", [p2, p3]);
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({ [p2]: "superseded", [p3]: "approved" });
  });
});

describe("admin agent review", () => {
  it("is for platform admins only and returns findings with evidence", async () => {
    await expect(q(owner, "select public.admin_agent_review(5)")).rejects.toThrow(/Forbidden/);
    await expect(q(null, "select public.admin_agent_review(5)")).rejects.toThrow(PERMISSION_DENIED);
    await q(owner, "select public.start_marketing_workflow($1,'website_review',null,'{}',$2)", [org, analysis]);
    const [{ r }] = await q<{ r: { organization: string; findings: { evidence: string[] }[]; plan: unknown }[] }>(admin, "select public.admin_agent_review(5) r");
    expect(r[0]!.organization).toBe("Sunrise");
    expect(r[0]!.findings.length).toBe(2);
    expect(r[0]!.plan).toBeTruthy();
    const logged = await db.admin.query("select 1 from public.activity_log where action = 'admin.agent_review_viewed' and actor_id = $1", [admin]);
    expect(logged.rowCount).toBeGreaterThan(0);
  });
});

describe("rollback", () => {
  it("rolls back, keeps existing data, and re-applies", async () => {
    const count = async (t: string) => (await db.admin.query<{ n: number }>(`select count(*)::int n from public.${t}`)).rows[0]!.n;
    const before = { cards: await count("action_cards"), facts: await count("business_facts"), orgs: await count("organizations") };
    await rollbackFrom(db.admin, "20261129120000_model_usage_and_strategy");
    const gone = await db.admin.query("select to_regclass('public.model_usage') u, to_regclass('public.marketing_plans') p, to_regprocedure('public.model_budget(uuid)') f");
    expect(gone.rows[0]).toEqual({ u: null, p: null, f: null });
    expect({ cards: await count("action_cards"), facts: await count("business_facts"), orgs: await count("organizations") }).toEqual(before);
    expect((await db.admin.query("select app_private.business_fact_field_ok('brand','positioning') ok")).rows[0].ok).toBe(false);
    expect((await db.admin.query("select count(*)::int n from public.app_config where key like 'model_%cap_micro'")).rows[0].n).toBe(0);
    await reapplyFrom(db.admin, "20261129120000_model_usage_and_strategy");
    expect((await db.admin.query("select count(*)::int n from public.model_usage")).rows[0].n).toBe(0);
    expect((await db.admin.query("select app_private.business_fact_field_ok('brand','positioning') ok")).rows[0].ok).toBe(true);
  });
});
