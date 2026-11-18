import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

import { env } from "./support";

// The cover display switch in a real browser (docs/security.md § Deployment
// gate, item 6), at desktop width and at 390 px. The same build is served
// with the switch unset (E2E_COVERS_OFF_URL, its default) and on (the public
// and studio servers): with it unset, neither a reader's nor the author's
// browser asks the Cover Art Archive or archive.org for anything, on the
// public pages or in the Studio, in English and Portuguese, and the fallback
// frame is shown; with it on, the same page asks for the cover, which proves
// the check can see a request. No real artwork is ever fetched: every request
// to those hosts is answered here with a synthetic image.

const off = env("E2E_COVERS_OFF_URL");
const publicOn = env("E2E_PUBLIC_URL");
const studioOn = env("E2E_BASE_URL");
const slug = env("E2E_PUBLIC_SLUG");
const entryId = env("E2E_PUBLIC_ENTRY_ID");

const RELEASE = "3f8c4f8e-0000-4000-8000-000000000001";
const STORED = `https://coverartarchive.org/release/${RELEASE}/1000000001`;
const COVER_HOSTS =
  /^https?:\/\/([a-z0-9-]+\.)*(coverartarchive|archive)\.org\//;
const TEST_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#1d4e89"/></svg>`;
const execFileAsync = promisify(execFile);

test.describe.configure({ mode: "serial" });

async function setCover(value: string) {
  await execFileAsync(
    "pnpm",
    [
      "--silent",
      "tsx",
      "--conditions=react-server",
      "src/testing/public-seed-cli.ts",
      "cover",
      entryId,
      value,
    ],
    { env: process.env },
  );
}

test.beforeAll(async () => {
  await setCover(STORED);
});

test.afterAll(async () => {
  await setCover("none");
});

/** Every request the page makes to a cover host, answered synthetically. */
async function coverRequests(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.route(COVER_HOSTS, (route) => {
    seen.push(route.request().url());
    return route.fulfill({ contentType: "image/svg+xml", body: TEST_IMAGE });
  });
  return seen;
}

async function visit(page: Page, url: string) {
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(200);
  await page.waitForLoadState("networkidle");
}

test("a reader's browser asks no cover host for anything while the switch is unset, in both languages", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const seen = await coverRequests(page);
  for (const path of [
    `/albums/${slug}`,
    `/pt/albums/${slug}`,
    "/",
    "/pt",
    "/albums",
    "/pt/albums",
  ]) {
    await visit(page, `${off}${path}`);
    await expect(page.locator('img[src*="archive.org"]'), path).toHaveCount(0);
  }
  expect(seen).toEqual([]);

  await visit(page, `${off}/albums/${slug}`);
  await expect(
    page.getByLabel(/^Album artwork for .*: not available yet$/),
  ).toBeVisible();

  // The same page with the switch on asks for the cover.
  await visit(page, `${publicOn}/albums/${slug}`);
  await expect(page.locator(`img[src="${STORED}-500.jpg"]`)).toBeVisible();
  expect(seen.length).toBeGreaterThan(0);
  await context.close();
});

test("the author's browser asks no cover host for anything in the Studio while the switch is unset, in both languages", async ({
  page,
}) => {
  const seen = await coverRequests(page);
  for (const path of [
    "/studio",
    "/studio/albums",
    "/studio/journals",
    `/studio/journals/${entryId}`,
    "/pt/studio",
    "/pt/studio/albums",
    `/pt/studio/journals/${entryId}`,
  ]) {
    await visit(page, `${off}${path}`);
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(page.locator('img[src*="archive.org"]'), path).toHaveCount(0);
  }
  expect(seen).toEqual([]);

  // The album's page says a cover is chosen, and that it is not shown.
  await visit(page, `${off}/studio/journals/${entryId}`);
  const album = await page
    .locator('a[href^="/studio/albums/"]')
    .first()
    .getAttribute("href");
  expect(album).toMatch(/^\/studio\/albums\/[0-9a-f-]{36}$/);
  await visit(page, `${off}${album}`);
  await expect(
    page.getByText("A cover is chosen; covers are turned off here."),
  ).toBeVisible();
  await visit(page, `${off}/pt${album}`);
  await expect(
    page.getByText("Há uma capa escolhida; as capas estão desativadas aqui."),
  ).toBeVisible();
  await visit(page, `${off}${album}/artwork`);
  await expect(page.locator('img[src*="archive.org"]')).toHaveCount(0);
  expect(seen).toEqual([]);

  // The same journal on the server with the switch on shows its cover.
  await visit(page, `${studioOn}/studio/journals/${entryId}`);
  await expect(page.locator(`img[src="${STORED}-500.jpg"]`)).toBeVisible();
  expect(seen.length).toBeGreaterThan(0);
});
