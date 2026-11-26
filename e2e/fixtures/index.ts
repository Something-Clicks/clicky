import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test as base } from "@playwright/test";

import { consent } from "./auth";

export interface OwnerMeta { email: string; orgId: string }
export const AUTH_DIR = join(__dirname, "..", ".auth");
/** Each browser project has its own throwaway owner, so projects never share (or depend on) each other's data. */
export const ownerFiles = (project: string) => ({
  state: join(AUTH_DIR, `owner-${project}.json`),
  meta: join(AUTH_DIR, `owner-${project}.meta.json`),
});

/**
 * `test` for the suite. Pages start with analytics consent declined. Signed-in projects start from the owner session the
 * setup project saved (a throwaway local account, never a real customer); `owner` is that account's email and business id.
 */
export const test = base.extend<{ owner: OwnerMeta; consentChoice: "yes" | "no" | null }>({
  /** Analytics consent a page starts with: "no" by default so the banner never covers a button; null = nothing chosen yet. */
  consentChoice: ["no", { option: true }],
  page: async ({ page, consentChoice }, provide) => {
    if (consentChoice) await consent(page, consentChoice);
    await provide(page);
  },
  owner: async ({}, provide, testInfo) => {
    await provide(JSON.parse(readFileSync(ownerFiles(testInfo.project.name.replace(/^e2e-/, "")).meta, "utf8")) as OwnerMeta);
  },
});
export { expect } from "@playwright/test";
export const signedOut = { storageState: { cookies: [], origins: [] } };
