import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cardStage, completionBasis } from "../../src/lib/stages";

import { setupTestDb, type TestDb } from "./harness";

let db: TestDb;
let owner: string;
let member: string;
let outsider: string;
let org: string;
let otherOrg: string;

const PERMISSION_DENIED = /permission denied/;
const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]]);

const ev = [{ key: "w", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://a.example/", observation: "No title." }];
const card = (check_key: string) => ({
  check_key, title: check_key, explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x",
  impact_priority: "high", confidence: "high", evidence_keys: ["w"],
});
const WEBSITE_OBSERVED = { website: { status: "observed" } };

async function analyze(user: string, orgId: string, keys: string[]) {
  const [{ id }] = await q<{ id: string }>(user, "select public.start_analysis($1) as id", [orgId]);
  await q(user, "select public.complete_analysis($1,$2,$3,$4,'s','template')", [id, JSON.stringify(ev), JSON.stringify(keys.map(card)), JSON.stringify(WEBSITE_OBSERVED)]);
  return id;
}
const cardsOf = (analysis: string) =>
  q<{ id: string; check_key: string; status: string; stage: string; origin: string; completion_basis: string | null }>(
    owner, "select id, check_key, status, stage, origin, completion_basis from public.action_cards where analysis_id = $1 order by check_key", [analysis]);

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
}, 60_000);
afterAll(async () => db?.teardown());

describe("action card stages", () => {
  let a1: string;

  it("new cards from website checks are 'prepared' and marked as website checks", async () => {
    a1 = await analyze(owner, org, ["a.one", "b.two", "c.three"]);
    const cards = await cardsOf(a1);
    expect(cards.map((c) => [c.stage, c.origin, c.completion_basis])).toEqual([
      ["prepared", "website_check", null], ["prepared", "website_check", null], ["prepared", "website_check", null],
    ]);
  });

  it("stage cannot be written directly", async () => {
    await expect(db.admin.query("update public.action_cards set stage = 'completed'")).rejects.toThrow(/generated|cannot be updated|can only be updated to DEFAULT/i);
    await expect(q(owner, "update public.action_cards set status = 'done'")).rejects.toThrow(PERMISSION_DENIED);
  });

  it("only the owner can approve; another tenant cannot", async () => {
    const [c] = await cardsOf(a1);
    await expect(q(member, "select public.approve_action_card($1, null)", [c!.id])).rejects.toThrow(/Only the account owner/);
    await expect(q(outsider, "select public.approve_action_card($1, null)", [c!.id])).rejects.toThrow(/Forbidden/);
    await expect(q(null, "select public.approve_action_card($1, null)", [c!.id])).rejects.toThrow(PERMISSION_DENIED);
  });

  it("approval moves a card to 'approved', not 'completed', and is logged", async () => {
    const [c] = await cardsOf(a1);
    await q(owner, "select public.approve_action_card($1, null)", [c!.id]);
    const [after] = await cardsOf(a1);
    expect([after!.status, after!.stage, after!.completion_basis]).toEqual(["approved", "approved", null]);
    await expect(q(owner, "select public.approve_action_card($1, null)", [c!.id])).rejects.toThrow(/Already approved/);
    const [log] = await q<{ n: number }>(owner, "select count(*)::int n from public.activity_log where action = 'action_card.approved' and target_id = $1", [c!.id]);
    expect(log!.n).toBe(1);
  });

  it("closed cards cannot be approved", async () => {
    const [, b] = await cardsOf(a1);
    await q(owner, "select public.set_action_card_status($1, 'dismissed', null)", [b!.id]);
    await expect(q(owner, "select public.approve_action_card($1, null)", [b!.id])).rejects.toThrow(/cannot be approved now/);
    const [, b2] = await cardsOf(a1);
    expect(b2!.stage).toBe("dismissed");
  });

  it("marking done is 'completed' on the team's report; a later check verifies it", async () => {
    const [a, , c] = await cardsOf(a1);
    await q(member, "select public.set_action_card_status($1, 'done', null)", [c!.id]);
    expect((await cardsOf(a1))[2]).toMatchObject({ stage: "completed", completion_basis: "reported" });

    // Re-check: a.one and c.three are gone. The approved card becomes completed (verified), the done one verified.
    const a2 = await analyze(owner, org, ["b.two"]);
    const [aa, , cc] = await cardsOf(a1);
    expect([aa!.id, aa!.status, aa!.stage, aa!.completion_basis]).toEqual([a!.id, "approved", "completed", "verified"]);
    expect([cc!.stage, cc!.completion_basis]).toEqual(["completed", "verified"]);
    // The re-found issue is a new prepared card, not completed.
    expect((await cardsOf(a2)).map((x) => x.stage)).toEqual(["prepared"]);
  });

  it("the database and the app agree on every status/verification combination", async () => {
    const statuses = ["new", "approved", "in_progress", "done", "failed", "dismissed"];
    const verifications = [null, "fixed", "still_found"];
    const [{ id: analysis }] = await q<{ id: string }>(owner, "select analysis_id as id from public.action_cards limit 1");
    for (const status of statuses) {
      for (const verification of verifications) {
        const { rows } = await db.admin.query<{ stage: string; completion_basis: string | null }>(
          `insert into public.action_cards (organization_id, analysis_id, check_key, title, explanation, why_it_matters,
             recommended_action, expected_benefit, impact_priority, confidence, status, verification)
           values ($1,$2,'x','x','x','x','x','x','low','low',$3,$4) returning stage, completion_basis`,
          [org, analysis, status, verification],
        );
        expect(rows[0], `${status}/${verification}`).toEqual({ stage: cardStage({ status, verification }), completion_basis: completionBasis({ status, verification }) });
      }
    }
    await db.admin.query("delete from public.action_cards where check_key = 'x'");
  });
});

describe("workflow records", () => {
  let wf: string;

  it("a member starts a workflow; a second running one of the same kind is refused", async () => {
    [{ id: wf }] = await q<{ id: string }>(member, "select public.start_marketing_workflow($1, 'website_review', 'Check my site', '{business_intelligence,website_intelligence}', null) as id", [org]);
    await expect(q(owner, "select public.start_marketing_workflow($1, 'website_review', null, '{}', null)", [org])).rejects.toThrow(/already being prepared/);
    // A different kind may run alongside.
    const [{ id: other }] = await q<{ id: string }>(owner, "select public.start_marketing_workflow($1, 'marketing_plan', null, '{}', null) as id", [org]);
    await q(owner, "select public.finish_marketing_workflow($1, 'blocked', '[]', null, 'No model provider is configured.', null, null, null)", [other]);
    const [row] = await q<{ status: string; error: string; model: string | null }>(owner, "select status, error, model from public.marketing_workflows where id = $1", [other]);
    expect(row).toEqual({ status: "blocked", error: "No model provider is configured.", model: null });
  });

  it("another tenant cannot start, finish or read it", async () => {
    await expect(q(outsider, "select public.start_marketing_workflow($1, 'website_review', null, '{}', null)", [org])).rejects.toThrow(/Forbidden/);
    await expect(q(outsider, "select public.finish_marketing_workflow($1, 'failed', '[]', null, 'x', null, null, null)", [wf])).rejects.toThrow(/Forbidden/);
    expect(await q(outsider, "select id from public.marketing_workflows")).toEqual([]);
    await expect(q(null, "select id from public.marketing_workflows")).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "insert into public.marketing_workflows (organization_id, kind) values ($1, 'website_review')", [org])).rejects.toThrow(PERMISSION_DENIED);
  });

  it("cannot attach another organization's analysis", async () => {
    const otherAnalysis = await analyze(outsider, otherOrg, ["z.one"]);
    await expect(q(owner, "select public.start_marketing_workflow($1, 'results_review', null, '{}', $2)", [org, otherAnalysis])).rejects.toThrow(/Forbidden/);
  });

  it("validates the finish payload and refuses a second finish", async () => {
    await expect(q(owner, "select public.finish_marketing_workflow($1, 'completed', '[]', '{}', null, null, null, null)", [wf])).rejects.toThrow(/Invalid status/);
    await expect(q(owner, "select public.finish_marketing_workflow($1, 'prepared', '{}', '{}', null, null, null, null)", [wf])).rejects.toThrow(/Invalid workflow payload/);
    await expect(q(owner, "select public.finish_marketing_workflow($1, 'prepared', '[]', null, null, null, null, null)", [wf])).rejects.toThrow(/needs a result/);
    const steps = [{ step: "understand_business", capability: "business_intelligence", status: "done" }];
    await q(owner, "select public.finish_marketing_workflow($1, 'prepared', $2, $3, null, null, null, null)", [wf, JSON.stringify(steps), JSON.stringify({ ranked: [] })]);
    await expect(q(owner, "select public.finish_marketing_workflow($1, 'failed', '[]', null, 'x', null, null, null)", [wf])).rejects.toThrow(/not running/);
    const [row] = await q<{ status: string; steps: unknown; capabilities: string[]; started_by: string }>(member, "select status, steps, capabilities, started_by from public.marketing_workflows where id = $1", [wf]);
    expect(row).toEqual({ status: "prepared", steps, capabilities: ["business_intelligence", "website_intelligence"], started_by: member });
  });

  it("an abandoned run times out so a new one can start", async () => {
    const [{ id }] = await q<{ id: string }>(owner, "select public.start_marketing_workflow($1, 'website_review', null, '{}', null) as id", [org]);
    await db.admin.query("update public.marketing_workflows set started_at = now() - interval '20 minutes' where id = $1", [id]);
    await q(owner, "select public.start_marketing_workflow($1, 'website_review', null, '{}', null)", [org]);
    const [row] = await q<{ status: string; error: string }>(owner, "select status, error from public.marketing_workflows where id = $1", [id]);
    expect(row).toEqual({ status: "failed", error: "Timed out" });
  });

  it("the server worker (service role) can record workflows", async () => {
    const [{ id }] = await q<{ id: string }>("service", "select public.start_marketing_workflow($1, 'results_review', null, '{}', null) as id", [otherOrg]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("rollback", () => {
  it("rolls back cleanly, keeps existing cards, and re-applies", async () => {
    const root = join(__dirname, "..", "..", "supabase");
    const [{ n: before }] = (await db.admin.query<{ n: number }>("select count(*)::int n from public.action_cards")).rows as [{ n: number }];
    // Rollbacks run newest first: the later evidence-class migration depends on action_cards.origin.
    await db.admin.query(readFileSync(join(root, "rollback", "20261127120000_business_intelligence_evidence_down.sql"), "utf8"));
    await db.admin.query(readFileSync(join(root, "rollback", "20261126120000_marketing_workflow_down.sql"), "utf8"));
    const gone = await db.admin.query(
      `select (select count(*)::int from information_schema.columns where table_name = 'action_cards' and column_name in ('stage','origin','completion_basis')) cols,
              to_regclass('public.marketing_workflows') is null tbl,
              (select count(*)::int from pg_proc where proname in ('approve_action_card','start_marketing_workflow','finish_marketing_workflow')) fns,
              (select count(*)::int from public.action_cards) cards`);
    expect(gone.rows[0]).toEqual({ cols: 0, tbl: true, fns: 0, cards: before });
    // Existing flows still work without the new objects.
    await q(owner, "select public.set_action_card_status(id, 'new', null) from public.action_cards where organization_id = $1 and status = 'dismissed'", [org]);

    await db.admin.query(readFileSync(join(root, "migrations", "20261126120000_marketing_workflow.sql"), "utf8"));
    await db.admin.query(readFileSync(join(root, "migrations", "20261127120000_business_intelligence_evidence.sql"), "utf8"));
    const back = await db.admin.query<{ stages: string[] }>("select array_agg(distinct stage order by stage) stages from public.action_cards");
    expect(back.rows[0]!.stages.every((s) => ["prepared", "approved", "completed", "dismissed"].includes(s))).toBe(true);
    const [{ n }] = (await db.admin.query<{ n: number }>("select count(*)::int n from public.action_cards where origin = 'website_check'")).rows as [{ n: number }];
    expect(n).toBe(before);
  });
});
