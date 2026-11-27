import { expect, test } from '@playwright/test';
/** Reopen the saved real-model review through the customer UI (no mocks): board, a finding with its evidence, a draft, the profile. */
const PW = process.env.SC_TEST_PASSWORD!;
test('saved Something Clicks review reopens in the customer account', async ({ page }) => {
  await page.goto('/login'); await page.fill('#email', 'sc-test-new@example.test'); await page.fill('#password', PW);
  await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.goto('/board'); const board = await page.locator('main').innerText(); console.log('BOARD', board.slice(0, 1500));
  expect(board).toMatch(/pricing page|Homepage says very little/i); expect(board).not.toMatch(/Demo mode/i);
  await page.getByRole('link', { name: /pricing page fails/i }).first().click(); await page.waitForLoadState('networkidle');
  const card = await page.locator('main').innerText(); console.log('CARD', card.slice(0, 2500));
  expect(card).toMatch(/No retainers/); // the real quote from the retrieved pricing page is shown as evidence
  await page.goto('/deliverables'); const list = await page.locator('main').innerText(); console.log('DRAFTS', list.slice(0, 800));
  await page.locator('main a[href^="/deliverables/"]').first().click(); await page.waitForLoadState('networkidle');
  const d = await page.locator('main').innerText(); console.log('DRAFT', d.slice(0, 1800)); await page.screenshot({ path: 'test-results/real-draft.png', fullPage: true });
  expect(d).toMatch(/Approve|Rejected|Approved/);
  await page.goto('/profile'); const prof = await page.locator('main').innerText(); console.log('PROFILE', prof.slice(0, 1500)); expect(prof).toMatch(/Something Clicks/);
});
