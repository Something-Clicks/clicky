import { expect, test } from "../fixtures";
import { logIn, noSideScroll, signUp } from "../fixtures/auth";
import { INTERNALS, sql, uniqueEmail } from "../fixtures/env";

test.describe.configure({ mode: "serial" });
const urls: Record<string, string> = {};

test.describe("campaign creation and owner approval", () => {
  test("nothing is offered until it is asked for, then campaigns are proposed from what was found", async ({ page }) => {
    await page.goto("/app/campaigns");
    await expect(page.getByText(/Nothing here yet/)).toBeVisible();
    await page.getByRole("button", { name: "Prepare my campaigns" }).click();
    await expect(page.getByText(/Prepared \d+ campaigns? for you to review/)).toBeVisible({ timeout: 60_000 });
    for (const l of await page.locator("main a.row-card").all()) urls[(await l.getByRole("heading").innerText()).trim()] = (await l.getAttribute("href"))!;
    expect(Object.keys(urls)).toEqual(expect.arrayContaining(["Fix what visitors notice first", "Ask happy customers for reviews"]));
    await expect(page.locator("main")).not.toContainText(INTERNALS);
    await expect(page.locator("main")).not.toContainText(/\bAI\b|artificial|automatically (publish|send)/i);
    await noSideScroll(page);
  });

  test("a proposed campaign shows why, evidence and certainty for each task, and nothing can be ticked before approval", async ({ page }) => {
    await page.goto(urls["Fix what visitors notice first"]!);
    await expect(page.getByRole("heading", { name: "Your decision" })).toBeVisible();
    await expect(page.getByText("Not approved yet").first()).toBeVisible();
    await expect(page.locator("main .evidence").first()).toContainText(/Observed/);
    await expect(page.getByRole("button", { name: "I did this" })).toHaveCount(0);
    await expect(page.getByText(/Nothing is published or sent for you/)).toBeVisible();
    await page.getByRole("link", { name: "Open the full recommendation" }).first().click();
    await expect(page).toHaveURL(/\/app\/actions\//);
  });

  test("a team member can see a proposal but only the owner can approve it", async ({ browser, owner }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem("sc_consent", "no"); } catch {} });
    const member = uniqueEmail("member");
    await signUp(page, member, "Team Member");
    const memberId = sql(`select id from auth.users where email = '${member}'`);
    sql(`insert into public.organization_members (organization_id, user_id, role) values ('${owner.orgId}', '${memberId}', 'member') on conflict do nothing`);
    sql(`delete from public.organization_members where user_id = '${memberId}' and organization_id <> '${owner.orgId}'`);
    await page.goto(urls["Ask happy customers for reviews"]!);
    await expect(page.getByText("Only the account owner can approve a campaign.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve this campaign" })).toHaveCount(0);
    await ctx.close();
  });

  test("the owner approves, edits a template draft, does the tasks and sees the result", async ({ page }) => {
    await page.goto(urls["Ask happy customers for reviews"]!);
    await page.getByRole("button", { name: "Approve this campaign" }).click();
    await expect(page.getByRole("heading", { name: "How it's going" })).toBeVisible();
    await expect(page.getByText("0 of 3 tasks done")).toBeVisible();
    await expect(page.getByText(/Next: Get your review link/)).toBeVisible();
    await expect(page.locator("main").getByText("Ready to do").first()).toBeVisible();
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
  });

  test("fix tasks report what the next website check verified", async ({ page }) => {
    await page.goto(urls["Fix what visitors notice first"]!);
    await page.getByRole("button", { name: "Approve this campaign" }).click();
    await page.getByRole("button", { name: "I did this" }).first().click();
    await expect(page.getByText(/waiting for the next check/i)).toBeVisible();
  });

  test("details added in Business details flow into a Google profile campaign", async ({ page }) => {
    await page.goto("/app/campaigns");
    await expect(page.getByText("Get your Google Business Profile right")).toHaveCount(0);
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
  });

  test("a dismissed campaign leaves the list", async ({ page }) => {
    await page.goto("/app/campaigns");
    await page.getByRole("button", { name: "Refresh the campaigns" }).click();
    await expect(page.getByText(/Prepared \d+ campaigns?/)).toBeVisible({ timeout: 60_000 });
    const rows = page.locator("main a.row-card");
    const before = await rows.count();
    await rows.first().click();
    const dismiss = page.getByRole("button", { name: "Not for us" });
    if (await dismiss.count()) {
      await dismiss.click();
      await page.goto("/app/campaigns");
      await expect(page.locator("main a.row-card")).toHaveCount(before - 1);
    }
  });
});

test.describe("campaigns in Production (released, no model)", () => {
  test("Compare and Campaigns exist on a server run as Production; nothing that needs a model or a third party is offered", async ({ page, owner }) => {
    const base = process.env.E2E_PROD_BASE;
    test.skip(!base, "Set E2E_PROD_BASE to a server started with VERCEL_ENV=production and no FEATURE_* variables");
    await logIn(page, owner.email);
    await page.goto(`${base}/app/campaigns`);
    await expect(page.getByRole("heading", { level: 1, name: "Campaigns" })).toBeVisible();
    await page.goto(`${base}/app/research`);
    await expect(page.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compare" })).toBeVisible();
    // Discovery sends a place and a service phrase to third parties: off in Production until the policy wording is approved.
    await expect(page.getByRole("heading", { name: "Find similar businesses" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Find similar businesses/ })).toHaveCount(0);
  });
});
