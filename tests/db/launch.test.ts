/**
 * Launch redesign: anonymous previews, Save this, claim across browsers, free uses,
 * feedback and funnel counts. Runs every migration on a throwaway local Postgres.
 */
import { createHash, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";

let db: TestDb;
const KEY = randomBytes(32).toString("hex");
const token = () => randomBytes(32).toString("base64url");
const ipHash = (s: string) => createHash("sha256").update(s).digest("hex");
const PERMISSION_DENIED = /permission denied/;

const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  db.as(user, async (c) => (await c.query(sql, params)).rows as [T, ...T[]]);

const evidence = [
  { key: "e1", source: "website", kind: "observed", check_key: "meta.title_missing", url: "https://shop.example/", observation: "No title." },
  { key: "e2", source: "pagespeed", kind: "missing", check_key: "pagespeed.unavailable", url: null, observation: "PageSpeed was busy." },
];
const cards = [
  {
    check_key: "meta.title_missing", title: "Add a page title", explanation: "x", why_it_matters: "x", recommended_action: "x",
    expected_benefit: "x", impact_priority: "high", confidence: "high", ai_capable: true, execution_type: "meta",
    approval_required: true, evidence_keys: ["e1"],
  },
];

async function preview(domain: string, ip = "1.1.1.1", view = token()) {
  const [{ r }] = await q<{ r: { id: string; cached: boolean } }>(
    null, "select public.site_preview_start($1,$2,$3,'84101',$4,$5) as r",
    [KEY, `https://${domain}/`, domain, ipHash(ip), view],
  );
  return { ...r, view };
}
async function complete(id: string) {
  await q(null, "select public.site_preview_complete($1,$2,$3,$4,'{\"website\":{\"status\":\"observed\"}}','Summary','template')", [
    KEY, id, JSON.stringify(evidence), JSON.stringify(cards),
  ]);
}
async function saved(domain: string, email: string, ip?: string) {
  const p = await preview(domain, ip);
  await complete(p.id);
  const claim = token();
  await q(null, "select public.site_preview_save($1,$2,$3,$4,$5)", [KEY, p.id, p.view, email, claim]);
  return { ...p, claim };
}

beforeAll(async () => {
  db = await setupTestDb();
  await db.admin.query("insert into app_private.secrets (name, hash) values ('site_server', $1)", [createHash("sha256").update(KEY).digest()]);
}, 60_000);
afterAll(async () => db?.teardown());

describe("server key", () => {
  it("site functions refuse callers without the key, with a wrong key, or a short key", async () => {
    await expect(q(null, "select public.site_preview_start($1,'https://a.example/','a.example','84101',$2,$3)", ["x".repeat(64), ipHash("a"), token()])).rejects.toThrow(/Forbidden/);
    await expect(q(null, "select public.site_track($1,'homepage_visit','{}')", [KEY.slice(0, 20)])).rejects.toThrow(/Forbidden/);
    const u = await db.createUser();
    await expect(q(u, "select public.site_preview_get($1, gen_random_uuid(), 'x')", ["nope"])).rejects.toThrow(/Forbidden/);
  });

  it("nobody reads or writes the new tables directly", async () => {
    const u = await db.createUser();
    for (const t of ["previews", "feedback", "feedback_followups", "funnel_events", "app_config"]) {
      await expect(q(null, `select * from public.${t}`)).rejects.toThrow(PERMISSION_DENIED);
      await expect(q(u, `select * from public.${t}`)).rejects.toThrow(PERMISSION_DENIED);
    }
    await expect(q(u, "insert into public.funnel_events (event) values ('homepage_visit')")).rejects.toThrow(PERMISSION_DENIED);
    await expect(q(null, "select app_private.free_uses_used(gen_random_uuid(), gen_random_uuid())")).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe("anonymous preview", () => {
  it("is readable only with its view token, and never exposes email or tokens", async () => {
    const p = await preview("view.example");
    await complete(p.id);
    const [{ r }] = await q<{ r: Record<string, unknown> }>(null, "select public.site_preview_get($1,$2,$3) as r", [KEY, p.id, p.view]);
    expect(r).toMatchObject({ status: "complete", domain: "view.example", zip_code: "84101", saved: false });
    expect(r).not.toHaveProperty("email");
    expect(JSON.stringify(r)).not.toMatch(/token|ip_hash/);
    const [{ r: none }] = await q<{ r: unknown }>(null, "select public.site_preview_get($1,$2,$3) as r", [KEY, p.id, token()]);
    expect(none).toBeNull();
    const [{ h }] = await db.admin.query("select view_token_hash = sha256(convert_to($2,'UTF8')) as h from public.previews where id = $1", [p.id, p.view]).then((x) => x.rows);
    expect(h).toBe(true);
  });

  it("reuses a result from the last 24 hours without new spend", async () => {
    const first = await preview("cache.example", "2.2.2.2");
    await complete(first.id);
    const second = await preview("cache.example", "3.3.3.3");
    expect(second.cached).toBe(true);
    const [{ r }] = await q<{ r: { status: string; cards: unknown[] } }>(null, "select public.site_preview_get($1,$2,$3) as r", [KEY, second.id, second.view]);
    expect(r.status).toBe("complete");
    expect(r.cards).toHaveLength(1);
  });

  it("limits each network address, each website, and the daily total", async () => {
    for (let i = 0; i < 5; i++) await preview(`ip${i}.example`, "9.9.9.9");
    await expect(preview("ip5.example", "9.9.9.9")).rejects.toThrow(/Too many from this address/);

    for (let i = 0; i < 3; i++) await preview("busy-site.example", `10.0.0.${i}`);
    await expect(preview("busy-site.example", "10.0.0.9")).rejects.toThrow(/Too many for this website/);

    await db.admin.query("update public.app_config set value = '0' where key = 'preview_daily_cap'");
    await expect(preview("capped.example", "11.0.0.1")).rejects.toThrow(/Daily capacity reached/);
    await db.admin.query("update public.app_config set value = '200' where key = 'preview_daily_cap'");
  });

  it("deletes previews older than seven days", async () => {
    const old = await preview("old.example", "12.0.0.1");
    await db.admin.query("update public.previews set created_at = now() - interval '8 days' where id = $1", [old.id]);
    await preview("trigger-cleanup.example", "12.0.0.2");
    const { rows } = await db.admin.query("select 1 from public.previews where id = $1", [old.id]);
    expect(rows).toHaveLength(0);
  });

  it("Save this needs the view token and a finished result", async () => {
    const p = await preview("save.example", "13.0.0.1");
    await expect(q(null, "select public.site_preview_save($1,$2,$3,'a@b.example',$4)", [KEY, p.id, p.view, token()])).rejects.toThrow(/Not available/);
    await complete(p.id);
    await expect(q(null, "select public.site_preview_save($1,$2,$3,'a@b.example',$4)", [KEY, p.id, token(), token()])).rejects.toThrow(/Not found/);
    await q(null, "select public.site_preview_save($1,$2,$3,'Owner@Save.Example',$4)", [KEY, p.id, p.view, token()]);
    const { rows } = await db.admin.query("select email, claim_token_hash is not null as has_hash from public.previews where id = $1", [p.id]);
    expect(rows[0]).toEqual({ email: "owner@save.example", has_hash: true });
  });
});

describe("claiming a saved result (any browser, same verified email)", () => {
  it("refuses a different email, an unverified email, an expired link, and a replay", async () => {
    const s = await saved("claim.example", "pat@claim.example", "14.0.0.1");
    const other = await db.createUser("Other", { email: "someone@else.example" });
    await expect(q(other, "select public.claim_preview($1)", [s.claim])).rejects.toThrow(/Different email/);
    const unverified = await db.createUser("Pat", { email: "pat@claim.example", confirmed: false });
    await expect(q(unverified, "select public.claim_preview($1)", [s.claim])).rejects.toThrow(/Email not verified/);
    await expect(q(null, "select public.claim_preview($1)", [s.claim])).rejects.toThrow(/Not signed in|permission denied/);

    const pat = await db.createUser("Pat", { email: "PAT@claim.example" });
    await expect(q(pat, "select public.claim_preview($1)", [token()])).rejects.toThrow(/already used or not found/);
    const [{ r }] = await q<{ r: { organization_id: string; analysis_id: string } }>(pat, "select public.claim_preview($1) as r", [s.claim]);
    expect(r.organization_id).toBeTruthy();
    await expect(q(pat, "select public.claim_preview($1)", [s.claim])).rejects.toThrow(/already used or not found/);

    // The claimed result is in the account: analysis, cards and cited evidence.
    const cardsRows = await q<{ title: string; n: number }>(pat,
      "select c.title, (select count(*) from public.action_card_evidence e where e.action_card_id = c.id)::int n from public.action_cards c where c.analysis_id = $1",
      [r.analysis_id]);
    expect(cardsRows).toEqual([{ title: "Add a page title", n: 1 }]);
    const [biz] = await q<{ website: string; zip_code: string }>(pat, "select website, zip_code from public.business_profiles where organization_id = $1", [r.organization_id]);
    expect(biz).toEqual({ website: "https://claim.example/", zip_code: "84101" });
    // Nobody else sees it.
    expect(await q(other, "select id from public.analyses where id = $1", [r.analysis_id])).toHaveLength(0);
  });

  it("an expired link is refused", async () => {
    const s = await saved("expired.example", "late@expired.example", "15.0.0.1");
    await db.admin.query("update public.previews set claim_expires_at = now() - interval '1 minute' where id = $1", [s.id]);
    const u = await db.createUser("Late", { email: "late@expired.example" });
    await expect(q(u, "select public.claim_preview($1)", [s.claim])).rejects.toThrow(/Link expired/);
  });

  it("asking again replaces the earlier link", async () => {
    const s = await saved("again.example", "again@again.example", "16.0.0.1");
    const newer = token();
    await q(null, "select public.site_preview_save($1,$2,$3,'again@again.example',$4)", [KEY, s.id, s.view, newer]);
    const u = await db.createUser("Again", { email: "again@again.example" });
    await expect(q(u, "select public.claim_preview($1)", [s.claim])).rejects.toThrow(/already used or not found/);
    await q(u, "select public.claim_preview($1)", [newer]);
  });

  it("an account already tracking another website cannot claim a different one", async () => {
    const u = await db.createUser("Two", { email: "two@sites.example" });
    await q(u, "select public.create_organization('First','https://first.example','','')");
    const s = await saved("second.example", "two@sites.example", "17.0.0.1");
    await expect(q(u, "select public.claim_preview($1)", [s.claim])).rejects.toThrow(/another website/);
  });
});

describe("three free uses, enforced in the database", () => {
  it("claimed first result + two more; the fourth needs a plan; failures do not count", async () => {
    const s = await saved("uses.example", "uses@uses.example", "18.0.0.1");
    const u = await db.createUser("Uses", { email: "uses@uses.example" });
    const [{ r }] = await q<{ r: { organization_id: string } }>(u, "select public.claim_preview($1) as r", [s.claim]);
    const org = r.organization_id;
    const uses = async () => (await q<{ f: { used: number; remaining: number; limit: number } }>(u, "select public.free_uses($1) as f", [org]))[0].f;
    expect(await uses()).toEqual({ used: 1, limit: 3, remaining: 2 });

    // A failed analysis does not use up a free use.
    const [{ id: failed }] = await q<{ id: string }>(u, "select public.start_analysis($1) as id", [org]);
    await q(u, "select public.fail_analysis($1,'Site was down')", [failed]);
    expect((await uses()).used).toBe(1);

    // Use 2: a draft from the claimed card.
    const [{ id: card }] = await q<{ id: string }>(u, "select id from public.action_cards where organization_id = $1 and ai_capable", [org]);
    const [{ id: run }] = await q<{ id: string }>(u, "select public.start_agent_run($1, null) as id", [card]);
    const [{ free }] = await q<{ free: boolean }>(u, "select free_use as free from public.agent_runs where id = $1", [run]);
    expect(free).toBe(true);
    expect((await uses()).used).toBe(2);

    // Use 3: an analysis.
    const [{ id: a3 }] = await q<{ id: string }>(u, "select public.start_analysis($1) as id", [org]);
    await q(u, "select public.complete_analysis($1,$2,'[]','{}','s','template')", [a3, JSON.stringify(evidence)]);
    expect(await uses()).toEqual({ used: 3, limit: 3, remaining: 0 });

    // Fourth: refused until there is a plan.
    await expect(q(u, "select public.start_analysis($1)", [org])).rejects.toThrow(/A plan is needed/);
    await db.grantPlan(org, "single_site");
    const [{ id: paid }] = await q<{ id: string }>(u, "select public.start_analysis($1) as id", [org]);
    const [{ f }] = await q<{ f: boolean }>(u, "select free_use as f from public.analyses where id = $1", [paid]);
    expect(f).toBe(false);
  });

  it("a new business does not reset the person's free uses", async () => {
    const u = await db.createUser("Hopper");
    await db.admin.query("update public.app_config set value = '1' where key = 'free_run_limit'");
    try {
      const [{ id: a }] = await q<{ id: string }>(u, "select public.create_organization('A','https://hop-a.example','','') as id");
      const [{ id: run }] = await q<{ id: string }>(u, "select public.start_analysis($1) as id", [a]);
      await q(u, "select public.complete_analysis($1,'[]','[]','{}','s','template')", [run]);
      const [{ id: b }] = await q<{ id: string }>(u, "select public.create_organization('B','https://hop-b.example','','') as id");
      await expect(q(u, "select public.start_analysis($1)", [b])).rejects.toThrow(/A plan is needed/);
    } finally {
      await db.admin.query("update public.app_config set value = '3' where key = 'free_run_limit'");
    }
  });

  it("free use counts are private to the business", async () => {
    const owner = await db.createUser();
    const outsider = await db.createUser();
    const [{ id: org }] = await q<{ id: string }>(owner, "select public.create_organization('P','https://p.example','','') as id");
    await expect(q(outsider, "select public.free_uses($1)", [org])).rejects.toThrow(/Forbidden/);
  });
});

describe("plans", () => {
  it("new plans have entitlements; Marketing Plan is one analysis; subscriptions unlock drafts", async () => {
    const rows = await q<{ plan_id: string; analyses: boolean; weekly: boolean; drafts: string; one_time: boolean }>(
      null, "select plan_id, analyses, weekly, drafts, one_time from public.plan_entitlements where plan_id in ('marketing_plan','single_site','business_plus','multi_site') order by plan_id");
    expect(rows).toEqual([
      { plan_id: "business_plus", analyses: true, weekly: true, drafts: "all", one_time: false },
      { plan_id: "marketing_plan", analyses: true, weekly: false, drafts: "none", one_time: true },
      { plan_id: "multi_site", analyses: true, weekly: true, drafts: "all", one_time: false },
      { plan_id: "single_site", analyses: true, weekly: true, drafts: "all", one_time: false },
    ]);
  });

  it("a Marketing Plan purchase allows one paid analysis", async () => {
    const billingKey = randomBytes(32).toString("hex");
    await db.admin.query("insert into app_private.secrets (name, hash) values ('billing_webhook', $1) on conflict (name) do update set hash = excluded.hash", [createHash("sha256").update(billingKey).digest()]);
    const u = await db.createUser();
    const [{ id: org }] = await q<{ id: string }>(u, "select public.create_organization('M','https://m.example','','') as id");
    await q(null, "select public.billing_record_purchase($1,$2,'marketing_plan','cs_test_mp1',null,4900)", [billingKey, org]);
    const ent = async () => (await q<{ e: { plan: string | null } }>(u, "select public.current_entitlements($1) as e", [org]))[0].e;
    expect((await ent()).plan).toBe("marketing_plan");
    const [{ id: a }] = await q<{ id: string }>(u, "select public.start_analysis($1) as id", [org]);
    await q(u, "select public.complete_analysis($1,'[]','[]','{}','s','template')", [a]);
    expect((await ent()).plan).toBeNull();
  });

  it("stores the billing interval and price from the webhook", async () => {
    const billingKey = randomBytes(32).toString("hex");
    await db.admin.query("update app_private.secrets set hash = $1 where name = 'billing_webhook'", [createHash("sha256").update(billingKey).digest()]);
    const u = await db.createUser();
    const [{ id: org }] = await q<{ id: string }>(u, "select public.create_organization('Y','https://y.example','','') as id");
    await q(null, "select public.billing_upsert_subscription($1,$2,'cus_Y1','sub_Y1','single_site','active',null,false,'year','price_1Uen6xFnFMCbDhHEVERLfWyA')", [billingKey, org]);
    const [s] = await q<{ billing_interval: string; stripe_price_id: string }>(u, "select billing_interval, stripe_price_id from public.subscriptions where organization_id = $1", [org]);
    expect(s).toEqual({ billing_interval: "year", stripe_price_id: "price_1Uen6xFnFMCbDhHEVERLfWyA" });
    await expect(q(u, "select public.billing_upsert_subscription($1,$2,'cus_Y1','sub_Y1','single_site','active',null,false,'year','price_x')", ["wrong".repeat(10), org])).rejects.toThrow(/Forbidden/);
  });
});

describe("feedback and funnel counts", () => {
  it("feedback is insert-only, rate limited, and follow-up emails are kept apart", async () => {
    const ip = ipHash("20.0.0.1");
    await q(null, "select public.site_submit_feedback($1,'first_result','up',null,null,null,$2,null)", [KEY, ip]);
    await q(null, "select public.site_submit_feedback($1,'upgrade',null,'Too expensive',null,null,$2,'Pat@Example.com')", [KEY, ip]);
    const { rows } = await db.admin.query("select f.reason, u.email from public.feedback f left join public.feedback_followups u on u.feedback_id = f.id where f.ip_hash = $1 order by f.created_at", [ip]);
    expect(rows).toEqual([{ reason: null, email: null }, { reason: "Too expensive", email: "pat@example.com" }]);
    for (let i = 0; i < 8; i++) await q(null, "select public.site_submit_feedback($1,'first_result','down',null,null,null,$2,null)", [KEY, ip]);
    await expect(q(null, "select public.site_submit_feedback($1,'first_result','down',null,null,null,$2,null)", [KEY, ip])).rejects.toThrow(/Too many/);
    await expect(q(null, "select public.site_submit_feedback($1,'first_result',null,null,null,null,$2,null)", [KEY, ipHash("x")])).rejects.toThrow(/check constraint/);
  });

  it("funnel events accept known names only and no email addresses", async () => {
    await q(null, "select public.site_track($1,'homepage_visit','{}')", [KEY]);
    await expect(q(null, "select public.site_track($1,'made_up','{}')", [KEY])).rejects.toThrow(/check constraint/);
    await expect(q(null, "select public.site_track($1,'signup_started','{\"e\":\"a@b.c\"}')", [KEY])).rejects.toThrow(/check constraint/);
  });

  it("the funnel view is for platform admins only", async () => {
    const admin = await db.createUser("Admin");
    const user = await db.createUser("User");
    await db.admin.query("insert into public.platform_admins (user_id) values ($1)", [admin]);
    await expect(q(user, "select public.admin_funnel(30)")).rejects.toThrow(/Forbidden/);
    await expect(q(null, "select public.admin_funnel(30)")).rejects.toThrow(PERMISSION_DENIED);
    const [{ f }] = await q<{ f: { events: Record<string, number>; feedback: unknown[]; previews: { started: number } } }>(admin, "select public.admin_funnel(30) as f");
    expect(f.events.homepage_visit).toBe(1);
    expect(f.feedback.length).toBeGreaterThan(0);
    expect(f.previews.started).toBeGreaterThan(0);
  });
});
