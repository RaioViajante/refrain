import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Transaction } from "@/db";

import { publicLanguageVersions } from "./predicate";
import { publicArtists, servedAlbumJournalAddresses } from "./queries";

// Whether an album is shown on a public page, for the catalog's guard on
// changes a reader would see without a confirmation (ADR 0006 D5, gap C11,
// gate G8). M3.2 does not resolve C11; it only refuses to add a new way
// around it: the album's artwork cannot change while any journal about the
// album is publicly visible. Visibility is decided here, by the publication
// predicate, never by the catalog.

/**
 * True when a journal about the album has a publicly visible language
 * version. A read for the studio's display; the command uses the locking form.
 */
export async function isAlbumOnPublicPage(
  db: DatabaseExecutor,
  albumId: string,
): Promise<boolean> {
  const result = await db.execute<{ visible: boolean }>(sql`
    select exists (
      select 1
        from album_journals aj
        join (${publicLanguageVersions}) pv on pv.entry_id = aj.entry_id
       where aj.album_id = ${albumId}) as visible`);
  return result.rows[0]?.visible ?? false;
}

/**
 * True when the artist has a public page (M3.5): `publicArtists`, the same
 * rule the page itself uses. A read for the studio's display; the command
 * uses the locking form.
 */
export async function isArtistOnPublicPage(
  db: DatabaseExecutor,
  artistId: string,
): Promise<boolean> {
  const result = await db.execute<{ visible: boolean }>(sql`
    select exists (
      select 1
        from (${publicArtists}) visible
       where visible.artist_id = ${artistId}) as visible`);
  return result.rows[0]?.visible ?? false;
}

/**
 * The same answer inside the photograph command's transaction (M3.5; ADR
 * 0006, proposed amendment A5), decided only after two locks, in this order:
 *
 * 1. `FOR SHARE`, in ascending id order, every album-journal entry about an
 *    album that credits the artist: the journals whose publication decides
 *    whether the artist's page exists. Publishing, unpublishing, deleting,
 *    and restoring lock the entry `FOR UPDATE`, so none of them can change
 *    the answer before the command commits.
 * 2. The artist row, `FOR NO KEY UPDATE` (L3: catalog locks after entry
 *    locks). The answer also depends on `archived_at`, which archiving and
 *    restoring the artist change under the same row lock, so neither can
 *    change it either.
 *
 * What still can, recorded in A5's residual windows: a journal created
 * after step 1, or a credit to the artist added on another album after step
 * 1, followed by that journal's publication, all before this command
 * commits.
 */
export async function lockArtistPublicExposure(
  tx: Transaction,
  artistId: string,
): Promise<boolean> {
  await tx.execute(sql`
    select e.id
      from entries e
      join album_journals aj on aj.entry_id = e.id
     where aj.album_id in (select aa.album_id
                             from album_artists aa
                            where aa.artist_id = ${artistId})
     order by e.id
       for share of e`);
  await tx.execute(sql`
    select id from artists where id = ${artistId} for no key update`);
  return isArtistOnPublicPage(tx, artistId);
}

/**
 * The same answer inside a catalog command's transaction, after locking every
 * journal entry about the album `FOR SHARE`, in a fixed order. Publishing,
 * unpublishing, deleting, and restoring lock the entry `FOR UPDATE`, so none
 * of them can change the answer before the command commits.
 */
export async function lockAlbumPublicExposure(
  tx: Transaction,
  albumId: string,
): Promise<boolean> {
  await tx.execute(sql`
    select e.id
      from entries e
      join album_journals aj on aj.entry_id = e.id
     where aj.album_id = ${albumId}
     order by e.id
       for share of e`);
  return isAlbumOnPublicPage(tx, albumId);
}

/**
 * For restoring an archived artist (M3.5, review of PR #46): whether the
 * artist **would** have a public page once it is no longer archived, after
 * the same locks as `lockArtistPublicExposure`, in the same order (the
 * entries `FOR SHARE` in id order, then the artist row `FOR NO KEY UPDATE`).
 * It is `publicArtists` without its archived condition, from the same
 * served-address rule.
 */
export async function lockArtistRestoreExposure(
  tx: Transaction,
  artistId: string,
): Promise<boolean> {
  await tx.execute(sql`
    select e.id
      from entries e
      join album_journals aj on aj.entry_id = e.id
     where aj.album_id in (select aa.album_id
                             from album_artists aa
                            where aa.artist_id = ${artistId})
     order by e.id
       for share of e`);
  await tx.execute(sql`
    select id from artists where id = ${artistId} for no key update`);
  const result = await tx.execute<{ shown: boolean }>(sql`
    select exists (
      select 1
        from (${servedAlbumJournalAddresses}) served
        join album_journals aj on aj.entry_id = served.entry_id
        join album_artists aa on aa.album_id = aj.album_id
       where aa.artist_id = ${artistId}) as shown`);
  return result.rows[0]?.shown ?? false;
}

/**
 * For a change of an album's credits (M3.5, the owner's review of PR #46):
 * locks `FOR SHARE`, in ascending id order, every album-journal entry that
 * decides whether the album and the credited artists are on public pages:
 * the journals about this album, and about every album that credits one of
 * `artistIds`. The caller then locks the album row and the artists' rows
 * (L3: catalog locks after entry locks) and decides with
 * `artistsNewlyExposedByCredit`.
 */
export async function lockAlbumCreditExposure(
  tx: Transaction,
  albumId: string,
  artistIds: readonly string[],
): Promise<void> {
  const others =
    artistIds.length > 0
      ? sql`or aj.album_id in (select aa.album_id
                                 from album_artists aa
                                where aa.artist_id in (${idList(artistIds)}))`
      : sql``;
  await tx.execute(sql`
    select e.id
      from entries e
      join album_journals aj on aj.entry_id = e.id
     where aj.album_id = ${albumId}
           ${others}
     order by e.id
       for share of e`);
}

/** `id1, id2, …` as bound parameters, for `in (…)`. Never empty here. */
function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

/**
 * The artists of `addedArtistIds` that crediting them on the album would put
 * on a public page for the first time: the album has a served journal, and
 * the artist is not archived and has no public page today. Empty when the
 * album is on no public page. Decided by the same rule as the pages
 * (`publicArtists`, `servedAlbumJournalAddresses`).
 */
export async function artistsNewlyExposedByCredit(
  tx: Transaction,
  albumId: string,
  addedArtistIds: readonly string[],
): Promise<string[]> {
  if (addedArtistIds.length === 0) {
    return [];
  }
  const result = await tx.execute<{ id: string }>(sql`
    select ar.id
      from artists ar
     where ar.id in (${idList(addedArtistIds)})
       and ar.archived_at is null
       and exists (select 1
                     from (${servedAlbumJournalAddresses}) served
                     join album_journals aj on aj.entry_id = served.entry_id
                    where aj.album_id = ${albumId})
       and not exists (select 1
                         from (${publicArtists}) visible
                        where visible.artist_id = ar.id)
     order by ar.id`);
  return result.rows.map((row) => row.id);
}
