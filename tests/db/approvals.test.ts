import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";

let db: TestDb;
let owner: string;
let member: string;
let outsider: string;
let org: string;
let otherOrg: string;
let aiCard: string;
let manualCard: string;

const PERMISSION_DENIED = /permission denied/;
const draft = { fields: [{ key: "title", label: "Page title", text: "Drain Cleaning in Salt Lake City | Sunrise Plumbing" }] };

const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]]);

async function seedCards(user: string, orgId: string) {
  const [{ id: analysis }] = await q<{ id: string }>(user, "select public.start_analysis($1) as id", [orgId]);
  const evidence = [{ key: "e1", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://a.example/", observation: "No title." }];
  const card = (key: string, ai: boolean, type: string) => ({
    check_key: key, title: key, explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x",
    impact_priority: "high", confidence: "high", ai_capable: ai, execution_type: type, approval_required: ai, evidence_keys: ["e1"],
  });
  await q(user, "select public.complete_analysis($1,$2,$3,'{}','s','template')", [
    analysis, JSON.stringify(evidence), JSON.stringify([card("meta.title_missing", true, "meta"), card("mobile.viewport_missing", false, "manual")]),
  ]);
  const rows = await q<{ id: string; ai_capable: boolean }>(user, "select id, ai_capable from public.action_cards where analysis_id = $1", [analysis]);
  return { ai: rows.find((r) => r.ai_capable)!.id, manual: rows.find((r) => !r.ai_capable)!.id };
}

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
  ({ ai: aiCard, manual: manualCard } = await seedCards(owner, org));
}, 60_000);
afterAll(async () => db?.teardown());

describe("preparing drafts", () => {
  let run: string;

  it("refuses AI preparation for a manual task", async () => {
    await expect(q(owner, "select public.start_agent_run($1, null)", [manualCard])).rejects.toThrow(/cannot be prepared by AI/);
  });

  it("another tenant cannot start a run on this card", async () => {
    await expect(q(outsider, "select public.start_agent_run($1, null)", [aiCard])).rejects.toThrow(/Forbidden/);
  });

  it("a member can start a run; the card moves to in progress; a second run is refused", async () => {
    [{ id: run }] = await q<{ id: string }>(member, "select public.start_agent_run($1, 'Mention emergency service') as id", [aiCard]);
    const [card] = await q<{ status: string }>(owner, "select status from public.action_cards where id = $1", [aiCard]);
    expect(card!.status).toBe("in_progress");
    await expect(q(owner, "select public.start_agent_run($1, null)", [aiCard])).rejects.toThrow(/already being prepared/);
    const [r] = await q<{ permission: string; draft_type: string; instructions: string }>(owner, "select permission, draft_type, instructions from public.agent_runs where id = $1", [run]);
    expect(r).toEqual({ permission: "draft_only", draft_type: "meta", instructions: "Mention emergency service" });
  });

  it("rejects an empty or malformed draft", async () => {
    await expect(q(owner, "select public.complete_agent_run($1, $2, 'm', '{}')", [run, JSON.stringify({ fields: [] })])).rejects.toThrow(/Invalid draft/);
    await expect(q(owner, "select public.complete_agent_run($1, $2, 'm', '{}')", [run, JSON.stringify({ fields: [{ label: "x", text: "" }] })])).rejects.toThrow(/Invalid draft field/);
  });

  it("another tenant cannot complete the run", async () => {
    await expect(q(outsider, "select public.complete_agent_run($1, $2, 'm', '{}')", [run, JSON.stringify(draft)])).rejects.toThrow(/Forbidden/);
  });

  it("completing a run queues an approval and logs it", async () => {
    await q(member, "select public.complete_agent_run($1, $2, 'test-model', '{\"output_tokens\": 120}')", [run, JSON.stringify(draft)]);
    const [ap] = await q<{ decision: string }>(owner, "select decision from public.approvals where agent_run_id = $1", [run]);
    expect(ap!.decision).toBe("pending");
    await expect(q(owner, "select public.start_agent_run($1, null)", [aiCard])).rejects.toThrow(/waiting for approval/);
    const log = await q<{ action: string }>(owner, "select action from public.activity_log where organization_id = $1", [org]);
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["agent_run.started", "agent_run.succeeded"]));
  });
});

describe("approvals are owner-only and enforced in the database", () => {
  let approval: string;
  beforeAll(async () => {
    [{ id: approval }] = await q<{ id: string }>(owner, "select id from public.approvals where action_card_id = $1", [aiCard]);
  });

  it("a member cannot approve", async () => {
    await expect(q(member, "select public.decide_approval($1, 'approved', null)", [approval])).rejects.toThrow(/Only the account owner/);
  });

  it("another tenant cannot approve or even see it", async () => {
    await expect(q(outsider, "select public.decide_approval($1, 'approved', null)", [approval])).rejects.toThrow(/Forbidden/);
    expect(await q(outsider, "select * from public.approvals where id = $1", [approval])).toEqual([]);
    expect(await q(outsider, "select * from public.agent_runs where organization_id = $1", [org])).toEqual([]);
  });

  it("nobody can write approvals or runs directly", async () => {
    await expect(q(owner, "update public.approvals set decision = 'approved' where id = $1", [approval])).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "update public.agent_runs set permission = 'publish'")).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "insert into public.approvals (organization_id, agent_run_id, action_card_id) values ($1, gen_random_uuid(), $2)", [org, aiCard])).rejects.toThrow(PERMISSION_DENIED);
  });

  it("the owner approves; the card becomes approved; deciding twice is refused", async () => {
    await q(owner, "select public.decide_approval($1, 'approved', 'Looks good')", [approval]);
    const [ap] = await q<{ decision: string; decided_by: string; note: string }>(owner, "select decision, decided_by, note from public.approvals where id = $1", [approval]);
    expect(ap).toEqual({ decision: "approved", decided_by: owner, note: "Looks good" });
    const [card] = await q<{ status: string }>(owner, "select status from public.action_cards where id = $1", [aiCard]);
    expect(card!.status).toBe("approved");
    await expect(q(owner, "select public.decide_approval($1, 'rejected', null)", [approval])).rejects.toThrow(/already decided/);
  });

  it("requesting changes returns the card to new so a fresh draft can be prepared", async () => {
    const { ai } = await seedCards(owner, org);
    const [{ id: r }] = await q<{ id: string }>(owner, "select public.start_agent_run($1, null) as id", [ai]);
    const [{ id: a }] = await q<{ id: string }>(owner, "select public.complete_agent_run($1, $2, 'm', '{}') as id", [r, JSON.stringify(draft)]);
    await q(owner, "select public.decide_approval($1, 'changes_requested', 'Shorter please')", [a]);
    const [card] = await q<{ status: string }>(owner, "select status from public.action_cards where id = $1", [ai]);
    expect(card!.status).toBe("new");
    await q(owner, "select public.start_agent_run($1, 'Shorter please')", [ai]);
  });

  it("a failed run puts the card back to new and is logged", async () => {
    const { ai } = await seedCards(outsider, otherOrg);
    const [{ id: r }] = await q<{ id: string }>(outsider, "select public.start_agent_run($1, null) as id", [ai]);
    await q(outsider, "select public.fail_agent_run($1, 'model timed out')", [r]);
    const [card] = await q<{ status: string }>(outsider, "select status from public.action_cards where id = $1", [ai]);
    expect(card!.status).toBe("new");
    const [run] = await q<{ status: string; error: string }>(outsider, "select status, error from public.agent_runs where id = $1", [r]);
    expect(run).toEqual({ status: "failed", error: "model timed out" });
  });

  it("caps runs at 20 per organization per day", async () => {
    const { ai } = await seedCards(outsider, otherOrg);
    const used = (await q<{ n: number }>(outsider, "select count(*)::int as n from public.agent_runs where organization_id = $1", [otherOrg]))[0]!.n;
    for (let i = used; i < 20; i++) {
      const [{ id: r }] = await q<{ id: string }>(outsider, "select public.start_agent_run($1, null) as id", [ai]);
      await q(outsider, "select public.fail_agent_run($1, 'x')", [r]);
    }
    await expect(q(outsider, "select public.start_agent_run($1, null)", [ai])).rejects.toThrow(/Daily draft limit/);
  });

  it("admin run listing refuses non-admins", async () => {
    await expect(q(owner, "select public.admin_agent_runs()")).rejects.toThrow(/Forbidden/);
  });
});
