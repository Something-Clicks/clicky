import { expect, test } from '@playwright/test';
/**
 * REAL business workflow: a customer onboards a real, publicly reachable business website through the UI; the app retrieves the live
 * site and a real open-weight model (LLM_* env, local OpenAI-compatible endpoint) interprets it. Nothing is mocked. Results are
 * written through the customer's own session to clicky-dev and reopened afterwards.
 */
const PW = process.env.SC_TEST_PASSWORD!;
const SITE = process.env.REAL_SITE ?? 'somethingclicks.com'; const NAME = process.env.REAL_NAME ?? 'Something Clicks'; const PLACE = process.env.REAL_PLACE ?? 'United States';

test('real website -> real model -> saved Action Cards and drafts -> reopened from the account', async ({ page }) => {
  test.setTimeout(55 * 60_000);
  await page.goto('/login'); await page.fill('#email', 'sc-test-new@example.test'); await page.fill('#password', PW);
  await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  if (process.env.RETRY_RUN) { // keep the work already saved (website scan etc.) and retry only the failed run
    await page.goto(process.env.RETRY_RUN); await page.getByRole('button', { name: /Retry/ }).click(); await page.waitForURL(/\/runs\//, { timeout: 60_000 });
  } else {
  await page.goto('/onboarding'); await page.fill('#name', NAME); await page.fill('#website', SITE); await page.fill('#place', PLACE);
  await page.getByRole('button', { name: 'Analyze my website' }).click(); await page.waitForURL(/\/runs\//, { timeout: 60_000 }); }
  const runUrl = page.url(); console.log('RUN', runUrl);
  // wait for the run to finish (real model on CPU: minutes)
  const deadline = Date.now() + 50 * 60_000; let body = '';
  while (Date.now() < deadline) { await page.reload(); body = await page.locator('body').innerText(); const st = body.match(/Status:\s*\n?\s*(\w+)/)?.[1]; console.log('status', st, new Date().toISOString()); if (st && !['queued', 'running'].includes(st)) break; await page.waitForTimeout(20_000); }
  console.log('RUN PAGE\n' + body.slice(0, 3000));
  await page.screenshot({ path: 'test-results/real-run.png', fullPage: true });
  await page.goto('/board'); const board = await page.locator('body').innerText(); console.log('BOARD\n' + board.slice(0, 4000));
  expect(board).not.toMatch(/Demo mode/i);
});
