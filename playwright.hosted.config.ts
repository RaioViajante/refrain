import { defineConfig, devices } from "@playwright/test";

// Smoke tests against a HOSTED deployment (the protected preview, or the
// production deployment before the domain moves). No local server, no seed:
// the tests create [Test] records with unique titles and remove them.
//
//   HOSTED_URL=https://… \
//   VERCEL_AUTOMATION_BYPASS_SECRET=… \
//   HOSTED_STUDIO_EMAIL=… HOSTED_STUDIO_PASSWORD=… \
//   pnpm exec playwright test -c playwright.hosted.config.ts
//
// The bypass secret comes from the project's Deployment Protection settings
// and is sent as a header on every request (pages, assets, API calls) to that
// deployment only; no bypass cookie is set. Never commit any of these.
const url = process.env.HOSTED_URL;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (!url || !/^https:\/\/[a-z0-9.-]+$/.test(url)) {
  throw new Error("Set HOSTED_URL to the deployment's https:// origin.");
}

export default defineConfig({
  testDir: "./e2e/hosted",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: url,
    locale: "pt-BR",
    extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : {},
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
