import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests.
 *   pnpm e2e            public journey (no database needed)
 *   pnpm test:e2e       the organized suite in e2e/ (signup to campaign approval) against the LOCAL stack (e2e/README.md)
 *   E2E_FULL=1 pnpm e2e full journey against the local stack in tests/e2e/stack (Auth + REST + mail catcher)
 *
 * Projects: iPhone 13 (390px) in WebKit when installed (PW_WEBKIT=1), the same iPhone
 * profile emulated in Chromium, and desktop Chromium.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const iphone = devices["iPhone 13"];
/** E2E_SUITE=1 selects the organized suite in e2e/ (needs the local stack); otherwise the existing tests in tests/e2e run as before. */
const suite = process.env.E2E_SUITE === "1";
const SUITE_SPECS = "e2e/specs/**/*.spec.ts";
const SIGNED_IN = { storageState: "e2e/.auth/owner.json" };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: suite ? 180_000 : 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: suite ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "off" },
  projects: suite
    ? [
        // Creates the throwaway owner account and runs the first website check; the other projects start from its session.
        { name: "e2e-setup", testDir: "e2e/setup", testMatch: /.*\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
        { name: "e2e-chromium", testDir: "e2e", testMatch: SUITE_SPECS, dependencies: ["e2e-setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, ...SIGNED_IN } },
        { name: "e2e-mobile", testDir: "e2e", testMatch: SUITE_SPECS, dependencies: ["e2e-setup"], use: { ...iphone, defaultBrowserType: "chromium", browserName: "chromium" as const, ...SIGNED_IN } },
        // Firefox and WebKit run where the browsers are installed (pnpm exec playwright install firefox webkit).
        ...(process.env.PW_FIREFOX === "1" ? [{ name: "e2e-firefox", testDir: "e2e", testMatch: SUITE_SPECS, dependencies: ["e2e-setup"], use: { ...devices["Desktop Firefox"], ...SIGNED_IN } }] : []),
        ...(process.env.PW_WEBKIT === "1"
          ? [
              { name: "e2e-webkit", testDir: "e2e", testMatch: SUITE_SPECS, dependencies: ["e2e-setup"], use: { ...devices["Desktop Safari"], ...SIGNED_IN } },
              { name: "e2e-mobile-safari", testDir: "e2e", testMatch: SUITE_SPECS, dependencies: ["e2e-setup"], use: { ...iphone, ...SIGNED_IN } },
            ]
          : []),
      ]
    : [
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
