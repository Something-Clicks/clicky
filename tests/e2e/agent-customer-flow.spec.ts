/**
 * The owner's day-to-day flow in a real browser, against the app running locally on clicky-dev (no model exists):
 * Home → the free-uses-used-up state → a check that cannot finish (the business's website is not reachable from here, a real
 * failure) → plain-words failure on Home → open a recommendation → approve it → dismiss another → reopen → a member cannot approve.
 * Run with E2E_AGENT=1 after tests/e2e/agent-seed.sql (see docs/launch/LAUNCH_CHECKLIST.md, "Marketing Agent screens").
 *
 * What is real: the app server, Supabase Auth, RLS, the database functions behind check, approve and dismiss.
 * What is not covered: scanning a REAL reachable website (this sandbox cannot reach public sites).
 */
import { expect, test, type Page } from "@playwright/test";

const ON = process.env.E2E_AGENT === "1";
const PASSWORD = "E2e-Passw0rd!7";
test.skip(!ON, "Set E2E_AGENT=1 with the clicky-dev environment and fixtures (see checklist).");
test.describe.configure({ mode: "serial", timeout: 120_000 });

async function login(page: Page, addr: string, next = "/app") {
  await page.addInitScript(() => { try { window.localStorage.setItem("sc_consent", "no"); } catch {} });
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email", { exact: true }).fill(addr);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
const INTERNALS = /ENOTFOUND|ECONN|fetch failed|stack|TypeError|supabase|postgres|rpc|undefined|\[object/i;

test.describe("owner: Home, a check that cannot finish, and deciding on recommendations", () => {
  test("Home shows what to do next, the way to the details and the plan, and fits the screen", async ({ page }) => {
    await login(page, "pat-d@e2e.test");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main .pill", { hasText: "claim-d.example" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your next move" })).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: /Business details|detail.* about your business to check/ }).first()).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: /plan/i }).first()).toBeVisible();
    await noSideScroll(page);
  });

  test("when the free uses are used up, Home says so plainly and the way forward is the plans page", async ({ page }) => {
    await login(page, "pat-d@e2e.test");
    const pill = page.getByRole("link", { name: "Free uses used up" });
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute("href", "/app/upgrade");
    await expect(page.getByRole("button", { name: /Check again|Check my website/ })).toHaveCount(0); // no dead button
    await page.getByRole("link", { name: "See plans" }).first().click();
    await expect(page).toHaveURL(/\/app\/upgrade/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noSideScroll(page);
  });

  test("a check that cannot reach the website ends in plain words on Home, not a crash or internals", async ({ page }) => {
    await login(page, "buyer-d@e2e.test"); // a business with free uses left whose website cannot be reached from here
    await page.getByRole("button", { name: /Check again|Check my website/ }).first().click();
    const notice = page.getByRole("alert").filter({ hasText: "The last check didn't finish." });
    await expect(async () => {
      await page.reload();
      await expect(notice).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000, intervals: [3_000] });
    const text = (await notice.innerText()).trim();
    expect(text).toMatch(/couldn't reach|isn't a public website|couldn't find|didn't let us in|trouble answering|address/i);
    expect(text).toMatch(/didn't use one of your free uses/);
    expect(text).not.toMatch(INTERNALS);
    await noSideScroll(page);
    await page.goto("/app/analysis"); // the Website check page tells the same story
    await expect(page.getByRole("alert").filter({ hasText: /reach|public|find|let us in|trouble|address/i })).toBeVisible();
  });

  test("the owner approves one recommendation, dismisses another, and can reopen it", async ({ page }) => {
    await login(page, "pat-d@e2e.test", "/app/actions");
    const links = page.locator('a[href^="/app/actions/"]');
    await expect(links.first()).toBeVisible();
    const hrefs = await links.evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!))]);
    expect(hrefs.length).toBeGreaterThanOrEqual(2);

    // Approve (agreement, not completion): the Approve button goes away, "done" is still offered.
    await page.goto(hrefs[0]!);
    await expect(page.getByRole("button", { name: "Mark done" })).toBeVisible(); // the page has finished rendering
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    if (await approve.count()) {
      await approve.click();
      await expect(approve).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: "Mark done" })).toBeVisible();
    await expect(page.getByText(/Approved/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Do this on your website" }).or(page.getByRole("heading", { name: /draft/i })).first()).toBeVisible();

    // Dismiss another, then reopen it so the business is left as it was.
    await page.goto(hrefs[1]!);
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("heading", { name: "Dismissed" })).toBeVisible();
    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await noSideScroll(page);
  });

  test("a member of the business cannot approve a recommendation", async ({ page }) => {
    await login(page, "other-d@e2e.test", "/app/actions");
    const first = page.locator('a[href^="/app/actions/"]').first();
    await expect(first).toBeVisible();
    await page.goto((await first.getAttribute("href"))!);
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark done" })).toBeVisible();
  });
});
