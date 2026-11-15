import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import { env } from "./support";

// The album artwork on the public album journal (M3.2), anonymous, at desktop
// width and at 390 px, from the server with public reads switched on. The
// cover is set on the synthetic Grace fixture's album in the stored form the
// catalog writes. No real artwork is ever requested: every request to the
// Cover Art Archive is answered here with a generated, synthetic image (an SVG
// of flat colors), or refused, to show the fallback. Screenshots only with
// E2E_SCREENSHOTS=1, to visual-review/m3-2/, which Git ignores.

const base = env("E2E_PUBLIC_URL");
const slug = env("E2E_PUBLIC_SLUG");
const entryId = env("E2E_PUBLIC_ENTRY_ID");

const RELEASE = "3f8c4f8e-0000-4000-8000-000000000001";
const STORED = `https://coverartarchive.org/release/${RELEASE}/1000000001`;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const execFileAsync = promisify(execFile);

// A synthetic test image: flat color fields, so the page's only color is
// visibly the artwork's. Not anyone's artwork.
const TEST_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">
<rect width="500" height="500" fill="#1d4e89"/>
<rect y="300" width="500" height="200" fill="#f2a541"/>
<circle cx="250" cy="220" r="120" fill="#c8553d"/>
</svg>`;

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

function serveTestImage(route: Route) {
  return route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: TEST_IMAGE,
  });
}

async function openJournal(page: Page) {
  // Not "load": that waits for the cover, which one test holds back on purpose.
  const response = await page.goto(`${base}/albums/${slug}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);
  await expect(page.locator(".tk ol")).toBeVisible();
}

// v3: the cover sits in the front sleeve's card, which carries its name.
const frameOf = (page: Page) => page.locator(".gtop .card");
const cover = (page: Page) => page.locator(".gtop .card > img");

/** The v3 sleeve slides in as the page opens. That entrance is not the cover
 * arriving or failing, so the frame is measured with reduced motion, where
 * nothing enters (on a slow runner it was once measured mid-slide). */
async function withoutEntrances(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
}

test("shows the chosen cover in its frame, with nothing moving as it loads", async ({
  page,
}) => {
  // Hold the image back until the frame has been measured without it.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const requested: string[] = [];
  await page.route("https://coverartarchive.org/**", async (route) => {
    requested.push(route.request().url());
    await held;
    await serveTestImage(route);
  });

  await withoutEntrances(page);
  await openJournal(page);
  const frame = frameOf(page);
  await expect(frame).toHaveAccessibleName("Album artwork for Grace");
  const before = await frame.boundingBox();
  expect(before!.width).toBeGreaterThan(200);

  release();
  await expect
    .poll(() =>
      cover(page).evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  // Nothing moves as the cover arrives: the sleeve keeps its box.
  expect(await frame.boundingBox()).toEqual(before);

  expect(requested.length).toBeGreaterThan(0);
  for (const url of requested) {
    expect(url).toMatch(
      new RegExp(`^${STORED.replace(/[.]/g, "\\.")}-(250|500|1200)\\.jpg$`),
    );
  }
  await expect(cover(page)).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(cover(page)).toHaveAttribute("alt", "");
  await expect(page.getByText("Cover: Cover Art Archive")).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("keeps the fallback when the archive does not answer", async ({
  page,
}) => {
  await page.route("https://coverartarchive.org/**", (route) =>
    route.abort("failed"),
  );
  await withoutEntrances(page);
  await openJournal(page);
  const before = await frameOf(page).boundingBox();
  await expect(frameOf(page)).toHaveAccessibleName("Album artwork for Grace");
  const drawn = await cover(page).evaluate((img: HTMLImageElement) => ({
    complete: img.complete,
    width: img.naturalWidth,
  }));
  expect(drawn).toEqual({ complete: true, width: 0 });
  // The sleeve keeps its place: a failed cover moves nothing.
  expect(await frameOf(page).boundingBox()).toEqual(before);
});

test("loads no image from any other host, even if one were rendered", async ({
  page,
}) => {
  await page.route("https://coverartarchive.org/**", serveTestImage);
  const blocked: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) {
      blocked.push(message.text());
    }
  });
  await openJournal(page);
  // The browser's half of the rule: an image from elsewhere is refused.
  const loaded = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(true);
        probe.onerror = () => resolve(false);
        probe.src = "https://example.com/cover.jpg";
      }),
  );
  expect(loaded).toBe(false);
  expect(blocked.join("\n")).toContain("img-src");
});

test("screenshots with the cover, when asked for", async ({
  page,
}, testInfo) => {
  test.skip(process.env.E2E_SCREENSHOTS !== "1", "set E2E_SCREENSHOTS=1");
  mkdirSync("visual-review/m3-2", { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://coverartarchive.org/**", serveTestImage);
  await openJournal(page);
  await expect
    .poll(() =>
      cover(page).evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: `visual-review/m3-2/${testInfo.project.name}-public-cover.png`,
    fullPage: true,
  });
});
