/**
 * Marketing Agent screens in a real browser: Your plan, Business details, and the internal agent review page,
 * signed in as real clicky-dev test accounts, with the app running locally against clicky-dev.
 * Run only with E2E_AGENT=1 (see docs/launch/LAUNCH_CHECKLIST.md, "Marketing Agent screens").
 *
 * What is real: the app server, Supabase Auth, RLS, the database functions behind approve / confirm / reject.
 * What is stood in: the plan, the business details, the usage rows and the workflow record are FIXTURES written by SQL
 * (provider "e2e-fixture"), because this sandbox cannot call a model. These tests show the screens render, authorize
 * and decide correctly; they say nothing about the quality of anything a model writes.
 * No model is configured on this server, so "Revise the plan" must answer with the plain "not switched on" message.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ON = process.env.E2E_AGENT === "1";
const PASSWORD = "E2e-Passw0rd!7";
const PROD_BASE = process.env.E2E_PROD_BASE ?? ""; // a second server started with VERCEL_ENV=production
test.skip(!ON, "Set E2E_AGENT=1 with the clicky-dev environment and fixtures (see checklist).");
test.describe.configure({ mode: "serial", timeout: 90_000 });

async function login(page: Page, addr: string, base = "", next = "/app") {
  await page.addInitScript(() => { try { window.localStorage.setItem("sc_consent", "no"); } catch {} });
  await page.goto(`${base}/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email", { exact: true }).fill(addr);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}
const suffix = (info: { project: { name: string } }) => (info.project.name.includes("iphone") ? "m" : "d");
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
async function axe(page: Page) {
  const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

// The fixtures belong to the "d" accounts' business (claim-d.example); the phone run reuses the same data read-only.
test.describe("owner: Your plan and Business details", () => {
  test("the plan shows what to do, in order, with reasons, and nothing is applied", async ({ page }, info) => {
    test.skip(suffix(info) === "m", "mutating checks run once, on the desktop project");
    await login(page, "pat-d@e2e.test");
    await expect(page.getByRole("link", { name: "Your plan" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Business details" }).first()).toBeVisible();
    await page.goto("/app/plan");
    await expect(page.getByRole("heading", { name: "Your plan", level: 1 })).toBeVisible();
    await expect(page.getByText("Waiting for your review")).toBeVisible();
    await expect(page.getByText("Claim D Plumbing serves homeowners.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "In this order" })).toBeVisible();
    const first = page.getByRole("link", { name: "Give your homepage a clear main headline" });
    await expect(first).toBeVisible();
    await expect(page.getByText("after Give your homepage a clear main headline")).toBeVisible(); // dependency shown
    await expect(page.getByRole("heading", { name: "Later" })).toBeVisible();
    await expect(page.getByText("Do it after the headline is clear.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Help us make it better" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve this plan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Not for us" })).toBeVisible();
    await noSideScroll(page);
    await axe(page);
    await first.click(); // points at a real action of this business
    await expect(page).toHaveURL(/\/app\/actions\/[0-9a-f-]{36}/);
  });

  test("revising without a model gives the plain 'not switched on' message and changes nothing", async ({ page }, info) => {
    test.skip(suffix(info) === "m", "desktop only");
    await login(page, "pat-d@e2e.test", "", "/app/plan");
    await page.getByLabel("What should change?").fill("We cannot take weekend jobs.");
    await page.getByRole("button", { name: "Revise the plan" }).click();
    await expect(page.getByText("Plans aren't switched on yet.")).toBeVisible();
    await expect(page.getByText("Waiting for your review")).toBeVisible();
  });

  test("business details: confirm, reject, and a broken evidence link does not break the page", async ({ page }, info) => {
    test.skip(suffix(info) === "m", "desktop only");
    await login(page, "pat-d@e2e.test", "", "/app/business");
    await expect(page.getByRole("heading", { name: "Business details", level: 1 })).toBeVisible();
    await expect(page.getByText("Drain cleaning")).toBeVisible();
    await expect(page.getByText("A local, family-run alternative for home plumbing")).toBeVisible();
    await expect(page.getByText("Why we think so: Stresses family ownership and local service.")).toBeVisible();
    await expect(page.getByText("The site states it is family owned")).toBeVisible(); // its evidence url is the broken "http://"
    await noSideScroll(page);
    await axe(page);
    const card = page.locator("div", { has: page.getByText("Drain cleaning", { exact: true }) }).filter({ has: page.getByRole("button", { name: "That's right" }) }).last();
    await card.getByRole("button", { name: "That's right" }).click();
    await expect(page.getByText("Confirmed").first()).toBeVisible();
    const positioning = page.locator("div", { has: page.getByText("A local, family-run alternative for home plumbing", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Not right" }) }).last();
    await positioning.getByRole("button", { name: "Not right" }).click();
    await expect(page.getByText("A local, family-run alternative for home plumbing")).toHaveCount(0);
  });

  test("approving the plan: the owner decides, the status changes, and the buttons go away", async ({ page }, info) => {
    test.skip(suffix(info) === "m", "desktop only");
    await login(page, "pat-d@e2e.test", "", "/app/plan");
    await page.getByRole("button", { name: "Approve this plan" }).click();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve this plan" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    // approval is agreement, not completion: the actions it points at are still open
    await page.goto("/app/actions");
    await expect(page.getByText("Give your homepage a clear main headline").first()).toBeVisible();
  });
});

test.describe("member: sees the plan, cannot decide", () => {
  test("a member of the business has no approve buttons on the plan or the details", async ({ page }) => {
    await login(page, "other-d@e2e.test", "", "/app/plan");
    await expect(page.getByRole("heading", { name: "Your plan", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve this plan" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Want it different?" })).toBeVisible(); // members can ask for a revision
    await noSideScroll(page);
    await page.goto("/app/business");
    await expect(page.getByRole("button", { name: "That's right" })).toHaveCount(0);
  });
});

test.describe("internal agent review (platform admin)", () => {
  test("an admin sees runs beside their evidence, quality flags and spend; customers get a 404", async ({ page, browser }, info) => {
    await login(page, "admin-d@e2e.test", "", "/admin/agent-review");
    await expect(page.getByRole("heading", { name: "Agent review", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Model spend, last 7 days" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "claim-d.example" }).first()).toBeVisible();
    await expect(page.getByText("Supported by evidence").first()).toBeVisible();
    await page.getByText("Business details the agent proposed").first().click();
    await expect(page.getByText("(801) 555-0100")).toHaveCount(0); // contact details are never shown here
    await noSideScroll(page);
    // a business owner cannot open it
    const ctx = await browser.newContext(info.project.use);
    const owner = await ctx.newPage();
    await login(owner, "pat-d@e2e.test");
    const res = await owner.goto("/admin/agent-review");
    expect(res?.status()).toBe(404);
    await ctx.close();
  });
});

test.describe("hidden in Production", () => {
  test("with VERCEL_ENV=production the plan, business details and agent review do not exist for anyone", async ({ browser }, info) => {
    test.skip(!PROD_BASE || suffix(info) === "m", "needs a second server started with VERCEL_ENV=production (E2E_PROD_BASE)");
    const ctx = await browser.newContext(info.project.use);
    const page = await ctx.newPage();
    await login(page, "pat-d@e2e.test", PROD_BASE);
    // The signed-in layout streams first, so the HTTP status can read 200; what matters is what the person sees.
    for (const [path, heading] of [["/app/plan", "Your plan"], ["/app/business", "Business details"]] as const) {
      await page.goto(`${PROD_BASE}${path}`);
      await expect(page.getByText("We couldn't find that.")).toBeVisible();
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toHaveCount(0);
    }
    await page.goto(`${PROD_BASE}/app`);
    await expect(page.getByRole("link", { name: "Your plan" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Business details" })).toHaveCount(0);
    await ctx.close();
    const admin = await browser.newContext(info.project.use);
    const ap = await admin.newPage();
    await login(ap, "admin-d@e2e.test", PROD_BASE, "/admin");
    await ap.goto(`${PROD_BASE}/admin/agent-review`);
    await expect(ap.getByRole("heading", { name: "Agent review", level: 1 })).toHaveCount(0);
    await expect(ap.getByText(/could not be found|couldn't find that/i).first()).toBeVisible();
    await expect(ap.getByRole("link", { name: "Agent review" })).toHaveCount(0);
    await admin.close();
  });
});
