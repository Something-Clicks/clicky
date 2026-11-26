import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";
import { reapplyFrom, rollbackFrom } from "./migrations";

let db: TestDb;
let owner: string;
let member: string;
let outsider: string;
let org: string;
let otherOrg: string;
let a1: string;
let cardTitle: string;
let cardH1: string;
let otherCard: string;

const PERMISSION_DENIED = /permission denied/;
const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]]);
const ev = [{ key: "w", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://a.example/", observation: "No title." }];
const card = (check_key: string) => ({
  check_key, title: check_key, explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x",
  impact_priority: "high", confidence: "high", ai_capable: check_key.startsWith("meta."), execution_type: check_key.startsWith("meta.") ? "meta" : "manual",
  approval_required: true, evidence_keys: ["w"],
});
const coverage = { website: { status: "observed" } };
async function analyze(user: string, o: string, cards: unknown[]) {
  const [{ id }] = await q<{ id: string }>(user, "select public.start_analysis($1) as id", [o]);
  await q(user, "select public.complete_analysis($1,$2,$3,$4,'s','template')", [id, JSON.stringify(ev), JSON.stringify(cards), JSON.stringify(coverage)]);
  return id;
}
const kw = (term: string, over: Record<string, unknown> = {}) => ({ term, metrics: { volume: 320, position: 14 }, evidence_class: "estimated", basis: "Semrush estimate.", ...over });
const importKw = (user: string, o: string, items: unknown[], date = "2026-11-01", source = "semrush_export") =>
  q<{ n: number }>(user, "select public.import_research_items($1,$2,$3::date,$4) n", [o, source, date, JSON.stringify(items)]);
const metric = (m: string, start: string, end: string, value: number) => ({ metric: m, period_start: start, period_end: end, value });
const request = (user: string, action: string, cardId: string | null, taskId: string | null = null, key = randomUUID()) =>
  q<{ id: string }>(user, "select public.request_execution($1,$2,$3,$4,null,$5) id", [org, action, cardId, taskId, key]);

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
  a1 = await analyze(owner, org, [card("meta.title_missing"), card("content.h1_missing")]);
  const rows = await q<{ id: string; check_key: string }>(owner, "select id, check_key from public.action_cards where analysis_id = $1", [a1]);
  cardTitle = rows.find((r) => r.check_key === "meta.title_missing")!.id;
  cardH1 = rows.find((r) => r.check_key === "content.h1_missing")!.id;
  const a2 = await analyze(outsider, otherOrg, [card("meta.title_missing")]);
  [{ id: otherCard }] = await q<{ id: string }>(outsider, "select id from public.action_cards where analysis_id = $1", [a2]);
}, 60_000);
afterAll(async () => db?.teardown());

describe("research library", () => {
  it("members import keyword rows with source, measured date, evidence class and basis; outsiders cannot", async () => {
    const [{ n }] = await importKw(member, org, [kw("emergency plumber dallas"), kw("water heater repair", { evidence_class: "verified", basis: null })]);
    expect(n).toBe(2);
    const rows = await q<{ term: string; source: string; measured_on: Date; evidence_class: string }>(owner, "select term, source, measured_on, evidence_class from public.research_items order by term");
    expect(rows.map((r) => [r.term, r.source, r.evidence_class])).toEqual([["emergency plumber dallas", "semrush_export", "estimated"], ["water heater repair", "semrush_export", "verified"]]);
    await expect(importKw(outsider, org, [kw("x")])).rejects.toThrow(/Forbidden/);
    expect(await q(outsider, "select 1 from public.research_items")).toHaveLength(0);
    await expect(q(owner, "insert into public.research_items (organization_id,source,term,evidence_class,measured_on) values ($1,'owner','x','verified',current_date)", [org])).rejects.toThrow(PERMISSION_DENIED);
  });

  it("refuses unsupported shapes: no basis for an estimate, future dates, unknown sources", async () => {
    await expect(importKw(owner, org, [kw("y", { basis: "" })])).rejects.toThrow(/expected shape/);
    await expect(importKw(owner, org, [kw("y")], "2999-01-01")).rejects.toThrow(/future/);
    await expect(importKw(owner, org, [kw("y")], "2026-11-01", "scraped")).rejects.toThrow(/Unknown research source/);
    await expect(importKw(owner, org, [])).rejects.toThrow(/between 1 and 500/);
  });

  it("re-importing newer data keeps the earlier figures; an older export never overwrites newer ones", async () => {
    await importKw(owner, org, [kw("Emergency Plumber Dallas", { metrics: { volume: 400, position: 9 } })], "2026-11-20");
    const [r] = await q<{ metrics: { position: number }; previous_metrics: { position: number } }>(owner, "select metrics, previous_metrics from public.research_items where lower(term) = 'emergency plumber dallas'");
    expect(r.metrics.position).toBe(9);
    expect(r.previous_metrics.position).toBe(14);
    const [{ n }] = await importKw(owner, org, [kw("emergency plumber dallas", { metrics: { volume: 1, position: 99 } })], "2026-10-01");
    expect(n).toBe(0);
    const [again] = await q<{ metrics: { position: number } }>(owner, "select metrics from public.research_items where lower(term) = 'emergency plumber dallas'");
    expect(again.metrics.position).toBe(9);
  });

  it("members remove items of their own business only", async () => {
    const [{ id }] = await q<{ id: string }>(owner, "select id from public.research_items where term = 'water heater repair'");
    await expect(q(outsider, "select public.remove_research_item($1)", [id])).rejects.toThrow(/Forbidden/);
    await q(member, "select public.remove_research_item($1)", [id]);
    expect(await q(owner, "select 1 from public.research_items where id = $1", [id])).toHaveLength(0);
  });
});

describe("performance history", () => {
  it("stores supplied figures per period and source; a re-entry corrects the value", async () => {
    const [{ n }] = await q<{ n: number }>(member, "select public.record_performance_metrics($1,'owner_entered',$2) n", [org, JSON.stringify([
      metric("calls", "2026-09-01", "2026-09-30", 41), metric("calls", "2026-10-01", "2026-10-31", 52),
    ])]);
    expect(n).toBe(2);
    await q(owner, "select public.record_performance_metrics($1,'owner_entered',$2)", [org, JSON.stringify([metric("calls", "2026-10-01", "2026-10-31", 50)])]);
    const rows = await q<{ value: string }>(owner, "select value from public.performance_metrics where metric = 'calls' order by period_start");
    expect(rows.map((r) => Number(r.value))).toEqual([41, 50]);
  });

  it("refuses future periods, unknown metrics, negative values and outsiders", async () => {
    const rec = (user: string, rows: unknown[], source = "owner_entered") => q(user, "select public.record_performance_metrics($1,$2,$3)", [org, source, JSON.stringify(rows)]);
    await expect(rec(owner, [metric("calls", "2026-11-01", "2999-01-01", 1)])).rejects.toThrow(/future/);
    await expect(rec(owner, [metric("revenue_guess", "2026-09-01", "2026-09-30", 1)])).rejects.toThrow(/check constraint/);
    await expect(rec(owner, [metric("calls", "2026-09-01", "2026-09-30", -1)])).rejects.toThrow(/check constraint/);
    await expect(rec(owner, [{ metric: "calls", period_start: "2026-09-01", period_end: "2026-09-30", value: "12" }])).rejects.toThrow(/needs a number/);
    await expect(rec(owner, [metric("calls", "2026-09-01", "2026-09-30", 1)], "model")).rejects.toThrow(/Unknown source/);
    await expect(rec(outsider, [metric("calls", "2026-09-01", "2026-09-30", 1)])).rejects.toThrow(/Forbidden/);
    expect(await q(outsider, "select 1 from public.performance_metrics")).toHaveLength(0);
  });
});

describe("execution records: requested, authorized, executed and verified are separate events", () => {
  it("an unsupported action is recorded as unsupported and can never be authorized or executed", async () => {
    const [{ id }] = await request(member, "publish_website", cardTitle);
    const [r] = await q<{ status: string; error: string }>(owner, "select status, error from public.execution_records where id = $1", [id]);
    expect(r.status).toBe("unsupported");
    expect(r.error).toMatch(/No authorized integration/);
    await expect(q(owner, "select public.authorize_execution($1)", [id])).rejects.toThrow(/not waiting/);
    await expect(q(owner, "select public.execute_authorized($1)", [id])).rejects.toThrow(/Only an authorized/);
  });

  it("saving to the workspace needs an approved draft first", async () => {
    await expect(request(member, "save_to_workspace", cardTitle)).rejects.toThrow(/Approve a draft first/);
  });

  it("save_to_workspace: member requests, only the owner authorizes, then it runs once with the approved version copied", async () => {
    const [{ id: run }] = await q<{ id: string }>(owner, "select public.start_agent_run($1,'') id", [cardTitle]);
    await db.admin.query("update public.agent_runs set status = 'succeeded', output = $2 where id = $1", [run, JSON.stringify({ fields: [{ key: "title", label: "Title", text: "Sunrise Plumbing | Dallas" }] })]);
    const { rows: [ap] } = await db.admin.query<{ id: string }>("insert into public.approvals (organization_id, agent_run_id, action_card_id) values ($1,$2,$3) returning id", [org, run, cardTitle]);
    const [{ id: v1 }] = await q<{ id: string }>(owner, "select id from public.draft_versions where approval_id = $1", [ap!.id]);
    await q(owner, "select public.approve_draft_version($1,$2)", [ap!.id, v1]);

    const key = randomUUID();
    const [{ id }] = await request(member, "save_to_workspace", cardTitle, null, key);
    const [{ id: same }] = await request(member, "save_to_workspace", cardTitle, null, key);
    expect(same).toBe(id); // a retry with the same key is the same request
    await expect(request(member, "save_to_workspace", cardTitle)).rejects.toThrow(/already waiting/); // no duplicate open request

    await expect(q(member, "select public.execute_authorized($1)", [id])).rejects.toThrow(/Only an authorized/);
    await expect(q(member, "select public.authorize_execution($1)", [id])).rejects.toThrow(/Only the account owner/);
    await expect(q(outsider, "select public.authorize_execution($1)", [id])).rejects.toThrow(/Forbidden/);
    await q(owner, "select public.authorize_execution($1)", [id]);
    const [{ s }] = await q<{ s: string }>(member, "select public.execute_authorized($1) s", [id]);
    expect(s).toBe("succeeded");
    await expect(q(member, "select public.execute_authorized($1)", [id])).rejects.toThrow(/Only an authorized/); // runs once

    // Later edits to the draft do not change what was executed.
    const [r] = await q<{ status: string; integration: string; draft_version_id: string; deliverable: { fields: { text: string }[] }; requested_by: string; authorized_by: string; executed_at: Date }>(owner,
      "select status, integration, draft_version_id, deliverable, requested_by, authorized_by, executed_at from public.execution_records where id = $1", [id]);
    expect(r).toMatchObject({ status: "succeeded", integration: "workspace", draft_version_id: v1, requested_by: member, authorized_by: owner });
    expect(r.deliverable.fields[0]!.text).toBe("Sunrise Plumbing | Dallas");
    expect(r.executed_at).toBeTruthy();
  });

  it("record_completed marks the work done as reported; the next website check verifies it", async () => {
    const [{ id }] = await request(member, "record_completed", cardH1);
    await q(owner, "select public.authorize_execution($1)", [id]);
    await q(member, "select public.execute_authorized($1)", [id]);
    const [c] = await q<{ status: string; completion_basis: string }>(owner, "select status, completion_basis from public.action_cards where id = $1", [cardH1]);
    expect(c).toEqual({ status: "done", completion_basis: "reported" });
    expect((await q<{ verification: string | null }>(owner, "select verification from public.execution_records where id = $1", [id]))[0].verification).toBeNull();

    // A new check no longer finds the missing H1 (still finds the title): the recorded work is verified.
    await analyze(owner, org, [card("meta.title_missing")]);
    const [r] = await q<{ verification: string; verified_at: Date }>(owner, "select verification, verified_at from public.execution_records where id = $1", [id]);
    expect(r.verification).toBe("verified");
    expect(r.verified_at).toBeTruthy();
  });

  it("isolation: no requests against another business's actions; nobody writes the table directly", async () => {
    await expect(q(member, "select public.request_execution($1,'record_completed',$2,null,null,$3)", [org, otherCard, randomUUID()])).rejects.toThrow(/Forbidden/);
    await expect(q(outsider, "select public.request_execution($1,'record_completed',$2,null,null,$3)", [org, cardTitle, randomUUID()])).rejects.toThrow(/Forbidden/);
    expect(await q(outsider, "select 1 from public.execution_records where organization_id = $1", [org])).toHaveLength(0);
    await expect(q(owner, "insert into public.execution_records (organization_id,action,card_id,status,idempotency_key) values ($1,'record_completed',$2,'succeeded','abcdefgh12')", [org, cardTitle])).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "update public.execution_records set status = 'succeeded'")).rejects.toThrow(PERMISSION_DENIED);
  });

  it("a request can be cancelled before it runs", async () => {
    const [{ id: a }] = await q<{ id: string }>(owner, "select public.start_analysis($1) as id", [org]);
    await q(owner, "select public.complete_analysis($1,$2,$3,$4,'s','template')", [a, JSON.stringify(ev), JSON.stringify([card("local.service_area_missing")]), JSON.stringify(coverage)]);
    const [{ id: cardId }] = await q<{ id: string }>(owner, "select id from public.action_cards where analysis_id = $1", [a]);
    const [{ id }] = await request(member, "record_completed", cardId);
    await q(member, "select public.cancel_execution($1)", [id]);
    await expect(q(owner, "select public.authorize_execution($1)", [id])).rejects.toThrow(/not waiting/);
    await expect(request(member, "record_completed", cardId)).resolves.toBeTruthy(); // a new request is allowed again
  });
});

describe("action card effort and dependencies", () => {
  it("are set by check on this analysis's cards and resolve only to cards of the same analysis", async () => {
    const [{ n }] = await q<{ n: number }>(member, "select public.annotate_action_cards($1,$2) n", [a1, JSON.stringify([
      { check_key: "meta.title_missing", effort: "small", depends_on: [] },
      { check_key: "content.h1_missing", effort: "small", depends_on: ["meta.title_missing", "content.h1_missing", "pagespeed.performance"] },
    ])]);
    expect(n).toBe(2);
    const [c] = await q<{ effort: string; depends_on: string[] }>(owner, "select effort, depends_on from public.action_cards where id = $1", [cardH1]);
    // itself and a check that did not fire are ignored
    expect(c).toEqual({ effort: "small", depends_on: [cardTitle] });
    await expect(q(member, "select public.annotate_action_cards($1,$2)", [a1, JSON.stringify([{ check_key: "content.h1_missing", effort: "huge" }])])).rejects.toThrow(/Invalid annotation/);
    await expect(q(member, "select public.annotate_action_cards($1,$2)", [a1, JSON.stringify([{ check_key: "content.h1_missing", depends_on: "x" }])])).rejects.toThrow(/Invalid annotation/);
    await expect(q(outsider, "select public.annotate_action_cards($1,'[]')", [a1])).rejects.toThrow(/Forbidden/);
    // The other business's card is never reachable: it is in a different analysis.
    const [other] = await q<{ depends_on: string[] }>(outsider, "select depends_on from public.action_cards where id = $1", [otherCard]);
    expect(other.depends_on).toEqual([]);
  });
});

describe("rollback", () => {
  it("removes everything and re-applies cleanly", async () => {
    await rollbackFrom(db.admin, "20261204120000");
    const gone = await db.admin.query("select to_regclass('public.research_items') a, to_regclass('public.performance_metrics') b, to_regclass('public.execution_records') c, (select count(*)::int from information_schema.columns where table_name = 'action_cards' and column_name in ('effort','depends_on')) cols");
    expect(gone.rows[0]).toEqual({ a: null, b: null, c: null, cols: 0 });
    await reapplyFrom(db.admin, "20261204120000");
    expect((await db.admin.query("select to_regclass('public.execution_records') a")).rows[0].a).toBe("execution_records");
  });
});
