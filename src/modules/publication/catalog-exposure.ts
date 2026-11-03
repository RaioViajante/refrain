import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Transaction } from "@/db";

import { publicLanguageVersions } from "./predicate";
import { publicArtists } from "./queries";

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
 * 0006, proposed amendment A5), after locking `FOR SHARE`, in ascending id
 * order, every album-journal entry about an album that credits the artist:
 * the journals whose publication decides whether the artist's page exists.
 * Publishing, unpublishing, deleting, and restoring lock the entry
 * `FOR UPDATE`, so none of them can change the answer before the command
 * commits. The artist row is locked by the caller afterwards (L3: catalog
 * locks after entry locks).
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
