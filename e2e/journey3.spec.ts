import { expect, test, type Page } from '@playwright/test';
import { subscribe, switchTo } from './helpers';

test.describe.serial('Marketing Assistant: what is included, and what stays locked', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => { page = await (await browser.newContext()).newPage(); });
  test('subscribe to the Assistant and review the website', async () => {
    await page.goto('/signup'); await page.fill('#email', 'asst@acme.test'); await page.fill('#password', 'assistant-long-pass-1'); await page.getByRole('button', { name: 'Create account' }).click();
    await page.fill('#name', 'Assistant Plumbing'); await page.fill('#website', 'summitplumbing.example'); await page.getByRole('button', { name: 'Analyze my website' }).click(); await expect(page.getByText('Results saved to your workspace')).toBeVisible({ timeout: 40_000 });
    expect((await subscribe(page, 'price_e2e_am', 'evt_j3_a')).res.status()).toBe(200);
    await page.goto('/billing'); await expect(page.getByRole('heading', { name: 'Your plan: Marketing Assistant' })).toBeVisible(); await expect(page.getByText(/of 20 drafts used/)).toBeVisible();
    await expect(page.getByText('Your current plan')).toBeVisible(); await expect(page.getByRole('button', { name: 'Change plan in billing' })).toHaveCount(2); // Studio + Suite
  });
  test('progress tracking is included', async () => {
    await page.goto('/progress'); await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible(); await expect(page.getByText('Review history')).toBeVisible(); await expect(page.getByRole('progressbar')).toBeVisible();
  });
  test('Studio and Suite features are locked with a clear upgrade message, and the server refuses them even when forced', async () => {
    await page.goto('/insights'); await expect(page.getByText('Included in Marketing Studio')).toBeVisible();
    await page.goto('/brand'); await expect(page.getByText('Included in Marketing Suite')).toBeVisible();
    await page.goto('/sites'); await expect(page.getByText('Included in Marketing Suite')).toBeVisible(); await expect(page.getByRole('button', { name: 'Add website' })).toHaveCount(0);
    await page.goto('/strategy'); await page.getByRole('button', { name: 'Develop a marketing plan' }).click(); await expect(page.locator('.banner.err')).toContainText('Marketing Studio includes it');
    await page.goto('/research'); await page.fill('#competitorUrls', 'rivalplumbing.example'); await page.getByRole('button', { name: 'Research', exact: true }).click(); await expect(page.locator('.banner.err')).toContainText(/Marketing Studio includes it/);
    await page.goto('/ask'); await page.fill('#request', 'Write a blog article about water heater maintenance'); await page.getByRole('button', { name: 'Send', exact: true }).click(); await expect(page.locator('.banner.err')).toContainText(/Marketing Studio includes it/);
    await page.goto('/campaigns'); await page.fill('#goal', 'More enquiries'); await page.getByRole('button', { name: 'Plan campaign' }).click(); await expect(page.locator('.banner.err')).toContainText(/Marketing Studio includes it/);
  });
  test('basic drafts are included', async () => {
    await page.goto('/ask'); await page.fill('#request', 'Write an email about drain cleaning'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Editable draft →' })).toBeVisible({ timeout: 40_000 });
  });
});

test.describe.serial('Marketing Suite: multiple websites, locations and brand', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => { page = await (await browser.newContext()).newPage(); });
  test('subscribe to the Suite and review the first website', async () => {
    await page.goto('/signup'); await page.fill('#email', 'suite@acme.test'); await page.fill('#password', 'suite-long-password-1'); await page.getByRole('button', { name: 'Create account' }).click();
    await page.fill('#name', 'Summit Group'); await page.fill('#website', 'summitplumbing.example'); await page.fill('#zip', '84101'); await page.getByRole('button', { name: 'Analyze my website' }).click(); await expect(page.getByText('Results saved to your workspace')).toBeVisible({ timeout: 40_000 });
    expect((await subscribe(page, 'price_e2e_uy', 'evt_j3_s')).res.status()).toBe(200);
    await page.goto('/billing'); await expect(page.getByRole('heading', { name: 'Your plan: Marketing Suite' })).toBeVisible(); await expect(page.getByText(/Up to 5 websites and 25 locations/)).toBeVisible();
  });
  test('add a second website and locations; each website is reviewed separately', async () => {
    await page.goto('/sites'); await page.fill('#sname', 'Rival Branch'); await page.fill('#surl', 'rivalplumbing.example'); await page.getByRole('button', { name: 'Add website' }).click(); await expect(page.getByText('Website added')).toBeVisible();
    const prim = page.locator('section', { has: page.getByRole('heading', { name: 'Summit Group' }) }); await prim.getByText('Add a location').click(); await prim.getByLabel('Location name').fill('Salt Lake Shop'); await prim.getByLabel('City').fill('Salt Lake City'); await prim.getByLabel('ZIP').fill('84101'); await prim.getByLabel('Phone shown on the website').fill('(801) 555-0142'); await prim.getByRole('button', { name: 'Add location' }).click(); await expect(page.getByText('Location added')).toBeVisible();
    const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Rival Branch' }) }); await sec.getByText('Add a location').click(); await sec.getByLabel('Location name').fill('Ogden Branch'); await sec.getByLabel('City').fill('Ogden'); await sec.getByLabel('Phone shown on the website').fill('(801) 555-7777'); await sec.getByRole('button', { name: 'Add location' }).click(); await expect(page.getByText('Location added')).toBeVisible();
    await page.getByRole('button', { name: 'Review all my websites' }).click(); await expect(page.getByText(/Started 2 website reviews/)).toBeVisible();
    await expect.poll(async () => { await page.goto('/sites'); return page.getByText(/last read \d{4}-\d{2}-\d{2}/).count(); }, { timeout: 60_000 }).toBe(2);
  });
  test('switching websites switches the whole workspace', async () => {
    await page.goto('/board'); await expect(page.getByText(/Homepage headline|calls to action/).first()).toBeVisible(); const primaryTitles = await page.locator('main .card a').allTextContents();
    await switchTo(page, 'Rival Branch'); await page.goto('/board');
    const otherTitles = await page.locator('main .card a').allTextContents(); expect(otherTitles.length).toBeGreaterThan(0); expect(otherTitles).not.toEqual(primaryTitles);
    await page.goto('/profile'); await expect(page.locator('#f_products_services')).toHaveValue(/Flat-rate drain cleaning/);
    await switchTo(page, 'Summit Group'); await page.goto('/profile'); await expect(page.locator('#f_products_services')).toHaveValue(/Water heater repair/); await expect(page.locator('#f_products_services')).not.toHaveValue(/Flat-rate/);
  });
  test('shared brand guidance, per-site override, and the consistency check', async () => {
    await page.goto('/brand'); await page.fill('#sh_avoid_terms', 'Flat-rate'); await page.fill('#sh_key_messages', 'Fast, friendly, fair'); await page.getByRole('button', { name: 'Save shared brand' }).click(); await expect(page.getByText('Brand guidance saved')).toBeVisible();
    await page.getByText('Overrides for Rival Branch').click(); await page.getByLabel('Tone').last().fill('Direct'); await page.getByRole('button', { name: 'Save overrides' }).click(); await expect(page.getByText('Brand guidance saved')).toBeVisible();
    await expect(page.getByText(/Uses a word the brand avoids \("Flat-rate"\)/)).toBeVisible(); await expect(page.getByText(/Ogden Branch is not mentioned on the site/)).toBeVisible(); await expect(page.getByText(/Phone number for Ogden Branch not found/)).toBeVisible();
    await page.getByRole('button', { name: 'Run brand check and add Action Cards' }).click(); await expect(page.getByText(/Brand check finished: \d+ new Action Card/)).toBeVisible();
    await switchTo(page, 'Rival Branch'); await page.goto('/board'); await expect(page.getByText(/Rival Branch: Uses a word the brand avoids/)).toBeVisible();
    await switchTo(page, 'Summit Group');
  });
  test('Studio features come with the Suite: research and insights', async () => {
    await page.goto('/research'); await page.fill('#competitorUrls', 'rivalplumbing.example'); await page.getByRole('button', { name: 'Research', exact: true }).click(); await expect(page.getByText('Results saved to your workspace')).toBeVisible({ timeout: 40_000 });
    await page.goto('/insights'); await expect(page.getByRole('heading', { name: 'Insights', exact: true })).toBeVisible(); await expect(page.getByText(/Flat-rate drain cleaning/).first()).toBeVisible(); await expect(page.getByText('To unlock more insights:')).toBeVisible();
    await page.goto('/ask'); await page.fill('#request', 'Write a blog article about water heater maintenance'); await page.getByRole('button', { name: 'Send', exact: true }).click(); await expect(page.getByRole('link', { name: 'Editable draft →' })).toBeVisible({ timeout: 40_000 });
  });
});
