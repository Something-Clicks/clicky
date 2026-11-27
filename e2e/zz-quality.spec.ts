import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Runs after the journey in the same server process, so the signed-in workspace has real data. Desktop + mobile. */
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };

for (const [name, vp] of Object.entries(VIEWPORTS)) {
  test.describe(`responsive + accessible (${name})`, () => {
    test.use({ viewport: vp });
    let page: Page; let urls: string[] = [];
    test.beforeAll(async ({ browser }) => {
      page = await (await browser.newContext({ viewport: vp })).newPage();
      await page.goto('/login'); await page.fill('#email', 'suite@acme.test'); await page.fill('#password', 'suite-long-password-1'); await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL('**/dashboard');
      await page.goto('/board'); const card = await page.getAttribute('a[href^="/board/"]', 'href'); await page.goto('/deliverables'); const draft = await page.getAttribute('a[href^="/deliverables/"]', 'href');
      urls = ['/dashboard', '/ask', '/board', card!, '/deliverables', draft!, '/progress', '/insights', '/profile', '/research', '/strategy', '/campaigns', '/performance', '/sites', '/brand', '/billing'];
    });
    test('every signed-in page has no horizontal scroll and no serious accessibility violations', async () => {
      for (const u of urls) {
        await page.goto(u); await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); expect(overflow, `${u} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
        const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'); expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 90)}`), u).toEqual([]);
      }
    });
    test('public pages are usable too', async ({ browser }) => {
      const p = await (await browser.newContext({ viewport: vp })).newPage();
      for (const u of ['/', '/pricing', '/login', '/signup']) {
        await p.goto(u); const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); expect(overflow, u).toBeLessThanOrEqual(1);
        const bad = (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'); expect(bad.map((v) => v.id), u).toEqual([]);
      }
    });
  });
}
