/**
 * Creates the throwaway owner account the signed-in specs share: sign up, set up the business, and run a real website
 * check (a public site, read the way a customer's would be). Saves the browser session and the account's ids.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { consent, signUp } from "../fixtures/auth";
import { SITE, sql, uniqueEmail } from "../fixtures/env";
import { AUTH_DIR, ownerFiles } from "../fixtures";

setup.setTimeout(240_000);

setup("create the owner and run the first website check", async ({ page }, testInfo) => {
  // setup project names look like "e2e-setup-chromium": the part after "setup-" names the project this owner belongs to.
  const files = ownerFiles(testInfo.project.name.replace(/^e2e-setup-/, ""));
  mkdirSync(AUTH_DIR, { recursive: true });
  await consent(page, "no");
  const email = uniqueEmail("owner");
  await signUp(page, email, "Sam Owner");
  await expect(page).toHaveURL(/onboarding/);
  await page.getByLabel("Business name").fill("Walkthrough Plumbing");
  await page.getByLabel("Website").fill(SITE);
  await page.getByLabel("ZIP code").fill("84601");
  await page.getByRole("button", { name: "Check my website" }).click();
  await page.waitForURL((u) => !u.pathname.includes("onboarding"), { timeout: 120_000 });
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your next move" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 150_000, intervals: [4_000] });
  const orgId = sql(`select m.organization_id from public.organization_members m join auth.users u on u.id = m.user_id where u.email = '${email}' limit 1`);
  writeFileSync(files.meta, JSON.stringify({ email, orgId }));
  await page.context().storageState({ path: files.state });
});
