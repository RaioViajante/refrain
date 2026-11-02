import { expect, test, type Page } from "@playwright/test";

import { createAlbumThroughStudio, named, withDatabase } from "./support";

// Workflow D: writing track by track. A reflection saved privately, one set to
// show on the public page, and one a reader can see are three different things,
// and the screen says which. The tests run in order and share their records;
// everything is synthetic and removed by the global teardown.

test.describe.configure({ mode: "serial" });

const names = { artist: named("Tracks Artist"), album: named("Tracks Album") };
const tracks = [1, 2, 3].map((n) => named(`Tracks Song ${n}`));
const reflection =
  "[Test] E2E First thought about the song,\nwith a line break.\n\n[Test] E2E A second paragraph with <b>literal markup</b>.";

let journalUrl = "";

const literal = (text: string) =>
  new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

const albumReflection = (page: Page) =>
  page.getByLabel("Your reflection", { exact: true });

async function openTrack(page: Page, title: string) {
  const head = page.getByRole("button", { name: literal(title) });
  if ((await head.getAttribute("aria-expanded")) !== "true") {
    await head.click();
  }
  return page.getByLabel(literal(`Your reflection on ${title}`));
}

async function openEditor(page: Page) {
  await page.goto(`${journalUrl}/edit`);
  await expect(albumReflection(page)).toBeVisible();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

async function stored() {
  return withDatabase(async (client) => {
    const result = await client.query<{
      title: string;
      is_published: boolean;
      is_favourite: boolean;
      is_still_writing: boolean;
      rating_half_steps: number | null;
      locale: string | null;
      body_text: string | null;
    }>(
      `select t.title, tr.is_published, tr.is_favourite, tr.is_still_writing,
              tr.rating_half_steps, trt.locale, trt.body_text
         from albums a
         join album_journals j on j.album_id = a.id
         join track_reflections tr on tr.album_journal_id = j.entry_id
         join tracks t on t.id = tr.track_id
         left join track_reflection_texts trt on trt.track_reflection_id = tr.id
        where a.title = $1
        order by t.title`,
      [names.album],
    );
    return result.rows;
  });
}

async function journalRow() {
  return withDatabase(async (client) => {
    const result = await client.query<{
      version: number;
      status: string;
      rating: number | null;
    }>(
      `select e.version, t.status, j.rating_half_steps as rating
         from albums a
         join album_journals j on j.album_id = a.id
         join entries e on e.id = j.entry_id
         join entry_texts t on t.entry_id = e.id and t.is_original
        where a.title = $1`,
      [names.album],
    );
    return result.rows[0]!;
  });
}

test("lists the album's tracks in order, empty, and starts nothing by itself", async ({
  page,
}) => {
  await createAlbumThroughStudio(page, names);
  for (const title of tracks) {
    await page.locator("#new-track-title").fill(title);
    await page.getByRole("button", { name: "Create and add" }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  }
  await page
    .getByRole("link", { name: "Write a journal about this album" })
    .click();
  await page
    .getByLabel("Your reflection", { exact: true })
    .fill("[Test] E2E The whole album.");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  journalUrl = page.url();

  await openEditor(page);
  const heads = page.getByRole("button", { name: /^Track \d/ });
  await expect(heads).toHaveCount(3);
  for (const [index, title] of tracks.entries()) {
    await expect(heads.nth(index)).toContainText(title);
    await expect(heads.nth(index)).toContainText("empty");
  }
  // Opening a track writes nothing.
  await openTrack(page, tracks[0]!);
  expect(await stored()).toEqual([]);
});

test("writes a reflection privately, with a rating and marks, and finds it exactly after reloading", async ({
  page,
}) => {
  await openEditor(page);
  const text = await openTrack(page, tracks[1]!);
  await text.fill(reflection);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(
    page.getByRole("button", { name: literal(tracks[1]!) }),
  ).toContainText("edited");

  const rating = page.getByRole("group", { name: /Rating for this track/ });
  await rating.locator("label").filter({ hasText: "3.5 stars" }).click();
  await expect(rating.getByLabel("3.5 stars")).toBeChecked();
  await expect(rating.locator(".studio-rating-words")).toHaveText("3.5 stars");
  await page.getByLabel("Mark as favourite").check();
  await page.getByLabel("Still writing").check();
  // The mark alone is not publication, and the screen says so before saving.
  await page.getByLabel("Include when published").check();
  await expect(
    page.getByText(/That publishes nothing by itself/),
  ).toBeVisible();
  await save(page);
  await expect(page.getByText("Saved just now")).toBeVisible();

  // What the database holds: private text, the marks, and nothing public.
  const rows = await stored();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    title: tracks[1],
    is_published: true,
    is_favourite: true,
    is_still_writing: true,
    rating_half_steps: 7,
    locale: "en",
  });
  expect(rows[0]!.body_text).toBe(reflection);
  expect((await journalRow()).status).toBe("draft");

  // After reloading: the exact text, the rating, the marks, and the honest
  // words about visibility.
  await openEditor(page);
  const again = await openTrack(page, tracks[1]!);
  await expect(again).toHaveValue(reflection);
  await expect(
    page
      .getByRole("group", { name: /Rating for this track/ })
      .getByLabel("3.5 stars"),
  ).toBeChecked();
  await expect(page.getByLabel("Mark as favourite")).toBeChecked();
  await expect(page.getByLabel("Include when published")).toBeChecked();
  await expect(
    page.getByText(
      /Included when published, not published yet: the English version/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: literal(tracks[1]!) }),
  ).toContainText("still writing · included when published");
});

test("rates the album on its own, and clearing one rating leaves the others", async ({
  page,
}) => {
  await openEditor(page);
  const album = page.getByRole("group", { name: /Your rating for the album/ });
  await album.locator("label").filter({ hasText: "4.5 stars" }).click();
  await save(page);
  await expect(page.getByText("Saved just now")).toBeVisible();
  expect((await journalRow()).rating).toBe(9);
  expect((await stored())[0]!.rating_half_steps).toBe(7);

  await openEditor(page);
  await openTrack(page, tracks[1]!);
  await page
    .getByRole("group", { name: /Rating for this track/ })
    .getByRole("button", { name: "Clear" })
    .click();
  await save(page);
  await expect(page.getByText("Saved just now")).toBeVisible();
  expect((await stored())[0]!.rating_half_steps).toBeNull();
  expect((await journalRow()).rating).toBe(9);
});

test("keeps the text when another tab saved first, and never overwrites it silently", async ({
  page,
  context,
}) => {
  await openEditor(page);
  const text = await openTrack(page, tracks[0]!);
  const other = await context.newPage();
  await other.goto(`${journalUrl}/edit`);
  await (
    await openTrack(other, tracks[0]!)
  ).fill("[Test] E2E From the other tab.");
  await save(other);
  await expect(other.getByText("Saved just now")).toBeVisible();

  await text.fill("[Test] E2E From the first tab.");
  await save(page);
  await expect(
    page.getByText(/changed somewhere else since you opened it/),
  ).toBeVisible();
  await expect(text).toHaveValue("[Test] E2E From the first tab.");
  const rows = await stored();
  expect(rows.find((row) => row.title === tracks[0])?.body_text).toBe(
    "[Test] E2E From the other tab.",
  );
  await other.close();
});

test("asks before leaving with unsaved track writing", async ({ page }) => {
  await openEditor(page);
  const text = await openTrack(page, tracks[2]!);
  await text.fill("[Test] E2E Not saved yet.");
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "← The journal" }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toMatch(/unsaved changes/i);
  await expect(page).toHaveURL(/\/edit$/);
  await expect(text).toHaveValue("[Test] E2E Not saved yet.");
});

test("clearing a reflection removes its text and keeps the track", async ({
  page,
}) => {
  await openEditor(page);
  const text = await openTrack(page, tracks[0]!);
  await text.fill("");
  await save(page);
  await expect(page.getByText("Saved just now")).toBeVisible();
  const rows = await stored();
  expect(
    rows.find((row) => row.title === tracks[0])?.body_text ?? null,
  ).toBeNull();
  await openEditor(page);
  await expect(
    page.getByRole("button", { name: literal(tracks[0]!) }),
  ).toContainText("empty");
});

test("a published journal asks before a change to the public page, and keeps the text when the author cancels", async ({
  page,
}) => {
  // The publication spec covers publishing through the studio; this test only
  // needs a journal that is public, so it sets the state of its own synthetic
  // journal directly, on the disposable database only.
  await withDatabase(async (client) => {
    await client.query(
      `update entry_texts t
          set status = 'published', published_at = now(),
              first_published_at = now()
         from album_journals j, albums a
        where t.entry_id = j.entry_id and j.album_id = a.id and a.title = $1`,
      [names.album],
    );
  });
  await openEditor(page);
  await expect(
    page.getByText(
      /This version is published\. Saving changes the published writing/,
    ),
  ).toBeVisible();

  const before = await journalRow();
  const text = await openTrack(page, tracks[1]!);
  await expect(
    page.getByText(
      /Public\. It is part of the English version that is marked as published/,
    ),
  ).toBeVisible();
  await text.fill("[Test] E2E A shorter text.");
  await save(page);
  const dialog = page.getByRole("dialog", {
    name: "Update published writing?",
  });
  await expect(dialog).toContainText("Changed: Reflection on the track");
  await expect(dialog).toContainText("[Test] E2E A shorter text.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(text).toHaveValue("[Test] E2E A shorter text.");
  expect(await journalRow()).toEqual(before);

  // A change that exposes nothing is saved: a reflection that is not set to
  // show.
  await text.fill(reflection);
  await page.getByLabel("Include when published").uncheck();
  await save(page);
  await expect(page.getByText("Saved just now")).toBeVisible();
  expect((await stored())[0]!.is_published).toBe(false);
});
