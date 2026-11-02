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
  await expect(
    page.getByRole("heading", { name: "Track by track" }),
  ).toBeVisible();
}

const cover = (page: Page) => page.locator(".pj-cover-image");

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

  await openJournal(page);
  const frame = page.locator(".pj-cover");
  await expect(frame).toHaveAccessibleName("Album artwork for Grace");
  const before = await frame.boundingBox();
  const headBefore = await page.locator(".pj-head").boundingBox();
  expect(before!.width).toBeGreaterThan(200);
  expect(Math.abs(before!.width - before!.height)).toBeLessThan(1);

  release();
  await expect
    .poll(() =>
      cover(page).evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  const after = await frame.boundingBox();
  expect(after).toEqual(before);
  expect(await page.locator(".pj-head").boundingBox()).toEqual(headBefore);

  // The image fills the frame exactly, from the archive's thumbnails only.
  const image = await cover(page).boundingBox();
  expect(image).toEqual(after);
  expect(requested.length).toBeGreaterThan(0);
  for (const url of requested) {
    expect(url).toMatch(
      new RegExp(`^${STORED.replace(/[.]/g, "\\.")}-(250|500|1200)\\.jpg$`),
    );
  }
  // Without a referrer, and named only by its frame.
  await expect(cover(page)).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(cover(page)).toHaveAttribute("alt", "");
  await expect(page.getByText("Cover: Cover Art Archive")).toBeVisible();

  if ((page.viewportSize()?.width ?? 1440) > 720) {
    // The title still sits on the artwork's lower edge, and the caption
    // hangs below the frame without pushing anything.
    const head = await page.locator(".pj-head").boundingBox();
    expect(
      Math.abs(head!.y + head!.height - (after!.y + after!.height)),
    ).toBeLessThan(20);
    const caption = await page.locator(".pj-cover-caption").boundingBox();
    expect(caption!.y).toBeGreaterThan(after!.y + after!.height);
    const meta = await page.locator(".pj-meta").boundingBox();
    expect(meta!.y).toBeGreaterThan(caption!.y + caption!.height);
  } else {
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("keeps the fallback when the archive does not answer", async ({
  page,
}) => {
  await page.route("https://coverartarchive.org/**", (route) =>
    route.abort("failed"),
  );
  await openJournal(page);
  await expect(page.getByText("Album artwork", { exact: true })).toBeVisible();
  await expect(page.getByText("loads from Cover Art Archive")).toBeVisible();
  // A failed image draws nothing over the frame: no broken-image icon.
  const drawn = await cover(page).evaluate((img: HTMLImageElement) => ({
    complete: img.complete,
    width: img.naturalWidth,
  }));
  expect(drawn).toEqual({ complete: true, width: 0 });
  const frame = await page.locator(".pj-cover").boundingBox();
  expect(Math.abs(frame!.width - frame!.height)).toBeLessThan(1);
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
