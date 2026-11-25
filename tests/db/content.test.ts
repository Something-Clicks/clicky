import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";

let db: TestDb;
let owner: string;
let member: string;
let outsider: string;
let org: string;

const PERMISSION_DENIED = /permission denied/;
const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]]);

const ev = [{ key: "w", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://a.example/", observation: "No title." }];
const checkCard = (check_key: string) => ({
  check_key, title: check_key, explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x",
  impact_priority: "high", confidence: "high", ai_capable: check_key.startsWith("meta."), execution_type: check_key.startsWith("meta.") ? "meta" : "manual",
  approval_required: true, evidence_keys: ["w"],
});
const quotes = [{ key: "q1", url: "https://a.example/", excerpt: "We fix pipes.", observation: "Homepage headline." }];
const modelCard = (over: Record<string, unknown> = {}) => ({
  check_key: "model.headline_unclear", title: "Say what you do in your headline", explanation: "x", why_it_matters: "x", recommended_action: "x",
  expected_benefit: "x", impact_priority: "high", confidence: "medium", evidence_class: "inferred",
  evidence_basis: "The headline names no service.", ai_capable: true, execution_type: "page_copy", evidence_keys: ["q1"], ...over,
});

async function analyze(cards: unknown[]) {
  const [{ id }] = await q<{ id: string }>(owner, "select public.start_analysis($1) as id", [org]);
  await q(owner, "select public.complete_analysis($1,$2,$3,$4,'s','template')", [id, JSON.stringify(ev), JSON.stringify(cards), JSON.stringify({ website: { status: "observed" } })]);
  return id;
}

beforeAll(async () => {
  db = await setupTestDb();
  owner = await db.createUser("Owner");
  member = await db.createUser("Member");
  outsider = await db.createUser("Outsider");
  [{ id: org }] = await q<{ id: string }>(owner, "select public.create_organization('Sunrise','https://a.example','','') as id");
  await q<{ id: string }>(outsider, "select public.create_organization('Other','https://b.example','','') as id");
  await db.admin.query("insert into public.organization_members values ($1,$2,'member',now())", [org, member]);
  await db.grantPlan(org);
}, 60_000);
afterAll(async () => db?.teardown());

describe("model findings (Marketing Analysis, origin 'model')", () => {
  let a1: string;

  it("are added to a just-finished analysis with their quoted evidence and class", async () => {
    a1 = await analyze([checkCard("meta.title_missing")]);
    const [{ n }] = await q<{ n: number }>(member, "select public.add_model_findings($1,$2,$3) n", [a1, JSON.stringify(quotes), JSON.stringify([modelCard()])]);
    expect(n).toBe(1);
    const [c] = await q<{ origin: string; evidence_class: string; evidence_basis: string; stage: string; wording: string }>(owner,
      "select origin, evidence_class, evidence_basis, stage, wording from public.action_cards where analysis_id = $1 and origin = 'model'", [a1]);
    expect(c).toEqual({ origin: "model", evidence_class: "inferred", evidence_basis: "The headline names no service.", stage: "prepared", wording: "ai" });
    const [e] = await q<{ kind: string; excerpt: string }>(owner,
      "select e.kind, e.excerpt from public.action_card_evidence ace join public.analysis_evidence e on e.id = ace.evidence_id join public.action_cards c on c.id = ace.action_card_id where c.analysis_id = $1 and c.origin = 'model'", [a1]);
    expect(e).toEqual({ kind: "observed", excerpt: "We fix pipes." });
  });

  it("only once per analysis, only by members of the business", async () => {
    await expect(q(member, "select public.add_model_findings($1,$2,$3)", [a1, JSON.stringify(quotes), JSON.stringify([modelCard()])])).rejects.toThrow(/already added/);
    await expect(q(outsider, "select public.add_model_findings($1,'[]','[]')", [a1])).rejects.toThrow(/Forbidden/);
    await expect(q(null, "select public.add_model_findings($1,'[]','[]')", [a1])).rejects.toThrow(PERMISSION_DENIED);
  });

  it("refuse findings without valid evidence, unknown classes, bad keys, or old analyses", async () => {
    const a = await analyze([checkCard("meta.title_missing")]);
    const add = (cards: unknown[], evidence: unknown[] = quotes) => q(member, "select public.add_model_findings($1,$2,$3)", [a, JSON.stringify(evidence), JSON.stringify(cards)]);
    await expect(add([modelCard({ evidence_class: "unknown" })])).rejects.toThrow(/needs evidence/);
    await expect(add([modelCard({ evidence_class: "verified", evidence_keys: [] })])).rejects.toThrow(/must cite observed or measured/);
    await expect(add([modelCard({ evidence_basis: "" })])).rejects.toThrow(/inferred finding must cite evidence and state its basis/);
    await expect(add([modelCard({ evidence_keys: ["nope"] })])).rejects.toThrow(/not supplied/);
    await expect(add([modelCard({ check_key: "meta.title_missing" })])).rejects.toThrow(/model\.\* keys/);
    await db.admin.query("update public.analyses set completed_at = now() - interval '2 hours' where id = $1", [a]);
    await expect(add([modelCard()])).rejects.toThrow(/just finished/);
  });
});

describe("outcome verification ignores model findings", () => {
  it("an approved model finding is not marked fixed just because the next analysis didn't repeat it", async () => {
    const a = await analyze([checkCard("meta.description_missing")]);
    await q(member, "select public.add_model_findings($1,$2,$3)", [a, JSON.stringify(quotes), JSON.stringify([modelCard({ check_key: "model.cta_unclear" })])]);
    const cards = await q<{ id: string; origin: string }>(owner, "select id, origin from public.action_cards where analysis_id = $1", [a]);
    for (const c of cards) await q(owner, "select public.approve_action_card($1, null)", [c.id]);
    await analyze([]); // neither finding appears again
    const after = await q<{ origin: string; verification: string | null; stage: string }>(owner,
      "select origin, verification, stage from public.action_cards where analysis_id = $1 order by origin", [a]);
    expect(after).toEqual([
      { origin: "model", verification: null, stage: "approved" },
      { origin: "website_check", verification: "fixed", stage: "completed" },
    ]);
  });
});

describe("draft versions and owner approval", () => {
  let card: string;
  let approval: string;
  const draft = { fields: [{ key: "page_title", label: "Page title", text: "Drain Cleaning | Sunrise" }, { key: "meta_description", label: "Meta description", text: "Fast drain cleaning." }] };

  it("a prepared draft starts as version 1 from the model", async () => {
    const a = await analyze([checkCard("meta.title_missing")]);
    [{ id: card }] = await q<{ id: string }>(owner, "select id from public.action_cards where analysis_id = $1 and check_key = 'meta.title_missing'", [a]);
    const [{ id: run }] = await q<{ id: string }>(member, "select public.start_agent_run($1, null) as id", [card]);
    [{ id: approval }] = await q<{ id: string }>(member, "select public.complete_agent_run($1,$2,'dev-model','{}') as id", [run, JSON.stringify(draft)]);
    const v = await q<{ version: number; source: string; fields: unknown; created_by: string }>(owner, "select version, source, fields, created_by from public.draft_versions where approval_id = $1", [approval]);
    expect(v).toEqual([{ version: 1, source: "model", fields: draft, created_by: member }]);
  });

  it("members edit a waiting draft; each edit is a new version with the same parts", async () => {
    const edited = [{ key: "page_title", text: "  Drain Cleaning in Salt Lake City | Sunrise " }, { key: "meta_description", text: "Same-day drain cleaning." }];
    await q(member, "select public.edit_draft($1,$2)", [approval, JSON.stringify(edited)]);
    const [v2] = await q<{ version: number; source: string; fields: { fields: { key: string; label: string; text: string }[] }; created_by: string }>(
      owner, "select version, source, fields, created_by from public.draft_versions where approval_id = $1 and version = 2", [approval]);
    expect(v2!.source).toBe("owner");
    expect(v2!.created_by).toBe(member);
    expect(v2!.fields.fields).toEqual([
      { key: "page_title", label: "Page title", text: "Drain Cleaning in Salt Lake City | Sunrise" },
      { key: "meta_description", label: "Meta description", text: "Same-day drain cleaning." },
    ]);
    await expect(q(member, "select public.edit_draft($1,$2)", [approval, JSON.stringify([{ key: "page_title", text: "x" }])])).rejects.toThrow(/same parts/);
    await expect(q(member, "select public.edit_draft($1,$2)", [approval, JSON.stringify([{ key: "page_title", text: " " }, { key: "meta_description", text: "x" }])])).rejects.toThrow(/needs text/);
    await expect(q(outsider, "select public.edit_draft($1,$2)", [approval, JSON.stringify(edited)])).rejects.toThrow(/Forbidden/);
    await expect(q(owner, "insert into public.draft_versions (organization_id, approval_id, version, fields, source) values ($1,$2,9,'{}','owner')", [org, approval])).rejects.toThrow(PERMISSION_DENIED);
  });

  it("only the owner approves, and approves a specific version; approval is not completion", async () => {
    const [{ id: v1 }] = await q<{ id: string }>(owner, "select id from public.draft_versions where approval_id = $1 and version = 1", [approval]);
    await expect(q(member, "select public.approve_draft_version($1,$2)", [approval, v1])).rejects.toThrow(/Only the account owner/);
    await expect(q(owner, "select public.approve_draft_version($1, gen_random_uuid())", [approval])).rejects.toThrow(/not part of this draft/);
    await q(owner, "select public.approve_draft_version($1,$2)", [approval, v1]);
    const [ap] = await q<{ decision: string; approved_version_id: string; decided_by: string }>(owner, "select decision, approved_version_id, decided_by from public.approvals where id = $1", [approval]);
    expect(ap).toEqual({ decision: "approved", approved_version_id: v1, decided_by: owner });
    const [c] = await q<{ status: string; stage: string }>(owner, "select status, stage from public.action_cards where id = $1", [card]);
    expect(c).toEqual({ status: "approved", stage: "approved" });
    await expect(q(member, "select public.edit_draft($1,'[]')", [approval])).rejects.toThrow(/waiting for approval/);
    await expect(q(owner, "select public.approve_draft_version($1,$2)", [approval, v1])).rejects.toThrow(/already decided/);
  });

  it("an approval through decide_approval records the latest version", async () => {
    const a = await analyze([checkCard("meta.title_length")]);
    const [{ id: c2 }] = await q<{ id: string }>(owner, "select id from public.action_cards where analysis_id = $1 and check_key = 'meta.title_length'", [a]);
    const [{ id: run }] = await q<{ id: string }>(owner, "select public.start_agent_run($1, null) as id", [c2]);
    const [{ id: ap }] = await q<{ id: string }>(owner, "select public.complete_agent_run($1,$2,'dev-model','{}') as id", [run, JSON.stringify(draft)]);
    await q(owner, "select public.edit_draft($1,$2)", [ap, JSON.stringify([{ key: "page_title", text: "v2" }, { key: "meta_description", text: "v2" }])]);
    await q(owner, "select public.decide_approval($1,'approved',null)", [ap]);
    const [r] = await q<{ version: number }>(owner, "select v.version from public.approvals a join public.draft_versions v on v.id = a.approved_version_id where a.id = $1", [ap]);
    expect(r!.version).toBe(2);
  });
});

describe("rollback", () => {
  it("rolls back (restoring verify_outcomes exactly) and re-applies", async () => {
    const root = join(__dirname, "..", "..", "supabase");
    const body = async () => (await db.admin.query<{ src: string }>("select prosrc src from pg_proc where proname = 'verify_outcomes'")).rows[0]!.src;
    const changed = await body();
    await db.admin.query(readFileSync(join(root, "rollback", "20261128120000_model_findings_and_draft_versions_down.sql"), "utf8"));
    const restored = await body();
    expect(restored).not.toContain("origin");
    expect(readFileSync(join(root, "migrations", "20261119160000_measurement_retention.sql"), "utf8")).toContain(restored.trim().split("\n")[3]!.trim());
    const gone = await db.admin.query(`select to_regclass('public.draft_versions') is null t,
      (select count(*)::int from pg_proc where proname in ('add_model_findings','edit_draft','approve_draft_version')) f`);
    expect(gone.rows[0]).toEqual({ t: true, f: 0 });
    await db.admin.query(readFileSync(join(root, "migrations", "20261128120000_model_findings_and_draft_versions.sql"), "utf8"));
    expect(await body()).toBe(changed);
    const [{ n }] = (await db.admin.query<{ n: number }>("select count(*)::int n from public.draft_versions")).rows as [{ n: number }];
    expect(n).toBeGreaterThan(1); // existing drafts got their version 1 back
  });
});
