import { expect, type Page } from "@playwright/test";

import { PASSWORD } from "./env";

/** Analytics consent is off for ordinary tests so the banner never covers a button. */
export async function consent(page: Page, choice: "yes" | "no" = "no") {
  // Set once per browser tab, so a later change of mind (or a reload after it) is not undone by this script.
  await page.addInitScript((c) => {
    try {
      if (window.sessionStorage.getItem("e2e_consent_seeded")) return;
      window.sessionStorage.setItem("e2e_consent_seeded", "1");
      window.localStorage.setItem("sc_consent", c);
    } catch {}
  }, choice);
}

export async function signUp(page: Page, email: string, name = "E2E Tester") {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create|sign up|start/i }).first().click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
}

export async function logIn(page: Page, email: string, next = "/app") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

export const noSideScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

/**
 * Types the password and signs in. A refused sign-in is reported at once with the page's own message: it is never retried.
 * The only thing retried is the input being wiped before submit: after a refused attempt the form resets its fields (React
 * clears uncontrolled inputs when an action finishes), which can empty a password typed straight afterwards. That shows up as
 * the field's own "Enter your password" error, not as a refusal, so it is the only case that is safe to repeat.
 */
export async function signInWithPassword(page: Page, password: string = PASSWORD) {
  const field = page.locator("#f-password");
  for (let attempt = 1; attempt <= 3; attempt++) {
    await field.fill(password);
    await expect(field).toHaveValue(password); // what is about to be sent really is the password
    await page.getByRole("button", { name: "Sign in" }).click();
    const left = await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 }).then(() => true, () => false);
    if (left) return;
    if (!(await page.locator("#f-password-error").isVisible())) {
      const message = await page.getByRole("alert").first().innerText().catch(() => "(no message shown)");
      throw new Error(`Sign-in was refused: ${message}`);
    }
  }
  throw new Error("The password field was emptied before submit on every attempt");
}
