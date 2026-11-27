import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', timeout: 90_000, workers: 1, reporter: 'list', retries: 0,
  use: { baseURL: 'http://localhost:3111', trace: 'off', launchOptions: { executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] } },
  webServer: { command: 'npx next dev -p 3111', url: 'http://localhost:3111', reuseExistingServer: false, timeout: 120_000, env: { DEV_MODE: '1', DEV_FIXTURE_SITES: '1', LLM_PROVIDER: 'mock', ANONYMOUS_PREVIEW_ENABLED: 'true', STRIPE_WEBHOOK_SECRET: 'whsec_e2e', STRIPE_PRICE_MARKETING_REPORT: 'price_e2e_r', STRIPE_PRICE_MARKETING_ASSISTANT_MONTHLY: 'price_e2e_am', STRIPE_PRICE_MARKETING_ASSISTANT_ANNUAL: 'price_e2e_ay', STRIPE_PRICE_MARKETING_STUDIO_MONTHLY: 'price_e2e_sm', STRIPE_PRICE_MARKETING_STUDIO_ANNUAL: 'price_e2e_sy', STRIPE_PRICE_MARKETING_SUITE_MONTHLY: 'price_e2e_um', STRIPE_PRICE_MARKETING_SUITE_ANNUAL: 'price_e2e_uy', STRIPE_SECRET_KEY: 'unused-in-e2e', NEXT_TELEMETRY_DISABLED: '1' } },
});
