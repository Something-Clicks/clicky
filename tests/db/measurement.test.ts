import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

const ev = [
  { key: "w", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://a.example/", observation: "No title." },
  { key: "p", source: "pagespeed", kind: "measured", check_key: "pagespeed.performance", url: "https://a.example/", observation: "Score 41.", measurement: { score: 41 } },
];
const card = (check_key: string, keys: string[]) => ({
  check_key, title: check_key, explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x",
  impact_priority: "high", confidence: "high", evidence_keys: keys,
});

async function analyze(user: string, orgId: string, cards: unknown[], coverage: Record<string, unknown>, evidence = ev) {
  const [{ id }] = await q<{ id: string }>(user, "select public.start_analysis($1) as id", [orgId]);
  await q(user, "select public.complete_analysis($1,$2,$3,$4,'s','template')", [id, JSON.stringify(evidence), JSON.stringify(cards), JSON.stringify(coverage)]);
  return id;
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
  await db.grantPlan(otherOrg, "starter_ai");
}, 60_000);
afterAll(async () => db?.teardown());

describe("outcomes are verified only from comparable, checked data", () => {
  let titleCard: string;
  let speedCard: string;

  beforeAll(async () => {
    const a1 = await analyze(owner, org, [card("meta.title_missing", ["w"]), card("pagespeed.performance", ["p"])], { website: { status: "observed" }, pagespeed: { status: "measured" } });
    const rows = await q<{ id: string; check_key: string }>(owner, "select id, check_key from public.action_cards where analysis_id = $1", [a1]);
    titleCard = rows.find((r) => r.check_key === "meta.title_missing")!.id;
    speedCard = rows.find((r) => r.check_key === "pagespeed.performance")!.id;
    await q(owner, "select public.set_action_card_status($1,'done',null)", [titleCard]);
    await q(owner, "select public.set_action_card_status($1,'done',null)", [speedCard]);
  });

  it("says nothing when the source was not checked this time", async () => {
    // PageSpeed missing; website observed; title check gone → title fixed, speed unverified.
    await analyze(owner, org, [], { website: { status: "observed" }, pagespeed: { status: "missing" } }, [ev[0]!]);
    const rows = await q<{ id: string; verification: string | null }>(owner, "select id, verification from public.action_cards where id in ($1,$2)", [titleCard, speedCard]);
    expect(rows.find((r) => r.id === titleCard)!.verification).toBe("fixed");
    expect(rows.find((r) => r.id === speedCard)!.verification).toBeNull();
  });

  it("marks still found when the same check fires again, and logs the change", async () => {
    await analyze(owner, org, [card("pagespeed.performance", ["p"])], { website: { status: "observed" }, pagespeed: { status: "measured" } });
    const [row] = await q<{ verification: string }>(owner, "select verification from public.action_cards where id = $1", [speedCard]);
    expect(row.verification).toBe("still_found");
    const log = await q<{ action: string }>(owner, "select action from public.activity_log where organization_id = $1 and action like 'outcome.%'", [org]);
    expect(log.map((l) => l.action).sort()).toEqual(["outcome.fixed", "outcome.still_found"]);
  });

  it("other tenants cannot see outcomes", async () => {
    expect(await q(outsider, "select * from public.action_cards where id = $1", [titleCard])).toEqual([]);
  });
});

describe("weekly re-analysis worker (service role)", () => {
  it("only the service role can list due organizations", async () => {
    await expect(q(owner, "select * from public.worker_due_organizations(5)")).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(null, "select * from public.worker_due_organizations(5)")).rejects.toThrow(PERMISSION_DENIED);
  });

  it("lists organizations whose last analysis is older than 7 days and that opted in", async () => {
    await analyze(outsider, otherOrg, [], { website: { status: "observed" } }, [ev[0]!]);
    await db.admin.query("update public.analyses set started_at = now() - interval '8 days' where organization_id = $1", [otherOrg]);
    const due = await q<{ organization_id: string }>("service", "select organization_id from public.worker_due_organizations(10)");
    expect(due.map((d) => d.organization_id)).toContain(otherOrg);
    expect(due.map((d) => d.organization_id)).not.toContain(org); // analyzed today
    await q(outsider, "update public.organizations set recurring_analysis = false where id = $1", [otherOrg]);
    const after = await q<{ organization_id: string }>("service", "select organization_id from public.worker_due_organizations(10)");
    expect(after.map((d) => d.organization_id)).not.toContain(otherOrg);
    await q(outsider, "update public.organizations set recurring_analysis = true where id = $1", [otherOrg]);
  });

  it("the worker can run a scheduled analysis end to end, logged as scheduled", async () => {
    const [{ id }] = await q<{ id: string }>("service", "select public.start_analysis($1) as id", [otherOrg]);
    await q("service", "select public.complete_analysis($1,$2,'[]','{}','s','template')", [id, JSON.stringify([ev[0]])]);
    const [a] = await q<{ status: string; triggered_by: string | null }>(outsider, "select status, triggered_by from public.analyses where id = $1", [id]);
    expect(a).toEqual({ status: "complete", triggered_by: null });
    const [log] = await q<{ metadata: unknown }>(outsider, "select metadata from public.activity_log where target_id = $1 and action = 'analysis.started'", [id]);
    expect(log.metadata).toEqual({ scheduled: true });
  });

  it("a member cannot turn off another business's recurring analysis; members of the business cannot either unless owner", async () => {
    const r1 = await db.as(outsider, (c) => c.query("update public.organizations set recurring_analysis = false where id = $1", [org]));
    const r2 = await db.as(member, (c) => c.query("update public.organizations set recurring_analysis = false where id = $1", [org]));
    expect([r1.rowCount, r2.rowCount]).toEqual([0, 0]);
  });
});

describe("notifications", () => {
  it("preferences are per person and private", async () => {
    await q(member, "insert into public.notification_preferences (user_id, analysis_complete) values ($1, false)", [member]);
    await expect(q(member, "insert into public.notification_preferences (user_id) values ($1)", [owner])).rejects.toThrow(/row-level security/);
    expect(await q(owner, "select * from public.notification_preferences where user_id = $1", [member])).toEqual([]);
  });

  it("recipients respect opt-outs; drafts go to owners only", async () => {
    const analysis = await q<{ user_id: string }>(owner, "select user_id from public.notification_recipients($1,'analysis_complete')", [org]);
    expect(analysis.map((r) => r.user_id)).toEqual([owner]); // member opted out
    const drafts = await q<{ user_id: string; email: string }>(owner, "select user_id, email from public.notification_recipients($1,'draft_ready')", [org]);
    expect(drafts.map((r) => r.user_id)).toEqual([owner]);
    expect(drafts[0].email).toMatch(/@example\.test$/);
  });

  it("other tenants cannot read recipients or log notifications for this business", async () => {
    await expect(q(outsider, "select * from public.notification_recipients($1,'draft_ready')", [org])).rejects.toThrow(/Forbidden/);
    await expect(q(outsider, "select public.log_notification($1,$2,'draft_ready','sent',null)", [org, owner])).rejects.toThrow(/Forbidden/);
  });

  it("logs a notification and only the recipient can read it", async () => {
    await q(owner, "select public.log_notification($1,$2,'analysis_complete','skipped','Email not configured')", [org, owner]);
    expect((await q(owner, "select status from public.notifications")).map((r) => r.status)).toEqual(["skipped"]);
    expect(await q(member, "select * from public.notifications")).toEqual([]);
    await expect(q(owner, "insert into public.notifications (organization_id, user_id, kind, status) values ($1,$2,'draft_ready','sent')", [org, owner])).rejects.toThrow(PERMISSION_DENIED);
  });
});
