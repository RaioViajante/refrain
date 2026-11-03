import { mkdirSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  commonsThumbnail,
  PHOTO,
  PHOTO_SCENARIO,
} from "@/testing/wikimedia-fixtures";

import {
  env,
  expectNoHorizontalOverflow,
  expectTouchTarget,
  named,
  withDatabase,
} from "./support";

// Artist photographs in the Writing Studio (M3.3), signed in as the synthetic
// author, at desktop width and at 390 px. The server's Wikimedia Commons and
// Wikidata are the local mock (src/testing/provider-mock.ts), so every file
// is a synthetic "Test_" fixture; the browser's requests for thumbnails are
// answered here with a generated test image (no real photograph is used).
// The artist is created through the Studio's own form. Screenshots only with
// E2E_SCREENSHOTS=1, to visual-review/m3-3/, which Git ignores.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// A flat, generated portrait-shaped image: a figure-like shape on a colored
// ground, so the frame and its cropping are visible in screenshots.
const TEST_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><rect width="400" height="500" fill="#3d5a80"/><circle cx="200" cy="190" r="80" fill="#e0c9a6"/><rect x="90" y="300" width="220" height="200" rx="90" fill="#ee6c4d"/></svg>`;

test.describe.configure({ mode: "serial" });

let artistUrl = "";
let artistName = "";

test.afterAll(() =>
  withDatabase(async (client) => {
    await client.query("delete from artists where name like $1", [
      `[Test] E2E ${env("E2E_RUN_ID")} Photo%`,
    ]);
  }),
);

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 720;

async function serveThumbnails(page: Page, requested: string[] = []) {
  await page.route("https://thumb.wikimedia.org/**", async (route) => {
    requested.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: TEST_IMAGE,
    });
  });
  return requested;
}

async function screenshot(page: Page, name: string, project: string) {
  if (process.env.E2E_SCREENSHOTS !== "1") {
    return;
  }
  mkdirSync("visual-review/m3-3", { recursive: true });
  await page.mouse.move(0, 0);
  // The skip link is fixed and hidden above the viewport; a full-page
  // capture of a scrolled page would draw it at the old scroll position.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `visual-review/m3-3/${project}-${name}.png`,
    fullPage: true,
  });
}

async function noAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function storedPhoto() {
  const id = artistUrl.split("/").at(-1)!;
  return withDatabase(async (client) => {
    const result = await client.query<{
      photo_url: string | null;
      photo_credit: string | null;
      photo_license: string | null;
      photo_file_sha1: string | null;
    }>(
      "select photo_url, photo_credit, photo_license, photo_file_sha1 from artists where id = $1",
      [id],
    );
    return result.rows[0]!;
  });
}

test("chooses a photograph only after reviewing it, and shows it with its credit", async ({
  page,
}, testInfo) => {
  const requested = await serveThumbnails(page);
  artistName = named(`Photo ${testInfo.project.name}`);
  await page.goto("/studio/artists/new");
  await page.getByLabel("Name", { exact: true }).fill(artistName);
  await page.getByRole("button", { name: "Add artist" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: artistName }),
  ).toBeVisible();
  artistUrl = new URL(page.url()).pathname;

  // No photograph yet: the V4.4 empty state, and nothing loaded.
  await expect(
    page.getByRole("img", { name: `No photograph of ${artistName} yet` }),
  ).toBeVisible();
  await expect(
    page.getByText("No photo. The page works without one."),
  ).toBeVisible();
  await screenshot(page, "artist-without-photo", testInfo.project.name);
  await page
    .getByRole("link", { name: "Choose from Wikimedia Commons…" })
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Photograph" }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", {
    name: "Search Wikimedia Commons",
  });
  await expect(search).toHaveValue(artistName);
  await search.fill("Ink Quartet");
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { name: "From Wikimedia Commons" }),
  ).toBeVisible();
  const reviews = page.getByRole("link", { name: /^Review / });
  await expect(reviews).toHaveCount(3);
  await expect(page.getByText("8 more files can’t be offered")).toBeVisible();
  // A file's own "Photo:" attribution is not prefixed again.
  await expect(
    page.getByText("Photo: [Test] Photographer Three / [Test] Studio Archive"),
  ).toBeVisible();
  await expect(page.getByText(/Photo: Photo:/)).toHaveCount(0);
  await expect(
    page.getByText("A search finds words, not people."),
  ).toBeVisible();
  // Only usable files were loaded, at the stored width or the srcset's.
  for (const url of requested) {
    expect(
      [PHOTO.onStage, PHOTO.portrait, PHOTO.attributed].some((name) =>
        url.includes(encodeURIComponent(name).replace(/\(/g, "%28")),
      ),
      url,
    ).toBe(true);
  }
  await noAxeViolations(page);
  if (isMobile(page)) {
    await expectNoHorizontalOverflow(page);
    await expectTouchTarget(reviews.first());
  }
  await screenshot(page, "photo-search", testInfo.project.name);

  // The review: everything needed to decide, and nothing written.
  await page
    .getByRole("link", { name: "Review Test Ink Quartet on stage.jpg" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Review photograph" }),
  ).toBeVisible();
  const facts = page.locator(".studio-review-photo .studio-facts");
  await expect(facts.getByText("[Test] Photographer One")).toBeVisible();
  await expect(
    facts.getByRole("link", { name: "CC BY-SA 4.0" }),
  ).toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/4.0/");
  await expect(facts.getByText("2000 × 2500 px, JPEG")).toBeVisible();
  await expect(
    facts.getByText("Resized, and cropped to fit the frame. No other changes."),
  ).toBeVisible();
  await expect(page.getByText("Personality rights")).toBeVisible();
  await noAxeViolations(page);
  if (isMobile(page)) {
    await expectNoHorizontalOverflow(page);
    await expectTouchTarget(
      page.getByRole("button", { name: "Use this photograph" }),
    );
    await expectTouchTarget(page.getByRole("link", { name: "Cancel" }));
  }
  await screenshot(page, "photo-review", testInfo.project.name);

  // Cancel goes back and changes nothing.
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Photograph" }),
  ).toBeVisible();
  expect((await storedPhoto()).photo_url).toBeNull();

  // Review again, and choose it.
  await page
    .getByRole("link", { name: "Review Test Ink Quartet on stage.jpg" })
    .click();
  await page.getByRole("button", { name: "Use this photograph" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: artistName }),
  ).toBeVisible();
  expect(await storedPhoto()).toMatchObject({
    photo_url: commonsThumbnail(PHOTO.onStage, 330),
    photo_credit: "[Test] Photographer One",
    photo_license: "CC BY-SA 4.0",
  });

  const frame = page.getByRole("img", { name: `Photograph of ${artistName}` });
  await expect(frame).toBeVisible();
  await expect(frame.locator("img")).toHaveJSProperty("complete", true);
  expect(
    await frame
      .locator("img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  const box = await frame.boundingBox();
  expect(box!.height / box!.width).toBeCloseTo(5 / 4, 1);
  await expect(page.locator(".studio-photo-credit").first()).toContainText(
    "Photo: [Test] Photographer One · CC BY-SA 4.0 · via Wikimedia Commons",
  );
  await page.getByText("Photo details").first().click();
  const details = page.locator(".studio-photo-details").first();
  await expect(
    details.getByRole("link", { name: "Test Ink Quartet on stage.jpg" }),
  ).toHaveAttribute(
    "href",
    `https://commons.wikimedia.org/wiki/File:${PHOTO.onStage}`,
  );
  await expect(details.getByText("Resized, and cropped")).toBeVisible();
  await noAxeViolations(page);
  if (isMobile(page)) {
    await expectNoHorizontalOverflow(page);
    await expectTouchTarget(page.getByText("Photo details").first());
  }
  await screenshot(page, "artist-with-photo", testInfo.project.name);
});

test("keeps the frame still and shows the fallback when the thumbnail fails", async ({
  page,
}, testInfo) => {
  await serveThumbnails(page);
  await page.goto(artistUrl);
  const frame = page.getByRole("img", { name: `Photograph of ${artistName}` });
  await expect(frame.locator("img")).toHaveJSProperty("complete", true);
  const loaded = await frame.boundingBox();

  await page.unroute("https://thumb.wikimedia.org/**");
  await page.route("https://thumb.wikimedia.org/**", (route) =>
    route.abort("failed"),
  );
  await page.goto(artistUrl);
  await expect(frame).toBeVisible();
  // The fallback says the photograph on file is not shown, not that none
  // exists.
  await expect(frame.getByText("photograph not shown")).toBeAttached();
  // The failed image is removed: no broken-image icon over the fallback.
  await expect(frame.locator("img")).toHaveCount(0);
  const failed = await frame.boundingBox();
  expect(failed!.width).toBeCloseTo(loaded!.width, 0);
  expect(failed!.height).toBeCloseTo(loaded!.height, 0);
  // The credit stays: it belongs to the photograph on file.
  await expect(page.locator(".studio-photo-credit").first()).toBeVisible();
  await noAxeViolations(page);
  await screenshot(page, "photo-image-failed", testInfo.project.name);
});

test("explains a file that cannot be used and never loads it", async ({
  page,
}, testInfo) => {
  const requested = await serveThumbnails(page);
  await page.goto(`${artistUrl}/photo/review?file=${PHOTO.unknownAuthor}`);
  await expect(page.getByText("This photograph can’t be used.")).toBeVisible();
  await expect(
    page.getByText("It doesn’t name the photographer or creator to credit."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Use this photograph/ }),
  ).toHaveCount(0);
  expect(requested).toEqual([]);
  await noAxeViolations(page);
  if (isMobile(page)) {
    await expectNoHorizontalOverflow(page);
  }
  await screenshot(page, "photo-not-usable", testInfo.project.name);
});

test("says when Commons cannot be reached and when nothing is found", async ({
  page,
}, testInfo) => {
  await serveThumbnails(page);
  await page.goto(
    `${artistUrl}/photo?q=${encodeURIComponent(PHOTO_SCENARIO.nothing)}`,
  );
  await expect(page.getByText(/Nothing found for/)).toBeVisible();

  await page.goto(
    `${artistUrl}/photo?q=${encodeURIComponent(PHOTO_SCENARIO.unavailable)}`,
  );
  await expect(page.getByText("Couldn’t reach Wikimedia Commons.")).toBeVisible(
    { timeout: 20_000 },
  );
  await expect(
    page.getByText(/the photograph on file is unchanged/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  await noAxeViolations(page);
  if (isMobile(page)) {
    await expectNoHorizontalOverflow(page);
  }
  await screenshot(page, "photo-unreachable", testInfo.project.name);
});

test("removes the photograph only after a confirmation", async ({
  page,
}, testInfo) => {
  await serveThumbnails(page);
  await page.goto(`${artistUrl}/photo`);
  await page.getByRole("button", { name: "Remove the photograph…" }).click();
  const dialog = page.getByRole("dialog", {
    name: `Remove the photograph of ${artistName}?`,
  });
  await expect(dialog).toBeVisible();
  await noAxeViolations(page);
  await screenshot(page, "photo-remove-dialog", testInfo.project.name);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await storedPhoto()).photo_url).not.toBeNull();

  // With the keyboard only: open, confirm, and hear what happened.
  await page.getByRole("button", { name: "Remove the photograph…" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Remove" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("img", { name: `No photograph of ${artistName} yet` }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Photograph removed" }),
  ).toBeVisible();
  // Focus is not lost with the button: it is on the section's heading.
  await expect(page.getByRole("heading", { name: "On file" })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Remove the photograph…" }),
  ).toHaveCount(0);
  expect(await storedPhoto()).toMatchObject({
    photo_url: null,
    photo_credit: null,
    photo_file_sha1: null,
  });
});
