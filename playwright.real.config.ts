import { defineConfig } from '@playwright/test';
/** Browser journeys against the REAL clicky-dev Supabase project with real customer logins (no DEV_MODE, no mock AI, no fixtures). */
export default defineConfig({
  testDir: 'e2e-real', timeout: 120_000, workers: 1, reporter: 'list', retries: 0,
  use: { baseURL: 'http://localhost:3112', trace: 'off', launchOptions: { executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] } },
  webServer: { command: 'npx next dev -p 3112', url: 'http://localhost:3112', reuseExistingServer: false, timeout: 120_000,
    env: { NODE_USE_ENV_PROXY: '1', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '', ALLOWED_SUPABASE_REFS: process.env.ALLOWED_SUPABASE_REFS ?? '', APP_URL: 'http://localhost:3112', NO_PROXY: `127.0.0.1,localhost,${process.env.NO_PROXY ?? ''}`, no_proxy: `127.0.0.1,localhost,${process.env.no_proxy ?? ''}`, LLM_BASE_URL: process.env.LLM_BASE_URL ?? '', LLM_MODEL: process.env.LLM_MODEL ?? '', LLM_STRUCTURED: process.env.LLM_STRUCTURED ?? '', LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS ?? '', LLM_API_KEY: process.env.LLM_API_KEY ?? '' } },
});
