import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import {
  databaseErrorOf,
  schema,
  SqlState,
  type DatabaseExecutor,
  type Transaction,
} from "@/db";
import type { AuthorizedAuthor } from "@/modules/identity";
import { fieldErrorsOf } from "@/validation";

import { CatalogError, type CatalogBlocker } from "./errors";
import {
  albumInput,
  artistInput,
  catalogId,
  moveDirection,
  newTrackInput,
  trackInput,
  tracklistInput,
} from "./input";

// Catalog commands (artists, albums, their reference edition and credits,
// tracks, and the ordered tracklist). Each validates its own input with Zod,
// then runs in one transaction (docs/data-model.md § Transaction boundaries);
// called with a transaction, it runs in a savepoint of it.
//
// Every command takes the `AuthorizedAuthor` that only the Identity module can
// create, so presentation code cannot call one without having authorized the
// request first. The commands hold no other authorization logic.
//
// Catalog records that writing references are archived, never deleted: a
// delete is attempted and PostgreSQL's ON DELETE RESTRICT decides (ADR 0002,
// D4.5). No command cascades from the catalog into writing.

// Constraints whose violation on DELETE means "something still depends on it".
const BLOCKERS: Record<string, CatalogBlocker> = {
  album_artists_artist_fk: "album_credits",
  track_artists_artist_fk: "track_credits",
  artist_journals_artist_fk: "journals",
  album_journals_album_fk: "journals",
  memory_music_album_fk: "memories",
  memory_music_track_fk: "memories",
  album_tracks_track_fk: "albums",
  track_reflections_album_track_fk: "reflections",
};

const MUSICBRAINZ_IDENTIFIERS = new Set([
  "artists_mb_artist_id_unique",
  "albums_mb_release_group_id_unique",
  "tracks_mb_recording_id_unique",
  "album_editions_mb_release_id_unique",
]);

// Turns a database failure into a fixed domain failure. Anything unrecognized
// is rethrown untouched for the caller to report as an internal error; its
// message is never shown to a client.
function translate(error: unknown): unknown {
  if (error instanceof CatalogError) {
    return error;
  }
  const failure = databaseErrorOf(error);
  if (!failure) {
    return error;
  }
  if (
    failure.code === SqlState.uniqueViolation &&
    failure.constraint &&
    MUSICBRAINZ_IDENTIFIERS.has(failure.constraint)
  ) {
    return new CatalogError("duplicate_identifier");
  }
  if (failure.code === SqlState.foreignKeyViolation) {
    const blocker = failure.constraint
      ? BLOCKERS[failure.constraint]
      : undefined;
    const missingParent = /is not present in table/.test(failure.detail ?? "");
    return blocker && !missingParent
      ? new CatalogError("in_use", { blockedBy: blocker })
      : new CatalogError("not_found");
  }
  if (failure.code === SqlState.checkViolation) {
    return new CatalogError("invalid_input");
  }
  return error;
}

async function guarded<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    throw translate(error);
  }
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new CatalogError("invalid_input", {
      fields: fieldErrorsOf(result.error),
    });
  }
  return result.data;
}

function idOf(value: unknown): string {
  return parse(catalogId, value);
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

export async function createArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<{ id: string }> {
  const data = parse(artistInput, input);
  return guarded(async () => {
    const [artist] = await db
      .insert(schema.artists)
      .values(data)
      .returning({ id: schema.artists.id });
    return { id: artist!.id };
  });
}

export async function updateArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  artistId: unknown,
  input: unknown,
): Promise<void> {
  const id = idOf(artistId);
  const data = parse(artistInput, input);
  await guarded(async () => {
    const updated = await db
      .update(schema.artists)
      .set(data)
      .where(eq(schema.artists.id, id))
      .returning({ id: schema.artists.id });
    if (updated.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

/** Archives an artist: hidden from pickers; writing and credits stay. */
export async function archiveArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  artistId: unknown,
): Promise<void> {
  const id = idOf(artistId);
  await guarded(async () => {
    const result = await db.execute(sql`
      update artists
         set archived_at = coalesce(archived_at, now()), updated_at = now()
       where id = ${id}
      returning id`);
    if (result.rows.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

export async function restoreArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  artistId: unknown,
): Promise<void> {
  const id = idOf(artistId);
  await guarded(async () => {
    const updated = await db
      .update(schema.artists)
      .set({ archivedAt: null })
      .where(eq(schema.artists.id, id))
      .returning({ id: schema.artists.id });
    if (updated.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

/**
 * Deletes an artist that nothing refers to. An artist credited on an album or
 * track, or with an artist journal, is refused with `in_use` by PostgreSQL's
 * ON DELETE RESTRICT: archive it instead.
 */
export async function deleteArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  artistId: unknown,
): Promise<void> {
  const id = idOf(artistId);
  await guarded(async () => {
    const deleted = await db
      .delete(schema.artists)
      .where(eq(schema.artists.id, id))
      .returning({ id: schema.artists.id });
    if (deleted.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

// ---------------------------------------------------------------------------
// Shared helpers for credits
// ---------------------------------------------------------------------------

// Every artist must exist, and a new link may not point to an archived one.
// Artists that are already linked stay valid even when archived.
async function assertArtistsLinkable(
  tx: Transaction,
  artistIds: string[],
  alreadyLinked: ReadonlySet<string>,
): Promise<void> {
  if (artistIds.length === 0) {
    return;
  }
  const found = await tx
    .select({
      id: schema.artists.id,
      archivedAt: schema.artists.archivedAt,
    })
    .from(schema.artists)
    .where(inArray(schema.artists.id, artistIds));
  if (found.length !== artistIds.length) {
    throw new CatalogError("not_found");
  }
  if (found.some((a) => a.archivedAt !== null && !alreadyLinked.has(a.id))) {
    throw new CatalogError("archived_reference");
  }
}

async function lockAlbum(tx: Transaction, albumId: string): Promise<void> {
  const locked = await tx.execute(
    sql`select id from albums where id = ${albumId} for update`,
  );
  if (locked.rows.length === 0) {
    throw new CatalogError("not_found");
  }
}

// ---------------------------------------------------------------------------
// Albums, their reference edition, and credits
// ---------------------------------------------------------------------------

async function linkedAlbumArtists(
  tx: Transaction,
  albumId: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ artistId: schema.albumArtists.artistId })
    .from(schema.albumArtists)
    .where(eq(schema.albumArtists.albumId, albumId));
  return new Set(rows.map((row) => row.artistId));
}

async function replaceAlbumCredits(
  tx: Transaction,
  albumId: string,
  credits: { artistId: string; creditedAs: string | null }[],
): Promise<void> {
  // (album_id, position) is unique and not deferrable, so the credits are
  // replaced rather than renumbered in place.
  await tx
    .delete(schema.albumArtists)
    .where(eq(schema.albumArtists.albumId, albumId));
  await tx.insert(schema.albumArtists).values(
    credits.map((credit, index) => ({
      albumId,
      artistId: credit.artistId,
      position: index + 1,
      creditedAs: credit.creditedAs,
    })),
  );
}

/**
 * Creates an album (the release group) with its one reference edition and its
 * ordered artist credits, in one transaction (data model: every album has a
 * reference edition). Titles are not unique. At least one credited artist is
 * required.
 */
export async function createAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<{ id: string }> {
  const data = parse(albumInput, input);
  return guarded(() =>
    db.transaction(async (tx) => {
      await assertArtistsLinkable(
        tx,
        data.credits.map((credit) => credit.artistId),
        new Set(),
      );
      const [album] = await tx
        .insert(schema.albums)
        .values({
          title: data.title,
          firstReleaseYear: data.firstReleaseYear,
          mbReleaseGroupId: data.mbReleaseGroupId,
        })
        .returning({ id: schema.albums.id });
      const albumId = album!.id;
      await tx
        .insert(schema.albumEditions)
        .values({ albumId, isReference: true, ...data.edition });
      await replaceAlbumCredits(tx, albumId, data.credits);
      return { id: albumId };
    }),
  );
}

/**
 * Edits an album's metadata, its reference edition's metadata, and replaces
 * its ordered credits, in one transaction. The album row is locked, so two
 * concurrent edits run one after the other and the credits never interleave.
 */
export async function updateAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
  input: unknown,
): Promise<void> {
  const id = idOf(albumId);
  const data = parse(albumInput, input);
  await guarded(() =>
    db.transaction(async (tx) => {
      await lockAlbum(tx, id);
      await assertArtistsLinkable(
        tx,
        data.credits.map((credit) => credit.artistId),
        await linkedAlbumArtists(tx, id),
      );
      await tx
        .update(schema.albums)
        .set({
          title: data.title,
          firstReleaseYear: data.firstReleaseYear,
          mbReleaseGroupId: data.mbReleaseGroupId,
        })
        .where(eq(schema.albums.id, id));

      const edition = await tx
        .update(schema.albumEditions)
        .set(data.edition)
        .where(
          and(
            eq(schema.albumEditions.albumId, id),
            eq(schema.albumEditions.isReference, true),
          ),
        )
        .returning({ id: schema.albumEditions.id });
      if (edition.length === 0) {
        await tx
          .insert(schema.albumEditions)
          .values({ albumId: id, isReference: true, ...data.edition });
      }
      await replaceAlbumCredits(tx, id, data.credits);
    }),
  );
}

export async function archiveAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
): Promise<void> {
  const id = idOf(albumId);
  await guarded(async () => {
    const result = await db.execute(sql`
      update albums
         set archived_at = coalesce(archived_at, now()), updated_at = now()
       where id = ${id}
      returning id`);
    if (result.rows.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

export async function restoreAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
): Promise<void> {
  const id = idOf(albumId);
  await guarded(async () => {
    const updated = await db
      .update(schema.albums)
      .set({ archivedAt: null })
      .where(eq(schema.albums.id, id))
      .returning({ id: schema.albums.id });
    if (updated.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

/**
 * Deletes an album that no writing refers to, with its credits, edition, and
 * tracklist membership. Its tracks stay in the catalog. An album with a
 * journal (even one in Recently deleted) or a memory link is refused with
 * `in_use` by ON DELETE RESTRICT: archive it instead.
 */
export async function deleteAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
): Promise<void> {
  const id = idOf(albumId);
  await guarded(async () => {
    const deleted = await db
      .delete(schema.albums)
      .where(eq(schema.albums.id, id))
      .returning({ id: schema.albums.id });
    if (deleted.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

async function replaceTrackCredits(
  tx: Transaction,
  trackId: string,
  artistIds: string[],
): Promise<void> {
  await tx
    .delete(schema.trackArtists)
    .where(eq(schema.trackArtists.trackId, trackId));
  if (artistIds.length > 0) {
    await tx.insert(schema.trackArtists).values(
      artistIds.map((artistId, index) => ({
        trackId,
        artistId,
        position: index + 1,
      })),
    );
  }
}

/**
 * Creates a track (a recording). It exists independently of albums. With
 * `albumId`, it is also appended to that album's tracklist, in the same
 * transaction.
 */
export async function createTrack(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<{ id: string }> {
  const { albumId, artistIds, ...fields } = parse(newTrackInput, input);
  return guarded(() =>
    db.transaction(async (tx) => {
      await assertArtistsLinkable(tx, artistIds, new Set());
      const [track] = await tx
        .insert(schema.tracks)
        .values(fields)
        .returning({ id: schema.tracks.id });
      const trackId = track!.id;
      await replaceTrackCredits(tx, trackId, artistIds);
      if (albumId) {
        await lockAlbum(tx, albumId);
        const tracklist = await currentTracklist(tx, albumId);
        await rewriteTracklist(tx, albumId, [
          ...tracklist,
          { trackId, discNumber: tracklist.at(-1)?.discNumber ?? 1 },
        ]);
      }
      return { id: trackId };
    }),
  );
}

export async function updateTrack(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  trackId: unknown,
  input: unknown,
): Promise<void> {
  const id = idOf(trackId);
  const { artistIds, ...fields } = parse(trackInput, input);
  await guarded(() =>
    db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`select id from tracks where id = ${id} for update`,
      );
      if (locked.rows.length === 0) {
        throw new CatalogError("not_found");
      }
      const linked = await tx
        .select({ artistId: schema.trackArtists.artistId })
        .from(schema.trackArtists)
        .where(eq(schema.trackArtists.trackId, id));
      await assertArtistsLinkable(
        tx,
        artistIds,
        new Set(linked.map((row) => row.artistId)),
      );
      await tx.update(schema.tracks).set(fields).where(eq(schema.tracks.id, id));
      await replaceTrackCredits(tx, id, artistIds);
    }),
  );
}

export async function archiveTrack(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  trackId: unknown,
): Promise<void> {
  const id = idOf(trackId);
  await guarded(async () => {
    const result = await db.execute(sql`
      update tracks
         set archived_at = coalesce(archived_at, now()), updated_at = now()
       where id = ${id}
      returning id`);
    if (result.rows.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

export async function restoreTrack(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  trackId: unknown,
): Promise<void> {
  const id = idOf(trackId);
  await guarded(async () => {
    const updated = await db
      .update(schema.tracks)
      .set({ archivedAt: null })
      .where(eq(schema.tracks.id, id))
      .returning({ id: schema.tracks.id });
    if (updated.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

/**
 * Deletes a track that is on no album and in no memory. A track on an album is
 * refused with `in_use` (ON DELETE RESTRICT on album membership): remove it
 * from the album first, which itself is refused while a reflection exists.
 */
export async function deleteTrack(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  trackId: unknown,
): Promise<void> {
  const id = idOf(trackId);
  await guarded(async () => {
    const deleted = await db
      .delete(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .returning({ id: schema.tracks.id });
    if (deleted.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

// ---------------------------------------------------------------------------
// The ordered tracklist of an album's reference edition
// ---------------------------------------------------------------------------

interface TracklistItem {
  trackId: string;
  discNumber: number;
}

async function referenceEditionId(
  tx: Transaction,
  albumId: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: schema.albumEditions.id })
    .from(schema.albumEditions)
    .where(
      and(
        eq(schema.albumEditions.albumId, albumId),
        eq(schema.albumEditions.isReference, true),
      ),
    );
  if (existing) {
    return existing.id;
  }
  const [created] = await tx
    .insert(schema.albumEditions)
    .values({ albumId, isReference: true })
    .returning({ id: schema.albumEditions.id });
  return created!.id;
}

// The album's recordings in reference-edition order. A member that has no
// position in the edition (possible only for data not written by these
// commands) follows the ordered ones, by title.
async function currentTracklist(
  tx: Transaction,
  albumId: string,
): Promise<TracklistItem[]> {
  const result = await tx.execute<{ track_id: string; disc_number: number }>(sql`
    select m.track_id, coalesce(et.disc_number, 1) as disc_number
      from album_tracks m
      join tracks t on t.id = m.track_id
      left join album_editions ed on ed.album_id = m.album_id and ed.is_reference
      left join edition_tracks et on et.edition_id = ed.id
                                 and et.track_id = m.track_id
     where m.album_id = ${albumId}
     order by (et.position is null), coalesce(et.disc_number, 1),
              et.position, t.title, t.id`);
  return result.rows.map((row) => ({
    trackId: row.track_id,
    discNumber: row.disc_number,
  }));
}

// Replaces the album's membership and the reference edition's order with
// `desired`, inside the caller's transaction, with the album row locked. The
// edition's rows are replaced rather than renumbered because
// (edition_id, disc_number, position) is unique and not deferrable. Nothing
// authored refers to edition_tracks, so this cannot touch writing; removing a
// recording that a reflection refers to is refused.
async function rewriteTracklist(
  tx: Transaction,
  albumId: string,
  desired: TracklistItem[],
): Promise<void> {
  const editionId = await referenceEditionId(tx, albumId);
  const current = await currentTracklist(tx, albumId);
  const currentIds = new Set(current.map((item) => item.trackId));
  const desiredIds = new Set(desired.map((item) => item.trackId));
  const added = desired
    .map((item) => item.trackId)
    .filter((trackId) => !currentIds.has(trackId));
  const removed = current
    .map((item) => item.trackId)
    .filter((trackId) => !desiredIds.has(trackId));

  if (added.length > 0) {
    const found = await tx
      .select({ id: schema.tracks.id, archivedAt: schema.tracks.archivedAt })
      .from(schema.tracks)
      .where(inArray(schema.tracks.id, added));
    if (found.length !== added.length) {
      throw new CatalogError("not_found");
    }
    if (found.some((track) => track.archivedAt !== null)) {
      throw new CatalogError("archived_reference");
    }
  }

  if (removed.length > 0) {
    const reflected = await tx
      .select({ trackId: schema.trackReflections.trackId })
      .from(schema.trackReflections)
      .where(
        and(
          eq(schema.trackReflections.albumId, albumId),
          inArray(schema.trackReflections.trackId, removed),
        ),
      )
      .limit(1);
    if (reflected.length > 0) {
      throw new CatalogError("in_use", { blockedBy: "reflections" });
    }
  }

  await tx
    .delete(schema.editionTracks)
    .where(eq(schema.editionTracks.editionId, editionId));
  if (removed.length > 0) {
    await tx
      .delete(schema.albumTracks)
      .where(
        and(
          eq(schema.albumTracks.albumId, albumId),
          inArray(schema.albumTracks.trackId, removed),
        ),
      );
  }
  if (added.length > 0) {
    await tx
      .insert(schema.albumTracks)
      .values(added.map((trackId) => ({ albumId, trackId })));
  }

  const nextPosition = new Map<number, number>();
  const rows = desired.map((item) => {
    const position = (nextPosition.get(item.discNumber) ?? 0) + 1;
    nextPosition.set(item.discNumber, position);
    return {
      editionId,
      albumId,
      trackId: item.trackId,
      discNumber: item.discNumber,
      position,
    };
  });
  if (rows.length > 0) {
    await tx.insert(schema.editionTracks).values(rows);
  }
}

/**
 * Sets an album's tracklist: which recordings belong to it, and their order
 * in the reference edition, in one transaction. A recording may be on several
 * albums and is never duplicated. New recordings must exist and not be
 * archived. A recording that a track reflection refers to cannot be removed
 * (`in_use`, blocked by `reflections`).
 */
export async function setAlbumTracklist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
  input: unknown,
): Promise<void> {
  const id = idOf(albumId);
  const data = parse(tracklistInput, input);
  await guarded(() =>
    db.transaction(async (tx) => {
      await lockAlbum(tx, id);
      await rewriteTracklist(tx, id, data.tracks);
    }),
  );
}

/** Appends an existing track to the end of an album's tracklist. */
export async function addTrackToAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
  trackId: unknown,
): Promise<void> {
  const id = idOf(albumId);
  const track = idOf(trackId);
  await guarded(() =>
    db.transaction(async (tx) => {
      await lockAlbum(tx, id);
      const tracklist = await currentTracklist(tx, id);
      if (tracklist.some((item) => item.trackId === track)) {
        return;
      }
      await rewriteTracklist(tx, id, [
        ...tracklist,
        { trackId: track, discNumber: tracklist.at(-1)?.discNumber ?? 1 },
      ]);
    }),
  );
}

/** Removes a track from an album's tracklist. The track stays in the catalog. */
export async function removeTrackFromAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
  trackId: unknown,
): Promise<void> {
  const id = idOf(albumId);
  const track = idOf(trackId);
  await guarded(() =>
    db.transaction(async (tx) => {
      await lockAlbum(tx, id);
      const tracklist = await currentTracklist(tx, id);
      if (!tracklist.some((item) => item.trackId === track)) {
        throw new CatalogError("not_found");
      }
      await rewriteTracklist(
        tx,
        id,
        tracklist.filter((item) => item.trackId !== track),
      );
    }),
  );
}

/** Moves a track one place up or down in an album's tracklist. */
export async function moveTrackInAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
  trackId: unknown,
  direction: unknown,
): Promise<void> {
  const id = idOf(albumId);
  const track = idOf(trackId);
  const way = parse(moveDirection, direction);
  await guarded(() =>
    db.transaction(async (tx) => {
      await lockAlbum(tx, id);
      const tracklist = await currentTracklist(tx, id);
      const index = tracklist.findIndex((item) => item.trackId === track);
      if (index === -1) {
        throw new CatalogError("not_found");
      }
      const target = way === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= tracklist.length) {
        return;
      }
      const moved = [...tracklist];
      [moved[index], moved[target]] = [moved[target]!, moved[index]!];
      await rewriteTracklist(tx, id, moved);
    }),
  );
}
