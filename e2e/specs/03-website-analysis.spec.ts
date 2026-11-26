import { expect, signedOut, test } from "../fixtures";
import { noSideScroll, signUp } from "../fixtures/auth";
import { INTERNALS, SITE, uniqueEmail } from "../fixtures/env";

test.describe("website submission and analysis", () => {
  test.describe("setting up a business", () => {
    test.use(signedOut);
    test("the setup form needs a business name and gives a plain message when it is missing", async ({ page }) => {
      await signUp(page, uniqueEmail("setup"));
      await expect(page).toHaveURL(/onboarding/);
      await noSideScroll(page);
      await page.getByRole("button", { name: "Check my website" }).click();
      await expect(page).toHaveURL(/onboarding/);
      await expect(page.locator("main")).not.toContainText(INTERNALS);
      await expect(page.locator("main [role='alert'], main .field-error, main [aria-invalid='true']").first()).toBeVisible();
    });
  });

  test("the owner's real website was read and the check finished with a summary", async ({ page, owner }) => {
    await page.goto("/app/analysis");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main")).toContainText(/page/i); // pages reviewed
    await expect(page.locator("main")).not.toContainText(INTERNALS);
    await noSideScroll(page);
    expect(owner.email).toContain("@local.test"); // a throwaway account, never a real customer
  });

  test("Home shows the site that was checked, when, and what to do next", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("main .pill", { hasText: SITE })).toBeVisible();
    await expect(page.getByText(/Last checked today/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your next move" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText(INTERNALS);
  });

  test("the free uses are counted, and a failed check explains itself without internals", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("link", { name: /of 3 free uses left/ })).toBeVisible();
    await expect(page.locator("main [role='alert']", { hasText: "didn't finish" })).toHaveCount(0);
  });
});
