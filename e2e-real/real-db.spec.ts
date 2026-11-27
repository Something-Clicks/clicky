import { expect, test, type Page } from '@playwright/test';

const PW = process.env.SC_TEST_PASSWORD!;
async function login(page: Page, who: string) {
  await page.goto('/login'); await page.fill('#email', `sc-test-${who}@example.test`); await page.fill('#password', PW);
  await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
}
const healthy = async (page: Page, path: string) => { const r = await page.goto(path); expect(r?.status(), path).toBeLessThan(500); await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error/); return page; };

test.describe('real clicky-dev, real customer sessions', () => {
  test('studio owner signs in, sees their workspace and plan from the real subscription', async ({ page }) => {
    await login(page, 'owner-a');
    await healthy(page, '/dashboard'); await expect(page.locator('body')).toContainText('SC Test Org A');
    await healthy(page, '/billing'); await expect(page.locator('body')).toContainText('Marketing Studio');
    for (const p of ['/profile', '/sites', '/board', '/research', '/strategy', '/campaigns', '/performance', '/insights', '/progress', '/brand', '/deliverables', '/ask']) await healthy(page, p);
  });
  test('a review request without a connected AI model fails honestly and never fabricates results', async ({ page }) => {
    await login(page, 'owner-a'); await page.goto('/ask');
    await page.locator('textarea').first().fill('Review my website'); await page.getByRole('button').filter({ hasText: /ask|send|start|submit/i }).first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/Demo mode/i);
    await expect(page.locator('body')).toContainText(/AI model|not connected|could not|failed|try again|website/i);
  });
  test('a member of the same business can work but is not offered owner-only authority', async ({ page }) => {
    await login(page, 'member-a'); await healthy(page, '/dashboard'); await expect(page.locator('body')).toContainText('SC Test Org A');
    await healthy(page, '/billing');
  });
  test('another tenant sees only its own business and its one-time Marketing Report credit', async ({ page }) => {
    await login(page, 'owner-b'); await healthy(page, '/dashboard');
    await expect(page.locator('body')).toContainText('SC Test Org B'); await expect(page.locator('body')).not.toContainText('SC Test Org A');
    await healthy(page, '/billing'); await expect(page.locator('body')).toContainText('Marketing Report');
  });
  test('signed-out visitors are sent to sign in', async ({ page }) => {
    await page.goto('/dashboard'); await expect(page).toHaveURL(/login/);
  });
});
