import { expect, test } from "../fixtures";
import { noSideScroll } from "../fixtures/auth";

test.describe("action board (To do)", () => {
  test("open, done and dismissed views and the impact filters work", async ({ page }) => {
    await page.goto("/app/actions");
    const filters = page.getByRole("navigation", { name: "Filter actions" });
    await expect(filters.getByRole("link", { name: "To do" })).toHaveAttribute("aria-current", "page");
    await filters.getByRole("link", { name: "Done" }).click();
    await expect(page).toHaveURL(/show=done/);
    await expect(filters.getByRole("link", { name: "Done" })).toHaveAttribute("aria-current", "page");
    await filters.getByRole("link", { name: "Dismissed" }).click();
    await expect(page).toHaveURL(/show=dismissed/);
    await page.goto("/app/actions");
    await filters.getByRole("link", { name: /Medium impact/ }).click();
    await expect(page).toHaveURL(/impact=medium/);
    await filters.getByRole("link", { name: /Medium impact/ }).click(); // click again to clear
    await expect(page).not.toHaveURL(/impact=/);
    await noSideScroll(page);
  });

  test("dismissing moves a recommendation to Dismissed, and reopening brings it back", async ({ page }) => {
    await page.goto("/app/actions");
    const card = page.locator("main .list > *").first();
    const title = (await card.getByRole("heading").first().innerText()).trim();
    await card.getByRole("link", { name: /See why it matters/ }).click();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
    await expect(page.getByText(/Mark it done when it.s fixed/)).toHaveCount(0); // a closed item no longer asks to be done
    await page.goto("/app/actions?show=dismissed");
    await expect(page.locator("main .list")).toContainText(title);
    await page.locator("main .list").getByRole("link", { name: /See why it matters/ }).first().click();
    await page.getByRole("button", { name: "Reopen" }).click();
    // Wait for the reopen to finish (the open-state buttons come back) before leaving the page, or the request is cut off.
    await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await page.goto("/app/actions");
    await expect(page.locator("main .list")).toContainText(title);
  });

  test("an empty view says so instead of showing a blank page", async ({ page }) => {
    await page.goto("/app/actions?show=done");
    await expect(page.locator("main")).toContainText(/nothing|no .* yet|all clear|empty/i);
  });
});
