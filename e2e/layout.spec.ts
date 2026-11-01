import { expect, test, type Page } from "@playwright/test";

import {
  createAlbumThroughStudio,
  expectNoHorizontalOverflow,
  named,
} from "./support";

// The Studio's lateral layout contract (docs/design/studio-visual-fidelity.md):
// the shell of the RaioViajante sites, `width: min(100% - 35.2px, 1320px)`,
// centered. These tests measure it in a real browser at the widths the Studio
// is verified at, on the production build.

test.describe.configure({ mode: "serial" });

const SHELL_MAX = 1320;
const GUTTER_TOTAL = 35.2;
const WIDTHS = [390, 768, 1280, 1440, 2560];

let journalUrl = "";

async function box(page: Page, selector: string) {
  const result = await page
    .locator(`${selector}:visible`)
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
  const viewport = await page.evaluate(
    () => document.documentElement.clientWidth,
  );
  return { ...result, viewport };
}

async function open(page: Page, width: number, path: string, heading: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
}

test("set up: an album and a journal to look at", async ({ page }) => {
  const created = await createAlbumThroughStudio(page, {
    artist: named("Layout Artist"),
    album: named("Layout Album"),
  });
  const albumId = created.albumUrl.split("/").pop()!;
  await page.goto(`/studio/journals/new?album=${albumId}`);
  await page
    .getByLabel("Your reflection")
    .fill(
      `[Test] ${"A synthetic sentence for the reading measure. ".repeat(40)}`,
    );
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  journalUrl = page.url();
});

for (const width of WIDTHS) {
  test(`at ${width}px the shell is min(100% - 35.2px, 1320px), centered, and header, content and footer share its edges`, async ({
    page,
  }) => {
    await open(page, width, "/studio", "Your desk");
    const expected = Math.min(width - GUTTER_TOTAL, SHELL_MAX);
    for (const selector of [
      ".studio-header-bar",
      ".studio-main",
      ".studio-footer",
    ]) {
      const measured = await box(page, selector);
      expect(measured.width, `${selector} width`).toBeCloseTo(
        Math.min(measured.viewport - GUTTER_TOTAL, SHELL_MAX),
        0,
      );
      expect(measured.left, `${selector} is centered`).toBeCloseTo(
        (measured.viewport - measured.width) / 2,
        0,
      );
      expect(measured.width, `${selector} matches the contract`).toBeCloseTo(
        expected,
        0,
      );
    }
    await expectNoHorizontalOverflow(page);
  });

  test(`at ${width}px every Studio screen fits without sideways scrolling`, async ({
    page,
  }) => {
    for (const [path, heading] of [
      ["/studio", "Your desk"],
      ["/studio/albums", "Albums"],
      ["/studio/artists", "Artists"],
      ["/studio/tracks", "Tracks"],
      ["/studio/journals", "Journals"],
      [journalUrl, named("Layout Album")],
      [`${journalUrl}/edit`, `Edit: ${named("Layout Album")}`],
    ] as const) {
      await open(page, width, path, heading);
      await expectNoHorizontalOverflow(page);
    }
  });
}

test("on an ultrawide screen the writing keeps a reading measure", async ({
  page,
}) => {
  await open(page, 2560, journalUrl, named("Layout Album"));
  const reading = await box(page, ".studio-reading");
  // 62ch of 21px Alegreya Sans is well under 800px; it never follows the
  // width of the display.
  expect(reading.width).toBeLessThan(800);
  const shell = await box(page, ".studio-main");
  expect(shell.width).toBeCloseTo(SHELL_MAX, 0);
  await open(
    page,
    2560,
    `${journalUrl}/edit`,
    `Edit: ${named("Layout Album")}`,
  );
  const writing = await box(page, ".studio-writing-column");
  expect(writing.width).toBeLessThanOrEqual(760);
});

test("the navigation is operable by keyboard, with a visible focus ring and 44px targets", async ({
  page,
}) => {
  await open(page, 1280, "/studio", "Your desk");
  await page.keyboard.press("Tab"); // the skip link
  await expect(
    page.getByRole("link", { name: "Skip to the content" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const first = page
    .getByRole("navigation", { name: "Writing studio" })
    .getByRole("link", { name: "Desk", exact: true });
  await expect(first).toBeFocused();
  const ring = await first.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(ring).toEqual({ style: "solid", width: 2 });
  for (const link of await page
    .getByRole("navigation", { name: "Writing studio" })
    .getByRole("link")
    .all()) {
    const target = await link.boundingBox();
    expect(target!.height).toBeGreaterThanOrEqual(43.5);
  }
});

test("reduced motion stops every transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, 1280, "/studio", "Your desk");
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".studio a, .studio button")]
      .filter((element) => element.checkVisibility())
      .map((element) => getComputedStyle(element).transitionDuration),
  );
  expect(durations.length).toBeGreaterThan(5);
  for (const duration of durations) {
    expect(duration).toBe("0s");
  }
});
