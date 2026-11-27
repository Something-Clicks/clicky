/**
 * Lighthouse performance / accessibility / best-practices / SEO checks, mobile and desktop.
 *
 *   MODE=public BASE=http://localhost:3222 npx tsx scripts/lighthouse.ts   # against `next build && next start` (representative performance)
 *   MODE=app    BASE=http://localhost:3111 npx tsx scripts/lighthouse.ts   # against the DEV_MODE dev server: signed-in pages
 *
 * The production build refuses DEV_MODE by design, so signed-in pages can only be audited on the dev server. There,
 * only accessibility / best-practices / SEO are enforced (dev-server performance numbers are not meaningful).
 */
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import Stripe from 'stripe';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const MODE = process.env.MODE ?? 'public';
const PORT = 9333;
const T = { performance: Number(process.env.MIN_PERF ?? 0.85), accessibility: 0.95, 'best-practices': 0.9, seo: 0.9 } as const;

const browser = await chromium.launchPersistentContext('/tmp/lh-profile-' + Date.now(), { executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', `--remote-debugging-port=${PORT}`] });
const page = await browser.newPage();
let urls: string[] = [`${BASE}/`, `${BASE}/pricing`, `${BASE}/login`, `${BASE}/signup`];

if (MODE === 'app') {
  // Create real data through the real UI: preview → signup (claims it) → a headline draft.
  await page.goto(`${BASE}/`); await page.fill('#url', 'summitplumbing.example'); await page.fill('#zip', '84101'); await page.click('button:has-text("Analyze my website")');
  await page.waitForSelector('text=What we understood', { timeout: 60_000 }); const preview = page.url();
  await page.click('text=Create free account'); await page.fill('#email', 'lh@summit.test'); await page.fill('#password', 'lighthouse-pass-1'); await page.click('button:has-text("Create account")'); await page.waitForURL('**/dashboard');
  // Subscribe this account to the Suite with a genuinely signed test event so the Studio/Suite pages are audited with data.
  const who = await (await page.request.get(`${BASE}/api/dev/whoami`)).json() as { userId: string; businessId: string }; const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: 'evt_lh', object: 'event', type: 'customer.subscription.created', data: { object: { id: 'sub_lh', customer: 'cus_lh', status: 'active', cancel_at_period_end: false, metadata: who, items: { data: [{ price: { id: 'price_lh_uy', recurring: { interval: 'year' } }, current_period_start: now - 86400, current_period_end: now + 29 * 86400 }] } } } });
  await page.request.post(`${BASE}/api/stripe/webhook`, { data: body, headers: { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_lh' }), 'content-type': 'application/json' } });
  await page.goto(`${BASE}/sites`); await page.fill('#sname', 'Rival Branch'); await page.fill('#surl', 'rivalplumbing.example'); await page.click('button:has-text("Add website")'); await page.waitForSelector('text=Website added');
  await page.click('button:has-text("Review all my websites")'); await page.waitForSelector('text=Started 2 website reviews'); await page.waitForTimeout(4000);
  await page.goto(`${BASE}/research`); await page.fill('#competitorUrls', 'rivalplumbing.example'); await page.click('button:has-text("Research")'); await page.waitForSelector('text=Results saved to your workspace', { timeout: 60_000 });
  await page.goto(`${BASE}/ask`); await page.fill('#request', 'Improve my homepage headline'); await page.click('button:has-text("Send")'); await page.waitForSelector('text=Editable draft', { timeout: 60_000 });
  const draft = await page.getAttribute('a:has-text("Editable draft")', 'href'); const card = (await page.goto(`${BASE}/board`), await page.getAttribute('a[href^="/board/"]', 'href'));
  urls = [preview, `${BASE}/dashboard`, `${BASE}/ask`, `${BASE}/board`, `${BASE}${card}`, `${BASE}${draft}`, `${BASE}/deliverables`, `${BASE}/profile`, `${BASE}/research`, `${BASE}/strategy`, `${BASE}/campaigns`, `${BASE}/performance`, `${BASE}/progress`, `${BASE}/insights`, `${BASE}/sites`, `${BASE}/brand`, `${BASE}/billing`];
} else {
  await page.goto(`${BASE}/`); await page.fill('#url', 'summitplumbing.example').catch(() => undefined);
}

let failed = 0; const rows: string[] = [];
for (const url of urls) for (const form of ['mobile', 'desktop'] as const) {
  const r = await lighthouse(url, { port: PORT, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], formFactor: form, screenEmulation: form === 'desktop' ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false } : undefined, throttlingMethod: 'simulate', disableStorageReset: true }, undefined);
  const c = r!.lhr.categories; const s = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.score ?? 0])) as Record<keyof typeof T, number>;
  const enforced = (Object.keys(T) as (keyof typeof T)[]).filter((k) => !(MODE === 'app' && k === 'performance'));
  const bad = enforced.filter((k) => s[k] < T[k]); if (bad.length) failed++;
  const line = `${bad.length ? 'FAIL' : 'ok  '} ${form.padEnd(7)} perf ${(s.performance * 100) | 0} a11y ${(s.accessibility * 100) | 0} bp ${(s['best-practices'] * 100) | 0} seo ${(s.seo * 100) | 0}  ${url.replace(BASE, '') || '/'}${bad.length ? '  <- ' + bad.join(',') : ''}`; rows.push(line); console.log(line);
  if (bad.length) for (const k of bad) for (const a of Object.values(r!.lhr.audits).filter((a) => c[k]!.auditRefs.some((x) => x.id === a.id) && a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative').slice(0, 5)) console.log(`        · ${k}: ${a.title}`);
}
await browser.close(); process.exit(failed ? 1 : 0);
