import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { contrastOnWhite } from "@/design/contrast";
import { createAlbumThroughStudio, named } from "./support";

// Automated accessibility checks of the Studio: axe-core against WCAG 2.0,
// 2.1 and 2.2 level A and AA on every key page at a desktop and a phone width,
// the open dialogs, and sign-in, plus a check of the control boundaries that
// axe cannot see. axe is a floor, not a verdict: it cannot judge reading
// order, the meaning of the words, or a screen reader's experience, and it
// cannot measure a boundary drawn as a background image, which is why the
// second test reads the drawn colors itself.

test.describe.configure({ mode: "serial" });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const ARTIST = named("A11y Artist");
const ALBUM = named("A11y Album");
const TRACK = named("A11y Track");

let albumUrl = "";
let artistUrl = "";
let trackUrl = "";
let journalUrl = "";
let albumId = "";

async function scan(page: Page, label: string) {
  await expect(page.getByText("Loading…")).toHaveCount(0);
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = result.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
  }));
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

async function open(page: Page, width: number, path: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

test("set up: an artist, an album, a track and a journal", async ({ page }) => {
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
    .getByLabel("Opening sentence (optional)")
    .fill("[Test] An opening.");
  await page
    .getByLabel("Your reflection")
    .fill("[Test] A synthetic reflection.\n\nA second paragraph.");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  journalUrl = page.url();
});

for (const width of [1280, 390]) {
  test(`axe finds no WCAG 2.2 A/AA violation on the Studio pages at ${width}px`, async ({
    page,
  }) => {
    const pages: [string, string][] = [
      ["the desk", "/studio"],
      ["artists", "/studio/artists"],
      ["a new artist", "/studio/artists/new"],
      ["an artist", artistUrl],
      ["albums", "/studio/albums"],
      ["a new album", "/studio/albums/new"],
      ["an album", albumUrl],
      ["tracks", "/studio/tracks"],
      ["a new track", "/studio/tracks/new"],
      ["a track", trackUrl],
      ["journals", "/studio/journals"],
      ["choosing an album for a journal", "/studio/journals/new"],
      ["a new journal", `/studio/journals/new?album=${albumId}`],
      ["a journal", journalUrl],
      ["editing a journal", `${journalUrl}/edit`],
      ["Recently deleted", "/studio/journals/deleted"],
    ];
    for (const [label, path] of pages) {
      await open(page, width, path);
      await scan(page, `${label} at ${width}px`);
    }
  });
}

test("the scanner is live: it reports a deliberately broken element", async ({
  page,
}) => {
  await open(page, 1280, "/studio");
  await page.evaluate(() => {
    // An image with no text alternative, and a button with no name.
    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"><button type="button"></button>',
      );
  });
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const rules = result.violations.map((violation) => violation.id);
  expect(rules).toContain("image-alt");
  expect(rules).toContain("button-name");
});

test("axe finds no violation in the open dialogs", async ({ page }) => {
  await open(page, 1280, journalUrl);
  await page.getByRole("button", { name: "Move to Recently deleted…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await scan(page, "the delete dialog");
});

test.describe("sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("axe finds no violation on the sign-in page", async ({ page }) => {
    for (const width of [1280, 390]) {
      await open(page, width, "/studio/sign-in");
      await scan(page, `sign-in at ${width}px`);
    }
  });
});

test("the journal editor's three inputs and its Save button are drawn at 3:1 or better, at rest, on hover and in focus", async ({
  page,
}) => {
  await open(page, 1280, `/studio/journals/new?album=${albumId}`);
  const controls = [
    page.getByLabel("Opening sentence (optional)"),
    page.getByLabel("Your reflection"),
    page.getByLabel("Written in"),
  ];
  async function strokeColors(control: (typeof controls)[number]) {
    return control.evaluate((element) => {
      const image = decodeURIComponent(
        getComputedStyle(element).backgroundImage,
      );
      return [...image.matchAll(/stroke='(#[0-9a-fA-F]{6})'/g)].map(
        (m) => m[1]!,
      );
    });
  }
  for (const control of controls) {
    for (const state of ["rest", "hover", "focus"] as const) {
      if (state === "hover") await control.hover();
      if (state === "focus") await control.focus();
      const colors = await strokeColors(control);
      expect(colors.length, `a boundary is drawn (${state})`).toBeGreaterThan(
        0,
      );
      for (const color of colors) {
        expect(
          contrastOnWhite(color),
          `${color} (${state})`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  }
  // A secondary button's boundary at rest.
  const save = page.getByRole("button", { name: "Save as draft" });
  const saveColors = await strokeColors(save);
  expect(
    saveColors.length,
    "the Save button has a drawn boundary",
  ).toBeGreaterThan(0);
  for (const color of saveColors) {
    expect(contrastOnWhite(color)).toBeGreaterThanOrEqual(3);
  }
});

test("in forced-colors mode the editor's controls keep a real border and no drawn image, at rest, on hover and in focus", async ({
  page,
}) => {
  // Windows high contrast replaces the page's colors, and a drawn outline is a
  // background image: real borders must stand in for it, also on hover, in
  // focus, and for the primary button, whose ink fill must never come back.
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, 1280, `/studio/journals/new?album=${albumId}`);
  await page.getByLabel("Your reflection").fill("[Test] forced colors");
  const controls = [
    page.getByLabel("Opening sentence (optional)"),
    page.getByLabel("Your reflection"),
    page.getByLabel("Written in"),
    // Primary once the text has been edited.
    page.getByRole("button", { name: "Save as draft" }),
  ];
  for (const control of controls) {
    for (const state of ["rest", "hover", "focus"] as const) {
      if (state === "hover") await control.hover();
      if (state === "focus") await control.focus();
      const style = await control.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          image: computed.backgroundImage,
          border: ["Top", "Bottom"].map(
            (side) =>
              parseFloat(
                computed.getPropertyValue(`border-${side.toLowerCase()}-width`),
              ) > 0,
          ),
        };
      });
      expect(style.image, `${state}: no drawn image`).toBe("none");
      expect(
        style.border.some(Boolean),
        `${state}: a real border remains`,
      ).toBe(true);
    }
  }
});
