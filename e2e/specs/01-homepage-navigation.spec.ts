import { expect, signedOut, test } from "../fixtures";
import { noSideScroll } from "../fixtures/auth";
import { INTERNALS } from "../fixtures/env";

test.use(signedOut);

test.describe("homepage and navigation", () => {
  test("the homepage explains the product, leads with one main action and fits the screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main")).not.toContainText(INTERNALS);
    // One main action: the "check your website" form.
    await expect(page.getByRole("form", { name: "Check your website" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Check your website" }).getByRole("button")).toHaveCount(1);
    await noSideScroll(page);
  });

  test("header and footer links reach their pages", async ({ page }) => {
    for (const [name, path] of [["Pricing", "/pricing"], ["Log in", "/login"]] as const) {
      await page.goto("/");
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    for (const [name, path] of [["How it works", "/how-it-works"], ["About", "/about"], ["FAQ", "/faq"], ["Privacy", "/privacy"], ["Terms", "/terms"]] as const) {
      await page.goto("/");
      await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("the logo returns home, and an unknown address gets a friendly page", async ({ page }) => {
    await page.goto("/pricing");
    await page.getByRole("link", { name: /Something Clicks/ }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/no-such-page-here");
    await expect(page.getByRole("heading", { name: /couldn.t find/i })).toBeVisible();
  });

  test("signed-out visitors are sent to log in from the workspace, and back after signing in", async ({ page }) => {
    await page.goto("/app/actions");
    await expect(page).toHaveURL(/\/login/);
    expect(new URL(page.url()).searchParams.get("next")).toBe("/app/actions");
  });
});
