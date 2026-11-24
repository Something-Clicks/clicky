import { createHash, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PLANS } from "@/config/pricing";

import { setupTestDb, type TestDb } from "./harness";

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
const ent = async (orgId: string, user = owner) => (await q<{ e: Record<string, unknown> }>(user, "select public.current_entitlements($1) as e", [orgId]))[0].e;

beforeAll(async () => {
  db = await setupTestDb();
  owner = await db.createUser("Owner");
  member = await db.createUser("Member");
  outsider = await db.createUser("Outsider");
  [{ id: org }] = await q<{ id: string }>(owner, "select public.create_organization('Sunrise','https://a.example','','') as id");
  [{ id: otherOrg }] = await q<{ id: string }>(outsider, "select public.create_organization('Other','https://b.example','','') as id");
  await db.admin.query("insert into public.organization_members values ($1,$2,'member',now())", [org, member]);
  await db.admin.query("insert into app_private.secrets (name, hash) values ('billing_webhook', $1)", [createHash("sha256").update(KEY).digest()]);
  // These tests cover paid access only; free uses are covered in launch.test.ts.
  await db.admin.query("update public.app_config set value = '0' where key = 'free_run_limit'");
}, 60_000);
afterAll(async () => db?.teardown());

describe("plan catalog", () => {
  it("every priced plan has entitlements in the database", async () => {
    const rows = await q<{ plan_id: string }>(null, "select plan_id from public.plan_entitlements order by plan_id");
    expect(rows.map((r) => r.plan_id)).toEqual(expect.arrayContaining(Object.keys(PLANS)));
  });
});

describe("no purchase, no paid features", () => {
  it("cannot run an analysis without a plan", async () => {
    expect(await ent(org)).toEqual({ plan: null, analyses: false, weekly: false, drafts: "none" });
    await expect(q(owner, "select public.start_analysis($1)", [org])).rejects.toThrow(/A plan is needed/);
  });
});

describe("billing key", () => {
  it("refuses anonymous calls without the key, with a wrong key, or a short key", async () => {
    await expect(q(null, "select public.billing_record_event($1,'evt_1','x')", ["wrong".repeat(10)])).rejects.toThrow(/Forbidden/);
    await expect(q(null, "select public.billing_record_event($1,'evt_1','x')", [KEY.slice(0, 20)])).rejects.toThrow(/Forbidden/);
    await expect(q(owner, "select public.billing_upsert_subscription($1,$2,null,'sub_x','growth_ai','active',null,false)", ["nope", org])).rejects.toThrow(/Forbidden/);
  });

  it("records each Stripe event once; a failed one can be retried", async () => {
    expect((await q<{ r: string }>(null, "select public.billing_record_event($1,'evt_A','checkout.session.completed') as r", [KEY]))[0].r).toBe("new");
    expect((await q<{ r: string }>(null, "select public.billing_record_event($1,'evt_A','checkout.session.completed') as r", [KEY]))[0].r).toBe("duplicate");
    await q(null, "select public.billing_finish_event($1,'evt_A','failed','boom')", [KEY]);
    expect((await q<{ r: string }>(null, "select public.billing_record_event($1,'evt_A','checkout.session.completed') as r", [KEY]))[0].r).toBe("retry");
  });

  it("nobody reads or writes billing tables directly", async () => {
    await expect(q(owner, "select * from public.integration_events")).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "select * from public.billing_customers")).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "insert into public.subscriptions (organization_id, stripe_subscription_id, plan_id, status) values ($1,'sub_free','growth_ai','active')", [org])).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "insert into public.purchases (organization_id, plan_id, stripe_checkout_session_id, amount_cents) values ($1,'diagnostic_audit','cs_free',1)", [org])).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe("Diagnostic Audit (one-time)", () => {
  it("a verified purchase allows exactly one analysis, and replays are harmless", async () => {
    for (let i = 0; i < 2; i++) {
      await q(null, "select public.billing_record_purchase($1,$2,'diagnostic_audit','cs_test_audit1','cus_A1',3900)", [KEY, org]);
    }
    expect((await q<{ n: number }>(owner, "select count(*)::int as n from public.purchases")) [0].n).toBe(1);
    expect(await ent(org)).toMatchObject({ plan: "diagnostic_audit", analyses: true, weekly: false, drafts: "none" });
    const [{ id }] = await q<{ id: string }>(owner, "select public.start_analysis($1) as id", [org]);
    await q(owner, "select public.complete_analysis($1,'[]','[]','{}','s','template')", [id]);
    expect(await ent(org)).toMatchObject({ plan: null, analyses: false });
    await expect(q(owner, "select public.start_analysis($1)", [org])).rejects.toThrow(/A plan is needed/);
  });

  it("links the Stripe customer for the owner only", async () => {
    expect((await q<{ c: string }>(owner, "select public.billing_customer_id($1) as c", [org]))[0].c).toBe("cus_A1");
    await expect(q(member, "select public.billing_customer_id($1)", [org])).rejects.toThrow(/Forbidden/);
    await expect(q(outsider, "select public.billing_customer_id($1)", [org])).rejects.toThrow(/Forbidden/);
  });
});

describe("subscriptions", () => {
  const sub = (status: string, plan = "starter_ai") =>
    q(null, "select public.billing_upsert_subscription($1,$2,'cus_A1','sub_S1',$3,$4,now() + interval '30 days',false)", [KEY, org, plan, status]);

  it("Starter unlocks analyses, weekly and page-title drafts only", async () => {
    await sub("active");
    expect(await ent(org)).toEqual({ plan: "starter_ai", analyses: true, weekly: true, drafts: "meta" });
  });

  it("Starter cannot prepare homepage copy; Growth can", async () => {
    const [{ id }] = await q<{ id: string }>(owner, "select public.start_analysis($1) as id", [org]);
    const evidence = [{ key: "e1", source: "website", kind: "observed", check_key: "content.h1_missing", url: "https://a.example/", observation: "No headline." }];
    const card = { check_key: "content.h1_missing", title: "t", explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x", impact_priority: "high", confidence: "high", ai_capable: true, execution_type: "page_copy", evidence_keys: ["e1"] };
    await q(owner, "select public.complete_analysis($1,$2,$3,'{}','s','template')", [id, JSON.stringify(evidence), JSON.stringify([card])]);
    const [{ id: cardId }] = await q<{ id: string }>(owner, "select id from public.action_cards where analysis_id = $1", [id]);
    await expect(q(owner, "select public.start_agent_run($1, null)", [cardId])).rejects.toThrow(/does not include this draft/);
    await sub("active", "growth_ai");
    await q(owner, "select public.start_agent_run($1, null)", [cardId]);
  });

  it("losing payment removes access; status changes are logged", async () => {
    await sub("past_due", "growth_ai");
    expect(await ent(org)).toMatchObject({ plan: null, analyses: false });
    await sub("active", "growth_ai");
    expect(await ent(org)).toMatchObject({ plan: "growth_ai" });
    await sub("canceled", "growth_ai");
    expect(await ent(org)).toMatchObject({ plan: null });
    const log = await q<{ action: string }>(owner, "select action from public.activity_log where organization_id = $1 and action like 'billing.%' order by created_at", [org]);
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["billing.purchase_confirmed", "billing.subscription_active", "billing.subscription_past_due", "billing.subscription_canceled"]));
  });

  it("members can see their subscription; other tenants cannot", async () => {
    expect((await q(member, "select * from public.subscriptions where organization_id = $1", [org])).length).toBe(1);
    expect(await q(outsider, "select * from public.subscriptions where organization_id = $1", [org])).toEqual([]);
    await expect(q(outsider, "select public.current_entitlements($1)", [org])).rejects.toThrow(/Forbidden/);
    expect(await ent(otherOrg, outsider)).toMatchObject({ plan: null });
  });
});
