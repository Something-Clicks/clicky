/**
 * Microsoft Clarity (official @microsoft/clarity package) and GA4 only after consent. The app must be built with
 * CLARITY_ID and NEXT_PUBLIC_GA_MEASUREMENT_ID set (any value; the tag requests are intercepted and never leave this machine).
 */
import { consent } from "../fixtures/auth";
import { expect, OWNER_STATE, signedOut, test } from "../fixtures";

const CLARITY_ID = process.env.E2E_CLARITY_ID ?? "";
const GA_ID = process.env.E2E_GA_ID ?? "";
test.skip(!CLARITY_ID, "Set E2E_CLARITY_ID (the CLARITY_ID the app was built with) to test analytics consent");
test.use({ ...signedOut, consentChoice: null }); // start with nothing chosen: the banner must appear

async function watch(page: import("@playwright/test").Page) {
  const seen = { clarity: [] as string[], ga: [] as string[] };
  await page.route(/clarity\.ms|googletagmanager\.com|google-analytics\.com|c\.bing\.com/, async (route) => {
    const u = route.request().url();
    if (/clarity\.ms|c\.bing\.com/.test(u)) seen.clarity.push(u); else seen.ga.push(u);
    await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  return seen;
}

test.describe("analytics consent (Clarity and GA4)", () => {
  test("nothing loads before a choice, and 'No thanks' keeps it that way", async ({ page }) => {
    const seen = await watch(page);
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(seen.clarity).toEqual([]);
    expect(seen.ga).toEqual([]);
    expect(await page.evaluate(() => typeof (window as unknown as { clarity?: unknown }).clarity)).toBe("undefined");
    await page.getByRole("button", { name: "No thanks" }).click();
    await page.goto("/pricing");
    await page.waitForTimeout(1000);
    expect(seen.clarity).toEqual([]);
    expect(seen.ga).toEqual([]);
  });

  test("'Yes' loads the Clarity tag once, with the id from the server, and keeps GA4 alongside it", async ({ page }) => {
    const seen = await watch(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Yes" }).click();
    await expect.poll(() => seen.clarity.length).toBeGreaterThan(0);
    expect(seen.clarity.filter((u) => u.includes(`/tag/${CLARITY_ID}`))).toHaveLength(1);
    if (GA_ID) {
      await expect.poll(() => seen.ga.some((u) => u.includes(`id=${GA_ID}`))).toBe(true);
      expect(seen.ga.filter((u) => u.includes("gtag/js"))).toHaveLength(1);
    }
    // Moving around the site does not start it again.
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" }).click();
    await page.waitForTimeout(800);
    expect(seen.clarity.filter((u) => u.includes(`/tag/${CLARITY_ID}`))).toHaveLength(1);
    expect(await page.evaluate(() => localStorage.getItem("sc_consent"))).toBe("yes");
  });

  test("a returning visitor who said Yes loads it once on arrival; nothing personal is passed to it", async ({ page }) => {
    const seen = await watch(page);
    await consent(page, "yes");
    await page.goto("/");
    await expect.poll(() => seen.clarity.length).toBeGreaterThan(0);
    expect(seen.clarity.filter((u) => u.includes(`/tag/${CLARITY_ID}`))).toHaveLength(1);
    // Everything handed to the tag's queue is the consent signal or a plain event name.
    const calls = await page.evaluate(() => JSON.stringify(Array.from((window as unknown as { clarity: { q?: ArrayLike<unknown>[] } }).clarity.q ?? [], (a) => Array.from(a))));
    expect(calls).toMatch(/consentv2/i);
    expect(calls).not.toMatch(/identify|"set"|@|Walkthrough|Sam Owner/i);
    expect(seen.clarity.join(" ")).not.toMatch(/@|Walkthrough/);
  });

  test("withdrawing consent stops it on the next page load", async ({ page }) => {
    const seen = await watch(page);
    await consent(page, "yes");
    await page.goto("/");
    await expect.poll(() => seen.clarity.length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Cookie settings" }).click();
    await page.getByRole("button", { name: "No thanks" }).click();
    await page.waitForLoadState("load");
    expect(await page.evaluate(() => localStorage.getItem("sc_consent"))).toBe("no");
    seen.clarity.length = 0;
    await page.goto("/about");
    await page.waitForTimeout(1000);
    expect(seen.clarity).toEqual([]);
  });

  test("signed-in workspace pages never expose the account to the tag", async ({ browser, owner }) => {
    const ctx = await browser.newContext({ storageState: OWNER_STATE });
    const page = await ctx.newPage();
    const seen = await watch(page);
    await consent(page, "yes");
    await page.goto("/app");
    await expect.poll(() => seen.clarity.length).toBeGreaterThan(0);
    const dump = await page.evaluate(() => JSON.stringify(Array.from((window as unknown as { clarity: { q?: ArrayLike<unknown>[] } }).clarity.q ?? [], (a) => Array.from(a))));
    expect(dump).not.toContain(owner.email);
    expect(seen.clarity.join(" ")).not.toContain(encodeURIComponent(owner.email));
    // Forms and the workspace are masked for recordings.
    expect(await page.locator("[data-clarity-mask='true']").count()).toBeGreaterThan(0);
    await ctx.close();
  });
});
