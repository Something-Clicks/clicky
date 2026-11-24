/**
 * Signed-in customer journey against a REAL Supabase project (clicky-dev) and Stripe TEST mode.
 * Run only with E2E_FULL=1 (see docs/launch/LAUNCH_CHECKLIST.md, "Journey tests").
 *
 * What is real: Supabase Auth, REST API, RLS and database functions; the app server; Stripe test
 * products, prices, checkout sessions, customers, subscriptions and events.
 * What is stood in (and why):
 *  - Website scan: the sandbox has no public internet, so results come from the real analyzer run over
 *    fixture HTML (tests/e2e/fixtures/analysis.json) and are saved through the real database functions.
 *  - Sign-in: users are created in clicky-dev with a known password, so no email is sent.
 *  - Webhooks: Stripe cannot reach localhost, so Stripe's own stored events are re-sent to the local
 *    route, signed with the TEST endpoint's signing secret.
 *  - Drafts are switched off for customers (FEATURES.drafts), so no journey creates or approves one.
 *  - Stripe TEST checkout and subscription tests run only with E2E_STRIPE=1.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import fixture from "./fixtures/analysis.json";

const FULL = process.env.E2E_FULL === "1";
const STRIPE_ON = process.env.E2E_STRIPE === "1"; // Stripe TEST checkout and subscription tests: opt-in
const NEED_STRIPE = "Stripe TEST checkout tests run only with E2E_STRIPE=1.";
const URL_ = process.env.E2E_SUPABASE_URL ?? "";
const KEY = process.env.E2E_SUPABASE_KEY ?? "";
const SITE_KEY = process.env.SITE_SERVER_KEY ?? "";
const WH_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const PASSWORD = "E2e-Passw0rd!7";
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3100}`;

// Stripe TEST ids come from the app's own catalog, so the test checks what the app really uses.
import { STRIPE_CATALOG } from "../../src/config/pricing";
const TEST = STRIPE_CATALOG.test;

test.skip(!FULL, "Set E2E_FULL=1 with the clicky-dev environment (see checklist).");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const sfxOf = (info: TestInfo) => (info.project.name.startsWith("iphone") ? "m" : "d");
const RUN = Math.floor(Math.random() * 200) + 20; // distinct network address per run (rate limits are per address)
const ipOf = (info: TestInfo) => `198.51.100.${RUN + (sfxOf(info) === "m" ? 0 : 1)}`;
const email = (role: string, info: TestInfo) => `${role}-${sfxOf(info)}@e2e.test`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");

const anon = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function asUser(addr: string): Promise<SupabaseClient> {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw new Error(`sign in ${addr}: ${error.message}`);
  return c;
}

async function stripe(path: string, init: { method?: string; form?: Record<string, string> } = {}) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: init.method ?? (init.form ? "POST" : "GET"),
    headers: { Authorization: "Bearer proxy-injected", ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
  });
  const body = await res.json();
  if (body.error) throw new Error(`stripe ${path}: ${body.error.message}`);
  expect(body.livemode ?? false, "Stripe must be in test mode").toBe(false);
  return body;
}


/** A TEST customer with a card on file (Stripe's pm_card_visa test card). */
async function testCustomer(addr: string): Promise<string> {
  const c = await stripe("/v1/customers", { form: { email: addr, "metadata[e2e]": "launch" } });
  const pm = await stripe("/v1/payment_methods/pm_card_visa/attach", { form: { customer: c.id } });
  await stripe(`/v1/customers/${c.id}`, { form: { "invoice_settings[default_payment_method]": pm.id } });
  return c.id as string;
}

/** Re-sends a Stripe event to the local webhook route, signed like Stripe signs it. */
async function deliver(event: unknown, secret = WH_SECRET) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return fetch(`${BASE}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": `t=${t},v1=${v1}`, "content-type": "application/json" }, body: payload });
}

async function seedPreview(domain: string, opts: { saveEmail?: string; claim?: string } = {}) {
  const c = anon();
  const view = token();
  const { data, error } = await c.rpc("site_preview_start", { p_key: SITE_KEY, p_website: `https://${domain}/`, p_domain: domain, p_zip: "75201", p_ip_hash: sha(token()), p_view: view });
  if (error) throw new Error(`site_preview_start: ${error.message}`);
  const { id, cached } = data as { id: string; cached: boolean };
  if (!cached) {
    const { error: e2 } = await c.rpc("site_preview_complete", { p_key: SITE_KEY, p_id: id, p_evidence: fixture.evidence, p_cards: fixture.cards, p_coverage: fixture.coverage, p_summary: fixture.summary, p_wording: "template" });
    if (e2) throw new Error(`site_preview_complete: ${e2.message}`);
  }
  if (opts.saveEmail) {
    const { error: e3 } = await c.rpc("site_preview_save", { p_key: SITE_KEY, p_id: id, p_view: view, p_email: opts.saveEmail, p_claim: opts.claim ?? token() });
    if (e3) throw new Error(`site_preview_save: ${e3.message}`);
  }
  return { id, view };
}

async function ctx(browser: Browser, info: TestInfo, opts: { ip?: boolean } = {}): Promise<BrowserContext> {
  const { defaultBrowserType: _d, ...use } = info.project.use as Record<string, unknown>;
  void _d;
  const context = await browser.newContext({ ...use, baseURL: BASE, ...(opts.ip ? { extraHTTPHeaders: { "x-forwarded-for": ipOf(info) } } : {}) });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("sc_consent", "no");
    } catch {}
  });
  return context;
}

async function login(page: Page, addr: string, next = "/app") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email", { exact: true }).fill(addr);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}
async function noSideScroll(page: Page) {
  const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(w.s).toBeLessThanOrEqual(w.c);
}
const BANNED = /\b(AI|agents?|prompts?|campaigns?)\b/;

// State shared by the serial tests of one project.
const S: Record<string, { patOrg?: string; claim?: string; sub?: string; cust?: string; buyerOrg?: string; mpOrg?: string }> = {};
const st = (info: TestInfo) => (S[info.project.name] ??= {});

test.describe("anonymous first result", () => {
  test("website + ZIP → result with evidence, plain words, thumbs feedback", async ({ browser }, info) => {
    const domain = `sunrise-${sfxOf(info)}.example`;
    await seedPreview(domain); // finished once; the next visitor for the same site gets the 24-hour cached result
    const context = await ctx(browser, info, { ip: true });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForTimeout(2800); // minimum fill time
    await page.getByLabel("Website", { exact: true }).fill(domain);
    await page.getByLabel("ZIP code", { exact: true }).fill("75201");
    await page.getByRole("button", { name: "Check my website" }).click();
    await page.waitForURL(/\/start$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/things? worth fixing/);
    await expect(page.getByText("Observed").first()).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(/draft/i); // drafts are not offered
    expect(await page.locator("main").innerText()).not.toMatch(BANNED);
    await noSideScroll(page);
    await axe(page);

    await page.getByRole("button", { name: "Yes, useful" }).click();
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Thanks! That helps.")).toBeVisible();
    await context.close();
  });

  test("an unreachable site fails politely", async ({ browser }, info) => {
    const context = await ctx(browser, info, { ip: true });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForTimeout(2800);
    await page.getByLabel("Website", { exact: true }).fill(`nowhere-${RUN}-${sfxOf(info)}.example`);
    await page.getByLabel("ZIP code", { exact: true }).fill("75201");
    await page.getByRole("button", { name: "Check my website" }).click();
    await page.waitForURL(/\/start$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "We couldn't finish" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/couldn't reach|couldn't analyze/)).toBeVisible();
    await context.close();
  });

  test("a hidden form field or an instant submit is refused", async ({ browser }, info) => {
    const context = await ctx(browser, info, { ip: true });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByLabel("Website", { exact: true }).fill("fast.example");
    await page.getByLabel("ZIP code", { exact: true }).fill("75201");
    await page.getByRole("button", { name: "Check my website" }).click(); // under 2.5 seconds
    await expect(page.getByText("That was quick! Please check your details and try again.")).toBeVisible();
    await context.close();
  });

  test("Save this stores the email against the result (email delivery depends on Supabase email settings)", async ({ browser }, info) => {
    const domain = `sunrise-${sfxOf(info)}.example`;
    const context = await ctx(browser, info, { ip: true });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForTimeout(2800);
    await page.getByLabel("Website", { exact: true }).fill(domain);
    await page.getByLabel("ZIP code", { exact: true }).fill("75201");
    await page.getByRole("button", { name: "Check my website" }).click();
    await page.waitForURL(/\/start$/, { timeout: 30_000 });
    await page.getByLabel("Email", { exact: true }).fill(email("pat", info));
    await page.getByRole("button", { name: "Email me a link" }).click();
    // Either the "check your email" confirmation or a plain error if clicky-dev cannot send mail yet.
    await expect(page.getByRole("heading", { name: "Check your email" }).or(page.getByText(/couldn't send the link|Too many attempts/))).toBeVisible({ timeout: 30_000 });
    const raw = (await context.cookies()).find((c) => c.name === "sc_preview")?.value ?? "";
    const [id, view] = raw.split(".");
    const { data } = await anon().rpc("site_preview_get", { p_key: SITE_KEY, p_id: id!, p_view: view! });
    expect((data as { saved: boolean }).saved).toBe(true);
    // Without the private cookie, nothing is readable.
    const { data: nothing } = await anon().rpc("site_preview_get", { p_key: SITE_KEY, p_id: id!, p_view: token() });
    expect(nothing).toBeNull();
    await context.close();
  });
});

test.describe("claim and free uses", () => {
  test("a link opened in a different browser claims the saved result for the same verified email", async ({ browser }, info) => {
    const claim = token();
    st(info).claim = claim;
    await seedPreview(`claim-${sfxOf(info)}.example`, { saveEmail: email("pat", info), claim });
    const other = await ctx(browser, info); // a brand-new browser: no cookies from where the result was started
    const page = await other.newPage();
    await login(page, email("pat", info), `/claim?t=${claim}`);
    await expect(page).toHaveURL(/\/app\?welcome=1/);
    await expect(page.getByText("Your results are saved.")).toBeVisible();
    await expect(page.getByText("You have 2 free uses left.")).toBeVisible();
    await expect(page.locator("main").getByText(`claim-${sfxOf(info)}.example`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your next move" })).toBeVisible();
    await noSideScroll(page);
    await axe(page);

    // The same link cannot be used twice.
    await page.goto(`/claim?t=${claim}`);
    await expect(page).toHaveURL(/\/claim-problem\?reason=invalid/);
    await expect(page.getByRole("heading", { name: "That link has already been used" })).toBeVisible();
    await other.close();
  });

  test("another account cannot claim it, and a signed-out visitor is asked to sign in", async ({ browser }, info) => {
    const claim = token();
    await seedPreview(`wrongmail-${sfxOf(info)}.example`, { saveEmail: email("pat", info), claim });
    const c = await ctx(browser, info);
    const page = await c.newPage();
    await page.goto(`/claim?t=${claim}`);
    await expect(page).toHaveURL(/\/login\?claim=1&next=/);
    await expect(page.getByRole("heading", { name: "Sign in to save your results" })).toBeVisible();
    await login(page, email("other", info), `/claim?t=${claim}`);
    await expect(page).toHaveURL(/\/claim-problem\?reason=wrong_email/);
    await expect(page.getByRole("heading", { name: "That link is for a different email" })).toBeVisible();
    // And the intended person can still use it afterwards.
    const { data } = await anon().rpc("site_preview_get", { p_key: SITE_KEY, p_id: "00000000-0000-0000-0000-000000000000", p_view: "x" });
    expect(data).toBeNull();
    await c.close();
  });

  test("three free uses, then the limit; the upgrade page offers only what works", async ({ browser }, info) => {
    const pat = await asUser(email("pat", info));
    const { data: mem } = await pat.from("organization_members").select("organization_id").limit(1).single();
    const org = mem!.organization_id as string;
    st(info).patOrg = org;
    const uses = async () => ((await pat.rpc("free_uses", { p_org: org })).data as { used: number; remaining: number; limit: number });
    expect(await uses()).toEqual({ used: 1, remaining: 2, limit: 3 });

    // Use 2: a website check (finished through the real database function, as the app's background job does).
    const { data: a2, error: e2 } = await pat.rpc("start_analysis", { p_org: org });
    expect(e2).toBeNull();
    const { error: c2 } = await pat.rpc("complete_analysis", { p_analysis: a2 as string, p_evidence: fixture.evidence, p_cards: fixture.cards, p_coverage: fixture.coverage, p_summary: fixture.summary, p_wording: "template" });
    expect(c2).toBeNull();
    expect((await uses()).used).toBe(2);

    // With a free use left, the upgrade page does not ask "What stopped you?" yet.
    const early = await ctx(browser, info);
    const earlyPage = await early.newPage();
    await login(earlyPage, email("pat", info), "/app/upgrade");
    await expect(earlyPage.getByRole("heading", { name: "1 free use left" })).toBeVisible();
    await expect(earlyPage.getByText("What stopped you?")).toHaveCount(0);
    await early.close();

    // Use 3: another website check.
    const { data: a3, error: e3 } = await pat.rpc("start_analysis", { p_org: org });
    expect(e3).toBeNull();
    const { error: c3 } = await pat.rpc("complete_analysis", { p_analysis: a3 as string, p_evidence: fixture.evidence, p_cards: fixture.cards, p_coverage: fixture.coverage, p_summary: fixture.summary, p_wording: "template" });
    expect(c3).toBeNull();
    expect(await uses()).toEqual({ used: 3, remaining: 0, limit: 3 });

    // The fourth is refused by the database.
    const { error: e4 } = await pat.rpc("start_analysis", { p_org: org });
    expect((e4 as { hint?: string }).hint).toBe("needs_plan");

    const c = await ctx(browser, info);
    const page = await c.newPage();
    await login(page, email("pat", info), "/app");
    await expect(page.getByText("Free uses used up")).toBeVisible();
    await page.goto("/app/upgrade");
    await expect(page.getByRole("heading", { name: "Keep the momentum going" })).toBeVisible();
    await expect(page.getByText("You've used your 3 free uses.")).toBeVisible();
    const main = page.locator("main");
    if (STRIPE_ON) {
      await expect(main.getByRole("button", { name: "Get my report" })).toBeVisible();
      // Marketing Assistant is on hold: no monthly or yearly checkout. The Marketing Report is the only thing for sale.
      await expect(main.getByRole("button", { name: /Choose (monthly|yearly)/ })).toHaveCount(0);
      await expect(main.locator("form input[name=plan]")).toHaveCount(1);
    } else {
      // No Stripe key on this server: nothing can be bought, and the page says so plainly.
      await expect(main.getByText("Checkout opens soon.")).toBeVisible();
      await expect(main.locator("form input[name=plan]")).toHaveCount(0);
    }
    await expect(main.getByRole("table").getByRole("row", { name: /Marketing Assistant/ })).toBeVisible();
    await expect(main.getByRole("table").getByRole("row", { name: /Marketing Studio/ })).toBeVisible();
    await expect(main.getByRole("table").getByRole("row", { name: /Marketing Suite/ })).toBeVisible();
    expect(await main.innerText()).not.toMatch(BANNED);
    await noSideScroll(page);
    await axe(page);

    // "What stopped you?" with a follow-up permission.
    await page.getByLabel("Your answer").fill("I want to compare plans first");
    await page.getByLabel("Okay to email me one follow-up.").check();
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Thanks! That helps.")).toBeVisible();

    // Drafts and approvals are not offered: no tab, and the old address is gone.
    await expect(page.getByRole("link", { name: /Drafts|Approvals/ })).toHaveCount(0);
    await page.goto("/app/approvals");
    await expect(page.getByRole("heading", { name: "We couldn't find that." })).toBeVisible();
    await expect(page.getByText("Waiting for approval")).toHaveCount(0);
    await c.close();
  });
});

test.describe("checkout and billing (Stripe TEST mode)", () => {
  async function startCheckout(browser: Browser, info: TestInfo, button: string) {
    const c = await ctx(browser, info);
    const page = await c.newPage();
    await login(page, email("pat", info), "/app/upgrade");
    await page.route(/checkout\.stripe\.com/, (r) => r.abort());
    const seen = page.waitForRequest(/checkout\.stripe\.com/, { timeout: 45_000 });
    await page.locator("main").getByRole("button", { name: button }).click();
    const url = (await seen).url();
    await c.close();
    const id = /(cs_test_[A-Za-z0-9]+)/.exec(url)?.[1];
    expect(id, "checkout URL should hold a TEST session id").toBeTruthy();
    return stripe(`/v1/checkout/sessions/${id}?expand[]=line_items`);
  }

  // Marketing Assistant (single_site) is on hold, so only the Marketing Report can start a checkout.
  for (const [button, plan, interval, mode] of [["Get my report", "marketing_plan", "one_time", "payment"]] as const) {
    test(`${button}: opens Stripe Checkout with the right TEST price`, async ({ browser }, info) => {
      test.skip(!STRIPE_ON, NEED_STRIPE);
      const s = await startCheckout(browser, info, button);
      const price = TEST[plan]!.prices[interval]!;
      expect(s.mode).toBe(mode);
      expect(s.line_items.data).toHaveLength(1);
      expect(s.line_items.data[0].price.id).toBe(price);
      expect(s.line_items.data[0].price.product).toBe(TEST[plan]!.product);
      expect(s.client_reference_id).toBe(st(info).patOrg);
      expect(s.metadata).toMatchObject({ organization_id: st(info).patOrg, plan_id: plan, interval });
      expect(s.success_url).toContain("/app/billing?checkout=success");
      expect(s.livemode).toBe(false);
    });
  }

  test("Stripe's real subscription events grant Single Site; replays are harmless; forged events are refused", async ({ browser }, info) => {
    test.skip(!STRIPE_ON, NEED_STRIPE);
    const org = st(info).patOrg!;
    const custId = await testCustomer(email("pat", info));
    st(info).cust = custId;
    const sub = await stripe("/v1/subscriptions", { form: { customer: custId, "items[0][price]": TEST.single_site!.prices.month!, "metadata[organization_id]": org, "metadata[plan_id]": "single_site", "metadata[interval]": "month" } });
    st(info).sub = sub.id;
    expect(sub.status).toBe("active");

    let event: { id: string } | undefined;
    for (let i = 0; i < 20 && !event; i++) {
      const list = await stripe("/v1/events?type=customer.subscription.created&limit=20");
      event = list.data.find((e: { data: { object: { id: string } } }) => e.data.object.id === sub.id);
      if (!event) await new Promise((r) => setTimeout(r, 1500));
    }
    expect(event, "Stripe should have recorded the subscription event").toBeTruthy();

    expect((await deliver(event)).status).toBe(200);
    const again = await deliver(event);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect((await deliver(event, "whsec_forged_secret_value")).status).toBe(400);

    const pat = await asUser(email("pat", info));
    const { data: s } = await pat.from("subscriptions").select("plan_id,status,billing_interval,stripe_price_id").eq("organization_id", org).single();
    expect(s).toEqual({ plan_id: "single_site", status: "active", billing_interval: "month", stripe_price_id: TEST.single_site!.prices.month });
    const { data: ent } = await pat.rpc("current_entitlements", { p_org: org });
    expect(ent).toMatchObject({ plan: "single_site", analyses: true, weekly: true, drafts: "all" });
    // Paid access works after the free uses are gone.
    const { data: paid, error } = await pat.rpc("start_analysis", { p_org: org });
    expect(error).toBeNull();
    await pat.rpc("fail_analysis", { p_analysis: paid as string, p_reason: "e2e: closing the test run" });

    const c = await ctx(browser, info);
    const page = await c.newPage();
    await login(page, email("pat", info), "/app/billing");
    await expect(page.getByRole("heading", { name: "Marketing Assistant" })).toBeVisible();
    await expect(page.getByText("$79/month")).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage billing" })).toBeVisible();
    await noSideScroll(page);
    await axe(page);
    await c.close();
  });

  test("onboarding creates the business and starts the first check (with E2E_STRIPE=1: an annual subscription is shown as billed yearly)", async ({ browser }, info) => {
    const c = await ctx(browser, info);
    const page = await c.newPage();
    await login(page, email("buyer", info), "/app");
    await expect(page).toHaveURL(/\/app\/onboarding/);
    await page.getByLabel("Business name").fill("Buyer Plumbing");
    await page.getByLabel("Website", { exact: true }).fill(`buyer-${sfxOf(info)}.example`);
    await page.getByLabel("ZIP code").fill("75201");
    await axe(page);
    await page.getByRole("button", { name: "Check my website" }).click();
    await page.waitForURL(/\/app$/, { timeout: 30_000 });
    const buyer = await asUser(email("buyer", info));
    const { data: mem } = await buyer.from("organization_members").select("organization_id").limit(1).single();
    const org = mem!.organization_id as string;
    st(info).buyerOrg = org;
    const { data: bp } = await buyer.from("business_profiles").select("business_name,website,zip_code").eq("organization_id", org).single();
    expect(bp).toEqual({ business_name: "Buyer Plumbing", website: `https://buyer-${sfxOf(info)}.example/`, zip_code: "75201" });

    if (STRIPE_ON) {
      const buyerCust = await testCustomer(email("buyer", info));
      const sub = await stripe("/v1/subscriptions", { form: { customer: buyerCust, "items[0][price]": TEST.single_site!.prices.year!, "metadata[organization_id]": org, "metadata[plan_id]": "single_site", "metadata[interval]": "year" } });
      let event: { id: string } | undefined;
      for (let i = 0; i < 20 && !event; i++) {
        const list = await stripe("/v1/events?type=customer.subscription.created&limit=20");
        event = list.data.find((e: { data: { object: { id: string } } }) => e.data.object.id === sub.id);
        if (!event) await new Promise((r) => setTimeout(r, 1500));
      }
      expect((await deliver(event!)).status).toBe(200);
      await page.goto("/app/billing");
      await expect(page.getByRole("heading", { name: "Marketing Assistant" })).toBeVisible();
      await expect(page.getByText("$756 billed yearly")).toBeVisible();
      await stripe(`/v1/subscriptions/${sub.id}`, { method: "DELETE" });
      await stripe(`/v1/customers/${buyerCust}`, { method: "DELETE" });
    }
    await c.close();
  });

  test("a Marketing Plan purchase allows exactly one paid check", async ({ browser }, info) => {
    test.skip(!STRIPE_ON, NEED_STRIPE);
    const c = await ctx(browser, info);
    const page = await c.newPage();
    await login(page, email("mpbuyer", info), "/app");
    await page.getByLabel("Business name").fill("Marketing Plan Buyer");
    await page.getByLabel("Website", { exact: true }).fill(`mp-${sfxOf(info)}.example`);
    await page.getByLabel("ZIP code").fill("75201");
    await page.getByRole("button", { name: "Check my website" }).click();
    await page.waitForURL(/\/app$/, { timeout: 30_000 });
    const mp = await asUser(email("mpbuyer", info));
    const { data: mem } = await mp.from("organization_members").select("organization_id").limit(1).single();
    const org = mem!.organization_id as string;
    st(info).mpOrg = org;

    // A real TEST checkout session, then the event Stripe would send once it is paid.
    const cust = await stripe("/v1/customers", { form: { email: email("mpbuyer", info), "metadata[e2e]": "launch" } });
    const session = await stripe("/v1/checkout/sessions", { form: { mode: "payment", "line_items[0][price]": TEST.marketing_plan!.prices.one_time!, "line_items[0][quantity]": "1", customer: cust.id, client_reference_id: org, "metadata[organization_id]": org, "metadata[plan_id]": "marketing_plan", "metadata[interval]": "one_time", success_url: `${BASE}/app/billing?checkout=success`, cancel_url: `${BASE}/app/billing` } });
    expect(session.amount_total).toBe(4900);
    const paid = { ...session, payment_status: "paid", status: "complete" };
    const event = { id: `evt_e2e_${token().slice(0, 16)}`, object: "event", type: "checkout.session.completed", livemode: false, data: { object: paid } };
    expect((await deliver(event)).status).toBe(200);
    // A wrong amount is refused (the handler checks the catalog price).
    const bad = { ...event, id: `evt_e2e_${token().slice(0, 16)}`, data: { object: { ...paid, amount_total: 100 } } };
    expect((await deliver(bad)).status).toBe(500);

    const { data: ent } = await mp.rpc("current_entitlements", { p_org: org });
    expect(ent).toMatchObject({ plan: "marketing_plan", analyses: true, weekly: false, drafts: "none" });
    await page.goto("/app/billing");
    await expect(page.getByRole("heading", { name: "Marketing Report" })).toBeVisible();
    await expect(page.getByText("Paid $49")).toBeVisible();
    const { data: a, error } = await mp.rpc("start_analysis", { p_org: org });
    expect(error).toBeNull();
    await mp.rpc("complete_analysis", { p_analysis: a as string, p_evidence: fixture.evidence, p_cards: fixture.cards, p_coverage: fixture.coverage, p_summary: fixture.summary, p_wording: "template" });
    const { data: after } = await mp.rpc("current_entitlements", { p_org: org });
    expect((after as { plan: string | null }).plan).toBeNull(); // the one check is used
    await stripe(`/v1/customers/${cust.id}`, { method: "DELETE" });
    await c.close();
  });

  test.afterAll(async ({}, info) => {
    const s = S[info.project.name];
    try {
      if (s?.sub) await stripe(`/v1/subscriptions/${s.sub}`, { method: "DELETE" });
      if (s?.cust) await stripe(`/v1/customers/${s.cust}`, { method: "DELETE" });
    } catch {
      // already gone
    }
  });
});

test.describe("admin, access control and signed-in screens", () => {
  test("only platform admins see the funnel and feedback page", async ({ browser }, info) => {
    const a = await ctx(browser, info);
    const ap = await a.newPage();
    await login(ap, email("admin", info), "/admin/funnel");
    await expect(ap.getByRole("heading", { name: "Funnel and feedback" })).toBeVisible();
    await expect(ap.getByRole("row", { name: /Homepage visits/ })).toBeVisible();
    await expect(ap.getByText("What stopped you").first()).toBeVisible();
    await expect(ap.getByText("I want to compare plans first").first()).toBeVisible();
    await expect(ap.getByText("One follow-up OK:").first()).toBeVisible();
    await noSideScroll(ap);
    await axe(ap);
    await a.close();

    const n = await ctx(browser, info);
    const np = await n.newPage();
    await login(np, email("other", info), "/app");
    for (const path of ["/admin", "/admin/funnel", "/admin/agent-runs"]) {
      const res = await np.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    await n.close();
  });

  test("signed-in screens fit the phone, pass axe, and use plain words", async ({ browser }, info) => {
    const c = await ctx(browser, info);
    const page = await c.newPage();
    await login(page, email("pat", info), "/app");
    for (const path of ["/app", "/app/actions", "/app/analysis", "/app/activity", "/app/billing", "/app/upgrade", "/app/settings", "/app/connections"]) {
      await page.goto(path);
      await noSideScroll(page);
      await axe(page);
      const text = await page.locator("main").innerText();
      expect(text, path).not.toMatch(BANNED);
    }
    if (sfxOf(info) === "m") {
      await page.goto("/app");
      await expect(page.getByRole("navigation", { name: "Sections" }).last()).toBeVisible();
    }
    await c.close();
  });

  test("one customer cannot see another's data, and anonymous visitors see nothing", async ({}, info) => {
    const pat = await asUser(email("pat", info));
    const other = await asUser(email("other", info));
    const { data: patOrgs } = await pat.from("organizations").select("id");
    const { data: otherOrgs } = await other.from("organizations").select("id");
    expect(patOrgs!.length).toBeGreaterThan(0);
    expect(otherOrgs).toEqual([]);
    for (const t of ["analyses", "action_cards", "agent_runs", "approvals", "subscriptions", "purchases", "activity_log", "business_profiles"]) {
      const { data } = await other.from(t).select("*");
      expect(data, t).toEqual([]);
    }
    const { error: noFree } = await other.rpc("free_uses", { p_org: st(info).patOrg! });
    expect(noFree).not.toBeNull();
    const an = anon();
    for (const t of ["previews", "feedback", "feedback_followups", "funnel_events", "app_config", "billing_customers", "integration_events"]) {
      const { error } = await an.from(t).select("*").limit(1);
      expect(error, `${t} must not be readable`).not.toBeNull();
    }
    const { error: noKey } = await an.rpc("site_track", { p_key: "x".repeat(40), p_event: "homepage_visit", p_props: {} });
    expect(noKey?.message).toMatch(/Forbidden/);
    const { error: noAdmin } = await other.rpc("admin_funnel", { p_days: 30 });
    expect(noAdmin?.message).toMatch(/Forbidden/);
    // Another account cannot start work for this business or read its free-use count.
    const { error: cross } = await other.rpc("start_analysis", { p_org: st(info).patOrg! });
    expect(cross?.message).toMatch(/Forbidden/);
  });
});
