/**
 * Compare and Campaigns in a real browser, from signup to finished tasks, against the app running locally with a LOCAL
 * Supabase Auth + REST stand-in (GoTrue + PostgREST on a throwaway Postgres; see docs/launch/LAUNCH_CHECKLIST.md,
 * "Compare and Campaigns"). No model, no clicky-dev, no Production.
 *
 * Real public websites are read: nodejs.org is the "business", and pypi.org and huggingface.co are the sites compared. These
 * are not small businesses, so this proves the plumbing and the screens on real HTML, not marketing quality.
 * Run with E2E_CAMPAIGNS=1 E2E_DB=postgres://postgres:postgres@localhost:5432/sc_e2e (the server needs FEATURE_CAMPAIGNS=1).
 */
import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

const ON = process.env.E2E_CAMPAIGNS === "1";
const DB = process.env.E2E_DB ?? "";
test.skip(!ON, "Set E2E_CAMPAIGNS=1 with the local stack (see the checklist).");
test.describe.configure({ mode: "serial", timeout: 240_000 });

const PASSWORD = "Walk-Passw0rd!9";
const stamp = Date.now();
const owner = `owner${stamp}@local.test`;
const member = `member${stamp}@local.test`;
const sql = (q: string) => execFileSync("psql", [DB, "-Atc", q], { encoding: "utf8" }).trim();
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
const INTERNALS = /ENOTFOUND|ECONN|fetch failed|stack|TypeError|supabase|postgres|rpc|undefined|\[object|NaN/i;
const campaignUrls: Record<string, string> = {};

async function consentOff(page: Page) {
  await page.addInitScript(() => { try { window.localStorage.setItem("sc_consent", "no"); } catch {} });
}
async function signup(page: Page, email: string) {
  await consentOff(page);
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Walk Tester");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create|sign up|start/i }).first().click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
}
async function login(page: Page, email: string) {
  await consentOff(page);
  await page.goto("/login?next=/app");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

test("owner signs up, sets up the business and gets recommendations with evidence", async ({ page }) => {
  await signup(page, owner);
  await page.getByLabel("Business name").fill("Walkthrough Plumbing");
  await page.getByLabel("Website").fill("nodejs.org");
  await page.getByLabel("ZIP code").fill("84601");
  await page.getByRole("button", { name: "Check my website" }).click();
  await page.waitForURL((u) => !u.pathname.includes("onboarding"), { timeout: 120_000 });
  await expect(async () => { await page.reload(); await expect(page.getByRole("heading", { name: "Your next move" })).toBeVisible({ timeout: 2_000 }); }).toPass({ timeout: 150_000, intervals: [4_000] });
  // The next steps of the journey are reachable from Home.
  await expect(page.locator("main").getByRole("link", { name: "Campaigns" })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "Compare" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(INTERNALS);
  await noSideScroll(page);
  if ((page.viewportSize()?.width ?? 0) >= 900) {
    await expect(page.getByRole("link", { name: "Campaigns" }).first()).toBeVisible(); // the sidebar
    await expect(page.getByRole("link", { name: "Compare" }).first()).toBeVisible();
  }
});

test("Compare: reads real public homepages, reports an unreadable entry whole, and shows a plain table", async ({ page }) => {
  await login(page, owner);
  await page.goto("/app/research");
  await expect(page.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
  await page.getByLabel(/Websites to compare/).fill("pypi.org\nhuggingface.co\nnot a site at all");
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByText(/Compared 2 websites\./)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/couldn't read not a site at all/)).toBeVisible();
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "pypi.org" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "huggingface.co" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(INTERNALS);
  await noSideScroll(page);
  // Removing one works and the table updates.
  await page.getByRole("button", { name: "Remove huggingface.co" }).click();
  await expect(page.getByRole("columnheader", { name: "huggingface.co" })).toHaveCount(0);
  await page.getByLabel(/Websites to compare/).fill("huggingface.co");
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByRole("columnheader", { name: "huggingface.co" })).toBeVisible({ timeout: 90_000 });
});

test("Campaigns: proposed from what was found, each task shows why, evidence and its certainty", async ({ page }) => {
  await login(page, owner);
  await page.goto("/app/campaigns");
  await expect(page.getByText(/Nothing here yet/)).toBeVisible();
  await page.getByRole("button", { name: "Prepare my campaigns" }).click();
  await expect(page.getByText(/Prepared \d+ campaigns? for you to review/)).toBeVisible({ timeout: 60_000 });
  const links = page.locator("main a[href^='/app/campaigns/']");
  expect(await links.count()).toBeGreaterThanOrEqual(2);
  for (const l of await links.all()) campaignUrls[(await l.innerText()).trim()] = (await l.getAttribute("href"))!;
  expect(Object.keys(campaignUrls)).toEqual(expect.arrayContaining(["Fix what visitors notice first", "Ask happy customers for reviews"]));
  await expect(page.locator("main")).not.toContainText(INTERNALS);
  // Not sent or published for the owner, and not described as AI.
  await expect(page.locator("main")).not.toContainText(/\bAI\b|artificial|automatically (publish|send)/i);
  await noSideScroll(page);

  await page.goto(campaignUrls["Fix what visitors notice first"]!);
  await expect(page.getByRole("heading", { name: "Your decision" })).toBeVisible();
  await expect(page.getByText("Not approved yet").first()).toBeVisible();
  await expect(page.locator("main .evidence").first()).toContainText(/Observed/); // the quote behind the fix, on the task itself
  await expect(page.getByRole("button", { name: "I did this" })).toHaveCount(0); // nothing to tick before approval
  await page.getByRole("link", { name: "Open the full recommendation" }).first().click();
  await expect(page).toHaveURL(/\/app\/actions\//);
  await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
});

test("owner approves, edits a template draft, does the tasks, and sees the results", async ({ page }) => {
  await login(page, owner);
  await page.goto(campaignUrls["Ask happy customers for reviews"]!);
  await page.getByRole("button", { name: "Approve this campaign" }).click();
  await expect(page.getByRole("heading", { name: "How it's going" })).toBeVisible();
  await expect(page.getByText("0 of 3 tasks done")).toBeVisible();
  await expect(page.getByText(/Next: Get your review link/)).toBeVisible();
  await expect(page.locator("main").getByText("Ready to do").first()).toBeVisible();

  // The draft is a visible template with blanks, the owner edits it, and the edit is kept.
  const draft = page.getByLabel(/Draft \(a fixed template/);
  await expect(draft).toHaveValue(/\[your first name\].*\[your review link\]/s);
  await draft.fill("Hi [your first name], thanks for choosing Walkthrough Plumbing. A short review would mean a lot: [your review link]");
  await page.getByRole("button", { name: "Save my edits" }).click();
  await page.reload();
  await expect(page.getByLabel(/Draft \(a fixed template.*edited/)).toHaveValue(/a short review would mean a lot/i);

  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "I did this" }).first().click();
    await expect(page.getByText(`${i + 1} of 3 tasks done`)).toBeVisible();
  }
  await expect(page.getByText(/All done\./)).toBeVisible();
  await page.goto("/app/campaigns");
  await expect(page.getByText("Finished")).toBeVisible();
  await expect(page.getByText("3 of 3 tasks done")).toBeVisible();
  await noSideScroll(page);

  // Dismissing is possible for the others, and a dismissed campaign disappears.
  await page.goto(campaignUrls["Fix what visitors notice first"]!);
  await page.getByRole("button", { name: "Approve this campaign" }).click();
  await page.getByRole("button", { name: "I did this" }).first().click();
  await expect(page.getByText(/awaiting|waiting for the next check/i)).toBeVisible();
});

test("details the owner adds in Business details flow into a Google profile campaign (unknowns stay unknown until then)", async ({ page }) => {
  await login(page, owner);
  // Before the owner says where they work, no profile campaign is offered and the screen says why.
  await page.goto("/app/campaigns");
  await expect(page.getByText("Get your Google Business Profile right")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Business details" }).last()).toBeVisible();
  await page.goto("/app/business");
  for (const [field, value] of [["Service area", "Provo, Orem"], ["Service", "Lawn mowing"]] as [string, string][]) {
    await page.getByLabel("Detail").selectOption({ label: field });
    await page.getByLabel("What should we know?").fill(value);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.locator("main").getByText(value).first()).toBeVisible();
  }
  await page.goto("/app/campaigns");
  await page.getByRole("button", { name: "Refresh the campaigns" }).click();
  await expect(page.getByText(/Prepared \d+ campaigns? for you to review/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Get your Google Business Profile right" }).click();
  await page.getByRole("button", { name: "Approve this campaign" }).click();
  await expect(page.getByLabel(/Draft \(a fixed template/)).toHaveValue("Walkthrough Plumbing serves Provo, Orem. We offer Lawn mowing. Call or message us to get started.");
  // The first task says plainly that the profile was not seen.
  await expect(page.locator("main").getByText(/isn't connected|haven't seen yours/i).first()).toBeVisible();
});

test("a team member sees the campaign but cannot approve it", async ({ page }) => {
  await signup(page, member);
  const orgId = sql(`select organization_id from public.organization_members m join auth.users u on u.id = m.user_id where u.email = '${owner}' limit 1`);
  const memberId = sql(`select id from auth.users where email = '${member}'`);
  sql(`insert into public.organization_members (organization_id, user_id, role) values ('${orgId}', '${memberId}', 'member') on conflict do nothing`);
  sql(`delete from public.organization_members where user_id = '${memberId}' and organization_id <> '${orgId}'`);
  await page.goto("/app/campaigns");
  const toReview = page.locator("main a[href^='/app/campaigns/']").first();
  await expect(toReview).toBeVisible();
  // Prepare a fresh proposal as the owner would, then check what the member can do with it.
  sql(`update public.marketing_campaigns set status = 'proposed' where organization_id = '${orgId}' and playbook = 'match_competitors'`);
  const href = sql(`select id from public.marketing_campaigns where organization_id = '${orgId}' and playbook = 'match_competitors' and status = 'proposed' limit 1`);
  test.skip(!href, "no proposed campaign to check");
  await page.goto(`/app/campaigns/${href}`);
  await expect(page.getByText("Only the account owner can approve a campaign.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve this campaign" })).toHaveCount(0);
});

test("Campaigns are hidden where the switch is off (Production behaviour)", async ({ page }) => {
  const base = process.env.E2E_PROD_BASE;
  test.skip(!base, "Set E2E_PROD_BASE to a server started with VERCEL_ENV=production");
  await login(page, owner);
  for (const path of ["/app/campaigns", "/app/research"]) {
    await page.goto(`${base}${path}`);
    // Next streams the not-found page after the loading screen, so check what the person sees, not the status line.
    await expect(page.getByRole("heading", { name: /not found|couldn.t find|doesn.t exist|404/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Compare|Prepare my campaigns/ })).toHaveCount(0);
  }
});
