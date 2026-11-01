import { expect, test } from "@playwright/test";

import { named, withDatabase } from "./support";

// Workflow B: the catalog, through the Studio's own forms, with every change
// checked after a reload and in PostgreSQL itself. The tests run in order and
// share the records they create.

test.describe.configure({ mode: "serial" });

const artist = named("Catalog Artist");
const album = named("Catalog Album");
const tracks: [string, string, string] = [
  named("Track One"),
  named("Track Two"),
  named("Track Three"),
];
let artistUrl = "";
let albumUrl = "";

const tracklist = (page: import("@playwright/test").Page) =>
  page.getByRole("list", { name: "Tracklist" }).getByRole("listitem");

test("creates an artist, and finds it again after a reload", async ({
  page,
}) => {
  await page.goto("/studio/artists/new");
  await page.getByLabel("Name", { exact: true }).fill(artist);
  await page.getByLabel("Person or band").selectOption("group");
  await page.getByRole("button", { name: "Add artist" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: artist }),
  ).toBeVisible();
  artistUrl = page.url();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: artist }),
  ).toBeVisible();
  await page.goto("/studio/artists");
  await expect(
    page.getByRole("list", { name: "Artists" }).getByText(artist),
  ).toBeVisible();
});

test("creates an album credited to the artist, with its reference edition", async ({
  page,
}) => {
  await page.goto("/studio/albums/new");
  await page.getByLabel("Title", { exact: true }).fill(album);
  await page
    .getByLabel("Credited artists: artist 1", { exact: true })
    .selectOption({ label: artist });
  await page.getByLabel("First released (optional)").fill("1994");
  await page.getByLabel("Label", { exact: true }).fill("[Test] E2E Label");
  await page.getByLabel("Country (two letters)").fill("US");
  await page.getByRole("button", { name: "Add album" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: album }),
  ).toBeVisible();
  albumUrl = page.url();

  // The album list shows it with the artist it is credited to (a JOIN in
  // PostgreSQL), and the page keeps it after a reload.
  await page.goto("/studio/albums");
  const row = page
    .getByRole("list", { name: "Albums" })
    .getByRole("listitem")
    .filter({ hasText: album });
  await expect(row).toContainText(artist);
  await page.goto(albumUrl);
  await expect(page.getByLabel("Label", { exact: true })).toHaveValue(
    "[Test] E2E Label",
  );
});

test("creates tracks on the album, reorders them, removes one and adds it back", async ({
  page,
}) => {
  await page.goto(albumUrl);
  for (const title of tracks) {
    await page.locator("#new-track-title").fill(title);
    await page.getByRole("button", { name: "Create and add" }).click();
    await expect(tracklist(page).filter({ hasText: title })).toHaveCount(1);
  }
  await expect(tracklist(page)).toHaveCount(3);
  await expect(tracklist(page)).toContainText(tracks);

  // Move the third track up: the order becomes one, three, two.
  await page.getByRole("button", { name: `Move “${tracks[2]}” up` }).click();
  await expect(page.getByText(`Moved “${tracks[2]}” up.`)).toBeVisible();
  await expect(tracklist(page)).toContainText([
    tracks[0],
    tracks[2],
    tracks[1],
  ]);

  // Remove the second track from the album, after a confirmation. The track
  // itself stays in the catalog.
  await page
    .getByRole("button", { name: `Remove “${tracks[1]}” from this album` })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Remove this track from the album?");
  await dialog.getByRole("button", { name: "Remove from album" }).click();
  await expect(
    page.getByText(`Removed “${tracks[1]}” from this album.`),
  ).toBeVisible();
  await expect(tracklist(page)).toHaveCount(2);

  // Add it back from the tracks you already have: it goes to the end, and
  // is never duplicated.
  const option = page
    .locator("#add-existing-track option")
    .filter({ hasText: tracks[1] });
  await page
    .locator("#add-existing-track")
    .selectOption((await option.getAttribute("value"))!);
  await page.getByRole("button", { name: "Add to album" }).click();
  await expect(tracklist(page)).toHaveCount(3);
  await expect(tracklist(page)).toContainText([
    tracks[0],
    tracks[2],
    tracks[1],
  ]);

  // The order is stored, not only shown: it survives a reload ...
  await page.reload();
  await expect(tracklist(page)).toContainText([
    tracks[0],
    tracks[2],
    tracks[1],
  ]);

  // ... and is what PostgreSQL holds, in the reference edition.
  const stored = await withDatabase(async (client) => {
    const result = await client.query<{ title: string; position: number }>(
      `select t.title, et.position
         from edition_tracks et
         join album_editions ed on ed.id = et.edition_id and ed.is_reference
         join albums a on a.id = ed.album_id
         join tracks t on t.id = et.track_id
        where a.title = $1 order by et.position`,
      [album],
    );
    return result.rows;
  });
  expect(stored.map((row) => row.title)).toEqual([
    tracks[0],
    tracks[2],
    tracks[1],
  ]);
  expect(stored.map((row) => row.position)).toEqual([1, 2, 3]);
});

test("edits the album, the artist, and a track, and every change persists", async ({
  page,
}) => {
  // The album's title, year, and edition label.
  const retitled = `${album} (retitled)`;
  await page.goto(albumUrl);
  const details = page.locator("form").filter({ hasText: "Reference edition" });
  await details.getByLabel("Title", { exact: true }).fill(retitled);
  await details.getByLabel("First released (optional)").fill("1995");
  await details.getByLabel("Label", { exact: true }).fill("[Test] E2E Label 2");
  await details.getByRole("button", { name: "Save album" }).click();
  await expect(details.getByText("Saved just now")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: retitled }),
  ).toBeVisible();
  const reloaded = page
    .locator("form")
    .filter({ hasText: "Reference edition" });
  await expect(reloaded.getByLabel("First released (optional)")).toHaveValue(
    "1995",
  );
  await expect(reloaded.getByLabel("Label", { exact: true })).toHaveValue(
    "[Test] E2E Label 2",
  );
  // Editing the album left its tracklist alone.
  await expect(tracklist(page)).toHaveCount(3);

  // The artist: a sort name, changing nothing else.
  await page.goto(artistUrl);
  await page.getByLabel("Sort name (optional)").fill("Artist, Catalog");
  await page.getByRole("button", { name: "Save artist" }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Sort name (optional)")).toHaveValue(
    "Artist, Catalog",
  );
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(artist);
  await expect(page.getByLabel("Person or band")).toHaveValue("group");

  // A track: its title, through the Tracks list.
  await page.goto("/studio/tracks");
  await page
    .getByRole("list", { name: "Tracks" })
    .getByRole("link", { name: tracks[0], exact: true })
    .click();
  const renamed = `${tracks[0]} (renamed)`;
  await page.getByLabel("Title", { exact: true }).fill(renamed);
  await page.getByRole("button", { name: "Save track" }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(renamed);

  const stored = await withDatabase(async (client) => {
    const result = await client.query<{
      title: string;
      first_release_year: number;
      label: string;
      sort_name: string;
      track: string;
    }>(
      `select a.title, a.first_release_year, ed.label, ar.sort_name,
              (select t.title from tracks t where t.title = $2) as track
         from albums a
         join album_editions ed on ed.album_id = a.id and ed.is_reference
         join album_artists aa on aa.album_id = a.id
         join artists ar on ar.id = aa.artist_id
        where a.title = $1`,
      [retitled, renamed],
    );
    return result.rows;
  });
  expect(stored).toEqual([
    {
      title: retitled,
      first_release_year: 1995,
      label: "[Test] E2E Label 2",
      sort_name: "Artist, Catalog",
      track: renamed,
    },
  ]);
});

test("deletes a record nothing refers to, for real, and refuses one that is in use", async ({
  page,
}) => {
  const count = (table: "artists", column: "name", value: string) =>
    withDatabase(async (client) => {
      const result = await client.query(
        `select count(*)::int as n from ${table} where ${column} = $1`,
        [value],
      );
      return result.rows[0].n as number;
    });

  // Nothing refers to this artist, so the delete is a real SQL DELETE.
  const unused = named("Unused Artist");
  await page.goto("/studio/artists/new");
  await page.getByLabel("Name", { exact: true }).fill(unused);
  await page.getByRole("button", { name: "Add artist" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: unused }),
  ).toBeVisible();
  expect(await count("artists", "name", unused)).toBe(1);
  await page.getByRole("button", { name: "Delete artist…" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page).toHaveURL(/\/studio\/artists$/);
  expect(await count("artists", "name", unused)).toBe(0);

  // This artist is credited on the album: PostgreSQL's foreign key refuses,
  // the studio says why, and nothing is removed.
  await page.goto(artistUrl);
  await page.getByRole("button", { name: "Delete artist…" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByText("It is credited on an album.")).toBeVisible();
  expect(await count("artists", "name", artist)).toBe(1);
});
