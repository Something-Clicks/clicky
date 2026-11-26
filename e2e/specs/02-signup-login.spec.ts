import { expect, signedOut, test } from "../fixtures";
import { logIn, noSideScroll, signUp } from "../fixtures/auth";
import { INTERNALS, PASSWORD, uniqueEmail } from "../fixtures/env";

test.use(signedOut);

test.describe("signup and login", () => {
  const email = uniqueEmail("auth");

  test("signup asks for what it needs, explains problems in plain words, and fits the screen", async ({ page }) => {
    await page.goto("/signup");
    await noSideScroll(page);
    await page.getByRole("button", { name: /create|sign up|start/i }).first().click();
    await expect(page.getByRole("alert").or(page.locator(".field-error, [aria-invalid='true']")).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(INTERNALS);
    // Each field now carries its own message, so address the fields directly.
    await expect(page.locator("#f-email-error")).toHaveText(/valid email/i);
    await page.locator("#f-fullName").fill("Pat Tester");
    await page.locator("#f-email").fill("not-an-email");
    await page.locator("#f-password").fill("short");
    await page.getByRole("button", { name: /create|sign up|start/i }).first().click();
    await expect(page).toHaveURL(/signup/);
  });

  test("a new person can sign up and lands on setting up their business", async ({ page }) => {
    await signUp(page, email, "Pat Tester");
    await expect(page).toHaveURL(/\/app\/onboarding/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("signing out ends the session; the workspace then needs a login", async ({ page }) => {
    await logIn(page, email);
    // A person who has only signed up is still on business setup, which has no Sign out on a phone. Finish setup first
    // (no website needed), then sign out from Account.
    if (page.url().includes("/onboarding")) {
      await page.getByLabel("Business name").fill("Sign Out Cafe");
      await page.getByRole("button", { name: "Check my website" }).click();
      await page.waitForURL((u) => !u.pathname.includes("onboarding"), { timeout: 60_000 });
    }
    await page.goto("/app/settings");
    await page.getByRole("button", { name: /sign out/i }).first().click();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login works, remembers where you were going, and refuses a wrong password without detail", async ({ page }) => {
    await page.goto("/login?next=/app/settings");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Wrong-Passw0rd!1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).not.toContainText(INTERNALS);
    await expect(page).toHaveURL(/login/);
    // The form clears the password after a refused attempt; wait for that before typing the right one.
    await expect(page.locator("#f-password")).toHaveValue("");
    await page.locator("#f-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await expect(page).toHaveURL(/\/app\/settings/); // back where they were going
  });

  test("an address that doesn't belong to an account gets the same plain refusal", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(uniqueEmail("nobody"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  });
});
