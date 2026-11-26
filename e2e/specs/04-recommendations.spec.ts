import { expect, test } from "../fixtures";
import { INTERNALS } from "../fixtures/env";

test.describe("recommendations", () => {
  test("each recommendation says what, why it matters, what to do and shows its evidence", async ({ page }) => {
    await page.goto("/app/actions");
    const first = page.locator("main .list > *").first();
    await expect(first).toBeVisible();
    await expect(first).toContainText(/impact/i);
    await expect(first.locator(".evidence").first()).toContainText(/Evidence \((observed|measured|missing)\)/i);
    await first.getByRole("link", { name: /See why it matters/ }).click();
    await expect(page).toHaveURL(/\/app\/actions\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
    await expect(page.locator("main .evidence").first()).toBeVisible();
    await expect(page.getByText(/not a guaranteed result/i)).toBeVisible(); // no promised outcomes
    await expect(page.locator("main")).not.toContainText(INTERNALS);
    await expect(page.locator("main")).not.toContainText(/\bAI\b|artificial intelligence/i);
  });

  test("the owner can approve a recommendation, and approval is not completion", async ({ page }) => {
    await page.goto("/app/actions");
    await page.locator("main .list").getByRole("link", { name: /See why it matters/ }).first().click();
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    if (await approve.count()) {
      await approve.click();
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: "Mark done" })).toBeVisible(); // still open: someone has to do it
    await expect(page.getByText(/Verified fixed/i)).toHaveCount(0);
  });

  test("a missing recommendation shows the friendly not-found page", async ({ page }) => {
    await page.goto("/app/actions/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("heading", { name: /couldn.t find/i })).toBeVisible();
  });
});
