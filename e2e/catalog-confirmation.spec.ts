import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  expectTouchTarget,
  named,
  withDatabase,
} from "./support";

// ADR 0013 step 3: "Update the published pages?". Renaming an artist that a
// published album journal credits opens the review before anything is saved:
// it lists the pages and the wording before and after, says the old artist
// address will answer 404, Cancel keeps the edit in the form and saves
// nothing, and only Confirm saves. In English and in Portuguese, at the
// project's width (desktop, and 390 px).
//
// The published journal is context, not the record under test: it is written
// to the disposable database directly (the publication workflow has its own
// browser tests), and removed by the run's teardown with its "[Test] E2E"
// names.

test.describe.configure({ mode: "serial" });

async function publishedArtist(label: string) {
  const artist = named(`${label} artist`);
  const album = named(`${label} album`);
  const slug = `t-e2e-${Math.random().toString(36).slice(2, 10)}`;
  const ids = await withDatabase(async (client) => {
    const artistRow = await client.query<{ id: string }>(
      "insert into artists (name, kind) values ($1, 'person') returning id",
      [artist],
    );
    const albumRow = await client.query<{ id: string }>(
      "insert into albums (title) values ($1) returning id",
      [album],
    );
    const artistId = artistRow.rows[0]!.id;
    const albumId = albumRow.rows[0]!.id;
    await client.query(
      "insert into album_artists (album_id, artist_id, position) values ($1, $2, 1)",
      [albumId, artistId],
    );
    await client.query(
      "insert into album_editions (album_id, is_reference) values ($1, true)",
      [albumId],
    );
    const entry = await client.query<{ id: string }>(
      "insert into entries (kind, first_published_at) values ('album_journal', now()) returning id",
    );
    const entryId = entry.rows[0]!.id;
    await client.query(
      `insert into entry_texts (entry_id, locale, is_original, status,
                                published_at, first_published_at, body, body_text)
       values ($1, 'en', true, 'published', now(), now(),
               '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"[Test] E2E words"}]}]}'::jsonb,
               '[Test] E2E words')`,
      [entryId],
    );
    await client.query(
      "insert into album_journals (entry_id, album_id) values ($1, $2)",
      [entryId, albumId],
    );
    await client.query(
      `insert into entry_slugs (kind, slug, entry_id, is_current, was_published)
       values ('album_journal', $1, $2, true, true)`,
      [slug, entryId],
    );
    return { artistId };
  });
  return { ...ids, artist, slug };
}

async function storedName(artistId: string): Promise<string> {
  return withDatabase(async (client) => {
    const result = await client.query<{ name: string }>(
      "select name from artists where id = $1",
      [artistId],
    );
    return result.rows[0]!.name;
  });
}

async function openReview(page: Page, saveLabel: string, renamed: string) {
  const name = page.getByLabel(/^(Name|Nome)$/);
  await name.fill(renamed);
  await page.getByRole("button", { name: saveLabel, exact: true }).click();
  return page.getByRole("dialog");
}

for (const language of [
  {
    prefix: "",
    save: "Save artist",
    title: "Update the published pages?",
    confirm: "Save and update the published pages",
    cancel: "Cancel",
    gone: /page not found.*404/,
    journal: "Album journal",
  },
  {
    prefix: "/pt",
    save: "Salvar artista",
    title: "Atualizar as páginas publicadas?",
    confirm: "Salvar e atualizar as páginas publicadas",
    cancel: "Cancelar",
    gone: /página não encontrada.*404/,
    journal: "Diário de álbum",
  },
]) {
  test(`reviews a published artist's rename before saving it (${language.prefix || "/"})`, async ({
    page,
  }) => {
    const { artistId, artist, slug } = await publishedArtist(
      `Review ${language.prefix || "en"}`,
    );
    const renamed = `${artist} renamed`;
    await page.goto(`${language.prefix}/studio/artists/${artistId}`);

    // Saving opens the review; nothing is saved yet.
    let dialog = await openReview(page, language.save, renamed);
    await expect(
      dialog.getByRole("heading", { name: language.title }),
    ).toBeVisible();
    await expect(dialog.getByText(`/albums/${slug}`).first()).toBeVisible();
    await expect(dialog.getByText(language.journal).first()).toBeVisible();
    await expect(dialog.getByText(renamed).first()).toBeVisible();
    await expect(dialog.getByText(language.gone)).toBeVisible();
    expect(await storedName(artistId)).toBe(artist);

    // Keyboard: focus starts inside the dialog, not on Confirm; both
    // controls are large enough and reachable.
    const confirm = dialog.getByRole("button", { name: language.confirm });
    const cancel = dialog.getByRole("button", { name: language.cancel });
    await expect(confirm).not.toBeFocused();
    await expectTouchTarget(confirm);
    await expectTouchTarget(cancel);
    await expectNoHorizontalOverflow(page);

    // Cancel saves nothing and keeps the edit in the form.
    await cancel.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel(/^(Name|Nome)$/)).toHaveValue(renamed);
    expect(await storedName(artistId)).toBe(artist);

    // Confirm saves exactly the reviewed name.
    dialog = await openReview(page, language.save, renamed);
    await dialog.getByRole("button", { name: language.confirm }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect.poll(() => storedName(artistId)).toBe(renamed);
  });
}

test("saves an unpublished artist's rename with no review", async ({
  page,
}) => {
  const artist = named("Unpublished artist");
  const artistId = await withDatabase(async (client) => {
    const row = await client.query<{ id: string }>(
      "insert into artists (name, kind) values ($1, 'person') returning id",
      [artist],
    );
    return row.rows[0]!.id;
  });
  await page.goto(`/studio/artists/${artistId}`);
  await page.getByLabel("Name", { exact: true }).fill(`${artist} 2`);
  await page.getByRole("button", { name: "Save artist", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => storedName(artistId)).toBe(`${artist} 2`);
});

// ADR 0013 step 4: a tracklist edit on a published album opens the same
// review, showing the track order before and after; Cancel keeps the order,
// Confirm saves it.
async function publishedAlbumWithTracks(label: string) {
  const album = named(`${label} album`);
  const tracks = [named(`${label} one`), named(`${label} two`)];
  const slug = `t-e2e-${Math.random().toString(36).slice(2, 10)}`;
  const albumId = await withDatabase(async (client) => {
    const albumRow = await client.query<{ id: string }>(
      "insert into albums (title) values ($1) returning id",
      [album],
    );
    const id = albumRow.rows[0]!.id;
    const edition = await client.query<{ id: string }>(
      "insert into album_editions (album_id, is_reference) values ($1, true) returning id",
      [id],
    );
    for (const [index, title] of tracks.entries()) {
      const track = await client.query<{ id: string }>(
        "insert into tracks (title) values ($1) returning id",
        [title],
      );
      await client.query(
        "insert into album_tracks (album_id, track_id) values ($1, $2)",
        [id, track.rows[0]!.id],
      );
      await client.query(
        `insert into edition_tracks (edition_id, album_id, track_id, disc_number, position)
         values ($1, $2, $3, 1, $4)`,
        [edition.rows[0]!.id, id, track.rows[0]!.id, index + 1],
      );
    }
    const entry = await client.query<{ id: string }>(
      "insert into entries (kind, first_published_at) values ('album_journal', now()) returning id",
    );
    const entryId = entry.rows[0]!.id;
    await client.query(
      `insert into entry_texts (entry_id, locale, is_original, status,
                                published_at, first_published_at, body, body_text)
       values ($1, 'en', true, 'published', now(), now(),
               '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"[Test] E2E words"}]}]}'::jsonb,
               '[Test] E2E words')`,
      [entryId],
    );
    await client.query(
      "insert into album_journals (entry_id, album_id) values ($1, $2)",
      [entryId, id],
    );
    await client.query(
      `insert into entry_slugs (kind, slug, entry_id, is_current, was_published)
       values ('album_journal', $1, $2, true, true)`,
      [slug, entryId],
    );
    return id;
  });
  return { albumId, tracks, slug };
}

async function storedOrder(albumId: string): Promise<string[]> {
  return withDatabase(async (client) => {
    const result = await client.query<{ title: string }>(
      `select t.title from album_editions ed
         join edition_tracks et on et.edition_id = ed.id
         join tracks t on t.id = et.track_id
        where ed.album_id = $1 and ed.is_reference
        order by et.disc_number, et.position`,
      [albumId],
    );
    return result.rows.map((row) => row.title);
  });
}

for (const language of [
  {
    prefix: "",
    moveDown: (title: string) => `Move “${title}” down`,
    confirm: "Save and update the published pages",
    cancel: "Cancel",
  },
  {
    prefix: "/pt",
    moveDown: (title: string) => `Mover “${title}” para baixo`,
    confirm: "Salvar e atualizar as páginas publicadas",
    cancel: "Cancelar",
  },
]) {
  test(`reviews a published album's tracklist change before saving it (${language.prefix || "/"})`, async ({
    page,
  }) => {
    const { albumId, tracks, slug } = await publishedAlbumWithTracks(
      `Tracklist ${language.prefix || "en"}`,
    );
    await page.goto(`${language.prefix}/studio/albums/${albumId}`);
    const move = () =>
      page.getByRole("button", { name: language.moveDown(tracks[0]!) }).click();

    await move();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByText(`/albums/${slug}`).first()).toBeVisible();
    await expect(dialog.getByText(tracks[1]!).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTouchTarget(
      dialog.getByRole("button", { name: language.cancel }),
    );
    await dialog.getByRole("button", { name: language.cancel }).click();
    await expect(dialog).toBeHidden();
    expect(await storedOrder(albumId)).toEqual(tracks);

    await move();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: language.confirm }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => storedOrder(albumId))
      .toEqual([tracks[1], tracks[0]]);
  });
}
