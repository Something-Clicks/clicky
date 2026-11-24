/**
 * Public journey (no database needed): homepage, start form, sign-up hand-off, pricing,
 * consent and analytics, legal drafts, access control, layout at 390px, accessibility.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PUBLIC_PAGES = ["/", "/pricing", "/how-it-works", "/about", "/faq", "/login", "/signup", "/forgot-password", "/privacy", "/terms"];
const BANNED = /\b(AI|agents?|prompts?|campaigns?)\b/;
const ANALYTICS = /googletagmanager\.com|google-analytics\.com|clarity\.ms/;

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, "page must not scroll sideways").toBeLessThanOrEqual(client);
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Decide consent first so the banner never covers what a test is looking at (unless the test is about consent). */
async function decline(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sc_consent", "no");
    } catch {}
  });
}

test.describe("every public page", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path}: fits the screen, passes axe, and uses plain words`, async ({ page }) => {
      await decline(page);
      await page.goto(path);
      await noHorizontalScroll(page);
      await axe(page);
      if (!["/privacy", "/terms"].includes(path)) {
        const text = await page.locator("main").innerText();
        expect(text).not.toMatch(BANNED);
      }
    });
  }
});

test("homepage: headline from the config slot, one primary action, tappable targets", async ({ page }) => {
  await decline(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Know exactly what to fix next");
  const main = page.locator("main");
  await expect(main.getByRole("button")).toHaveCount(1);
  await expect(main.getByRole("button", { name: "Check my website" })).toBeVisible();
  await expect(page.getByLabel("Website", { exact: true })).toBeVisible();
  await expect(page.getByLabel("ZIP code", { exact: true })).toBeVisible();
  // Every link and button on the page is at least 44px tall (or wide, for inline links in text).
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("header a, main a, main button, main input:not([type=hidden]), footer a, footer button")]
      .filter((el) => el.offsetParent !== null && !el.closest(".trap"))
      .map((el) => ({ el: el.outerHTML.slice(0, 80), h: el.getBoundingClientRect().height }))
      .filter((x) => x.h < 44),
  );
  expect(small).toEqual([]);
});

test("start form: explains mistakes, then hands the website to sign-up", async ({ page }) => {
  await decline(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Check my website" }).click();
  await expect(page.getByText("Enter your website, like example.com.")).toBeVisible();
  await expect(page.getByText("Enter a 5-digit ZIP code.")).toBeVisible();

  await page.getByLabel("Website", { exact: true }).fill("not a website");
  await page.getByLabel("ZIP code", { exact: true }).fill("7520");
  await page.getByRole("button", { name: "Check my website" }).click();
  await expect(page.getByText("Enter a website address like https://example.com.")).toBeVisible();

  await page.getByLabel("Website", { exact: true }).fill("www.sunrise-plumbing.example");
  await page.getByLabel("ZIP code", { exact: true }).fill("75201");
  await page.getByRole("button", { name: "Check my website" }).click();
  // Free first result is off here (as in production until the Privacy Policy is published).
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Let's check sunrise-plumbing.example");
});

test("pricing: exact names and prices; unavailable plans can't be bought", async ({ page }) => {
  await decline(page);
  await page.goto("/pricing");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Marketing Plan" })).toBeVisible();
  await expect(main.getByText("$49 one-time")).toBeVisible();
  await expect(main.getByRole("heading", { name: "Single Site" })).toBeVisible();
  await expect(main.getByText("$79/month", { exact: true })).toBeVisible();
  await expect(main.getByText("or $756 billed yearly")).toBeVisible();
  const soon = main.getByRole("table");
  await expect(soon.getByRole("row", { name: /Business Plus \$179\/month \$1,716 billed yearly/ })).toBeVisible();
  await expect(soon.getByRole("row", { name: /Multi-Site \$399\/month \$3,828 billed yearly/ })).toBeVisible();
  // Buy links exist only for Marketing Plan and Single Site.
  const hrefs = await main.locator("a[href*='plan=']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(hrefs.sort()).toEqual([
    "/app/upgrade?plan=marketing_plan&interval=one_time",
    "/app/upgrade?plan=single_site&interval=month",
    "/app/upgrade?plan=single_site&interval=year",
  ]);
  expect(await main.innerText()).not.toMatch(/Solo|Growth AI|Starter AI|Scale|Diagnostic Audit|\$39\b/);
});

test("old Diagnostic Audit links go to pricing", async ({ page }) => {
  await decline(page);
  await page.goto("/diagnostic-audit");
  await expect(page).toHaveURL(/\/pricing$/);
});

test.describe("consent and analytics", () => {
  test("nothing loads before Yes; No keeps it off; the choice can be changed", async ({ page }) => {
    const analytics: string[] = [];
    await page.route(ANALYTICS, (route) => {
      analytics.push(route.request().url());
      return route.abort();
    });
    await page.goto("/pricing?ref=secret-token");
    const banner = page.getByRole("dialog", { name: /measure how people use this site/ });
    await expect(banner).toBeVisible();
    await page.waitForTimeout(500);
    expect(analytics).toEqual([]);
    expect(await page.evaluate(() => Boolean((window as unknown as Record<string, unknown>).dataLayer || (window as unknown as Record<string, unknown>).clarity))).toBe(false);

    await banner.getByRole("button", { name: "No thanks" }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await page.waitForTimeout(500);
    await expect(banner).toBeHidden();
    expect(analytics).toEqual([]);

    await page.getByRole("button", { name: "Cookie settings" }).click();
    await page.getByRole("button", { name: "Yes" }).click();
    await expect.poll(() => analytics.length).toBeGreaterThan(0);
    expect(analytics.some((u) => u.includes("googletagmanager.com/gtag/js"))).toBe(true);
    expect(analytics.some((u) => u.includes("clarity.ms/tag/"))).toBe(true);
    // Page views carry the path only: no query strings (they can hold sign-in codes), no emails.
    const sent = await page.evaluate(() => JSON.stringify((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? []));
    expect(sent).toContain("page_view");
    expect(sent).not.toContain("secret-token");
    expect(sent).not.toMatch(/@/);
  });

  test("forms and the workspace are masked in recordings", async ({ page }) => {
    await decline(page);
    await page.goto("/login");
    await expect(page.locator("[data-clarity-mask=true]").first()).toBeVisible();
  });
});

test("legal pages are marked as drafts and name every service that handles data", async ({ page }) => {
  await decline(page);
  for (const path of ["/privacy", "/terms"]) {
    await page.goto(path);
    await expect(page.getByText("Draft for attorney review.")).toBeVisible();
  }
  await page.goto("/privacy");
  const text = await page.locator("main").innerText();
  for (const name of ["Supabase", "Stripe", "Anthropic", "Resend", "Vercel", "Google Analytics", "Microsoft Clarity"]) {
    expect(text).toContain(name);
  }
  expect(text).toContain("AI service");
});

test.describe("access control", () => {
  for (const path of ["/app", "/app/billing", "/app/upgrade", "/admin", "/admin/funnel"]) {
    test(`${path} sends signed-out visitors to log in`, async ({ page }) => {
      await decline(page);
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
    });
  }
  test("no result is reachable without its private cookie", async ({ page }) => {
    await decline(page);
    await page.goto("/start");
    await expect(page).toHaveURL(/\/$/);
  });
  test("a malformed claim link is refused", async ({ page }) => {
    await decline(page);
    await page.goto("/claim?t=short");
    await expect(page).toHaveURL(/\/claim-problem\?reason=invalid/);
  });
});

test("mobile header and keyboard: skip link, two links, no menu needed", async ({ page }) => {
  await decline(page);
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Pricing" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Log in" })).toBeVisible();
  await nav.getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});
