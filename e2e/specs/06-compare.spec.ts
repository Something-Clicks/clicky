import { COMPARE_SITES, INTERNALS } from "../fixtures/env";
import { expect, test } from "../fixtures";
import { noSideScroll } from "../fixtures/auth";

const SITES = COMPARE_SITES;
const LAST = SITES[SITES.length - 1]!;

test.describe("compare", () => {
  test("the page explains what it does and what it will not do", async ({ page }) => {
    await page.goto("/app/research");
    await expect(page.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
    await expect(page.getByText(/Only the websites you type here are read; nothing is read until you ask/)).toBeVisible();
    await expect(page.locator("main")).not.toContainText(INTERNALS);
    await noSideScroll(page);
  });

  test("finding similar businesses gives a plain outcome: candidates with their sources, or an honest reason, and never anything unread", async ({ page }) => {
    await page.goto("/app/research");
    await expect(page.getByRole("heading", { name: "Find similar businesses" })).toBeVisible();
    await page.getByRole("button", { name: "Find similar businesses" }).click();
    // The public sources can be slow or push back, so any plain outcome is acceptable; what must always hold is below.
    const outcome = page.getByText(/Why it's here|didn't find anyone to suggest|couldn't look just now|Give it a minute|Add your service area first|No confirmed or suggested services|asked us to slow down|didn't answer/);
    await expect(outcome.first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/not proof they compete/).or(page.getByText(/Add your service area first|No confirmed or suggested services|Give it a minute|couldn't look just now/)).first()).toBeVisible();
    // Nothing is saved or read until the owner ticks some and presses Compare.
    await expect(page.locator("main")).not.toContainText(INTERNALS);
    await noSideScroll(page);
  });

  test("reads real public homepages, reports an unreadable entry whole, and shows a plain table", async ({ page }) => {
    await page.goto("/app/research");
    await page.getByLabel(/Websites to compare/).fill(`${SITES.join("\n")}\nnot a site at all`);
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.getByText(new RegExp(`Compared ${SITES.length} websites?\\.`))).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/couldn't read not a site at all/)).toBeVisible();
    const table = page.getByRole("table");
    for (const site of SITES) await expect(table.getByRole("columnheader", { name: site })).toBeVisible();
    await expect(table.getByRole("row", { name: /phone number/i }).first()).toBeVisible();
    await expect(page.getByText(/doesn't mean the claim is true/)).toBeVisible();
    await expect(page.locator("main")).not.toContainText(INTERNALS);
    await noSideScroll(page);
  });

  test("more than five sites is refused with a plain message", async ({ page }) => {
    await page.goto("/app/research");
    await page.getByLabel(/Websites to compare/).fill("a1.example\na2.example\na3.example\na4.example\na5.example\na6.example");
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.getByText(/more than 5/i)).toBeVisible();
  });

  test("a site can be removed, and the next step leads to campaigns when there are gaps", async ({ page }) => {
    await page.goto("/app/research");
    await page.getByRole("button", { name: `Remove ${LAST}` }).click();
    await expect(page.getByRole("columnheader", { name: LAST })).toHaveCount(0);
    await page.getByLabel(/Websites to compare/).fill(LAST);
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.getByRole("columnheader", { name: LAST })).toBeVisible({ timeout: 90_000 });
    const next = page.getByRole("link", { name: /Turn this into tasks|See your campaigns/ });
    await expect(next).toBeVisible();
    await next.click();
    await expect(page).toHaveURL(/\/app\/campaigns$/);
  });
});
