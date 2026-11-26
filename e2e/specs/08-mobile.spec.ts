import { expect, test } from "../fixtures";
import { noSideScroll } from "../fixtures/auth";
import { INTERNALS } from "../fixtures/env";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

const SCREENS = ["/app", "/app/actions", "/app/analysis", "/app/research", "/app/campaigns", "/app/business", "/app/plan", "/app/settings"];

test.describe("mobile layout and navigation (390px)", () => {
  for (const path of SCREENS) {
    test(`${path} fits the screen, has one heading and no internals`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await noSideScroll(page);
      await expect(page.locator("main")).not.toContainText(INTERNALS);
    });
  }

  test("the bottom tab bar reaches Home, To do, Check and Account", async ({ page }) => {
    await page.goto("/app");
    const tabs = page.locator("nav").filter({ has: page.getByRole("link", { name: /^.?\s*Account$/ }) }).last();
    for (const [name, path] of [["To do", /\/app\/actions/], ["Check", /\/app\/analysis/], ["Account", /\/app\/settings/], ["Home", /\/app$/]] as const) {
      await tabs.getByRole("link", { name: new RegExp(name) }).click();
      await expect(page).toHaveURL(path);
    }
  });

  test("Compare and Campaigns are reachable from Home on a phone", async ({ page }) => {
    await page.goto("/app");
    await page.locator("main").getByRole("link", { name: "Compare" }).click();
    await expect(page).toHaveURL(/\/app\/research/);
    await page.goBack();
    await page.locator("main").getByRole("link", { name: /campaign|Campaigns|in progress/i }).first().click();
    await expect(page).toHaveURL(/\/app\/campaigns/);
  });

  test("buttons and tabs are big enough to tap (44px)", async ({ page }) => {
    for (const path of ["/app", "/app/campaigns", "/app/research"]) {
      await page.goto(path);
      const small = await page.locator("main button:visible, main .btn:visible, nav a:visible").evaluateAll((els) =>
        els.map((e) => ({ t: (e.textContent ?? "").trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h > 0 && x.h < 44),
      );
      expect(small, `${path} has controls under 44px`).toEqual([]);
    }
  });
});
