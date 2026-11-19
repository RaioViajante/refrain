import { defineConfig, devices } from "@playwright/test";

import {
  BASE_URL,
  E2E_DATABASE_URL,
  E2E_PORT,
  TEST_STUDIO_EMAIL,
  TEST_STUDIO_PASSWORD_HASH,
} from "./e2e/support/env";

// Browser tests (Chromium) against the production build on port 3300, with
// a disposable database (refrain_mixtapes_e2e_test) that the global setup
// rebuilds and seeds with synthetic [Test] data on every run.
//
//   pnpm db:test:up && pnpm build && pnpm test:e2e
//
// Locally an already running server on 3300 is reused; CI always starts one.
export default defineConfig({
  testDir: "./e2e",
  // Hosted smoke tests have their own config (playwright.hosted.config.ts).
  testIgnore: ["**/hosted/**"],
  globalSetup: "./e2e/global-setup.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The specs share one database; files run in parallel, but every test
  // creates the records it changes, with a unique title.
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
  webServer: {
    // Serves the existing build (`pnpm build` first). Playwright starts it
    // before the global setup, so readiness is the open port rather than a
    // page: every page queries the database, which may not exist yet.
    command: `pnpm start --port ${E2E_PORT}`,
    port: E2E_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      STUDIO_EMAIL: TEST_STUDIO_EMAIL,
      STUDIO_PASSWORD_HASH: TEST_STUDIO_PASSWORD_HASH,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
