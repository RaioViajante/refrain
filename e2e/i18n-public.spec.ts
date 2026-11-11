import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { env, expectNoHorizontalOverflow, expectTouchTarget } from "./support";

// The public pages in Brazilian Portuguese (ADR 0008; ADR 0006 A7), in a
// browser, anonymous, from the server with public reads on: the language
// selector by mouse, by keyboard, and without JavaScript; every Portuguese
// page at 320, 360, 390, 768, and 1440 px with no sideways scroll and no axe
// violation; the version a reader is shown and its `lang`; and the shared
// not-found view. Synthetic data only. Screenshots only with
// E2E_SCREENSHOTS=1, to visual-review/i18n/ (ignored by Git).

const base = env("E2E_PUBLIC_URL");
const graceSlug = env("E2E_PUBLIC_SLUG");
const prefix = `${env("E2E_PUBLIC_SEED_PREFIX")}-pt`;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const WIDTHS = [320, 360, 390, 768, 1440];
const SHOTS = "visual-review/i18n";
const TEST_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#c9b79c"/></svg>`;
const execFileAsync = promisify(execFile);

test.describe.configure({ mode: "serial" });

async function seed(...args: string[]) {
  const { stdout } = await execFileAsync(
    "pnpm",
    [
      "--silent",
      "tsx",
      "--conditions=react-server",
      "src/testing/public-seed-cli.ts",
      ...args,
    ],
    { env: process.env },
  );
  return stdout.trim();
}

let artistsJson = "";
let memoriesJson = "";
let memorySlug = "";
let artistPath = "";

test.beforeAll(async () => {
  artistsJson = await seed("artists", prefix);
  memoriesJson = await seed("memories", prefix);
  memorySlug = (JSON.parse(memoriesJson) as { shown: { slug: string } }).shown
    .slug;
});

test.afterAll(async () => {
  if (memoriesJson) await seed("remove-memories", memoriesJson, prefix);
  if (artistsJson) await seed("remove-artists", artistsJson, prefix);
});

async function serveTestImages(page: Page) {
  for (const host of [
    "https://coverartarchive.org/**",
    "https://thumb.wikimedia.org/**",
  ]) {
    await page.route(host, (route) =>
      route.fulfill({ contentType: "image/svg+xml", body: TEST_IMAGE }),
    );
  }
}

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS !== "1") return;
  mkdirSync(SHOTS, { recursive: true });
  const width = page.viewportSize()?.width ?? 0;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${SHOTS}/${name}-${width}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

const selectorButton = (page: Page) =>
  page.locator("summary.public-language-button");
const option = (page: Page, name: string) =>
  page.locator(".public-language-option", { hasText: name });

test("switches the language from the footer, keeping the page and its address", async ({
  page,
}) => {
  await serveTestImages(page);
  await page.goto(`${base}/albums/${graceSlug}`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(selectorButton(page)).toHaveText(/Language: English/);
  await selectorButton(page).click();
  await expect(option(page, "English")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Changes the interface only.")).toBeVisible();
  await option(page, "Português (Brasil)").click();
  await page.waitForURL(`${base}/pt/albums/${graceSlug}`);
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(
    page.getByRole("heading", { level: 2, name: "Faixa a faixa" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Principal" }),
  ).toBeVisible();
  await expect(selectorButton(page)).toHaveText(/Idioma: Português/);
  await selectorButton(page).click();
  await option(page, "English").click();
  await page.waitForURL(`${base}/albums/${graceSlug}`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("works by keyboard: the arrows move through the options, Escape closes and returns focus", async ({
  page,
}) => {
  await page.goto(`${base}/pt`);
  const button = selectorButton(page);
  await button.focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("details.public-language")).toHaveAttribute(
    "open",
    "",
  );
  const options = page.locator(".public-language-option");
  await expect(options.last()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(options.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("details.public-language")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(button).toBeFocused();
  // Enter on the button opens it natively; Tab reaches the options.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(options.first()).toBeFocused();
  await expectTouchTarget(button);
  for (const index of [0, 1]) {
    await expectTouchTarget(options.nth(index));
  }
});

test("works without JavaScript: a native disclosure of real links", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${base}/albums`);
  await selectorButton(page).click();
  await page
    .locator(".public-language-option", { hasText: "Português" })
    .click();
  await page.waitForURL(`${base}/pt/albums`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Álbuns");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await context.close();
});

test("shows the English writing of an untranslated journal in a Portuguese page, marked as English", async ({
  page,
}) => {
  await serveTestImages(page);
  await page.goto(`${base}/pt/albums/${graceSlug}`);
  await expect(page.locator(".pj-opening")).toHaveAttribute("lang", "en");
  await expect(page.locator(".pj-body")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Escrito em inglês")).toBeVisible();
  await expect(
    page.getByText("Diário de álbum", { exact: true }),
  ).toBeVisible();
});

test("every Portuguese page fits every width, has no axe violation, and keeps its links in Portuguese", async ({
  page,
}) => {
  await serveTestImages(page);
  await page.goto(`${base}/artists`);
  artistPath = (await page.locator(".px-row").first().getAttribute("href"))!;
  const pages = [
    ["home", "/pt"],
    ["albums", "/pt/albums"],
    ["artists", "/pt/artists"],
    ["memories", "/pt/memories"],
    ["album", `/pt/albums/${graceSlug}`],
    ["artist", `/pt${artistPath}`],
    ["memory", `/pt/memories/${memorySlug}`],
  ] as const;
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of pages) {
      const response = await page.goto(`${base}${path}`);
      expect(response?.status(), path).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
      await expectNoHorizontalOverflow(page);
      // The selector, opened, fits too.
      await selectorButton(page).click();
      await expect(page.locator(".public-language-menu")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const menu = await page.locator(".public-language-menu").boundingBox();
      expect(menu!.x, `${path} at ${width}`).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width, `${path} at ${width}`).toBeLessThanOrEqual(
        width,
      );
      await shot(page, `${name}-open`);
      await selectorButton(page).click();
      if (width === 1440 || width === 320) {
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(results.violations, `${path} at ${width}`).toEqual([]);
      }
      await shot(page, name);
    }
  }
  // Every link of a Portuguese page stays in Portuguese, but the selector's.
  await page.goto(`${base}/pt/albums/${graceSlug}`);
  const hrefs = await page
    .locator("a[href^='/']")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
  const english = hrefs.filter(
    (href) => href !== "/pt" && !href.startsWith("/pt/"),
  );
  expect(english).toEqual([`/albums/${graceSlug}`]);
});

test("answers an unknown Portuguese address with the shared view in both languages", async ({
  page,
}) => {
  const response = await page.goto(`${base}/pt/albums/${prefix}-nothing`);
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Nothing here" }),
  ).toBeVisible();
  await expect(page.locator(".public-notfound-other")).toHaveAttribute(
    "lang",
    "pt-BR",
  );
  await expect(
    page.getByRole("link", { name: "Voltar ao início" }),
  ).toHaveAttribute("href", "/pt");
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations).toEqual([]);
    await shot(page, "not-found");
  }
});
