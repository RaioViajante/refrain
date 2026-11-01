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
    await open(page, width, "/studio", "Desk");
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
      ["/studio", "Desk"],
      ["/studio/catalog", "Catalog"],
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
      [`${journalUrl}/edit`, ALBUM],
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
  await open(page, 2560, `${journalUrl}/edit`, ALBUM);
  const writing = await box(page, ".studio-writing-column");
  expect(writing.width).toBeLessThanOrEqual(760);
});

test("the navigation is operable by keyboard, with a visible focus ring and tall targets", async ({
  page,
}) => {
  await open(page, 1280, "/studio", "Desk");
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
  await open(page, 1280, "/studio", "Desk");
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
  await open(page, 1280, "/studio", "Desk");
  await page
    .getByRole("navigation", { name: "Writing studio" })
    .getByRole("link", { name: "Catalog", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Catalog", exact: true }),
  ).toBeVisible();
  for (const section of ["Artists", "Albums"]) {
    await page
      .getByRole("navigation", { name: "Catalog sections" })
      .getByRole("link", { name: section, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: section, exact: true }),
    ).toBeVisible();
  }
  // Next keeps the earlier routes in the DOM, hidden, each with the same
  // #studio-content: the hazard this test exists for.
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

// The header follows the reference at both sizes. Above 720px it is one row:
// the label, the two destinations centered, and the session control. At 720px
// and below it is the reference's short vertical composition: the label and the
// two destinations centered, and the session control, quiet, at the right. The
// two destinations never wrap, at any width.
for (const width of [...WIDTHS, 360, 320, 720, 721]) {
  test(`at ${width}px the header follows the reference, with two destinations that never wrap`, async ({
    page,
  }) => {
    await open(page, width, "/studio", "Desk");
    const geometry = await page.evaluate(() => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          cx: box.left + box.width / 2,
          cy: box.top + box.height / 2,
        };
      };
      const visible = <T extends Element>(selector: string) =>
        [...document.querySelectorAll<T>(selector)].find((element) =>
          element.checkVisibility(),
        )!;
      return {
        viewport: document.documentElement.clientWidth,
        label: rect(visible(".studio-header-label")),
        links: [...visible(".studio-nav").querySelectorAll("a")].map(rect),
        nav: rect(visible(".studio-nav")),
        end: rect(visible(".studio-header-end")),
        labelText: visible(".studio-header-label").textContent,
        labelWordsWidth: visible(
          ".studio-header-label-text",
        ).getBoundingClientRect().width,
      };
    });
    expect(geometry.links).toHaveLength(2);
    const [first, second] = geometry.links as [
      (typeof geometry.links)[number],
      (typeof geometry.links)[number],
    ];
    expect(
      Math.abs(first.cy - second.cy),
      "the two destinations share a row",
    ).toBeLessThan(4);
    expect(geometry.labelText, "the identity stays visible as words").toContain(
      "Writing studio",
    );
    // Text clipped to a pixel is still in the DOM, so measure the words.
    expect(
      geometry.labelWordsWidth,
      "the words are shown, not hidden",
    ).toBeGreaterThan(60);
    const middle = geometry.viewport / 2;
    if (width <= 720) {
      // Stacked: label, then the destinations, then the session control.
      expect(geometry.label.bottom).toBeLessThanOrEqual(geometry.nav.top + 1);
      expect(geometry.nav.bottom).toBeLessThanOrEqual(geometry.end.top + 1);
      expect(
        Math.abs(geometry.label.cx - middle),
        "label centered",
      ).toBeLessThan(8);
      expect(
        Math.abs(geometry.nav.cx - middle),
        "destinations centered",
      ).toBeLessThan(8);
      expect(geometry.end.right, "Sign out at the right").toBeGreaterThan(
        geometry.viewport - 40,
      );
    } else {
      // One row: label, destinations, session control, in that order.
      expect(Math.abs(geometry.label.cy - first.cy)).toBeLessThan(14);
      expect(Math.abs(geometry.end.cy - first.cy)).toBeLessThan(14);
      expect(geometry.label.right).toBeLessThanOrEqual(first.left + 1);
      expect(second.right).toBeLessThanOrEqual(geometry.end.left + 1);
      expect(
        Math.abs(geometry.nav.cx - middle),
        "destinations centered",
      ).toBeLessThan(8);
    }
    await expectNoHorizontalOverflow(page);
  });
}

// The editor's action bar: Save and the save state are one glance away while
// writing, on a wide screen and on a phone, without covering the writing.
for (const width of [1280, 390]) {
  test(`at ${width}px Save and the save state stay reachable while writing a long text`, async ({
    page,
  }) => {
    await open(page, width, `${journalUrl}/edit`, ALBUM);
    const save = page.getByRole("button", { name: "Save", exact: true });
    const body = page.getByLabel("Your reflection");
    const longText = Array.from(
      { length: 40 },
      (_, index) => `[Test] Paragraph ${index + 1} of a long synthetic text.`,
    ).join("\n\n");
    await body.fill(longText);
    // The save state appears beside Save as soon as the text changes.
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await expect(save).toBeVisible();
    // Scroll to the end of the page: Save is still on screen.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(save).toBeInViewport();
    // The bar must not cover the writing it belongs to: the text area's top is
    // below the bar when the page is at the top again.
    await page.evaluate(() => window.scrollTo(0, 0));
    const [bar, area] = await Promise.all([
      page.locator(".studio-editorbar").first().boundingBox(),
      body.boundingBox(),
    ]);
    expect(area!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
    // Reading order: the bar (the way back, Save) comes before the fields.
    const order = await page.evaluate(() => {
      const bar = document.querySelector(".studio-editorbar");
      const field = document.querySelector("textarea");
      return Boolean(
        bar &&
        field &&
        bar.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(order).toBe(true);
    await expectNoHorizontalOverflow(page);
  });
}

// WCAG 2.2, 2.4.11: a focused field must not be hidden under the sticky bar.
test("the sticky action bar never hides the field that takes focus", async ({
  page,
}) => {
  await open(page, 1280, `${journalUrl}/edit`, ALBUM);
  const body = page.getByLabel("Your reflection");
  // Scroll the writing out of sight below, then move focus back to it.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole("link", { name: /^← The journal/ }).focus();
  await body.focus();
  const [bar, area] = await Promise.all([
    page.locator(".studio-editorbar").first().boundingBox(),
    body.boundingBox(),
  ]);
  expect(
    area!.y,
    "the focused field starts below the bar",
  ).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
});
