import { expect, test, type Page } from '@playwright/test';

/** The whole customer journey against the running app (mock model, fixture website). */
test.describe.serial('customer journey', () => {
  let page: Page; let cardUrl = ''; let draftUrl = '';
  test.beforeAll(async ({ browser }) => { page = await (await browser.newContext()).newPage(); });

  test('anonymous visitor enters website + ZIP and gets an evidence-backed first result', async () => {
    await page.goto('/');
    await page.fill('#url', 'summitplumbing.example'); await page.fill('#zip', '84101');
    await page.getByRole('button', { name: 'Analyze my website' }).click();
    await expect(page).toHaveURL(/\/preview\//);
    await expect(page.getByText('What we understood')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText('Water heater repair').first()).toBeVisible();
    await expect(page.getByText('Demo mode')).toBeVisible(); // mock output is labelled
    await expect(page.getByText('“Welcome”').first()).toBeVisible(); // exact quote from the site as evidence
    await expect(page.getByText('Most important things we found')).toBeVisible();
  });

  test('invalid / unsafe input is rejected', async ({ browser }) => {
    const p = await (await browser.newContext()).newPage();
    for (const [url, zip, msg] of [['http://127.0.0.1/admin', '84101', /not a public domain|IP-address|not allowed/i], ['summitplumbing.example', '123', /5-digit ZIP/i], ['ftp://x.com', '84101', /http and https/i]] as const) {
      await p.goto('/'); await p.fill('#url', url); await p.fill('#zip', zip); await p.evaluate(() => document.querySelector('form')!.setAttribute('novalidate', ''));
      await p.getByRole('button', { name: 'Analyze my website' }).click();
      await expect(p.locator('.banner.err')).toContainText(msg);
    }
  });

  test('signing up claims the preview into a persistent workspace with Action Cards', async () => {
    await page.getByRole('link', { name: 'Create free account' }).click();
    await page.fill('#email', 'owner@summit.test'); await page.fill('#password', 'a-long-password-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('2 free uses left')).toBeVisible(); // preview counted as use #1
    await page.goto('/board');
    await expect(page.getByText(/Homepage headline does not name the main service|calls to action are generic/).first()).toBeVisible();
    await page.getByRole('link', { name: /#1 / }).click(); await page.waitForURL(/\/board\//); cardUrl = page.url();
    await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible();
    await expect(page.getByText('Recommendation')).toBeVisible();
  });

  test('business profile shows provenance and labels AI assumptions', async () => {
    await page.goto('/profile');
    await expect(page.getByText('AI assumption').first()).toBeVisible();
    await expect(page.getByText('from website').first()).toBeVisible();
    await page.fill('#f_pricing', 'Free estimates; transparent quotes'); await page.getByRole('button', { name: 'Save and confirm my changes' }).click();
    await expect(page.getByText(/Saved 1 change/)).toBeVisible();
  });

  test('asking for a headline runs the agent and produces an editable draft that must be approved', async () => {
    await page.goto('/ask'); await page.fill('#request', 'Improve my homepage headline'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page).toHaveURL(/\/runs\//);
    await expect(page.getByRole('heading', { name: 'Improve homepage messaging' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Editable draft →' })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText('What this did not cover')).toBeVisible();
    await page.getByRole('link', { name: 'Editable draft →' }).click(); await page.waitForURL(/\/deliverables\//); draftUrl = page.url();
    await expect(page.locator('textarea[name="b_headline"]')).toHaveValue(/Water heater repair/);
    await page.fill('textarea[name="b_cta"]', 'Call Summit Plumbing'); await page.fill('#note', 'owner edit'); await page.getByRole('button', { name: 'Save as a new version' }).click();
    await expect(page.getByText('Version 2')).toBeVisible();
    await page.getByRole('button', { name: 'Approve this version' }).click();
    await expect(page.getByText(/Approved\. Nothing has been published or sent/)).toBeVisible();
  });

  test('execution needs separate request + authorization; verified download works only afterwards', async () => {
    await page.goto(draftUrl);
    await page.selectOption('select[name="action"]', 'download_export'); await page.getByRole('button', { name: 'Create request' }).click();
    await expect(page.getByText(/does nothing until you authorize/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Authorize and run' }).click();
    await expect(page.getByText(/Done: Export of version 2/)).toBeVisible();
    const href = await page.getByRole('link', { name: 'Download' }).getAttribute('href');
    const res = await page.request.get(href!); expect(res.status()).toBe(200); expect(await res.text()).toContain('Call Summit Plumbing');
    expect((await page.request.get(draftUrl + '/export')).status()).toBe(403); // no request id → refused
    await page.selectOption('select[name="action"]', 'record_activity'); await page.fill('input[name="url"]', 'https://summitplumbing.example/'); await page.getByRole('button', { name: 'Create request' }).click();
    await page.getByRole('button', { name: 'Authorize and run' }).click(); await expect(page.locator('.banner.ok')).toContainText(/Completed activity recorded/);
    await page.goto('/dashboard'); await expect(page.getByText('1 free use left')).toBeVisible();
  });

  test('editing after approval withdraws approval', async () => {
    await page.goto(draftUrl); await page.fill('textarea[name="b_cta"]', 'Call us today'); await page.getByRole('button', { name: 'Save as a new version' }).click();
    await expect(page.getByRole('button', { name: 'Approve this version' })).toBeVisible();
    await expect(page.getByText('Approved version')).toHaveCount(0);
  });

  test('unsupported claims are flagged and block approval until the customer confirms', async () => {
    await page.goto(draftUrl); await page.fill('textarea[name="b_subheadline"]', 'Award-winning plumbers, 100% satisfaction guaranteed, 25 years in business.');
    await page.getByRole('button', { name: 'Save as a new version' }).click();
    await expect(page.getByText('Claims to check')).toBeVisible(); await expect(page.getByRole('button', { name: 'Approve this version' })).toBeDisabled();
    await page.getByRole('button', { name: 'Approve this version' }).click({ force: true, trial: true }).catch(() => undefined);
  });

  test('allowance: third use works, fourth is blocked with a clear message and does not count', async () => {
    // advanced content is a Marketing Studio feature: refused with a clear message, and the refusal does not use an allowance
    await page.goto('/ask'); await page.fill('#request', 'Write a blog article about water heater maintenance'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.banner.err')).toContainText('Marketing Studio includes it');
    await page.goto('/ask'); await page.fill('#request', 'Write an FAQ about water heater repair'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Editable draft →' })).toBeVisible({ timeout: 40_000 });
    await page.goto('/ask'); await page.fill('#request', 'Write an email about drain cleaning'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.banner.err')).toContainText(/free uses/i);
    await page.goto('/billing'); await expect(page.getByText('3 of 3 free uses used')).toBeVisible(); for (const [n, price] of [['Marketing Report', '$49 one-time'], ['Marketing Assistant', '$79/month'], ['Marketing Studio', '$179/month'], ['Marketing Suite', '$399/month']] as const) { await expect(page.getByRole('heading', { name: n, exact: true })).toBeVisible(); await expect(page.getByText(price).first()).toBeVisible(); }
    await expect(page.getByText('$756/year ($63/month billed annually)')).toBeVisible(); await expect(page.getByText('$1,716/year ($143/month billed annually)')).toBeVisible(); await expect(page.getByText('$3,828/year ($319/month billed annually)')).toBeVisible();
    // the e2e price ids cannot be verified against Stripe, so checkout stays closed (fail-closed catalog): no buy buttons, a clear message instead
    await expect(page.getByText('Not available to purchase yet.')).toHaveCount(4); await expect(page.getByRole('button', { name: 'Get the Marketing Report' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Monthly' })).toHaveCount(0); await expect(page.getByText('Business Plus')).toHaveCount(0); await expect(page.getByText('Multi-Site')).toHaveCount(0);
  });

  test('another customer cannot see this customer’s data', async ({ browser }) => {
    const p = await (await browser.newContext()).newPage();
    await p.goto('/signup'); await p.fill('#email', 'other@rival.test'); await p.fill('#password', 'another-long-pass-1'); await p.getByRole('button', { name: 'Create account' }).click();
    await expect(p).toHaveURL(/onboarding/); await p.fill('#name', 'Other Co'); await p.fill('#website', 'rivalplumbing.example'); await p.getByRole('button', { name: 'Analyze my website' }).click();
    await expect(p).toHaveURL(/\/runs\//);
    for (const url of [cardUrl, draftUrl]) { const r = await p.goto(url); expect(r!.status()).toBe(404); }
    await p.goto('/board'); await expect(p.getByText('Summit')).toHaveCount(0);
  });

  test('results reporting is not available once the free uses are spent (it is part of the paid plans)', async () => {
    await page.goto('/performance');
    await page.fill('#start', '2026-10-01'); await page.fill('#end', '2026-10-28'); await page.setInputFiles('#file', { name: 'prev.csv', mimeType: 'text/csv', buffer: Buffer.from('query,clicks,impressions,position\nwater heater repair,120,4000,8.2\n') });
    await page.getByRole('button', { name: 'Import' }).click(); await expect(page.locator('.banner.err')).toContainText(/free uses|Choose a plan/i);
  });
});
