import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FACT_FIELDS } from "../../src/lib/business-profile";
import { propose } from "../../src/lib/server/agent/modules/business-intelligence";
import { extractFacts } from "../../src/lib/server/site-scan";

import { setupTestDb, type TestDb } from "./harness";

let db: TestDb;
let owner: string;
let member: string;
let outsider: string;
let org: string;
let otherOrg: string;
let analysis: string;

const PERMISSION_DENIED = /permission denied/;
const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]]);

const evidence = [
  { key: "w", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://a.example/", observation: "No title." },
  { key: "m", source: "pagespeed", kind: "missing", check_key: "pagespeed.unavailable", url: null, observation: "PageSpeed unavailable." },
];
const card = (check_key: string, keys: string[]) => ({
  check_key, title: check_key, explanation: "x", why_it_matters: "x", recommended_action: "x", expected_benefit: "x",
  impact_priority: "high", confidence: "high", evidence_keys: keys,
});
const fact = (over: Record<string, unknown> = {}) => ({
  category: "business", field: "service", value: "Drain cleaning", source: "website", evidence_class: "inferred",
  basis: "A page at /services/drain-cleaning exists.", evidence: [{ kind: "observed", url: "https://a.example/services/drain-cleaning" }], ...over,
});

beforeAll(async () => {
  db = await setupTestDb();
  owner = await db.createUser("Owner");
  member = await db.createUser("Member");
  outsider = await db.createUser("Outsider");
  [{ id: org }] = await q<{ id: string }>(owner, "select public.create_organization('Sunrise','https://a.example','','') as id");
  [{ id: otherOrg }] = await q<{ id: string }>(outsider, "select public.create_organization('Other','https://b.example','','') as id");
  await db.admin.query("insert into public.organization_members values ($1,$2,'member',now())", [org, member]);
  await db.grantPlan(org);
  [{ id: analysis }] = await q<{ id: string }>(owner, "select public.start_analysis($1) as id", [org]);
  await q(owner, "select public.complete_analysis($1,$2,$3,'{}','s','template')", [
    analysis, JSON.stringify(evidence), JSON.stringify([card("a.observed", ["w"]), card("b.missing_only", ["m"]), card("c.both", ["m", "w"])]),
  ]);
}, 60_000);
afterAll(async () => db?.teardown());

const classes = () =>
  q<{ check_key: string; evidence_class: string }>(owner, "select check_key, evidence_class from public.action_cards where analysis_id = $1 and origin = 'website_check' order by check_key", [analysis]);

describe("evidence classes on Action Cards", () => {
  it("fixed-check cards get their class from the evidence they cite", async () => {
    expect((await classes()).map((c) => [c.check_key, c.evidence_class])).toEqual([
      ["a.observed", "verified"], ["b.missing_only", "unknown"], ["c.both", "verified"],
    ]);
  });

  it("a fixed-check card's class cannot be changed to something its evidence doesn't support", async () => {
    await db.admin.query("update public.action_cards set evidence_class = 'inferred' where analysis_id = $1 and check_key = 'b.missing_only'", [analysis]);
    expect((await classes())[1]!.evidence_class).toBe("unknown");
  });

  const modelCard = async (cls: string | null, basis: string | null, evidenceKeys: string[]) => {
    const c = db.admin;
    await c.query("begin");
    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into public.action_cards (organization_id, analysis_id, check_key, title, explanation, why_it_matters, recommended_action,
           expected_benefit, impact_priority, confidence, origin, evidence_class, evidence_basis)
         values ($1,$2,'model.x','t','x','x','x','x','medium','medium','model',$3,$4) returning id`, [org, analysis, cls, basis]);
      for (const k of evidenceKeys) {
        await c.query(
          `insert into public.action_card_evidence (action_card_id, evidence_id, organization_id)
           select $1, e.id, $2 from public.analysis_evidence e where e.analysis_id = $3 and e.check_key = $4`,
          [rows[0]!.id, org, analysis, k === "w" ? "meta.title_missing" : "pagespeed.unavailable"],
        );
      }
      await c.query("commit");
      return rows[0]!.id;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  };

  it("model findings must carry a valid class: refused without one", async () => {
    await expect(modelCard(null, null, ["w"])).rejects.toThrow(/needs an evidence class/);
  });

  it("verified model findings must cite observed or measured evidence", async () => {
    await expect(modelCard("verified", null, ["m"])).rejects.toThrow(/must cite observed or measured/);
    expect(await modelCard("verified", null, ["w"])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("inferred findings need evidence and a basis; estimated findings need a basis", async () => {
    await expect(modelCard("inferred", null, ["w"])).rejects.toThrow(/inferred finding must cite evidence and state its basis/);
    await expect(modelCard("inferred", "Because the homepage says so.", [])).rejects.toThrow(/inferred finding/);
    expect(await modelCard("inferred", "The headline names no service.", ["w"])).toMatch(/^[0-9a-f-]/);
    await expect(modelCard("estimated", " ", [])).rejects.toThrow(/estimated finding must state its basis/);
    expect(await modelCard("estimated", "Assumes the service area named on the contact page.", [])).toMatch(/^[0-9a-f-]/);
    expect(await modelCard("unknown", null, [])).toMatch(/^[0-9a-f-]/);
  });

  it("removing the only direct evidence from a verified model finding is refused", async () => {
    const id = await modelCard("verified", null, ["w"]);
    await expect(db.admin.query("delete from public.action_card_evidence where action_card_id = $1", [id])).rejects.toThrow(/must cite observed or measured/);
  });

  it("customers cannot write classes directly", async () => {
    await expect(q(owner, "update public.action_cards set evidence_class = 'verified'")).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe("business facts", () => {
  it("the Marketing Agent (a member's run or the server worker) proposes facts; outsiders and anonymous callers cannot", async () => {
    const [{ n }] = await q<{ n: number }>(member, "select public.propose_business_facts($1,$2,$3) n", [org, analysis, JSON.stringify([fact(), fact({ field: "contact_phone", value: "(801) 555-0123", evidence_class: "verified", basis: null, evidence: [{ kind: "observed", url: "https://a.example/" }] })])]);
    expect(n).toBe(2);
    await expect(q(outsider, "select public.propose_business_facts($1,null,$2)", [org, JSON.stringify([fact()])])).rejects.toThrow(/Forbidden/);
    await expect(q(null, "select public.propose_business_facts($1,null,$2)", [org, JSON.stringify([fact()])])).rejects.toThrow(PERMISSION_DENIED);
    const [{ n: s }] = await q<{ n: number }>("service", "select public.propose_business_facts($1,null,$2) n", [otherOrg, JSON.stringify([fact({ value: "Roof repair" })])]);
    expect(s).toBe(1);
  });

  it("refuses proposals that claim to be the owner's, or break the evidence rules", async () => {
    await expect(q(member, "select public.propose_business_facts($1,null,$2)", [org, JSON.stringify([fact({ source: "owner" })])])).rejects.toThrow(/come from the website/);
    await expect(q(member, "select public.propose_business_facts($1,null,$2)", [org, JSON.stringify([fact({ value: "Pipes", evidence_class: "verified", evidence: [{ kind: "missing" }] })])])).rejects.toThrow(/business_facts_verified/);
    await expect(q(member, "select public.propose_business_facts($1,null,$2)", [org, JSON.stringify([fact({ value: "Pipes", basis: null })])])).rejects.toThrow(/business_facts_inferred/);
    await expect(q(member, "select public.propose_business_facts($1,null,$2)", [org, JSON.stringify([fact({ value: "Pipes", evidence_class: "estimated", basis: "" })])])).rejects.toThrow(/business_facts_estimated/);
    await expect(q(member, "select public.propose_business_facts($1,null,$2)", [org, JSON.stringify([fact({ value: "Gutters", evidence_class: "unknown" })])])).rejects.toThrow(/business_facts_unknown_value/);
    await expect(q(member, "select public.propose_business_facts($1,null,$2)", [org, JSON.stringify([fact({ field: "favorite_color" })])])).rejects.toThrow(/Unknown business detail business.favorite_color/);
    await expect(q(member, "select public.propose_business_facts($1,null,$2)", [org, JSON.stringify([fact({ category: "brand", field: "service" })])])).rejects.toThrow(/Unknown business detail brand.service/);
  });

  it("an unknown fact records what is missing, with no value", async () => {
    const [{ n }] = await q<{ n: number }>(member, "select public.propose_business_facts($1,null,$2) n", [org, JSON.stringify([fact({ category: "customer", field: "audience", value: null, evidence_class: "unknown", basis: null, evidence: [] })])]);
    expect(n).toBe(1);
  });

  it("an identical proposal refreshes the existing fact instead of duplicating it", async () => {
    const [before] = await q<{ observed_at: string }>(owner, "select observed_at from public.business_facts where organization_id = $1 and value = 'Drain cleaning'", [org]);
    await new Promise((r) => setTimeout(r, 20));
    const [{ n }] = await q<{ n: number }>(member, "select public.propose_business_facts($1,null,$2) n", [org, JSON.stringify([fact({ value: "drain cleaning" })])]);
    expect(n).toBe(0);
    const rows = await q<{ observed_at: string }>(owner, "select observed_at from public.business_facts where organization_id = $1 and lower(value) = 'drain cleaning'", [org]);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.observed_at).getTime()).toBeGreaterThan(new Date(before!.observed_at).getTime());
  });

  it("only the owner reviews: confirm makes a fact verified; a correction supersedes the proposal", async () => {
    const [{ id }] = await q<{ id: string }>(owner, "select id from public.business_facts where organization_id = $1 and field = 'service'", [org]);
    await expect(q(member, "select public.review_business_fact($1,'confirm',null)", [id])).rejects.toThrow(/Only the account owner/);
    await expect(q(outsider, "select public.review_business_fact($1,'confirm',null)", [id])).rejects.toThrow(/Forbidden/);
    const [{ r }] = await q<{ r: string }>(owner, "select public.review_business_fact($1,'confirm','Drain and sewer cleaning') r", [id]);
    expect(r).not.toBe(id);
    const rows = await q<{ id: string; status: string; source: string; evidence_class: string; value: string; confirmed_by: string | null }>(
      owner, "select id, status, source, evidence_class, value, confirmed_by from public.business_facts where id in ($1,$2) order by created_at", [id, r]);
    expect(rows.map((x) => [x.status, x.source, x.evidence_class, x.value])).toEqual([
      ["superseded", "website", "inferred", "Drain cleaning"],
      ["confirmed", "owner", "verified", "Drain and sewer cleaning"],
    ]);
    expect(rows[1]!.confirmed_by).toBe(owner);
    await expect(q(owner, "select public.review_business_fact($1,'confirm',null)", [id])).rejects.toThrow(/Already reviewed/);

    const [{ id: phone }] = await q<{ id: string }>(owner, "select id from public.business_facts where organization_id = $1 and field = 'contact_phone'", [org]);
    await q(owner, "select public.review_business_fact($1,'confirm',null)", [phone]);
    const [p] = await q<{ status: string; evidence_class: string }>(owner, "select status, evidence_class from public.business_facts where id = $1", [phone]);
    expect(p).toEqual({ status: "confirmed", evidence_class: "verified" });
  });

  it("a confirmed unknown needs the missing detail", async () => {
    const [{ id }] = await q<{ id: string }>(owner, "select id from public.business_facts where organization_id = $1 and field = 'audience'", [org]);
    await expect(q(owner, "select public.review_business_fact($1,'confirm',null)", [id])).rejects.toThrow(/Add the missing detail/);
    await q(owner, "select public.review_business_fact($1,'confirm','Homeowners in Salt Lake County')", [id]);
  });

  it("a rejected fact is not proposed again", async () => {
    await q(member, "select public.propose_business_facts($1,null,$2)", [org, JSON.stringify([fact({ value: "Pool cleaning" })])]);
    const [{ id }] = await q<{ id: string }>(owner, "select id from public.business_facts where organization_id = $1 and value = 'Pool cleaning'", [org]);
    await q(owner, "select public.review_business_fact($1,'reject',null)", [id]);
    const [{ n }] = await q<{ n: number }>(member, "select public.propose_business_facts($1,null,$2) n", [org, JSON.stringify([fact({ value: "Pool cleaning" })])]);
    expect(n).toBe(0);
    const [{ c }] = await q<{ c: number }>(owner, "select count(*)::int c from public.business_facts where organization_id = $1 and value = 'Pool cleaning'", [org]);
    expect(c).toBe(1);
  });

  it("the owner adds facts directly; members cannot; duplicates are refused", async () => {
    await q(owner, "select public.add_business_fact($1,'brand','voice','Friendly and plain-spoken')", [org]);
    await expect(q(member, "select public.add_business_fact($1,'brand','tone','Warm')", [org])).rejects.toThrow(/Only the account owner/);
    await expect(q(owner, "select public.add_business_fact($1,'brand','voice','friendly and plain-spoken')", [org])).rejects.toThrow(/already there/);
  });

  it("members read their own facts only; nobody writes the table directly", async () => {
    const mine = await q(member, "select id from public.business_facts");
    expect(mine.length).toBeGreaterThan(3);
    expect((await q<{ organization_id: string }>(outsider, "select organization_id from public.business_facts")).every((r) => r.organization_id === otherOrg)).toBe(true);
    await expect(q(owner, "insert into public.business_facts (organization_id, category, field, value, source, evidence_class) values ($1,'business','service','x','owner','verified')", [org])).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(owner, "update public.business_facts set status = 'confirmed'")).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe("application and database agree", () => {
  it("the profile fields in the app are exactly the fields the database accepts", async () => {
    const { rows } = await db.admin.query<{ category: string; field: string; ok: boolean }>(
      `select c.category, f.field, app_private.business_fact_field_ok(c.category, f.field) ok
       from (values ('business'), ('brand'), ('customer')) c(category),
            unnest($1::text[]) f(field)`, [Object.values(FACT_FIELDS).flat()]);
    const accepted = rows.filter((r) => r.ok).map((r) => `${r.category}.${r.field}`).sort();
    const declared = Object.entries(FACT_FIELDS).flatMap(([c, fs]) => fs.map((f) => `${c}.${f}`)).sort();
    expect(accepted).toEqual(declared);
  });

  it("the database accepts exactly what Business Intelligence proposes from a real page", async () => {
    const html = `<html><body><a href="tel:+18015550188">Call</a><a href="mailto:office@sunrise.example">Email</a>
      <a href="/services/sewer-repair">Sewer Repair</a></body></html>`;
    const facts = propose({ homepage: extractFacts({ url: "https://a.example/", status: 200, contentType: "text/html", body: html, truncated: false, redirects: [] }), pages: [], failures: [] });
    expect(facts).toHaveLength(3);
    const [{ n }] = await q<{ n: number }>(member, "select public.propose_business_facts($1,$2,$3) n", [org, analysis, JSON.stringify(facts)]);
    expect(n).toBe(3);
  });
});

describe("rollback", () => {
  it("rolls back and re-applies on a database with existing cards, re-deriving their classes", async () => {
    const root = join(__dirname, "..", "..", "supabase");
    await db.admin.query(readFileSync(join(root, "rollback", "20261127120000_business_intelligence_evidence_down.sql"), "utf8"));
    const gone = await db.admin.query(
      `select to_regclass('public.business_facts') is null tbl,
              (select count(*)::int from information_schema.columns where table_name = 'action_cards' and column_name in ('evidence_class','evidence_basis')) cols`);
    expect(gone.rows[0]).toEqual({ tbl: true, cols: 0 });
    await db.admin.query(readFileSync(join(root, "migrations", "20261127120000_business_intelligence_evidence.sql"), "utf8"));
    expect((await classes()).map((c) => c.evidence_class)).toEqual(["verified", "unknown", "verified"]);
    const { rows } = await db.admin.query<{ n: number }>("select count(*)::int n from public.action_cards where evidence_class is null");
    expect(rows[0]!.n).toBe(0);
  });
});
