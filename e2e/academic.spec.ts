import { expect, test } from "@playwright/test";

import { named, withDatabase } from "./support";

// The academic example (docs/evidence/m1-3c.md): an album, its credited
// artist, its linked tracks, and a private journal, made through the Studio
// and then read back from PostgreSQL with a real JOIN, aggregates, and a
// subquery. A change made in the database then appears in the interface, so
// both directions of AC-06 are shown. Every record is synthetic.

test.describe.configure({ mode: "serial" });

const artist = named("Academic Artist");
const album = named("Academic Album");
const trackTitles = [named("Academic Track A"), named("Academic Track B")];
const journalText = "[Test] E2E Academic journal text.";
let albumUrl = "";

test("builds the example through the Studio", async ({ page }) => {
  await page.goto("/studio/artists/new");
  await page.getByLabel("Name", { exact: true }).fill(artist);
  await page.getByRole("button", { name: "Add artist" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: artist }),
  ).toBeVisible();

  await page.goto("/studio/albums/new");
  await page.getByLabel("Title", { exact: true }).fill(album);
  await page
    .getByLabel("Credited artists: artist 1", { exact: true })
    .selectOption({ label: artist });
  await page.getByLabel("First released (optional)").fill("1994");
  await page.getByRole("button", { name: "Add album" }).click();
  await page.waitForURL(/\/studio\/albums\/[0-9a-f-]{36}$/);
  albumUrl = page.url();

  for (const title of trackTitles) {
    await page.locator("#new-track-title").fill(title);
    await page.getByRole("button", { name: "Create and add" }).click();
    await expect(
      page
        .getByRole("list", { name: "Tracklist" })
        .getByRole("listitem")
        .filter({ hasText: title }),
    ).toHaveCount(1);
  }

  await page
    .getByRole("link", { name: "Write a journal about this album" })
    .click();
  await page.getByLabel("Your reflection").fill(journalText);
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Private" }).click();
  await expect(page.getByText("Now private.")).toBeVisible();
});

test("PostgreSQL holds the related rows: a JOIN across the tables, and the aggregates the pages show", async ({
  page,
}) => {
  const rows = await withDatabase(async (client) => {
    // AC-02 and AC-04: six related tables in one JOIN.
    const joined = await client.query<{
      album: string;
      artist: string;
      position: number;
      track: string;
      status: string;
      deleted: boolean;
    }>(
      `select al.title as album, coalesce(aa.credited_as, ar.name) as artist,
              et.position, t.title as track, o.status, e.deleted_at is not null as deleted
         from albums al
         join album_artists aa on aa.album_id = al.id
         join artists ar       on ar.id = aa.artist_id
         join album_editions ed on ed.album_id = al.id and ed.is_reference
         join edition_tracks et on et.edition_id = ed.id
         join tracks t          on t.id = et.track_id
         join album_journals j  on j.album_id = al.id
         join entries e         on e.id = j.entry_id
         join entry_texts o     on o.entry_id = e.id and o.is_original
        where al.title = $1
        order by et.position`,
      [album],
    );
    // AC-05: an aggregate (COUNT with GROUP BY over a LEFT JOIN) ...
    const count = await client.query<{ track_count: number }>(
      `select count(m.track_id)::int as track_count
         from albums al left join album_tracks m on m.album_id = al.id
        where al.title = $1 group by al.id`,
      [album],
    );
    // ... and a subquery (how many live entries use the album).
    const usage = await client.query<{ used_in: number }>(
      `select (select count(*)::int from entries e
                where e.deleted_at is null
                  and e.id in (select aj.entry_id from album_journals aj
                                where aj.album_id = al.id)) as used_in
         from albums al where al.title = $1`,
      [album],
    );
    return { joined: joined.rows, count: count.rows, usage: usage.rows };
  });

  expect(rows.joined).toEqual(
    trackTitles.map((track, index) => ({
      album,
      artist,
      position: index + 1,
      track,
      status: "private",
      deleted: false,
    })),
  );
  expect(rows.count).toEqual([{ track_count: 2 }]);
  expect(rows.usage).toEqual([{ used_in: 1 }]);

  // The same numbers are on the pages: computed by PostgreSQL on request.
  await page.goto("/studio/albums");
  const listing = page
    .getByRole("list", { name: "Albums" })
    .getByRole("listitem")
    .filter({ hasText: album });
  await expect(listing).toContainText(artist);
  await expect(listing).toContainText("2 tracks");
  await expect(listing).toContainText("used in 1 entry");
});

test("a change made in the database appears in the interface after a reload", async ({
  page,
}) => {
  const renamed = `${artist} (renamed in SQL)`;
  await withDatabase(async (client) => {
    await client.query(
      "update artists set name = $2, updated_at = now() where name = $1",
      [artist, renamed],
    );
  });
  await page.goto(albumUrl);
  await expect(page.getByText(renamed).first()).toBeVisible();
  await page.goto("/studio/artists");
  await expect(
    page.getByRole("list", { name: "Artists" }).getByText(renamed),
  ).toBeVisible();
});
