import { expect, test } from '@playwright/test';
/** Real model, real saved business: ask for a marketing plan (Marketing Studio feature) through the customer UI and wait for it. */
const PW = process.env.SC_TEST_PASSWORD!;
test('marketing plan from the real business profile and findings', async ({ page }) => {
  test.setTimeout(60 * 60_000);
  await page.goto('/login'); await page.fill('#email', 'sc-test-new@example.test'); await page.fill('#password', PW);
  await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.goto('/ask'); await page.fill('#request', 'Develop a marketing plan'); await page.getByRole('button', { name: 'Send', exact: true }).click(); await page.waitForURL(/\/runs\//, { timeout: 60_000 });
  console.log('RUN', page.url());
});
