import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createAlbumThroughStudio, named } from "./support";

// The visual review package (`pnpm review:screens`). Not part of the normal
// suite: it runs only when VISUAL_REVIEW=1, as its own Playwright project. It
// builds a small synthetic catalog and journal through the Studio's real forms
// (every record is "[Test] E2E …" and is removed by the global teardown), then
// captures the screens at the widths the Studio is verified at. Screenshots go
// to visual-review/ (ignored by Git). They contain only synthetic text.

test.describe.configure({ mode: "serial" });

const OUT = process.env.VISUAL_REVIEW_DIR ?? "visual-review";
const WIDTHS = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 900 },
  { name: "1440", width: 1440, height: 900 },
  { name: "2560", width: 2560, height: 1200 },
];

const artist = named("Visual Artist With A Fairly Long Name");
const album = named("Visual Album With A Title Long Enough To Wrap");
const opening = "[Test] A synthetic opening sentence, set in Kalam light.";
const body = [
  "[Test] This is synthetic text, written for the visual review and for nothing else. It has several paragraphs so that the reading measure, the line height and the rhythm between paragraphs can be judged.",
  "[Test] A second paragraph, with a line break\nin the middle of it, to show that line breaks are kept.",
  "[Test] A third paragraph that is long enough to wrap over a few lines on a narrow screen and to show how the writing column behaves on a very wide monitor, where the text must stay at a comfortable width instead of stretching across the display. It says nothing about anyone.",
].join("\n\n");

let albumUrl = "";
let journalUrl = "";
let trackTitles: string[] = [];

async function shoot(page: Page, name: string, fullPage = true) {
  // React reveals a streamed page a moment after it arrives, so wait until
  // the loading placeholder is gone rather than for the first element.
  await expect(page.getByText("Loading…")).toHaveCount(0);
  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    // Let fonts and layout settle; the pages have no animation to wait for.
    await page.evaluate(() => document.fonts.ready);
    const directory = join(OUT, size.name);
    mkdirSync(directory, { recursive: true });
    await page.screenshot({
      path: join(directory, `${name}.png`),
      fullPage,
    });
  }
}

async function visit(page: Page, path: string, heading?: RegExp | string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(path);
  if (heading) {
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
  }
}

test.describe("anonymous", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("sign-in", async ({ page }) => {
    await visit(page, "/studio/sign-in", "Sign in");
    await shoot(page, "01-sign-in");
  });
});

test("empty states", async ({ page }) => {
  await visit(page, "/studio", "Your desk");
  await shoot(page, "02-desk-empty");
  await visit(page, "/studio/artists", "Artists");
  await shoot(page, "03-artists-empty");
  await visit(page, "/studio/albums", "Albums");
  await shoot(page, "04-albums-empty");
  await visit(page, "/studio/journals", "Journals");
  await shoot(page, "05-journals-empty");
});

test("populated catalog", async ({ page }) => {
  const created = await createAlbumThroughStudio(page, { artist, album });
  albumUrl = created.albumUrl;
  trackTitles = [1, 2, 3, 4].map((n) => named(`Visual Track ${n}`));
  for (const title of trackTitles) {
    await page.locator("#new-track-title").fill(title);
    await page.getByRole("button", { name: "Create and add" }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  }
  await visit(page, "/studio/artists", "Artists");
  await shoot(page, "06-artists");
  await visit(page, "/studio/albums", "Albums");
  await shoot(page, "07-albums");
  await visit(page, "/studio/tracks", "Tracks");
  await shoot(page, "08-tracks");
  await page.goto(albumUrl);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shoot(page, "09-album-detail");
  await visit(page, "/studio/albums/new", /Add an album/);
  await shoot(page, "10-album-new");
  await visit(page, "/studio/artists/new", /Add an artist/);
  await shoot(page, "11-artist-new");
});

test("journal: write, read, edit", async ({ page }) => {
  const albumId = albumUrl.split("/").pop()!;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/studio/journals/new?album=${albumId}`);
  await expect(page.getByLabel("Your reflection")).toBeVisible();
  await shoot(page, "12-journal-new");
  await page.getByLabel("Opening sentence (optional)").fill(opening);
  await page.getByLabel("Your reflection").fill(body);
  await shoot(page, "13-journal-editing-unsaved");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  journalUrl = page.url();
  await expect(page.getByText(opening)).toBeVisible();
  await shoot(page, "14-journal-reading");
  await page.goto(`${journalUrl}/edit`);
  await expect(page.getByLabel("Your reflection")).toHaveValue(body);
  await shoot(page, "15-journal-edit");
  await visit(page, "/studio", "Your desk");
  await shoot(page, "16-desk-populated");
  await visit(page, "/studio/journals", "Journals");
  await shoot(page, "17-journals-list");
});

test("dialogs and Recently deleted", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(journalUrl);
  await page.getByRole("button", { name: "Move to Recently deleted…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shoot(page, "18-delete-dialog", false);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move to Recently deleted" })
    .click();
  await expect(page).toHaveURL(/\/studio\/journals$/);
  await page.goto("/studio/journals/deleted");
  await expect(
    page.getByRole("heading", { level: 1, name: "Recently deleted" }),
  ).toBeVisible();
  await shoot(page, "19-recently-deleted");
  await page.getByRole("button", { name: /Restore the journal about/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shoot(page, "20-restore-dialog", false);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restore journal" })
    .click();
  await expect(page).toHaveURL(/restored=1/);
  await shoot(page, "21-journal-restored");
});
