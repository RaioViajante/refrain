import type { Client } from "pg";

import { FIXTURE } from "./provider-fixtures";
import { assertDisposableTestDatabase } from "./test-database";

// Removes the catalog records that the provider fixtures create when a test
// imports them (M3.2), found by their MusicBrainz identifiers, together with
// any journal written about those albums. Only from the verified disposable
// database: the check runs first, every time.
export async function removeMusicFixtureRecords(client: Client): Promise<void> {
  await assertDisposableTestDatabase(client);
  const groups = [
    FIXTURE.paperMoon,
    FIXTURE.paperMoonDeluxe,
    FIXTURE.paperMoonCover,
  ];
  const journals = `select aj.entry_id from album_journals aj
                      join albums a on a.id = aj.album_id
                     where a.mb_release_group_id = any($1)`;
  await client.query(
    `delete from entry_slugs where entry_id in (${journals})`,
    [groups],
  );
  await client.query(`delete from entries where id in (${journals})`, [groups]);
  await client.query("delete from albums where mb_release_group_id = any($1)", [
    groups,
  ]);
  await client.query("delete from tracks where mb_recording_id = any($1)", [
    [
      FIXTURE.recording1,
      FIXTURE.recording2,
      FIXTURE.recording3,
      FIXTURE.recording4,
      FIXTURE.recording5,
    ],
  ]);
  await client.query("delete from artists where mb_artist_id = any($1)", [
    [FIXTURE.inkQuartet, FIXTURE.paperSinger],
  ]);
}
