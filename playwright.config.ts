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
/** One id per run, inherited by every worker (a worker restarts after a failed test, so it must not live in a test file). */
process.env.E2E_RUN_ID ??= String(Date.now());
const SUITE_SPECS = "e2e/specs/**/*.spec.ts";
const signedIn = (name: string) => ({ storageState: `e2e/.auth/owner-${name}.json` });
const setupFor = (name: string, device: object) => ({ name: `e2e-setup-${name}`, testDir: "e2e/setup", testMatch: /.*\.setup\.ts/, use: device });

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
        // Each browser project first creates its OWN throwaway owner account and runs its first website check.
        setupFor("chromium", { ...devices["Desktop Chrome"] }),
        setupFor("mobile", { ...iphone, defaultBrowserType: "chromium", browserName: "chromium" as const }),
        { name: "e2e-chromium", testDir: "e2e", testMatch: SUITE_SPECS, dependencies: ["e2e-setup-chromium"], use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, ...signedIn("chromium") } },
        { name: "e2e-mobile", testDir: "e2e", testMatch: SUITE_SPECS, dependencies: ["e2e-setup-mobile"], use: { ...iphone, defaultBrowserType: "chromium", browserName: "chromium" as const, ...signedIn("mobile") } },
        // Firefox and WebKit run where the browsers are installed (pnpm exec playwright install firefox webkit).
        ...(process.env.PW_FIREFOX === "1" ? [setupFor("firefox", { ...devices["Desktop Firefox"] }), { name: "e2e-firefox", testDir: "e2e", testMatch: SUITE_SPECS, dependencies: ["e2e-setup-firefox"], use: { ...devices["Desktop Firefox"], ...signedIn("firefox") } }] : []),
        ...(process.env.PW_WEBKIT === "1"
          ? [
              setupFor("webkit", { ...devices["Desktop Safari"] }),
              setupFor("mobile-safari", { ...iphone }),
              { name: "e2e-webkit", testDir: "e2e", testMatch: SUITE_SPECS, dependencies: ["e2e-setup-webkit"], use: { ...devices["Desktop Safari"], ...signedIn("webkit") } },
              { name: "e2e-mobile-safari", testDir: "e2e", testMatch: SUITE_SPECS, dependencies: ["e2e-setup-mobile-safari"], use: { ...iphone, ...signedIn("mobile-safari") } },
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
