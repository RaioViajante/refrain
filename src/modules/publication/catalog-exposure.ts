import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Transaction } from "@/db";

import {
  albumChangePlan,
  artistChangePlan,
  lockInOrder,
  releaseImportPlan,
  trackChangePlan,
} from "./catalog-locks";
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
 * The same answer inside an artist command's transaction (`updateArtist`,
 * `archiveArtist`, `setArtistPhoto`), decided only after ADR 0013 § 4.1's
 * locks, in its order: the album-journal entries and memories involved
 * `FOR SHARE`, the albums crediting the artist or containing a track crediting
 * it `FOR SHARE`, the artist `FOR NO KEY UPDATE`, and the tracks crediting it
 * `FOR SHARE` (`artistChangePlan`). Publishing, unpublishing, deleting, and
 * restoring lock the entry `FOR UPDATE`, and a publication share-locks the
 * catalog rows it binds, so none of them can change the answer before the
 * command commits.
 */
export async function lockArtistPublicExposure(
  tx: Transaction,
  artistId: string,
): Promise<boolean> {
  await lockInOrder(tx, await artistChangePlan(tx, artistId));
  return isArtistOnPublicPage(tx, artistId);
}

/**
 * The same locks, inside an album command that may change a served page
 * (ADR 0013 § 4.1): `updateAlbum`, the tracklist commands, `createTrack` with
 * an album (before it inserts anything), `deleteAlbum`, and, with
 * `journalsOnly`, `linkAlbumToMusic`. The album is locked `FOR UPDATE`, its
 * credited artists and the artists `artistIds` names `FOR SHARE`, its tracks
 * `FOR SHARE`, and the tracks it adds `FOR NO KEY UPDATE`. With
 * `creditJournalsOf`, the journals of every album crediting those artists are
 * locked too (A5's set, for a credit change). Decides nothing: the caller
 * decides after it returns.
 */
export async function lockAlbumCatalogChange(
  tx: Transaction,
  albumId: string,
  options: {
    artistIds?: readonly string[];
    addedTrackIds?: readonly string[];
    creditJournalsOf?: readonly string[];
    journalsOnly?: boolean;
  } = {},
): Promise<void> {
  const credited = await tx.execute<{ artist_id: string }>(sql`
    select artist_id from album_artists where album_id = ${albumId}`);
  await lockInOrder(
    tx,
    await albumChangePlan(tx, albumId, {
      albumMode: "update",
      artistIds: options.journalsOnly
        ? []
        : [
            ...credited.rows.map((row) => row.artist_id),
            ...(options.artistIds ?? []),
          ],
      addedTrackIds: options.addedTrackIds,
      creditJournalsOf: options.creditJournalsOf,
      journalsOnly: options.journalsOnly,
    }),
  );
}

/**
 * The artwork commands' answer (A3), decided only after the same locks, with
 * the album `FOR NO KEY UPDATE` (A3's mode, which the album's identity read
 * takes again): whether a journal about the album is publicly visible.
 */
export async function lockAlbumPublicExposure(
  tx: Transaction,
  albumId: string,
): Promise<boolean> {
  const credited = await tx.execute<{ artist_id: string }>(sql`
    select artist_id from album_artists where album_id = ${albumId}`);
  await lockInOrder(
    tx,
    await albumChangePlan(tx, albumId, {
      albumMode: "no key update",
      artistIds: credited.rows.map((row) => row.artist_id),
    }),
  );
  return isAlbumOnPublicPage(tx, albumId);
}

/** `updateTrack`'s locks (ADR 0013 § 4.1); the caller decides afterwards. */
export async function lockTrackCatalogChange(
  tx: Transaction,
  trackId: string,
  newArtistIds: readonly string[],
): Promise<void> {
  await lockInOrder(tx, await trackChangePlan(tx, trackId, newArtistIds));
}

/**
 * `importMusicRelease`'s locks, taken before it inserts anything (ADR 0013
 * § 4.1): the memories linking the reused recordings, the albums containing
 * them, the reused artists, and the reused recordings.
 */
export async function lockReleaseImport(
  tx: Transaction,
  reusedTrackIds: readonly string[],
  reusedArtistIds: readonly string[],
): Promise<void> {
  await lockInOrder(
    tx,
    await releaseImportPlan(tx, reusedTrackIds, reusedArtistIds),
  );
}

/**
 * For restoring an archived artist (M3.5, review of PR #46): whether the
 * artist **would** have a public page once it is no longer archived, after
 * the same locks as `lockArtistPublicExposure`, in the same order. It is
 * `publicArtists` without its archived condition, from the same
 * served-address rule.
 */
export async function lockArtistRestoreExposure(
  tx: Transaction,
  artistId: string,
): Promise<boolean> {
  await lockInOrder(tx, await artistChangePlan(tx, artistId));
  const result = await tx.execute<{ shown: boolean }>(sql`
    select exists (
      select 1
        from (${servedAlbumJournalAddresses}) served
        join album_journals aj on aj.entry_id = served.entry_id
        join album_artists aa on aa.album_id = aj.album_id
       where aa.artist_id = ${artistId}) as shown`);
  return result.rows[0]?.shown ?? false;
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
