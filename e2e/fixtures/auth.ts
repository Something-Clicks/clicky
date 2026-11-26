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
