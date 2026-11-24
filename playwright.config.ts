import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests.
 *   pnpm e2e            public journey (no database needed)
 *   E2E_FULL=1 pnpm e2e full journey against the local stack in tests/e2e/stack (Auth + REST + mail catcher)
 *
 * Projects: iPhone 13 (390px) in WebKit when installed (PW_WEBKIT=1), the same iPhone
 * profile emulated in Chromium, and desktop Chromium.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const iphone = devices["iPhone 13"];

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "off" },
  projects: [
    ...(process.env.PW_WEBKIT === "1" ? [{ name: "iphone-webkit", use: { ...iphone } }] : []),
    {
      name: "iphone-chromium",
      use: { ...iphone, defaultBrowserType: "chromium", browserName: "chromium" as const },
    },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: `pnpm exec next start -p ${port}`,
    url: `http://localhost:${port}/robots.txt`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
