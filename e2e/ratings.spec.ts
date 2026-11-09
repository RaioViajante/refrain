import { mkdirSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { createAlbumThroughStudio, named, withDatabase } from "./support";

// The album and track ratings in the Writing Studio: every state a rating can
// be in, what the database holds for it, and what comes back after reloading,
// so that a change to how the stars are drawn can never change a stored
// rating. The records are synthetic and removed by the global teardown.
// Screenshots are written only with E2E_SCREENSHOTS=1, to visual-review/ratings/
// (ignored by Git).

test.describe.configure({ mode: "serial" });

const names = {
  artist: named("Ratings Artist"),
  album: named("Ratings Album"),
};
const trackTitle = named("Ratings Song");

const STATES = [
  { words: "0.5 stars", halfSteps: 1 },
  { words: "1 star", halfSteps: 2 },
  { words: "1.5 stars", halfSteps: 3 },
  { words: "2 stars", halfSteps: 4 },
  { words: "2.5 stars", halfSteps: 5 },
  { words: "3 stars", halfSteps: 6 },
  { words: "3.5 stars", halfSteps: 7 },
  { words: "4 stars", halfSteps: 8 },
  { words: "4.5 stars", halfSteps: 9 },
  { words: "5 stars", halfSteps: 10 },
];
// The captures need only the states the owner's brief names.
const CAPTURED = STATES.filter(({ halfSteps }) =>
  [1, 2, 5, 9, 10].includes(halfSteps),
);
const EVERY_RADIO = [
  "0.5 stars",
  "1 star",
  "1.5 stars",
  "2 stars",
  "2.5 stars",
  "3 stars",
  "3.5 stars",
  "4 stars",
  "4.5 stars",
  "5 stars",
  "No rating",
];

let journalUrl = "";

const albumRating = (page: Page) =>
  page.getByRole("group", { name: /Your rating for the album/ });
const trackRating = (page: Page) =>
  page.getByRole("group", { name: /Rating for this track/ });

async function openEditor(page: Page) {
  await page.goto(`${journalUrl}/edit`);
  await expect(page.locator("form[data-editor-ready]")).toBeAttached();
  await expect(
    page.getByLabel("Your reflection", { exact: true }),
  ).toBeVisible();
}

async function openTrack(page: Page) {
  const head = page.getByRole("button", { name: /^Track 1:/ });
  if ((await head.getAttribute("aria-expanded")) !== "true") {
    await head.click();
  }
  await expect(trackRating(page)).toBeVisible();
}

async function pick(rating: Locator, words: string) {
  await rating
    .locator("label")
    .filter({ hasText: new RegExp(`^${words.replace(".", "\\.")}$`) })
    .click();
  await expect(
    rating.getByRole("radio", { name: words, exact: true }),
  ).toBeChecked();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();
}

async function stored() {
  return withDatabase(async (client) => {
    const album = await client.query<{ rating: number | null }>(
      `select j.rating_half_steps as rating
         from album_journals j
         join albums a on a.id = j.album_id
        where a.title = $1`,
      [names.album],
    );
    const track = await client.query<{ rating: number | null }>(
      `select tr.rating_half_steps as rating
         from track_reflections tr
         join tracks t on t.id = tr.track_id
        where t.title = $1`,
      [trackTitle],
    );
    return {
      album: album.rows[0]?.rating ?? null,
      track: track.rows[0]?.rating ?? null,
    };
  });
}

/** How many of the ten star halves actually paint their ink. */
const filledHalves = (rating: Locator) =>
  rating.locator('.studio-star-half svg path[fill="currentColor"]').count();

async function expectState(
  rating: Locator,
  words: string,
  halfSteps: number | null,
) {
  await expect(
    rating.getByRole("radio", { name: words, exact: true }),
  ).toBeChecked();
  await expect(rating.locator(".studio-rating-words")).toHaveText(words);
  expect(await filledHalves(rating)).toBe(halfSteps ?? 0);
}

test("starts a journal with no rating, drawn as five empty stars", async ({
  page,
}) => {
  await createAlbumThroughStudio(page, names);
  await page.locator("#new-track-title").fill(trackTitle);
  await page.getByRole("button", { name: "Create and add" }).click();
  await expect(page.getByText(trackTitle).first()).toBeVisible();
  await page
    .getByRole("link", { name: "Write a journal about this album" })
    .click();
  await page
    .getByLabel("Your reflection", { exact: true })
    .fill("[Test] E2E The whole album, for the ratings.");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  journalUrl = page.url();

  await openEditor(page);
  await openTrack(page);
  await expectState(albumRating(page), "No rating", null);
  await expectState(trackRating(page), "No rating", null);
  expect(await stored()).toEqual({ album: null, track: null });
});

for (const { words, halfSteps } of STATES) {
  test(`stores ${words} for the album, and it comes back after reloading`, async ({
    page,
  }) => {
    await openEditor(page);
    await pick(albumRating(page), words);
    await expectState(albumRating(page), words, halfSteps);
    await save(page);
    expect((await stored()).album).toBe(halfSteps);

    await openEditor(page);
    await expectState(albumRating(page), words, halfSteps);
  });
}

test("stores a track's rating on its own, and every state comes back after reloading", async ({
  page,
}) => {
  await openEditor(page);
  await openTrack(page);
  await page
    .getByLabel(/^Your reflection on /)
    .fill("[Test] E2E A reflection, for the track rating.");
  const albumBefore = (await stored()).album;
  for (const { words, halfSteps } of STATES) {
    await pick(trackRating(page), words);
    await save(page);
    expect(await stored()).toEqual({ album: albumBefore, track: halfSteps });

    await openEditor(page);
    await openTrack(page);
    await expectState(trackRating(page), words, halfSteps);
    await expectState(albumRating(page), "5 stars", albumBefore);
  }
});

test("clearing returns to no rating, for the album and the track separately", async ({
  page,
}) => {
  await openEditor(page);
  await openTrack(page);
  await trackRating(page).getByRole("button", { name: "Clear" }).click();
  await expectState(trackRating(page), "No rating", null);
  await save(page);
  expect(await stored()).toEqual({ album: 10, track: null });

  await openEditor(page);
  await openTrack(page);
  await albumRating(page).getByRole("button", { name: "Clear" }).click();
  await save(page);
  expect(await stored()).toEqual({ album: null, track: null });

  await openEditor(page);
  await openTrack(page);
  await expectState(albumRating(page), "No rating", null);
  await expectState(trackRating(page), "No rating", null);
});

test("is one named radio group, with a spoken name for every half step", async ({
  page,
}) => {
  await openEditor(page);
  const rating = albumRating(page);
  await expect(rating.getByRole("radio")).toHaveCount(11);
  for (const name of EVERY_RADIO) {
    await expect(rating.getByRole("radio", { name, exact: true })).toHaveCount(
      1,
    );
  }
  // The drawings say nothing of their own: only the words are spoken.
  for (const drawing of await rating.locator("svg").all()) {
    await expect(drawing).toHaveAttribute("aria-hidden", "true");
  }
});

test("moves through the half steps with the arrow keys, with visible focus", async ({
  page,
}) => {
  await openEditor(page);
  const rating = albumRating(page);
  await pick(rating, "2.5 stars");
  const checked = rating.getByRole("radio", { name: "2.5 stars", exact: true });
  await checked.focus();

  await page.keyboard.press("ArrowRight");
  const three = rating.getByRole("radio", { name: "3 stars", exact: true });
  await expect(three).toBeFocused();
  await expect(three).toBeChecked();
  expect(await filledHalves(rating)).toBe(6);
  // Native radios: `:focus-visible` follows the key press, and the outline is
  // drawn on the label beside the input.
  const focusedLabel = page.locator(
    ".studio-star-half input:focus-visible + label",
  );
  await expect(focusedLabel).toHaveCount(1);
  await expect(focusedLabel).toHaveCSS("outline-style", "solid");
  await expect(focusedLabel).toHaveCSS("outline-width", "2px");

  await page.keyboard.press("ArrowLeft");
  await expect(checked).toBeFocused();
  await expect(checked).toBeChecked();
  expect(await filledHalves(rating)).toBe(5);

  await page.keyboard.press("Space");
  await expect(checked).toBeChecked();
});

test("keeps the stars in the same place in every state, in a row 44px tall", async ({
  page,
}) => {
  await openEditor(page);
  const rating = albumRating(page);
  const stars = rating.locator(".studio-stars");
  // Measured on the page, not in the viewport, which a click may scroll.
  const place = () =>
    stars.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        x: box.x + window.scrollX,
        y: box.y + window.scrollY,
        width: box.width,
        height: box.height,
      };
    });
  const before = await place();
  expect(before.width).toBe(140);
  for (const { words } of STATES) {
    await pick(rating, words);
    expect(await place()).toEqual(before);
  }
  const row = await rating.locator(".studio-rating-row").boundingBox();
  expect(row!.height).toBeGreaterThanOrEqual(44);
  for (const half of await rating.locator(".studio-star-half label").all()) {
    expect((await half.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  }
});

test("reserves Clear's place, so a first rating moves nothing at any width", async ({
  page,
}) => {
  await openEditor(page);
  await openTrack(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const assertNoShift = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    const rating = trackRating(page);
    if (await rating.getByRole("button", { name: "Clear" }).isVisible()) {
      await rating.getByRole("button", { name: "Clear" }).click();
    }
    await expect(rating.getByRole("button", { name: "Clear" })).toBeHidden();
    const empty = await rating.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    for (const { words } of STATES) {
      await pick(rating, words);
      await expect(rating.getByRole("button", { name: "Clear" })).toBeVisible();
      expect(
        await rating.evaluate(
          (element) => element.getBoundingClientRect().height,
        ),
      ).toBe(empty);
    }
  };
  for (const width of [1440, 390, 360, 320]) {
    await assertNoShift(width);
  }
  // An unset rating has no Clear for the keyboard or a screen reader.
  await page.setViewportSize({ width: 1280, height: 900 });
  await trackRating(page).getByRole("button", { name: "Clear" }).click();
  await expect(
    trackRating(page).getByRole("button", { name: "Clear" }),
  ).toHaveCount(0);
});

test("takes the system's ink in forced-colors mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
  await openEditor(page);
  await pick(albumRating(page), "2.5 stars");
  const inks = await albumRating(page)
    .locator(".studio-star-half svg")
    .first()
    .evaluate((drawing) => {
      const outline = drawing.querySelector(".star-outline")!;
      const words = document.querySelector(".studio-rating-words")!;
      return {
        stroke: getComputedStyle(outline).stroke,
        text: getComputedStyle(words).color,
      };
    });
  // A black star on a dark system canvas would vanish.
  expect(inks.stroke).not.toBe("rgb(17, 17, 17)");
  expect(inks.stroke).toBe(inks.text);
});

const WIDTHS = [1440, 390, 360, 320];
const SHOTS = `visual-review/ratings/${process.env.E2E_SCREENSHOTS_LABEL ?? "current"}`;

test("captures every state of the studio's rating, at every width", async ({
  page,
}) => {
  test.skip(process.env.E2E_SCREENSHOTS !== "1", "set E2E_SCREENSHOTS=1");
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await openEditor(page);
    await openTrack(page);
    await page.evaluate(() => document.fonts.ready);
    await albumRating(page).locator("legend").scrollIntoViewIfNeeded();
    await albumRating(page).screenshot({
      path: `${SHOTS}/studio-album-${width}-none.png`,
    });
    for (const { words, halfSteps } of CAPTURED) {
      await pick(albumRating(page), words);
      await pick(trackRating(page), words);
      await page.mouse.move(0, 0);
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      );
      await albumRating(page).screenshot({
        path: `${SHOTS}/studio-album-${width}-${halfSteps}.png`,
      });
      await trackRating(page).screenshot({
        path: `${SHOTS}/studio-track-${width}-${halfSteps}.png`,
      });
    }
    await pick(albumRating(page), "4.5 stars");
    await pick(trackRating(page), "2.5 stars");
    await page.mouse.move(0, 0);
    // A full-page capture paints the sticky bar and the skip link where the
    // last scroll left them, so go back to the top with nothing focused.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: `${SHOTS}/studio-editor-${width}.png`,
      fullPage: true,
    });
  }
});
