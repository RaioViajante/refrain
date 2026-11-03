import { existsSync } from "node:fs";

import { defineConfig } from "@playwright/test";

import { AUTH_FILE, BASE_URL, VISUAL_REVIEW } from "./e2e/constants";

// Browser tests of the Writing Studio (`pnpm test:e2e`). They drive the real
// production build (`next start`) in Chromium, against the disposable test
// database and a synthetic author, started by e2e/global-setup.ts. Nothing
// here reads or writes the development database or the owner's account.
//
// Local configuration lives in .env, as for Vitest. Variables already set in
// the environment (CI) take precedence.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  // One synthetic author and one database: tests run one at a time, in a
  // fixed order, and each creates the records it needs under its own label.
  fullyParallel: false,
  workers: 1,
  // A flaky test is a bug to fix, not to retry.
  retries: 0,
  forbidOnly: isCi,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: isCi
    ? [["github"], ["list"]]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    // An action that cannot be done fails with its own log, well before the
    // test times out.
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    // Traces record request headers, including the session cookie of the
    // synthetic author. They are for local diagnosis only and stay ignored by
    // Git; CI keeps none.
    trace: isCi ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    // The tests assert on words; they do not depend on the browser's language.
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [
    {
      // Signs in once through the real form and keeps the session for the
      // authenticated projects (Playwright's recommended pattern). The file
      // is ignored by Git and holds a session of the disposable server only.
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      // No stored session: a visitor, and the sign-in and sign-out journey.
      name: "anonymous",
      testMatch: /(authentication|negative)\.spec\.ts/,
      use: { browserName: "chromium", storageState: undefined },
      dependencies: ["setup"],
    },
    {
      name: "desktop",
      testMatch:
        /(catalog|journal|tracks|recovery|publication|academic|navigation|layout|accessibility|music|photos)\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 900 },
        storageState: AUTH_FILE,
      },
      dependencies: ["setup", "anonymous"],
    },
    // The visual review package: only with VISUAL_REVIEW=1 (`pnpm review:screens`).
    ...(VISUAL_REVIEW
      ? [
          {
            name: "visual-review",
            testMatch: /visual-review\.spec\.ts/,
            use: {
              browserName: "chromium" as const,
              viewport: { width: 1280, height: 900 },
              storageState: AUTH_FILE,
            },
            dependencies: ["setup"],
          },
        ]
      : []),
    {
      // The publication workflow again at a phone width: the dialogs scroll
      // inside the screen, and every control is 44px.
      name: "publication-390",
      testMatch: /publication\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: AUTH_FILE,
      },
      dependencies: ["desktop"],
    },
    {
      // The public album journal, anonymous, from the second server that has
      // public reads switched on (e2e/global-setup.ts): desktop and 390 px.
      name: "public-desktop",
      testMatch: /public(-artwork)?\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
        storageState: undefined,
      },
    },
    {
      name: "public-390",
      testMatch: /public(-artwork)?\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: undefined,
      },
    },
    {
      // The public Home (M3.4), anonymous: from the server with public reads
      // on (populated) and from the studio's server, whose switch is off. At
      // 1440 px, and at 390 px on a touch screen; the layout test also checks
      // 390, 768, 1280, 1440, and 2560 px.
      name: "home-desktop",
      testMatch: /home\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
        storageState: undefined,
      },
    },
    {
      name: "home-390",
      testMatch: /home\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: undefined,
      },
    },
    {
      // The public artist pages (M3.5), anonymous, from the server with public
      // reads on: at 1440 px, and at 390 px on a touch screen; the layout test
      // also checks 320, 768, and 2560 px.
      name: "artist-desktop",
      testMatch: /artist\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
        storageState: undefined,
      },
    },
    {
      name: "artist-390",
      testMatch: /artist\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: undefined,
      },
    },
    {
      // Add music and artwork (M3.2) again at a phone width.
      name: "music-390",
      testMatch: /music\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: AUTH_FILE,
      },
      dependencies: ["desktop"],
    },
    {
      // Artist photographs (M3.3) again at a phone width.
      name: "photos-390",
      testMatch: /photos\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: AUTH_FILE,
      },
      dependencies: ["desktop"],
    },
    {
      name: "mobile-390",
      testMatch: /mobile\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: AUTH_FILE,
      },
      dependencies: ["desktop"],
    },
  ],
});
