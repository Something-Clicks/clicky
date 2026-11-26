import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";
import { reapplyFrom, rollbackFrom } from "./migrations";

let db: TestDb;
let owner: string;
let member: string;
let outsider: string;
let org: string;
let otherOrg: string;
let cardA: string;
let otherCard: string;

const PERMISSION_DENIED = /permission denied/;
const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]]);
const ev = [{ key: "w", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://a.example/", observation: "No title." }];
const card = (check_key: string) => ({
  check_key, title: check_key, explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x",
  impact_priority: "high", confidence: "high", ai_capable: false, execution_type: "manual", approval_required: true, evidence_keys: ["w"],
});
const scan = (user: string, o: string, host: string, extra: { self?: boolean; signals?: object; status?: string } = {}) =>
  q<{ id: string }>(user, "select public.save_competitor_scan($1,$2,$3,$4,$5,null,$6) as id", [o, `https://${host}/`, host, extra.status ?? "done", JSON.stringify(extra.signals ?? { phone: true }), extra.self ?? false]);
const task = (over: Record<string, unknown> = {}) => ({ kind: "checklist", title: "t", why: "w", steps: ["s"], evidence_class: "verified", ...over });
const campaign = (tasks: object[], playbook = "p1") => ({ playbook, title: "T", goal: "g", summary: "s", basis: {}, tasks });
const save = (user: string, o: string, c: object) => q<{ id: string }>(user, "select public.save_campaign($1,$2) as id", [o, JSON.stringify(c)]);

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
  const [{ id: a1 }] = await q<{ id: string }>(owner, "select public.start_analysis($1) as id", [org]);
  await q(owner, "select public.complete_analysis($1,$2,$3,'{}','s','template')", [a1, JSON.stringify(ev), JSON.stringify([card("meta.title_missing")])]);
  [{ id: cardA }] = await q<{ id: string }>(owner, "select id from public.action_cards where analysis_id = $1", [a1]);
  const [{ id: a2 }] = await q<{ id: string }>(outsider, "select public.start_analysis($1) as id", [otherOrg]);
  await q(outsider, "select public.complete_analysis($1,$2,$3,'{}','s','template')", [a2, JSON.stringify(ev), JSON.stringify([card("meta.title_missing")])]);
  [{ id: otherCard }] = await q<{ id: string }>(outsider, "select id from public.action_cards where analysis_id = $1", [a2]);
}, 60_000);
afterAll(async () => db?.teardown());

describe("competitor scans", () => {
  it("members save and read them; outsiders can do neither; nobody writes directly", async () => {
    const [{ id }] = await scan(member, org, "rival-one.example");
    expect(await q(owner, "select 1 from public.competitor_scans where id = $1", [id])).toHaveLength(1);
    expect(await db.as(outsider, async (c) => (await c.query("select 1 from public.competitor_scans")).rows)).toHaveLength(0);
    await expect(scan(outsider, org, "x.example")).rejects.toThrow(/Forbidden/);
    await expect(q(owner, "insert into public.competitor_scans (organization_id,url,host,status) values ($1,'https://abc.example','abc.example','done')", [org])).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "select public.save_competitor_scan($1,'https://a.example/','a.example','done','{}',null,true)", [org])).resolves.toBeTruthy();
    await expect(q(outsider, "select public.remove_competitor_scan($1)", [id])).rejects.toThrow(/Forbidden/);
  });

  it("re-reading a site keeps the earlier result for before and after", async () => {
    await scan(owner, org, "rival-one.example", { signals: { phone: true, reviews: true } });
    const [r] = await q<{ signals: { reviews?: boolean }; previous_signals: { phone?: boolean } }>(owner, "select signals, previous_signals from public.competitor_scans where host = 'rival-one.example'");
    expect(r.signals.reviews).toBe(true);
    expect(r.previous_signals).toEqual({ phone: true });
  });

  it("allows 5 other sites; the business's own homepage is not counted", async () => {
    // the business's own homepage (saved above as a.example) is not counted
    for (const h of ["r2.example", "r3.example", "r4.example", "r5.example"]) await scan(owner, org, h);
    await expect(scan(owner, org, "r6.example")).rejects.toThrow(/up to 5/);
    await scan(owner, org, "r5.example"); // re-reading an existing one is fine
    const [{ id }] = await q<{ id: string }>(owner, "select id from public.competitor_scans where host = 'r5.example'");
    await q(member, "select public.remove_competitor_scan($1)", [id]);
    await expect(scan(owner, org, "r6.example")).resolves.toBeTruthy();
  });
});

describe("campaigns and tasks", () => {
  it("saves a proposal with tasks that cite real open actions of this business only", async () => {
    const [{ id }] = await save(member, org, campaign([task({ card_id: cardA, kind: "fix_action" }), task({ title: "t2" })]));
    const rows = await q<{ position: number; status: string }>(owner, "select position, status from public.campaign_tasks where campaign_id = $1 order by position", [id]);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(rows.every((r) => r.status === "prepared")).toBe(true);
    await expect(save(owner, org, campaign([task({ card_id: otherCard })]))).rejects.toThrow(/open action of this business/);
    await expect(save(owner, org, campaign([task({ card_id: "00000000-0000-0000-0000-000000000000" })]))).rejects.toThrow(/open action/);
    await expect(save(outsider, org, campaign([task()]))).rejects.toThrow(/Forbidden/);
    await expect(save(owner, org, { ...campaign([task()]), tasks: [] })).rejects.toThrow(/expected shape/);
  });

  it("inferred, estimated and unknown tasks must say what they are based on", async () => {
    await expect(save(owner, org, campaign([task({ evidence_class: "estimated" })], "p2"))).rejects.toThrow(/campaign_tasks_basis/);
    await expect(save(owner, org, campaign([task({ evidence_class: "estimated", basis: "A standard message" })], "p2"))).resolves.toBeTruthy();
    await expect(save(owner, org, campaign([task({ evidence_class: "guessed" })], "p3"))).rejects.toThrow(/check constraint/);
  });

  it("a newer proposal of the same playbook replaces the older one, not an approved one", async () => {
    const [{ id: first }] = await save(owner, org, campaign([task()], "p4"));
    const [{ id: second }] = await save(owner, org, campaign([task()], "p4"));
    const r = await q<{ id: string; status: string }>(owner, "select id, status from public.marketing_campaigns where playbook = 'p4'");
    expect(r.find((x) => x.id === first)!.status).toBe("dismissed");
    expect(r.find((x) => x.id === second)!.status).toBe("proposed");
    await q(owner, "select public.decide_campaign($1,'approved')", [second]);
    await save(owner, org, campaign([task()], "p4"));
    expect((await q<{ status: string }>(owner, "select status from public.marketing_campaigns where id = $1", [second]))[0].status).toBe("approved");
  });

  it("only the owner approves; approval is not completion; work is recorded only after approval", async () => {
    const [{ id }] = await save(owner, org, campaign([task({ deliverable: "Hi [name]" }), task({ title: "t2" })], "p5"));
    const tasks = await q<{ id: string }>(owner, "select id from public.campaign_tasks where campaign_id = $1 order by position", [id]);
    await expect(q(member, "select public.decide_campaign($1,'approved')", [id])).rejects.toThrow(/Only the account owner/);
    await expect(q(outsider, "select public.decide_campaign($1,'approved')", [id])).rejects.toThrow(/Forbidden/);
    await expect(q(member, "select public.set_task_status($1,'done',null)", [tasks[0]!.id])).rejects.toThrow(/approve the campaign first/);
    await q(owner, "select public.decide_campaign($1,'approved')", [id]);
    await expect(q(owner, "select public.decide_campaign($1,'dismissed')", [id])).rejects.toThrow(/already decided/);
    expect((await q<{ status: string }>(owner, "select status from public.campaign_tasks where id = $1", [tasks[0]!.id]))[0].status).toBe("approved");
    expect((await q<{ status: string }>(owner, "select status from public.marketing_campaigns where id = $1", [id]))[0].status).toBe("approved");

    await q(member, "select public.set_task_status($1,'done','called them')", [tasks[0]!.id]);
    expect((await q<{ status: string }>(owner, "select status from public.marketing_campaigns where id = $1", [id]))[0].status).toBe("approved");
    await q(member, "select public.set_task_status($1,'skipped',null)", [tasks[1]!.id]);
    expect((await q<{ status: string }>(owner, "select status from public.marketing_campaigns where id = $1", [id]))[0].status).toBe("completed");
    const [t] = await q<{ done_by: string; note: string }>(owner, "select done_by, note from public.campaign_tasks where id = $1", [tasks[0]!.id]);
    expect(t).toMatchObject({ done_by: member, note: "called them" });
    await expect(q(outsider, "select public.set_task_status($1,'done',null)", [tasks[0]!.id])).rejects.toThrow(/Forbidden/);
    await expect(q(owner, "select public.set_task_status($1,'finished',null)", [tasks[0]!.id])).rejects.toThrow(/Invalid status/);
  });

  it("template drafts are editable and the original is kept; tasks without a draft refuse edits", async () => {
    const [{ id }] = await save(owner, org, campaign([task({ deliverable: "Hi [name]" }), task({ title: "none" })], "p6"));
    const [a, b] = await q<{ id: string }>(owner, "select id from public.campaign_tasks where campaign_id = $1 order by position", [id]);
    await q(member, "select public.edit_task_deliverable($1,'Hello Sam')", [a.id]);
    expect((await q<{ deliverable: string; deliverable_edited: string }>(owner, "select deliverable, deliverable_edited from public.campaign_tasks where id = $1", [a.id]))[0]).toEqual({ deliverable: "Hi [name]", deliverable_edited: "Hello Sam" });
    await expect(q(owner, "select public.edit_task_deliverable($1,'x')", [b!.id])).rejects.toThrow(/no draft/);
    await expect(q(owner, "select public.edit_task_deliverable($1,'   ')", [a.id])).rejects.toThrow(/1 to 4000/);
    await expect(q(outsider, "select public.edit_task_deliverable($1,'x')", [a.id])).rejects.toThrow(/Forbidden/);
  });

  it("is isolated between businesses and cannot be written directly", async () => {
    expect(await db.as(outsider, async (c) => (await c.query("select 1 from public.marketing_campaigns where organization_id = $1", [org])).rows)).toHaveLength(0);
    expect(await db.as(outsider, async (c) => (await c.query("select 1 from public.campaign_tasks where organization_id = $1", [org])).rows)).toHaveLength(0);
    await expect(q(owner, "update public.campaign_tasks set status = 'done'")).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "insert into public.marketing_campaigns (organization_id,playbook,title,goal,summary) values ($1,'x','t','g','s')", [org])).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(null, "select public.save_campaign($1,'{}')", [org])).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe("rollback", () => {
  it("rolls back cleanly and re-applies", async () => {
    await rollbackFrom(db.admin, "20261203120000");
    const gone = await db.admin.query("select to_regclass('public.marketing_campaigns') a, to_regclass('public.competitor_scans') b, to_regclass('public.campaign_tasks') c");
    expect(gone.rows[0]).toEqual({ a: null, b: null, c: null });
    await reapplyFrom(db.admin, "20261203120000");
    expect((await db.admin.query("select to_regclass('public.marketing_campaigns') a")).rows[0].a).toBe("marketing_campaigns");
  });
});
