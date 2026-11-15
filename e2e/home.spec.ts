import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { env } from "./support";

// The public Home (M3.4) in a browser, anonymous, at 1440 px and at 390 px.
// Populated: the second server of the same production build, with public
// reads on, which holds the synthetic Grace journal, a draft, and the Home's
// shelf (Pink Moon, Twin Fantasy, Cleopatra), whose writing is "[Test]".
// Switched off: the studio's own server, whose switch stays off as a default
// deployment's does, and which reads the same database. No real artwork is
// requested: covers are answered here with a synthetic image. Screenshots are
// written only with E2E_SCREENSHOTS=1, to visual-review/m3-4/ (ignored).

const base = env("E2E_PUBLIC_URL");
const offBase = env("E2E_BASE_URL");
const graceSlug = env("E2E_PUBLIC_SLUG");
const draftSlug = env("E2E_PUBLIC_DRAFT_SLUG");
const shelf = JSON.parse(env("E2E_PUBLIC_SHELF")) as {
  slug: string;
  entryId: string;
}[];

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const KEPT = "a music journal, kept by hand";
const TEST_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500"><rect width="500" height="500" fill="#1d4e89"/><circle cx="250" cy="230" r="120" fill="#c8553d"/></svg>`;

test.describe.configure({ mode: "serial" });

async function serveTestCovers(page: Page) {
  await page.route("https://coverartarchive.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: TEST_IMAGE,
    }),
  );
}

async function openHome(page: Page, from = base) {
  const response = await page.goto(`${from}/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText(KEPT)).toBeVisible();
  await streamed(page);
}

/**
 * Waits until React has revealed every streamed part of the page. Each
 * Suspense boundary arrives hidden (`<div hidden id="S:n">`, at the end of
 * the body) and is revealed on its own, a little later: reading the page
 * before then finds the lists outside the page's frame, unstyled, or not yet
 * in it.
 */
async function streamed(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelectorAll('template[id^="B:"], div[hidden][id^="S:"]')
            .length,
      ),
    )
    .toBe(0);
}

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

const addresses = (page: Page) =>
  page
    .locator("main a[href^='/albums/']")
    .evaluateAll((links) => [
      ...new Set(links.map((link) => link.getAttribute("href")!)),
    ]);

// The v3 Home (docs/design-system.md, Part I, Pages: Home; evidence:
// docs/evidence/v3-public.md). These tests hold the properties the V4.4 tests
// held, on the v3 composition: only served journals, never a draft; A6's
// limits; the approved faces; no sideways scrolling at any width; 44px
// targets; no accessibility violation; complete without JavaScript; still
// under reduced motion; covers only from the archive; and the empty Home
// while public reads are off.

test("shows the v3 composition, with only what exists", async ({ page }) => {
  await openHome(page);
  // The Home's header: the sections stacked, no wordmark, nothing current.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText([
    "Albums",
    "Artists",
    "Memories",
  ]);
  await expect(nav.locator("[aria-current]")).toHaveCount(0);
  await expect(page.locator(".hdr .wm")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("refrain");
  // The newest journal opens from the hero.
  const latest = page.getByRole("link", { name: "Read the latest journal" });
  await expect(latest).toHaveAttribute("href", /^\/albums\//);
  // Every album link is a served journal; the draft never appears.
  const listed = await addresses(page);
  for (const slug of [graceSlug, ...shelf.map((journal) => journal.slug)]) {
    expect(listed).toContain(`/albums/${slug}`);
  }
  expect(listed).not.toContain(`/albums/${draftSlug}`);
  await expect(page.getByText("[Test] Draft album")).toHaveCount(0);
  await expect(page.getByText("PRIVATE-")).toHaveCount(0);
  // A6: at most five recent entries, four albums (the sleeve and its shelf).
  expect(await page.locator("#ph-recent .it").count()).toBeLessThanOrEqual(5);
  expect(
    (await page.locator(".sl.front").count()) +
      (await page.locator(".mini").count()),
  ).toBeLessThanOrEqual(4);
  // The archive links, and no link to the studio.
  const main = page.locator("main");
  await expect(
    main.getByRole("link", { name: "All album journals" }),
  ).toHaveAttribute("href", "/albums");
  await expect(
    page.getByRole("link", { name: /studio|sign in|edit/i }),
  ).toHaveCount(0);
  await expect(page.locator(".ftr .tg")).toHaveText(
    "some songs take you back.",
  );
});

test("uses only the four approved faces", async ({ page }) => {
  await openHome(page);
  const strays = await page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const family = getComputedStyle(element).fontFamily;
      if (!/Archivo|Instrument Serif|Silkscreen|La Belle Aurore/.test(family)) {
        found.push(`${element.tagName}.${element.className}: ${family}`);
      }
    }
    return found;
  });
  expect(strays).toEqual([]);
  const name = await page
    .locator(".hero .w")
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(name).toContain("Archivo");
});

test("never scrolls sideways, at any width", async ({ page }) => {
  await openHome(page);
  for (const width of [320, 390, 640, 720, 721, 768, 1024, 1280, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(0);
  }
});

test("every link and button in the page is at least 44px tall", async ({
  page,
}) => {
  await openHome(page);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("header a, footer a, footer button, .pill")]
      .map((element) => ({
        text: element.textContent?.trim(),
        height: element.getBoundingClientRect().height,
      }))
      .filter((target) => target.height > 0 && target.height < 44),
  );
  expect(small).toEqual([]);
});

test("loads nothing from another origin but the covers, and logs no error", async ({
  page,
}) => {
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== new URL(base).origin &&
      url.hostname !== "coverartarchive.org"
    ) {
      foreign.push(url.origin);
    }
  });
  await serveTestCovers(page);
  await openHome(page);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test("works without JavaScript: the lists, their links, and the footer", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  // Nothing waits to be revealed: every section is visible as sent.
  await expect(page.getByText(KEPT)).toBeVisible();
  const listed = await addresses(page);
  expect(listed).toContain(`/albums/${graceSlug}`);
  await expect(page.locator("#ph-recent .it").first()).toBeVisible();
  await expect(page.locator(".ftr .tg")).toBeVisible();
  await context.close();
});

test("has no accessibility violations (WCAG 2.2 A and AA)", async ({
  page,
}) => {
  await openHome(page);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map(
      (violation) => `${violation.id}: ${violation.nodes.length}`,
    ),
  ).toEqual([]);
});

test("the skip link is the first tab stop, and leads to the content", async ({
  page,
}) => {
  await openHome(page);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("respects reduced motion: everything is in place, and nothing animates", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await openHome(page);
  const moving = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
  );
  expect(moving).toBe(0);
  const hidden = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-a]")].filter(
        (element) => getComputedStyle(element).opacity === "0",
      ).length,
  );
  expect(hidden).toBe(0);
  await context.close();
});

test("plays no sound until the reader turns it on", async ({ page }) => {
  await openHome(page);
  const toggle = page.locator(".ftr .snd");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("with public reads off, it is the empty Home, whatever is published", async ({
  page,
}) => {
  const response = await page.goto(`${offBase}/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText("nothing pinned yet")).toBeVisible();
  await expect(page.locator("main a[href^='/albums/']")).toHaveCount(0);
  await expect(page.getByText("Grace")).toHaveCount(0);
});
