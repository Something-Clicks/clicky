import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";
import { reapplyFrom, rollbackFrom } from "./migrations";

let db: TestDb;
let owner: string;
let member: string;
let outsider: string;
let org: string;
let campaign: string;
const tasks: Record<number, string> = {};

const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = [], opts?: { customer?: boolean }) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]], opts);
const brief = { objective: "More water heater jobs", audience: "Homeowners in Plano", offer: null, core_message: "Same-day water heater repair", channels: ["landing_page", "email", "social"], measurement: ["calls"] };
const promo = (over: Record<string, unknown>[] = []) => ({
  playbook: "promote_service", title: "Promote water heater repair", goal: "g", summary: "s", basis: {}, brief,
  tasks: [
    { kind: "message", title: "Landing page", why: "w", steps: ["s"], evidence_class: "verified", channel: "landing_page", due_in_days: 0, deliverable: "Template [blank]" },
    { kind: "message", title: "Email", why: "w", steps: ["s"], evidence_class: "verified", channel: "email", due_in_days: 7, depends_on: [1], deliverable: "Template" },
    { kind: "checklist", title: "Measure", why: "w", steps: ["s"], evidence_class: "verified", due_in_days: 30, depends_on: [1, 2] },
    ...over,
  ],
});

beforeAll(async () => {
  db = await setupTestDb();
  owner = await db.createUser("Owner");
  member = await db.createUser("Member");
  outsider = await db.createUser("Outsider");
  [{ id: org }] = await q<{ id: string }>(owner, "select public.create_organization('Sunrise','https://a.example','','') as id");
  await q(outsider, "select public.create_organization('Other','https://b.example','','')");
  await db.admin.query("insert into public.organization_members values ($1,$2,'member',now())", [org, member]);
}, 60_000);
afterAll(async () => db?.teardown());

describe("campaign brief, schedule and dependencies", () => {
  it("saves the brief and each task's channel, schedule and dependencies", async () => {
    [{ id: campaign }] = await q<{ id: string }>(member, "select public.save_campaign($1,$2) id", [org, JSON.stringify(promo())]);
    const [c] = await q<{ brief: typeof brief }>(owner, "select brief from public.marketing_campaigns where id = $1", [campaign]);
    expect(c.brief.core_message).toBe("Same-day water heater repair");
    const rows = await q<{ id: string; position: number; channel: string | null; due_in_days: number; depends_on: number[] }>(owner,
      "select id, position, channel, due_in_days, depends_on from public.campaign_tasks where campaign_id = $1 order by position", [campaign]);
    for (const r of rows) tasks[r.position] = r.id;
    expect(rows.map((r) => [r.channel, r.due_in_days, r.depends_on])).toEqual([["landing_page", 0, []], ["email", 7, [1]], [null, 30, [1, 2]]]);
  });

  it("refuses dependencies on later tasks, itself or nonsense", async () => {
    const bad = promo();
    (bad.tasks[1] as Record<string, unknown>).depends_on = [2];
    await expect(q(member, "select public.save_campaign($1,$2)", [org, JSON.stringify(bad)])).rejects.toThrow(/earlier tasks/);
    await expect(q(member, "select public.save_campaign($1,$2)", [org, JSON.stringify({ ...promo(), brief: "x" })])).rejects.toThrow(/expected shape/);
  });

  it("a task cannot be marked done before what it depends on (no email to a page that isn't live)", async () => {
    await q(owner, "select public.decide_campaign($1,'approved')", [campaign]);
    await expect(q(member, "select public.set_task_status($1,'done',null)", [tasks[2]])).rejects.toThrow(/Finish the steps this depends on first/);
    await q(member, "select public.set_task_status($1,'done',null)", [tasks[1]]);
    await q(member, "select public.set_task_status($1,'done',null)", [tasks[2]]);
    await q(member, "select public.set_task_status($1,'skipped',null)", [tasks[3]]); // skipping is always allowed
    expect((await q<{ status: string }>(owner, "select status from public.marketing_campaigns where id = $1", [campaign]))[0].status).toBe("completed");
  });
});

describe("model-written task drafts", () => {
  let fresh: Record<number, string>;
  beforeAll(async () => {
    const [{ id }] = await q<{ id: string }>(member, "select public.save_campaign($1,$2) id", [org, JSON.stringify(promo())]);
    const rows = await q<{ id: string; position: number }>(owner, "select id, position from public.campaign_tasks where campaign_id = $1", [id]);
    fresh = Object.fromEntries(rows.map((r) => [r.position, r.id]));
  });

  it("are stored beside the template and the owner's edit, with the model named", async () => {
    await q(member, "select public.save_task_model_draft($1,$2,'self-hosted','qwen2.5-1.5b')", [fresh[1], "Water heater out? We can help today."]);
    const [t] = await q<{ deliverable: string; deliverable_model: string; deliverable_model_by: { model: string }; deliverable_edited: string | null }>(owner,
      "select deliverable, deliverable_model, deliverable_model_by, deliverable_edited from public.campaign_tasks where id = $1", [fresh[1]]);
    expect(t).toMatchObject({ deliverable: "Template [blank]", deliverable_model: "Water heater out? We can help today.", deliverable_model_by: { model: "qwen2.5-1.5b" }, deliverable_edited: null });
  });

  it("need the server key and the database switch; customers, outsiders and tasks without a channel are refused", async () => {
    await expect(q(member, "select public.save_task_model_draft($1,'x','p','m')", [fresh[1]], { customer: true })).rejects.toThrow(/Not available/);
    await expect(q(outsider, "select public.save_task_model_draft($1,'x','p','m')", [fresh[1]])).rejects.toThrow(/Forbidden/);
    await expect(q(member, "select public.save_task_model_draft($1,'x','p','m')", [fresh[3]])).rejects.toThrow(/nothing to write/);
    await db.admin.query("update public.app_config set value = '0' where key = 'agent_functions_enabled'");
    await expect(q(member, "select public.save_task_model_draft($1,'x','p','m')", [fresh[1]])).rejects.toThrow(/Not available yet/);
    await db.admin.query("update public.app_config set value = '1' where key = 'agent_functions_enabled'");
    await expect(q(owner, "update public.campaign_tasks set deliverable_model = 'x'")).rejects.toThrow(/permission denied/);
  });
});

describe("content channels (spec §8 breadth)", () => {
  it("accepts an FAQ, an article and a brief as task channels, and still refuses an unknown one", async () => {
    const extra = ["faq", "blog_post", "content_brief"].map((channel, i) => ({ kind: "message", title: channel, why: "w", steps: ["s"], evidence_class: "verified", channel, due_in_days: 10 + i, depends_on: [1], deliverable: "Template [blank]" }));
    const [{ id }] = await q<{ id: string }>(member, "select public.save_campaign($1,$2) id", [org, JSON.stringify(promo(extra))]);
    const rows = await q<{ channel: string | null }>(owner, "select channel from public.campaign_tasks where campaign_id = $1 order by position", [id]);
    expect(rows.map((r) => r.channel)).toEqual(["landing_page", "email", null, "faq", "blog_post", "content_brief"]);
    await expect(q(member, "select public.save_campaign($1,$2)", [org, JSON.stringify(promo([{ kind: "message", title: "x", why: "w", steps: ["s"], evidence_class: "verified", channel: "podcast", deliverable: "x" }]))])).rejects.toThrow(/channel/);
  });
});

describe("rollback", () => {
  it("restores the earlier functions and removes the columns", async () => {
    await rollbackFrom(db.admin, "20261205120000");
    const cols = await db.admin.query("select count(*)::int n from information_schema.columns where table_name = 'campaign_tasks' and column_name in ('channel','depends_on','deliverable_model')");
    expect(cols.rows[0].n).toBe(0);
    // The restored save_campaign ignores the new fields and still works.
    await expect(q(member, "select public.save_campaign($1,$2)", [org, JSON.stringify(promo())])).resolves.toBeTruthy();
    await reapplyFrom(db.admin, "20261205120000");
  });
});
