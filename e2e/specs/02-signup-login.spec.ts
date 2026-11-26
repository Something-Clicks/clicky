import { expect, signedOut, test } from "../fixtures";
import { logIn, noSideScroll, signInWithPassword, signUp } from "../fixtures/auth";
import { INTERNALS, PASSWORD, projectEmail, uniqueEmail } from "../fixtures/env";

test.use(signedOut);

test.describe("signup and login", () => {
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

  test("a new person can sign up and lands on setting up their business", async ({ page }, testInfo) => {
    await signUp(page, projectEmail("auth", testInfo.project.name), "Pat Tester");
    await expect(page).toHaveURL(/\/app\/onboarding/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("signing out ends the session and leads to the login page", async ({ page }, testInfo) => {
    await logIn(page, projectEmail("auth", testInfo.project.name));
    // Someone who has only signed up has no business yet, so Account sends them to setup. Sign out must be reachable there,
    // on a phone too (no sidebar), so use the button in the page itself, not the sidebar's.
    await page.goto("/app/settings");
    await expect(page).toHaveURL(/\/app\/onboarding$/);
    expect((await page.context().cookies()).some((c) => /auth-token/.test(c.name))).toBe(true); // signed in before
    await page.locator("main").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
    expect((await page.context().cookies()).some((c) => /auth-token/.test(c.name))).toBe(false); // session cleared
    for (const path of ["/app", "/app/onboarding", "/app/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(path);
    }
  });

  test("login works, remembers where you were going, and refuses a wrong password without detail", async ({ page }, testInfo) => {
    const email = projectEmail("auth", testInfo.project.name);
    await page.goto("/login?next=/app/settings");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Wrong-Passw0rd!1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).not.toContainText(INTERNALS);
    await expect(page).toHaveURL(/login/);
    await signInWithPassword(page);
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
