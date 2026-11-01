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

// Long names on purpose: they are what breaks a layout first.
const ARTIST = named("Layout Artist With A Name Long Enough To Test Wrapping");
const ALBUM = named("Layout Album With A Title Long Enough To Test Wrapping");
const TRACK = named("Layout Track With A Title Long Enough To Test Wrapping");

let journalUrl = "";
let albumUrl = "";
let artistUrl = "";
let trackUrl = "";
let albumId = "";

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

async function open(
  page: Page,
  width: number,
  path: string,
  heading: string | RegExp,
) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
}

test("set up: an artist, an album, a track and a journal to look at", async ({
  page,
}) => {
  const created = await createAlbumThroughStudio(page, {
    artist: ARTIST,
    album: ALBUM,
  });
  albumUrl = created.albumUrl;
  albumId = albumUrl.split("/").pop()!;
  await page.locator("#new-track-title").fill(TRACK);
  await page.getByRole("button", { name: "Create and add" }).click();
  await expect(page.getByText(TRACK).first()).toBeVisible();
  await page.goto("/studio/artists");
  await page.getByRole("link", { name: ARTIST, exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: ARTIST }),
  ).toBeVisible();
  artistUrl = page.url();
  await page.goto("/studio/tracks");
  await page.getByRole("link", { name: TRACK, exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: TRACK }),
  ).toBeVisible();
  trackUrl = page.url();
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

  test(`at ${width}px every Studio page fits without sideways scrolling, with long names`, async ({
    page,
  }) => {
    for (const [path, heading] of [
      ["/studio", "Your desk"],
      ["/studio/artists", "Artists"],
      ["/studio/artists/new", "Add an artist"],
      [artistUrl, ARTIST],
      ["/studio/albums", "Albums"],
      ["/studio/albums/new", "Add an album"],
      [albumUrl, ALBUM],
      ["/studio/tracks", "Tracks"],
      ["/studio/tracks/new", "Add a track"],
      [trackUrl, TRACK],
      ["/studio/journals", "Journals"],
      ["/studio/journals/new", "Write a journal"],
      [`/studio/journals/new?album=${albumId}`, `Write about ${ALBUM}`],
      [journalUrl, ALBUM],
      [`${journalUrl}/edit`, `Edit: ${ALBUM}`],
      ["/studio/journals/deleted", "Recently deleted"],
    ] as const) {
      await open(page, width, path, heading);
      await expectNoHorizontalOverflow(page);
    }
  });
}

test("on an ultrawide screen the writing keeps a reading measure", async ({
  page,
}) => {
  await open(page, 2560, journalUrl, ALBUM);
  const reading = await box(page, ".studio-reading");
  // 62ch of 21px Alegreya Sans is well under 800px; it never follows the
  // width of the display.
  expect(reading.width).toBeLessThan(800);
  const shell = await box(page, ".studio-main");
  expect(shell.width).toBeCloseTo(SHELL_MAX, 0);
  await open(page, 2560, `${journalUrl}/edit`, `Edit: ${ALBUM}`);
  const writing = await box(page, ".studio-writing-column");
  expect(writing.width).toBeLessThanOrEqual(760);
});

test("the navigation is operable by keyboard, with a visible focus ring and tall targets", async ({
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

test("the skip link works after client-side navigation, with earlier routes still in the DOM", async ({
  page,
}) => {
  await open(page, 1280, "/studio", "Your desk");
  for (const section of ["Artists", "Albums"]) {
    await page
      .getByRole("navigation", { name: "Writing studio" })
      .getByRole("link", { name: section, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: section }),
    ).toBeVisible();
  }
  const skip = page.getByRole("link", { name: "Skip to the content" });
  await skip.focus();
  await page.keyboard.press("Enter");
  const focused = await page.evaluate(() => ({
    id: document.activeElement?.id,
    visible: document.activeElement?.checkVisibility() ?? false,
  }));
  expect(focused.id).toBe("studio-content");
  expect(focused.visible, "focus landed on a hidden earlier route").toBe(true);
});
