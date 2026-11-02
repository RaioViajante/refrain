import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createAlbumThroughStudio, named, withDatabase } from "./support";

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
const extraAlbums: { id: string; index: number }[] = [];

async function shoot(page: Page, name: string, fullPage = true) {
  // React reveals a streamed page a moment after it arrives, so wait until
  // the loading placeholder is gone rather than for the first element.
  await expect(page.getByText("Loading…")).toHaveCount(0);
  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    // Let fonts and layout settle; the pages have no animation to wait for.
    await page.evaluate(() => document.fonts.ready);
    if (fullPage) {
      // Neutral state for a full-page capture: nothing focused, the page at
      // the top, and no transition running. A full-page capture paints fixed
      // and sticky elements (the sticky action bar, the skip link that waits
      // above the screen) where the last scroll left them, so a page that a
      // click had scrolled down showed them in the middle of the writing. The
      // page itself is correct: e2e/editor-journal.spec.ts tests that.
      await page.evaluate(async () => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
        await Promise.all(
          document
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }
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

// A realistic sample, with the names the owner asked for. All of its text is
// synthetic, and each paragraph says so.
const GRACE = {
  artist: "Jeff Buckley",
  album: "Grace",
  opening: "[Test] A synthetic opening sentence, short and quiet.",
  body: [
    "[Test] Synthetic paragraph one. It is written for the visual review and for nothing else: a few sentences of plain prose, long enough to show the measure, the line height and the space between paragraphs, and saying nothing about anyone.",
    "[Test] Synthetic paragraph two. It stands in for the second thought of a journal, with a line break\nin the middle of it, and it is about the same length as the first so that the rhythm of the page can be judged.",
    "[Test] Synthetic paragraph three. A closing paragraph, a little shorter than the others, so that the end of the writing and the space under it can be seen too.",
  ].join("\n\n"),
};
let graceJournalUrl = "";
let graceAlbumId = "";

test("empty states", async ({ page }) => {
  // The realistic sample uses exact names, and the teardown removes those names
  // when the review ends: never start if they already exist.
  const existing = await withDatabase(async (client) => {
    const result = await client.query<{ count: string }>(
      "select (select count(*) from albums where title = $1) + (select count(*) from artists where name = $2) as count",
      [GRACE.album, GRACE.artist],
    );
    return Number(result.rows[0]!.count);
  });
  expect(
    existing,
    "the disposable database already has a record named like the review sample",
  ).toBe(0);
  await visit(page, "/studio", "Desk");
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
  // More of a catalog, so the lists and the Desk can be compared with a fuller
  // reference: two more artists, each with an album and a track or two.
  for (const [index, extra] of ["Second", "Third"].entries()) {
    const more = await createAlbumThroughStudio(page, {
      artist: named(`Visual ${extra} Artist`),
      album: named(`Visual ${extra} Album`),
    });
    extraAlbums.push({ id: more.albumUrl.split("/").pop()!, index });
    for (const n of [1, 2]) {
      await page.locator("#new-track-title").fill(named(`${extra} Track ${n}`));
      await page.getByRole("button", { name: "Create and add" }).click();
      await expect(
        page.getByText(named(`${extra} Track ${n}`)).first(),
      ).toBeVisible();
    }
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
  await visit(page, "/studio/catalog", "Catalog");
  await shoot(page, "22-catalog-overview");
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
  // The realistic sample: Grace, by Jeff Buckley, with a short opening sentence
  // and three paragraphs of synthetic text.
  const grace = await createAlbumThroughStudio(page, {
    artist: GRACE.artist,
    album: GRACE.album,
  });
  graceAlbumId = grace.albumUrl.split("/").pop()!;
  await page.goto(`/studio/journals/new?album=${graceAlbumId}`);
  await page.getByLabel("Opening sentence (optional)").fill(GRACE.opening);
  await page.getByLabel("Your reflection").fill(GRACE.body);
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  graceJournalUrl = page.url();

  // Two more journals in other states, so the Desk shows a mix of drafts and
  // private writing, as the reference does.
  for (const { id, index } of extraAlbums) {
    await page.goto(`/studio/journals/new?album=${id}`);
    await page
      .getByLabel("Opening sentence (optional)")
      .fill(`[Test] Synthetic opening ${index + 2}.`);
    await page
      .getByLabel("Your reflection")
      .fill(`[Test] Synthetic reflection ${index + 2}, for the review only.`);
    await page.getByRole("button", { name: "Save as draft" }).click();
    await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
    if (index === 1) {
      await page.getByRole("button", { name: "Private", exact: true }).click();
      await expect(page.getByText("Now private.")).toBeVisible();
    }
  }
  await visit(page, "/studio", "Desk");
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

test("realistic sample: Grace, by Jeff Buckley", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(graceJournalUrl);
  await expect(
    page.getByRole("heading", { level: 1, name: GRACE.album, exact: true }),
  ).toBeVisible();
  await shoot(page, "23-grace-reading");
  await page.goto(`${graceJournalUrl}/edit`);
  await expect(page.getByLabel("Your reflection")).toHaveValue(GRACE.body);
  await shoot(page, "24-grace-edit");
  await page.goto(`/studio/journals/new?album=${graceAlbumId}`);
  await expect(page.getByLabel("Your reflection")).toBeVisible();
  await shoot(page, "25-grace-new");
  await page.goto("/studio/albums");
  await expect(
    page.getByRole("heading", { level: 1, name: "Albums", exact: true }),
  ).toBeVisible();
  await shoot(page, "26-albums-with-grace");
});

// Track by track, with the ten tracks of the reference sample and synthetic
// reflections, so the screen can be put beside the V4.4 album editor. Track
// titles are catalog facts; every reflection is "[Test]" text.
test("track by track: Grace", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/studio/albums/${graceAlbumId}`);
  const graceTracks = [
    "Mojo Pin",
    "Grace",
    "Last Goodbye",
    "Lilac Wine",
    "So Real",
    "Hallelujah",
    "Lover, You Should’ve Come Over",
    "Corpus Christi Carol",
    "Eternal Life",
    "Dream Brother",
  ];
  for (const [index, title] of graceTracks.entries()) {
    await page.locator("#new-track-title").fill(title);
    await page.getByRole("button", { name: "Create and add" }).click();
    // Count the list: a track named like the album would match the heading.
    await expect(
      page.getByRole("list", { name: "Tracklist" }).getByRole("listitem"),
    ).toHaveCount(index + 1);
  }
  await page.goto(`${graceJournalUrl}/edit`);
  await expect(
    page.getByLabel("Your reflection", { exact: true }),
  ).toBeVisible();
  const write = async (index: number, text: string, still = false) => {
    const head = page.getByRole("button", {
      name: new RegExp(`^Track ${index}:`),
    });
    await head.click();
    await page
      .getByLabel(new RegExp(`^Your reflection on .*`))
      .last()
      .fill(text);
    if (still) {
      await page.getByLabel("Still writing").check();
    }
    await head.click();
  };
  await write(1, "[Test] Synthetic reflection on the first track.");
  await write(2, "[Test] Synthetic reflection on the second track.");
  await write(3, "[Test] A synthetic reflection that is not finished.", true);
  await write(4, "[Test] Synthetic reflection on the fourth track.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.goto(`${graceJournalUrl}/edit`);
  await page.getByRole("button", { name: /^Track 2:/ }).click();
  await shoot(page, "27-grace-tracks");
});

// Close-ups of the drawn controls at 1x (the reference previews are 1x), for
// comparing stroke weight and irregularity with the reference by eye and by
// measurement. Synthetic data only.
test("stroke samples", async ({ page }) => {
  const directory = join(OUT, "strokes");
  mkdirSync(directory, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const sample = async (name: string, locator: ReturnType<Page["locator"]>) => {
    await locator.first().screenshot({ path: join(directory, `${name}.png`) });
  };
  await page.goto("/studio");
  await expect(
    page.getByRole("heading", { level: 1, name: "Desk", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await sample(
    "primary-button",
    page.getByRole("link", { name: "Write a journal" }),
  );
  await sample(
    "nav-underline",
    page.getByRole("navigation", { name: "Writing studio" }),
  );
  // A strip of a list with its drawn dividers.
  const list = page.getByRole("list", { name: "Journals" });
  const box = (await list.boundingBox())!;
  await page.screenshot({
    path: join(directory, "rule.png"),
    clip: {
      x: box.x,
      y: box.y - 6,
      width: Math.min(box.width, 600),
      height: 24,
    },
  });
  await page.goto(journalUrl);
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await sample(
    "secondary-button",
    page.getByRole("link", { name: "Edit this journal" }),
  );
  await page.goto("/studio/albums/new");
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await sample("field", page.getByLabel("Title", { exact: true }));
  await page.goto(`${journalUrl}/edit`);
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await sample("textarea", page.getByLabel("Your reflection"));
  await page.goto(journalUrl);
  await page.getByRole("button", { name: "Move to Recently deleted…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await sample("dialog", page.getByRole("dialog"));
});
