import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";

let db: TestDb;
let alice: string;
let bob: string;
let orgA: string;
let orgB: string;

const PERMISSION_DENIED = /permission denied/;

const evidence = [
  { key: "e1", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://a.example/", observation: "The homepage has no page title." },
  { key: "e2", source: "pagespeed", kind: "measured", check_key: "pagespeed.performance", url: "https://a.example/", observation: "Mobile performance score 41/100.", measurement: { score: 41 } },
];
const card = (keys: string[]) => ({
  check_key: "meta.title_missing",
  title: "Add a page title",
  explanation: "Your homepage has no title.",
  why_it_matters: "Search results show the title first.",
  recommended_action: "Write a title that names your main service and area.",
  expected_benefit: "People can tell what your page is about before they click.",
  impact_priority: "high",
  confidence: "high",
  ai_capable: true,
  execution_type: "meta",
  approval_required: true,
  evidence_keys: keys,
});

async function createOrg(user: string, name: string, website: string | null = "https://a.example") {
  return db.as(user, async (c) => (await c.query<{ id: string }>("select public.create_organization($1,$2,'','') as id", [name, website ?? ""])).rows[0]!.id);
}
const start = (user: string, org: string) =>
  db.as(user, async (c) => (await c.query<{ id: string }>("select public.start_analysis($1) as id", [org])).rows[0]!.id);
const complete = (user: string, analysis: string, cards: unknown[] = [card(["e1", "e2"])]) =>
  db.as(user, (c) =>
    c.query("select public.complete_analysis($1,$2,$3,$4,$5,$6)", [
      analysis, JSON.stringify(evidence), JSON.stringify(cards), JSON.stringify({ website: "observed" }), "Summary", "template",
    ]),
  );

beforeAll(async () => {
  db = await setupTestDb();
  alice = await db.createUser("Alice");
  bob = await db.createUser("Bob");
  orgA = await createOrg(alice, "Alpha");
  orgB = await createOrg(bob, "Bravo", "https://b.example");
  await db.grantPlan(orgA);
  await db.grantPlan(orgB);
}, 60_000);
afterAll(async () => db?.teardown());

describe("analysis lifecycle", () => {
  let analysisA: string;

  it("a member starts an analysis; a second concurrent start is refused", async () => {
    analysisA = await start(alice, orgA);
    await expect(start(alice, orgA)).rejects.toThrow(/already running/);
  });

  it("another tenant cannot start, complete or fail it", async () => {
    await expect(start(bob, orgA)).rejects.toThrow(/Forbidden/);
    await expect(complete(bob, analysisA)).rejects.toThrow(/Forbidden/);
    await expect(db.as(bob, (c) => c.query("select public.fail_analysis($1,'x')", [analysisA]))).rejects.toThrow(/Forbidden/);
  });

  it("refuses a card that cites no evidence from this analysis", async () => {
    await expect(complete(alice, analysisA, [card(["nope"])])).rejects.toThrow(/must cite evidence/);
  });

  it("saves evidence and cards linked to their evidence, and logs it", async () => {
    await complete(alice, analysisA);
    const r = await db.as(alice, async (c) => ({
      analysis: (await c.query("select status, summary from public.analyses where id = $1", [analysisA])).rows[0],
      cards: (await c.query("select id, status, title from public.action_cards where analysis_id = $1", [analysisA])).rows,
      links: (await c.query("select count(*)::int as n from public.action_card_evidence")).rows[0].n,
      evidence: (await c.query("select kind from public.analysis_evidence where analysis_id = $1 order by kind", [analysisA])).rows,
      website: (await c.query("select status from public.data_connections where provider = 'website'")).rows,
      log: (await c.query("select action from public.activity_log where organization_id = $1 order by created_at", [orgA])).rows.map((x) => x.action),
    }));
    expect(r.analysis).toEqual({ status: "complete", summary: "Summary" });
    expect(r.cards).toHaveLength(1);
    expect(r.links).toBe(2);
    expect(r.evidence.map((e: { kind: string }) => e.kind)).toEqual(["measured", "observed"]);
    expect(r.website).toEqual([{ status: "connected" }]);
    expect(r.log).toEqual(expect.arrayContaining(["analysis.started", "analysis.completed"]));
  });

  it("cannot complete an analysis twice", async () => {
    await expect(complete(alice, analysisA)).rejects.toThrow(/not running/);
  });

  it("a newer analysis dismisses untouched cards from the older one", async () => {
    const second = await start(alice, orgA);
    await complete(alice, second);
    const { rows } = await db.as(alice, (c) =>
      c.query("select analysis_id, status from public.action_cards where organization_id = $1 order by created_at", [orgA]),
    );
    expect(rows.map((x) => x.status)).toEqual(["dismissed", "new"]);
  });

  it("refuses to start without a website", async () => {
    const carol = await db.createUser("Carol");
    const orgC = await createOrg(carol, "NoSite", null);
    await db.grantPlan(orgC);
    await expect(start(carol, orgC)).rejects.toThrow(/Add a website first/);
  });

  it("limits each organization to 10 analyses a day", async () => {
    for (let i = 0; i < 8; i++) {
      const id = await start(bob, orgB);
      await db.as(bob, (c) => c.query("select public.fail_analysis($1, 'test')", [id]));
    }
    // 8 so far for Bravo; 2 more allowed.
    for (let i = 0; i < 2; i++) {
      const id = await start(bob, orgB);
      await db.as(bob, (c) => c.query("select public.fail_analysis($1, 'test')", [id]));
    }
    await expect(start(bob, orgB)).rejects.toThrow(/Daily analysis limit/);
  });
});

describe("Customer B cannot read or change Customer A's intelligence data", () => {
  for (const table of ["analyses", "analysis_evidence", "action_cards", "action_card_evidence", "data_connections"]) {
    it(`${table}: B sees none of A's rows; nobody can write directly`, async () => {
      const own = await db.as(alice, (c) => c.query(`select * from public.${table} where organization_id = $1`, [orgA]));
      const other = await db.as(bob, (c) => c.query(`select * from public.${table} where organization_id = $1`, [orgA]));
      expect(own.rowCount).toBeGreaterThan(0);
      expect(other.rowCount).toBe(0);
      await expect(db.as(alice, (c) => c.query(`delete from public.${table} where organization_id = $1`, [orgA]))).rejects.toThrow(PERMISSION_DENIED);
      await expect(db.as(alice, (c) => c.query(`update public.${table} set organization_id = organization_id`))).rejects.toThrow(PERMISSION_DENIED);
    });
  }

  it("B cannot change the status of A's card; A can, and it is logged", async () => {
    const { rows } = await db.as(alice, (c) => c.query("select id from public.action_cards where organization_id = $1 and status = 'new'", [orgA]));
    const id = rows[0]!.id;
    await expect(db.as(bob, (c) => c.query("select public.set_action_card_status($1,'done',null)", [id]))).rejects.toThrow(/Forbidden/);
    await db.as(alice, (c) => c.query("select public.set_action_card_status($1,'done','Fixed the title')", [id]));
    const after = await db.admin.query("select status, result_summary, completed_at is not null as done from public.action_cards where id = $1", [id]);
    expect(after.rows[0]).toEqual({ status: "done", result_summary: "Fixed the title", done: true });
    await expect(db.as(alice, (c) => c.query("select public.set_action_card_status($1,'approved',null)", [id]))).rejects.toThrow(/Invalid status/);
  });

  it("anonymous visitors cannot call the analysis functions", async () => {
    await expect(db.as(null, (c) => c.query("select public.start_analysis($1)", [orgA]))).rejects.toThrow(PERMISSION_DENIED);
  });
});
