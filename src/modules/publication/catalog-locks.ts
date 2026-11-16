import "server-only";

import { sql, type SQL } from "drizzle-orm";

import type { Transaction } from "@/db";

// The lock order of ADR 0013 § 4.1, in one place. Every catalog command that
// a served page can depend on, and every publication and confirmed save,
// takes its row locks through `lockInOrder`, which always takes them in this
// order, each in ascending id:
//
//   1. entries `FOR SHARE` (the album journals and memories involved);
//   2. albums;
//   3. artists;
//   4. tracks;
//
// with, for each row, the strongest mode the caller needs. A command builds
// its plan from reads taken before the locks (that is how it knows what to
// lock), and decides only from statements run after `lockInOrder` returns.
// Entry commands hold their own entry `FOR UPDATE` first, and add no entry to
// the plan. Internal to the Publication module.

export type RowLockMode = "share" | "no key update" | "update";

const STRENGTH: Record<RowLockMode, number> = {
  share: 0,
  "no key update": 1,
  update: 2,
};

const MODE: Record<RowLockMode, SQL> = {
  share: sql`for share`,
  "no key update": sql`for no key update`,
  update: sql`for update`,
};

/** Which entries a catalog change involves (ADR 0013 § 4.1, the table). */
export interface EntryScope {
  /** Album journals about these albums. */
  journalsOfAlbums?: readonly string[];
  /** Memories linking one of these albums directly. */
  memoriesLinkingAlbums?: readonly string[];
  /** Memories linking one of these tracks. */
  memoriesLinkingTracks?: readonly string[];
  /** Memories linking a track that is on one of these albums. */
  memoriesLinkingTracksOn?: readonly string[];
}

/** The rows to lock, and how. Built, then taken once with `lockInOrder`. */
export class LockPlan {
  readonly entries: Required<{ [Key in keyof EntryScope]: Set<string> }> = {
    journalsOfAlbums: new Set(),
    memoriesLinkingAlbums: new Set(),
    memoriesLinkingTracks: new Set(),
    memoriesLinkingTracksOn: new Set(),
  };
  readonly albums = new Map<string, RowLockMode>();
  readonly artists = new Map<string, RowLockMode>();
  readonly tracks = new Map<string, RowLockMode>();

  involve(scope: EntryScope): this {
    for (const key of Object.keys(this.entries) as (keyof EntryScope)[]) {
      for (const id of scope[key] ?? []) {
        this.entries[key].add(id);
      }
    }
    return this;
  }

  album(ids: Iterable<string>, mode: RowLockMode): this {
    return this.add(this.albums, ids, mode);
  }

  artist(ids: Iterable<string>, mode: RowLockMode): this {
    return this.add(this.artists, ids, mode);
  }

  track(ids: Iterable<string>, mode: RowLockMode): this {
    return this.add(this.tracks, ids, mode);
  }

  // A row named twice keeps the strongest mode, so a transaction never asks
  // to upgrade a lock it holds (an upgrade can deadlock).
  private add(
    rows: Map<string, RowLockMode>,
    ids: Iterable<string>,
    mode: RowLockMode,
  ): this {
    for (const id of ids) {
      const held = rows.get(id);
      if (held === undefined || STRENGTH[mode] > STRENGTH[held]) {
        rows.set(id, mode);
      }
    }
    return this;
  }
}

function ids(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** `col in (…)`, or `false` for an empty list. */
function inList(column: SQL, values: Iterable<string>): SQL {
  const list = ids(values);
  if (list.length === 0) {
    return sql`false`;
  }
  return sql`${column} in (${sql.join(
    list.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

/**
 * Takes every lock of `plan`, in ADR 0013 § 4.1's order: the entries in one
 * statement `FOR SHARE` in ascending id (a sort below the row locking, so the
 * rows are locked in that order), then each album, artist, and track row in
 * ascending id, with its mode. A row that does not exist is skipped: the
 * caller's own statements, after this, decide what that means.
 */
export async function lockInOrder(
  tx: Transaction,
  plan: LockPlan,
): Promise<void> {
  const scope = plan.entries;
  const anyEntry =
    scope.journalsOfAlbums.size +
      scope.memoriesLinkingAlbums.size +
      scope.memoriesLinkingTracks.size +
      scope.memoriesLinkingTracksOn.size >
    0;
  if (anyEntry) {
    await tx.execute(sql`
      select e.id
        from entries e
       where e.id in (
               select aj.entry_id from album_journals aj
                where ${inList(sql`aj.album_id`, scope.journalsOfAlbums)}
               union
               select mm.memory_id from memory_music mm
                where ${inList(sql`mm.album_id`, scope.memoriesLinkingAlbums)}
                   or ${inList(sql`mm.track_id`, scope.memoriesLinkingTracks)}
                   or mm.track_id in (
                        select atr.track_id from album_tracks atr
                         where ${inList(
                           sql`atr.album_id`,
                           scope.memoriesLinkingTracksOn,
                         )}))
       order by e.id
         for share of e`);
  }
  for (const id of ids(plan.albums.keys())) {
    await tx.execute(
      sql`select id from albums where id = ${id} ${MODE[plan.albums.get(id)!]}`,
    );
  }
  for (const id of ids(plan.artists.keys())) {
    await tx.execute(
      sql`select id from artists where id = ${id} ${MODE[plan.artists.get(id)!]}`,
    );
  }
  for (const id of ids(plan.tracks.keys())) {
    await tx.execute(
      sql`select id from tracks where id = ${id} ${MODE[plan.tracks.get(id)!]}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The plans of § 4.1's table. Each reads what it must lock (before the
// locks), and returns the plan; the caller adds to it if needed and takes it.

async function column(tx: Transaction, query: SQL): Promise<string[]> {
  const result = await tx.execute<{ id: string }>(query);
  return result.rows.map((row) => row.id);
}

/**
 * `updateAlbum`, the tracklist commands, `createTrack` with an album,
 * `setAlbumArtwork`, `removeAlbumArtwork`, `deleteAlbum`, and
 * `linkAlbumToMusic` (`journalsOnly`): the album's journals, the memories
 * linking the album or any of its tracks or an added track, the album in
 * `albumMode`, the named artists `FOR SHARE`, the album's tracks `FOR SHARE`,
 * and the added tracks `FOR NO KEY UPDATE`. With `creditJournalsOf`, also the
 * journals of every album crediting those artists (A5's set).
 */
export async function albumChangePlan(
  tx: Transaction,
  albumId: string,
  options: {
    albumMode: RowLockMode;
    artistIds?: readonly string[];
    addedTrackIds?: readonly string[];
    creditJournalsOf?: readonly string[];
    journalsOnly?: boolean;
  },
): Promise<LockPlan> {
  const plan = new LockPlan().album([albumId], options.albumMode);
  if (options.journalsOnly) {
    return plan.involve({ journalsOfAlbums: [albumId] });
  }
  const creditingAlbums =
    options.creditJournalsOf && options.creditJournalsOf.length > 0
      ? await column(
          tx,
          sql`select distinct aa.album_id as id from album_artists aa
               where ${inList(sql`aa.artist_id`, options.creditJournalsOf)}`,
        )
      : [];
  const tracks = await column(
    tx,
    sql`select atr.track_id as id from album_tracks atr
         where atr.album_id = ${albumId}`,
  );
  return plan
    .involve({
      journalsOfAlbums: [albumId, ...creditingAlbums],
      memoriesLinkingAlbums: [albumId],
      memoriesLinkingTracksOn: [albumId],
      memoriesLinkingTracks: options.addedTrackIds ?? [],
    })
    .artist(options.artistIds ?? [], "share")
    .track(tracks, "share")
    .track(options.addedTrackIds ?? [], "no key update");
}

/**
 * `updateTrack`: the journals of every album containing the track, the
 * memories linking the track or those albums, those albums `FOR SHARE`, the
 * track's stored and new artists `FOR SHARE`, and the track `FOR UPDATE`.
 * The album set is read before the locks; the command decides only from
 * statements after them.
 */
export async function trackChangePlan(
  tx: Transaction,
  trackId: string,
  newArtistIds: readonly string[],
): Promise<LockPlan> {
  const albums = await column(
    tx,
    sql`select atr.album_id as id from album_tracks atr
         where atr.track_id = ${trackId}`,
  );
  const stored = await column(
    tx,
    sql`select ta.artist_id as id from track_artists ta
         where ta.track_id = ${trackId}`,
  );
  return new LockPlan()
    .involve({
      journalsOfAlbums: albums,
      memoriesLinkingTracks: [trackId],
      memoriesLinkingAlbums: albums,
    })
    .album(albums, "share")
    .artist([...stored, ...newArtistIds], "share")
    .track([trackId], "update");
}

/**
 * `updateArtist`, `restoreArtist`, `setArtistPhoto`, and `archiveArtist`: the
 * journals of the albums crediting the artist or containing a track crediting
 * it, the memories linking those albums or tracks, those albums `FOR SHARE`,
 * the artist `FOR NO KEY UPDATE`, and the tracks crediting it `FOR SHARE`.
 */
export async function artistChangePlan(
  tx: Transaction,
  artistId: string,
): Promise<LockPlan> {
  const tracks = await column(
    tx,
    sql`select ta.track_id as id from track_artists ta
         where ta.artist_id = ${artistId}`,
  );
  const albums = await column(
    tx,
    sql`select aa.album_id as id from album_artists aa
         where aa.artist_id = ${artistId}
        union
        select atr.album_id as id from album_tracks atr
         where ${inList(sql`atr.track_id`, tracks)}`,
  );
  return new LockPlan()
    .involve({
      journalsOfAlbums: albums,
      memoriesLinkingAlbums: albums,
      memoriesLinkingTracks: tracks,
    })
    .album(albums, "share")
    .artist([artistId], "no key update")
    .track(tracks, "share");
}

/**
 * `importMusicRelease`, before it inserts anything: the memories linking the
 * reused recordings, the albums already containing them `FOR SHARE`, the
 * reused artists `FOR SHARE`, and the reused recordings `FOR NO KEY UPDATE`.
 */
export async function releaseImportPlan(
  tx: Transaction,
  reusedTrackIds: readonly string[],
  reusedArtistIds: readonly string[],
): Promise<LockPlan> {
  const albums = await column(
    tx,
    sql`select distinct atr.album_id as id from album_tracks atr
         where ${inList(sql`atr.track_id`, reusedTrackIds)}`,
  );
  return new LockPlan()
    .involve({ memoriesLinkingTracks: reusedTrackIds })
    .album(albums, "share")
    .artist(reusedArtistIds, "share")
    .track(reusedTrackIds, "no key update");
}

// ---------------------------------------------------------------------------
// The entry commands (ADR 0013 § 4.4). Each runs under its own entry's
// `FOR UPDATE`, and locks only catalog rows.

/**
 * An album journal's rows a page renders: its album, its credited artists,
 * and the tracks its page renders (the reference edition's, and those its
 * flagged reflections name). A publication, an unpublication, or a deletion
 * (`transition`) takes the album and the artists `FOR NO KEY UPDATE`; a
 * confirmed save (`save`) takes everything `FOR SHARE`. Returns nothing for an
 * entry that is not an album journal.
 */
export async function lockAlbumJournalCatalog(
  tx: Transaction,
  entryId: string,
  kind: "transition" | "save",
): Promise<void> {
  const album = await column(
    tx,
    sql`select aj.album_id as id from album_journals aj
         where aj.entry_id = ${entryId}`,
  );
  if (album.length === 0) {
    return;
  }
  const albumId = album[0]!;
  const artists = await column(
    tx,
    sql`select aa.artist_id as id from album_artists aa
         where aa.album_id = ${albumId}`,
  );
  const tracks = await column(
    tx,
    sql`select et.track_id as id
          from album_editions ed
          join edition_tracks et on et.edition_id = ed.id
         where ed.album_id = ${albumId} and ed.is_reference
        union
        select tr.track_id as id from track_reflections tr
         where tr.album_journal_id = ${entryId} and tr.is_published`,
  );
  const mode: RowLockMode = kind === "transition" ? "no key update" : "share";
  await lockInOrder(
    tx,
    new LockPlan()
      .album([albumId], mode)
      .artist(artists, mode)
      .track(tracks, "share"),
  );
}

/** A memory's music link, by what it links. */
export type CatalogLink = { trackId: string } | { albumId: string };

/** What a memory lock read before taking its locks, to compare after. */
interface MemoryCatalogReads {
  trackArtists: string;
  containingAlbums: string;
}

async function memoryCatalogReads(
  tx: Transaction,
  trackIds: readonly string[],
): Promise<MemoryCatalogReads & { artists: string[]; albums: string[] }> {
  const trackArtists = await tx.execute<{
    track_id: string;
    artist_id: string;
  }>(
    sql`select ta.track_id, ta.artist_id from track_artists ta
         where ${inList(sql`ta.track_id`, trackIds)}
         order by ta.track_id, ta.artist_id`,
  );
  const containing = await tx.execute<{ track_id: string; album_id: string }>(
    sql`select atr.track_id, atr.album_id from album_tracks atr
         where ${inList(sql`atr.track_id`, trackIds)}
         order by atr.track_id, atr.album_id`,
  );
  return {
    trackArtists: JSON.stringify(trackArtists.rows),
    containingAlbums: JSON.stringify(containing.rows),
    artists: trackArtists.rows.map((row) => row.artist_id),
    albums: containing.rows.map((row) => row.album_id),
  };
}

/**
 * A memory's publication or confirmed save (ADR 0013 § 4.4): `FOR SHARE`, in
 * order, each linked album and every album containing a linked track, the
 * artists credited on the links and on those albums, and the linked tracks.
 * A confirmed save passes the links of its current and resulting states.
 * After the track locks it reads the linked tracks' credits and containing
 * albums again; it returns false when either differs from what it locked (a
 * change made and undone between the reads could otherwise leave a rendered
 * row unlocked), and the caller then answers `confirmation_stale`.
 */
export async function lockMemoryCatalog(
  tx: Transaction,
  links: readonly CatalogLink[],
): Promise<boolean> {
  const trackIds = ids(
    links.flatMap((link) => ("trackId" in link ? [link.trackId] : [])),
  );
  const linkedAlbums = ids(
    links.flatMap((link) => ("albumId" in link ? [link.albumId] : [])),
  );
  if (trackIds.length === 0 && linkedAlbums.length === 0) {
    return true;
  }
  const before = await memoryCatalogReads(tx, trackIds);
  const albums = ids([...linkedAlbums, ...before.albums]);
  const albumArtists = await column(
    tx,
    sql`select distinct aa.artist_id as id from album_artists aa
         where ${inList(sql`aa.album_id`, albums)}`,
  );
  await lockInOrder(
    tx,
    new LockPlan()
      .album(albums, "share")
      .artist([...before.artists, ...albumArtists], "share")
      .track(trackIds, "share"),
  );
  const after = await memoryCatalogReads(tx, trackIds);
  return (
    after.trackArtists === before.trackArtists &&
    after.containingAlbums === before.containingAlbums
  );
}

/**
 * An album journal's deletion (ADR 0013 § 4.4), called by the Journals module
 * after its entry lock: the album and its credited artists
 * `FOR NO KEY UPDATE`, and the rendered tracks `FOR SHARE`, as a publication
 * and an unpublication take them.
 */
export async function lockAlbumJournalTransition(
  tx: Transaction,
  entryId: string,
): Promise<void> {
  await lockAlbumJournalCatalog(tx, entryId, "transition");
}

/**
 * A publication's catalog locks (ADR 0013 § 4.4), under its entry lock, by
 * the entry's kind. For a memory, false when the re-read after the track
 * locks found a change, which the publication answers with
 * `confirmation_stale`.
 */
export async function lockPublicationCatalog(
  tx: Transaction,
  entryId: string,
  kind: string,
): Promise<boolean> {
  if (kind === "album_journal") {
    await lockAlbumJournalCatalog(tx, entryId, "transition");
    return true;
  }
  if (kind === "memory") {
    const links = await tx.execute<{
      track_id: string | null;
      album_id: string | null;
    }>(sql`
      select track_id, album_id from memory_music
       where memory_id = ${entryId}`);
    return lockMemoryCatalog(
      tx,
      links.rows.map((link) =>
        link.track_id !== null
          ? { trackId: link.track_id }
          : { albumId: link.album_id! },
      ),
    );
  }
  return true;
}
