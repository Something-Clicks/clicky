import { expect, test, type Page } from '@playwright/test';
import Stripe from 'stripe';
import { subscribe } from './helpers';

/** Second customer on a paid plan: research, strategy, campaigns, performance and billing, all through the real UI and the real Stripe webhook route. */
test.describe.serial('paid customer: research → strategy → campaign → performance', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => { page = await (await browser.newContext()).newPage(); });

  test('onboarding reads the website and builds the first board', async () => {
    await page.goto('/signup'); await page.fill('#email', 'two@acme.test'); await page.fill('#password', 'acme-long-password-1'); await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/onboarding/); await page.fill('#name', 'Acme Plumbing'); await page.fill('#website', 'summitplumbing.example'); await page.fill('#zip', '84111'); await page.getByRole('button', { name: 'Analyze my website' }).click();
    await expect(page.getByText('Results saved to your workspace')).toBeVisible({ timeout: 40_000 });
    await page.goto('/profile'); await expect(page.locator('#f_zip_codes')).toHaveValue('84111'); await expect(page.locator('#f_name')).toHaveValue('Acme Plumbing');
  });

  test('a signed Stripe event unlocks Marketing Studio; forged and replayed events do nothing', async () => {
    const forged = await page.request.post('/api/stripe/webhook', { data: '{}', headers: { 'stripe-signature': 't=1,v1=forged', 'content-type': 'application/json' } }); expect(forged.status()).toBe(400);
    const { res, body } = await subscribe(page, 'price_e2e_sm', 'evt_j2_1'); expect(res.status()).toBe(200); expect((await res.json()).handled).toBe(true);
    const replay = await page.request.post('/api/stripe/webhook', { data: body, headers: { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_e2e' }), 'content-type': 'application/json' } }); expect((await replay.json()).duplicate).toBe(true);
    await page.goto('/billing'); await expect(page.getByRole('heading', { name: 'Your plan: Marketing Studio' })).toBeVisible(); await expect(page.getByText(/of 80 drafts used/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Manage billing and cancellation' })).toBeVisible();
  });

  test('competitor research uses only the sites supplied and shows quoted evidence', async () => {
    await page.goto('/research'); await page.fill('#competitorUrls', 'rivalplumbing.example'); await page.getByRole('button', { name: 'Research', exact: true }).click();
    await expect(page.getByText('Results saved to your workspace')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(/What this did not cover/)).toBeVisible(); await expect(page.getByText(/No external market-research source/)).toBeVisible();
    await page.goto('/research'); await page.getByText('Competitor comparison (1)').click(); await expect(page.getByText(/Flat-rate drain cleaning from \$129/).first()).toBeVisible();
    await page.goto('/board'); await expect(page.getByText(/Add clear pricing guidance|Strengthen calls to action/).first()).toBeVisible();
  });

  test('marketing plan is specific to this business and can be approved', async () => {
    await page.goto('/strategy'); await page.getByRole('button', { name: 'Develop a marketing plan' }).click();
    await expect(page.getByText('Results saved to your workspace')).toBeVisible({ timeout: 40_000 }); await page.goto('/strategy');
    await expect(page.getByText(/Acme Plumbing/).first()).toBeVisible(); await expect(page.getByText(/Water heater repair/).first()).toBeVisible(); await expect(page.getByText('Assumptions to confirm')).toBeVisible();
    await page.getByRole('button', { name: 'Approve strategy' }).click(); await expect(page.getByText('Strategy approved.')).toBeVisible();
    await page.getByRole('link', { name: 'Open card' }).first().click(); await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible();
  });

  test('campaign tasks respect dependencies: landing page before traffic', async () => {
    await page.goto('/campaigns'); await page.fill('#goal', 'More drain cleaning enquiries before winter'); await page.getByRole('button', { name: 'Plan campaign' }).click();
    await expect(page.getByText('Results saved to your workspace')).toBeVisible({ timeout: 40_000 }); await page.getByRole('link', { name: 'Campaign plan' }).click(); await page.waitForURL(/\/campaigns\/[^/]+$/); const campaignUrl = page.url();
    const task = (t: string) => page.locator('.card', { has: page.getByText(t, { exact: true }) });
    await expect(task('Prepare landing page').getByText('blocked')).toBeVisible(); await expect(task('Prepare landing page').getByRole('button', { name: 'Prepare draft' })).toHaveCount(0);
    await expect(task('Prepare announcement email sequence').getByText('Depends on: Prepare landing page')).toBeVisible();
    await task('Confirm offer and audience').getByRole('button', { name: 'Mark done' }).click();
    await task('Prepare landing page').getByRole('button', { name: 'Prepare draft' }).click(); await expect(page).toHaveURL(/\/deliverables\//);
    await page.getByRole('button', { name: 'Approve this version' }).click(); await expect(page.getByText(/Approved\./)).toBeVisible();
    await page.goto('/campaigns'); await expect(page.getByText('2/6 tasks done')).toBeVisible(); // the list reflects the approval too
    await page.goto(campaignUrl);
    await expect(task('Prepare landing page').getByText('done')).toBeVisible(); await expect(task('Prepare announcement email sequence').getByText('ready')).toBeVisible();
  });

  test('performance report is cautious and only uses supplied numbers', async () => {
    const csv = (c: number, i: number) => `query,clicks,impressions,position\nwater heater repair,${c},${i},8.2\ndrain cleaning,${Math.round(c / 2)},${Math.round(i / 2)},12.4\n`;
    await page.goto('/performance');
    for (const [s, e, c, i] of [['2026-10-01', '2026-10-28', 120, 4000], ['2026-10-29', '2026-11-25', 190, 5200]] as const) {
      await page.fill('#start', s); await page.fill('#end', e); await page.setInputFiles('#file', { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(c, i)) }); await page.getByRole('button', { name: 'Import' }).click(); await expect(page.getByText(/Imported \d+ rows/)).toBeVisible();
    }
    await page.getByRole('button', { name: 'Run performance review' }).click(); await expect(page.getByText('Results saved to your workspace')).toBeVisible({ timeout: 40_000 });
    await page.goto('/performance'); const row = page.locator('tr', { hasText: 'Search clicks' }); await expect(row).toContainText('improved'); await expect(row).toContainText('+58.3%');
    await expect(page.getByText('Read this with care')).toBeVisible(); await expect(page.getByText(/Not supplied: .*sessions/)).toBeVisible();
    await expect(page.getByText('Demo mode')).toBeVisible();
  });
});
