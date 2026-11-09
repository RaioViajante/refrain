import "server-only";

import { sql } from "drizzle-orm";

import type { ArtistKind, DatabaseExecutor } from "@/db";
import {
  coverArtworkOf,
  type CoverArtwork,
} from "@/integrations/cover-art-archive";
import type { AuthorizedAuthor } from "@/modules/identity";

import { storedPhotoView, type StoredPhotoView } from "./photos";

import { catalogId } from "./input";

// Writing Studio queries of the catalog. They list private catalog data, such
// as albums whose only writing is a draft, so every one takes the
// `AuthorizedAuthor` that only the Identity module creates, and none may back
// a public page. A public listing selects through the publication predicate
// in the Publication module (M3).

function isId(value: unknown): value is string {
  return catalogId.safeParse(value).success;
}

export interface AlbumCredit {
  albumId: string;
  title: string;
  firstReleaseYear: number | null;
  artistName: string;
  creditPosition: number;
}

/**
 * Albums with their credited artists, one row per credit, for the Writing
 * Studio's Catalog. Academic requirement AC-04 (JOIN); the SQL is quoted in
 * docs/data-model.md. Archived albums are excluded.
 */
export async function listAlbumsWithArtists(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<AlbumCredit[]> {
  const result = await db.execute<{
    id: string;
    title: string;
    first_release_year: number | null;
    artist_name: string;
    position: number;
  }>(sql`
    select al.id, al.title, al.first_release_year,
           coalesce(aa.credited_as, ar.name) as artist_name, aa.position
      from albums al
      join album_artists aa on aa.album_id = al.id
      join artists ar       on ar.id = aa.artist_id
     where al.archived_at is null
     order by al.title, al.id, aa.position`);

  return result.rows.map((row) => ({
    albumId: row.id,
    title: row.title,
    firstReleaseYear: row.first_release_year,
    artistName: row.artist_name,
    creditPosition: row.position,
  }));
}

export interface AlbumUsage {
  albumId: string;
  title: string;
  usedIn: number;
}

/**
 * How many entries use each album ("used in 2 entries"), for the Writing
 * Studio's Catalog: album journals about it and memories that link it. It
 * counts private and draft writing. Deleted entries are not counted. Academic
 * requirement AC-05 (subquery); the SQL is quoted in docs/data-model.md.
 * It reads the authored tables with SQL rather than through the Journals
 * module (docs/architecture.md, dependency rule 3).
 */
export async function listAlbumUsage(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<AlbumUsage[]> {
  const result = await db.execute<{
    id: string;
    title: string;
    used_in: number;
  }>(sql`
    select al.id, al.title,
           (select count(*)::int
              from entries e
             where e.deleted_at is null
               and (   e.id in (select aj.entry_id  from album_journals aj where aj.album_id = al.id)
                    or e.id in (select mm.memory_id from memory_music mm  where mm.album_id = al.id))
           ) as used_in
      from albums al
     where al.archived_at is null
     order by al.title, al.id`);

  return result.rows.map((row) => ({
    albumId: row.id,
    title: row.title,
    usedIn: row.used_in,
  }));
}

export interface AlbumTrackCount {
  albumId: string;
  title: string;
  firstReleaseYear: number | null;
  archived: boolean;
  trackCount: number;
}

export interface AlbumCover {
  src: string;
  srcSet: string;
}

/**
 * The chosen cover of every album that has a valid one, keyed by album, for
 * the studio's lists. Private: it takes the author, and no public page reads
 * it (public pages use the Publication module). A stored value that does not
 * parse is left out, so the row keeps its record mark, and the image
 * addresses are always rebuilt from its parts, never copied from the row.
 */
export async function listAlbumCovers(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<Map<string, AlbumCover>> {
  const result = await db.execute<{
    id: string;
    cover_url: string | null;
    cover_source: string | null;
  }>(sql`select id, cover_url, cover_source from albums
          where cover_url is not null`);
  const covers = new Map<string, AlbumCover>();
  for (const row of result.rows) {
    const artwork = coverArtworkOf(row.cover_url, row.cover_source);
    if (artwork) {
      covers.set(row.id, { src: artwork.src, srcSet: artwork.srcSet });
    }
  }
  return covers;
}

/** One album's chosen cover, under the same rules as `listAlbumCovers`. */
export async function getAlbumCover(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: string,
): Promise<AlbumCover | null> {
  const result = await db.execute<{
    cover_url: string | null;
    cover_source: string | null;
  }>(sql`select cover_url, cover_source from albums where id = ${albumId}`);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const artwork = coverArtworkOf(row.cover_url, row.cover_source);
  return artwork ? { src: artwork.src, srcSet: artwork.srcSet } : null;
}

/**
 * Every album, archived ones included, with the number of recordings on it.
 * Academic requirement AC-05 (aggregate: `COUNT` with `GROUP BY` over a
 * `LEFT JOIN`, so an album with no tracks reads 0). The join has a single
 * one-to-many side, so the count cannot be multiplied; credits are joined in
 * a separate query on purpose.
 */
export async function listAlbumTrackCounts(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<AlbumTrackCount[]> {
  const result = await db.execute<{
    id: string;
    title: string;
    first_release_year: number | null;
    archived: boolean;
    track_count: number;
  }>(sql`
    select al.id, al.title, al.first_release_year,
           al.archived_at is not null as archived,
           count(m.track_id)::int as track_count
      from albums al
      left join album_tracks m on m.album_id = al.id
     group by al.id
     order by al.title, al.id`);
  return result.rows.map((row) => ({
    albumId: row.id,
    title: row.title,
    firstReleaseYear: row.first_release_year,
    archived: row.archived,
    trackCount: row.track_count,
  }));
}

export interface CatalogStatistics {
  artists: number;
  albums: number;
  tracks: number;
  archivedRecords: number;
  albumsWithoutTracks: number;
  tracksWithoutAlbum: number;
}

/** Catalog counts for the Desk. Every figure is a SQL aggregate. */
export async function getCatalogStatistics(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<CatalogStatistics> {
  const result = await db.execute<{
    artists: number;
    albums: number;
    tracks: number;
    archived_records: number;
    albums_without_tracks: number;
    tracks_without_album: number;
  }>(sql`
    select (select count(*)::int from artists where archived_at is null) as artists,
           (select count(*)::int from albums  where archived_at is null) as albums,
           (select count(*)::int from tracks  where archived_at is null) as tracks,
           (select count(*)::int from artists where archived_at is not null)
         + (select count(*)::int from albums  where archived_at is not null)
         + (select count(*)::int from tracks  where archived_at is not null)
             as archived_records,
           (select count(*)::int from albums al
             where al.archived_at is null
               and not exists (select 1 from album_tracks m where m.album_id = al.id))
             as albums_without_tracks,
           (select count(*)::int from tracks t
             where t.archived_at is null
               and not exists (select 1 from album_tracks m where m.track_id = t.id))
             as tracks_without_album`);
  const row = result.rows[0]!;
  return {
    artists: row.artists,
    albums: row.albums,
    tracks: row.tracks,
    archivedRecords: row.archived_records,
    albumsWithoutTracks: row.albums_without_tracks,
    tracksWithoutAlbum: row.tracks_without_album,
  };
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

export interface ArtistSummary {
  id: string;
  name: string;
  sortName: string | null;
  kind: ArtistKind;
  mbArtistId: string | null;
  archived: boolean;
  /** Albums that credit the artist. */
  albumCount: number;
  /** Tracks that credit the artist. */
  trackCount: number;
  /** Artist journals that are not in Recently deleted. */
  journalCount: number;
}

type ArtistRow = {
  id: string;
  name: string;
  sort_name: string | null;
  kind: ArtistKind;
  mb_artist_id: string | null;
  archived: boolean;
  album_count: number;
  track_count: number;
  journal_count: number;
};

// Counts are correlated subqueries, one per relation, so they cannot multiply
// each other the way several joins would.
const artistSummarySql = sql`
  select a.id, a.name, a.sort_name, a.kind, a.mb_artist_id,
         a.archived_at is not null as archived,
         (select count(*)::int from album_artists aa where aa.artist_id = a.id)
           as album_count,
         (select count(*)::int from track_artists ta where ta.artist_id = a.id)
           as track_count,
         (select count(*)::int
            from artist_journals j
            join entries e on e.id = j.entry_id
           where j.artist_id = a.id and e.deleted_at is null) as journal_count
    from artists a`;

function toArtistSummary(row: ArtistRow): ArtistSummary {
  return {
    id: row.id,
    name: row.name,
    sortName: row.sort_name,
    kind: row.kind,
    mbArtistId: row.mb_artist_id,
    archived: row.archived,
    albumCount: row.album_count,
    trackCount: row.track_count,
    journalCount: row.journal_count,
  };
}

export async function listArtists(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<ArtistSummary[]> {
  const result = await db.execute<ArtistRow>(sql`
    ${artistSummarySql}
    order by coalesce(a.sort_name, a.name), a.name, a.id`);
  return result.rows.map(toArtistSummary);
}

export interface ArtistDetail extends ArtistSummary {
  albums: { id: string; title: string; firstReleaseYear: number | null }[];
  /**
   * The photograph (M3.3), only in the one stored form, with its
   * attribution; `unreadable` when the columns hold anything else.
   */
  photo: StoredPhotoView;
}

export async function getArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  artistId: string,
): Promise<ArtistDetail | null> {
  if (!isId(artistId)) {
    return null;
  }
  const result = await db.execute<ArtistRow>(sql`
    ${artistSummarySql}
    where a.id = ${artistId}`);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const albums = await db.execute<{
    id: string;
    title: string;
    first_release_year: number | null;
  }>(sql`
    select al.id, al.title, al.first_release_year
      from album_artists aa
      join albums al on al.id = aa.album_id
     where aa.artist_id = ${artistId}
     order by al.first_release_year nulls last, al.title, al.id`);
  const photo = await db.execute<{
    photo_url: string | null;
    photo_credit: string | null;
    photo_license: string | null;
    photo_source_url: string | null;
    photo_file_sha1: string | null;
    photo_file_timestamp: string | null;
    photo_chosen_at: string | null;
  }>(sql`
    select photo_url, photo_credit, photo_license, photo_source_url,
           photo_file_sha1,
           to_char(photo_file_timestamp at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as photo_file_timestamp,
           to_char(photo_chosen_at at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as photo_chosen_at
      from artists
     where id = ${artistId}`);
  const stored = photo.rows[0]!;
  return {
    ...toArtistSummary(row),
    albums: albums.rows.map((album) => ({
      id: album.id,
      title: album.title,
      firstReleaseYear: album.first_release_year,
    })),
    photo: storedPhotoView({
      photoUrl: stored.photo_url,
      photoCredit: stored.photo_credit,
      photoLicense: stored.photo_license,
      photoSourceUrl: stored.photo_source_url,
      photoFileSha1: stored.photo_file_sha1,
      photoFileTimestamp: stored.photo_file_timestamp,
      photoChosenAt: stored.photo_chosen_at,
    }),
  };
}

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

export interface AlbumDetail {
  id: string;
  title: string;
  firstReleaseYear: number | null;
  mbReleaseGroupId: string | null;
  archived: boolean;
  /** The chosen cover, only in the one stored form (M3.2), else null. */
  artwork: CoverArtwork | null;
  credits: {
    artistId: string;
    artistName: string;
    creditedAs: string | null;
    archived: boolean;
  }[];
  /** The reference edition (ADR 0002, D2). */
  edition: {
    label: string | null;
    releaseDate: string | null;
    country: string | null;
    mbReleaseId: string | null;
  } | null;
  /** In reference-edition order. */
  tracklist: {
    trackId: string;
    title: string;
    lengthMs: number | null;
    discNumber: number;
    position: number;
    artistNames: string;
    archived: boolean;
    /** A track reflection refers to it, so it cannot be removed. */
    hasReflection: boolean;
  }[];
}

export async function getAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: string,
): Promise<AlbumDetail | null> {
  if (!isId(albumId)) {
    return null;
  }
  const albums = await db.execute<{
    id: string;
    title: string;
    first_release_year: number | null;
    mb_release_group_id: string | null;
    cover_url: string | null;
    cover_source: string | null;
    archived: boolean;
  }>(sql`
    select id, title, first_release_year, mb_release_group_id,
           cover_url, cover_source, archived_at is not null as archived
      from albums where id = ${albumId}`);
  const album = albums.rows[0];
  if (!album) {
    return null;
  }

  const credits = await db.execute<{
    artist_id: string;
    name: string;
    credited_as: string | null;
    archived: boolean;
  }>(sql`
    select aa.artist_id, ar.name, aa.credited_as,
           ar.archived_at is not null as archived
      from album_artists aa
      join artists ar on ar.id = aa.artist_id
     where aa.album_id = ${albumId}
     order by aa.position`);

  const editions = await db.execute<{
    label: string | null;
    release_date: string | null;
    country: string | null;
    mb_release_id: string | null;
  }>(sql`
    select label, release_date::text as release_date, country, mb_release_id
      from album_editions
     where album_id = ${albumId} and is_reference`);

  const tracklist = await db.execute<{
    track_id: string;
    title: string;
    length_ms: number | null;
    disc_number: number;
    position: number | null;
    artist_names: string;
    archived: boolean;
    has_reflection: boolean;
  }>(sql`
    select m.track_id, t.title, t.length_ms,
           coalesce(et.disc_number, 1) as disc_number, et.position,
           coalesce((select string_agg(ar.name, ', ' order by ta.position)
                       from track_artists ta
                       join artists ar on ar.id = ta.artist_id
                      where ta.track_id = t.id), '') as artist_names,
           t.archived_at is not null as archived,
           exists (select 1 from track_reflections tr
                    where tr.album_id = m.album_id
                      and tr.track_id = m.track_id) as has_reflection
      from album_tracks m
      join tracks t on t.id = m.track_id
      left join album_editions ed on ed.album_id = m.album_id and ed.is_reference
      left join edition_tracks et on et.edition_id = ed.id
                                 and et.track_id = m.track_id
     where m.album_id = ${albumId}
     order by (et.position is null), coalesce(et.disc_number, 1),
              et.position, t.title, t.id`);

  const edition = editions.rows[0];
  return {
    id: album.id,
    title: album.title,
    firstReleaseYear: album.first_release_year,
    mbReleaseGroupId: album.mb_release_group_id,
    archived: album.archived,
    artwork: coverArtworkOf(album.cover_url, album.cover_source),
    credits: credits.rows.map((credit) => ({
      artistId: credit.artist_id,
      artistName: credit.name,
      creditedAs: credit.credited_as,
      archived: credit.archived,
    })),
    edition: edition
      ? {
          label: edition.label,
          releaseDate: edition.release_date,
          country: edition.country,
          mbReleaseId: edition.mb_release_id,
        }
      : null,
    tracklist: tracklist.rows.map((track, index) => ({
      trackId: track.track_id,
      title: track.title,
      lengthMs: track.length_ms,
      discNumber: track.disc_number,
      position: track.position ?? index + 1,
      artistNames: track.artist_names,
      archived: track.archived,
      hasReflection: track.has_reflection,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export interface TrackSummary {
  id: string;
  title: string;
  lengthMs: number | null;
  credit: string | null;
  archived: boolean;
  artistNames: string;
  /** Albums the recording is on. */
  albumCount: number;
}

type TrackRow = {
  id: string;
  title: string;
  length_ms: number | null;
  credit: string | null;
  archived: boolean;
  artist_names: string;
  album_count: number;
};

export async function listTracks(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<TrackSummary[]> {
  const result = await db.execute<TrackRow>(sql`
    select t.id, t.title, t.length_ms, t.credit,
           t.archived_at is not null as archived,
           coalesce(string_agg(ar.name, ', ' order by ta.position), '')
             as artist_names,
           (select count(*)::int from album_tracks m where m.track_id = t.id)
             as album_count
      from tracks t
      left join track_artists ta on ta.track_id = t.id
      left join artists ar on ar.id = ta.artist_id
     group by t.id
     order by t.title, t.id`);
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    lengthMs: row.length_ms,
    credit: row.credit,
    archived: row.archived,
    artistNames: row.artist_names,
    albumCount: row.album_count,
  }));
}

/**
 * A recording the author can link from a memory (M3.6), with the catalog
 * facts that tell it apart from another recording of the same name: its
 * credited artists, the albums it is on, and its length. Nothing is inferred
 * or merged: two recordings are two choices, and an empty list or `null`
 * means the catalog does not record that fact.
 */
export interface RecordingChoice {
  trackId: string;
  title: string;
  /** Credited artists, in credit order. */
  artists: { id: string; name: string }[];
  /** Titles of the albums the recording is on. */
  albums: string[];
  lengthMs: number | null;
  archived: boolean;
}

/**
 * Every recording that is not archived, for the memory editor's picker, by
 * title. Pickers hide archived records (a link to one that already exists is
 * kept by the memory itself). Reads the catalog only.
 */
export async function listRecordingChoices(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<RecordingChoice[]> {
  const result = await db.execute<{
    track_id: string;
    title: string;
    artists: { id: string; name: string }[];
    albums: string[];
    length_ms: number | null;
    archived: boolean;
  }>(sql`
    select t.id as track_id, t.title, t.length_ms,
           t.archived_at is not null as archived,
           coalesce((select json_agg(json_build_object('id', ar.id, 'name', ar.name)
                                     order by ta.position)
                       from track_artists ta
                       join artists ar on ar.id = ta.artist_id
                      where ta.track_id = t.id), '[]'::json) as artists,
           coalesce((select json_agg(al.title order by al.title, al.id)
                       from album_tracks m
                       join albums al on al.id = m.album_id
                      where m.track_id = t.id), '[]'::json) as albums
      from tracks t
     where t.archived_at is null
     order by t.title, t.id`);
  return result.rows.map((row) => ({
    trackId: row.track_id,
    title: row.title,
    artists: row.artists,
    albums: row.albums,
    lengthMs: row.length_ms,
    archived: row.archived,
  }));
}

export interface TrackDetail {
  id: string;
  title: string;
  lengthMs: number | null;
  credit: string | null;
  mbRecordingId: string | null;
  archived: boolean;
  credits: { artistId: string; artistName: string; archived: boolean }[];
  albums: { id: string; title: string }[];
}

export async function getTrack(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  trackId: string,
): Promise<TrackDetail | null> {
  if (!isId(trackId)) {
    return null;
  }
  const tracks = await db.execute<{
    id: string;
    title: string;
    length_ms: number | null;
    credit: string | null;
    mb_recording_id: string | null;
    archived: boolean;
  }>(sql`
    select id, title, length_ms, credit, mb_recording_id,
           archived_at is not null as archived
      from tracks where id = ${trackId}`);
  const track = tracks.rows[0];
  if (!track) {
    return null;
  }
  const credits = await db.execute<{
    artist_id: string;
    name: string;
    archived: boolean;
  }>(sql`
    select ta.artist_id, ar.name, ar.archived_at is not null as archived
      from track_artists ta
      join artists ar on ar.id = ta.artist_id
     where ta.track_id = ${trackId}
     order by ta.position`);
  const albums = await db.execute<{ id: string; title: string }>(sql`
    select al.id, al.title
      from album_tracks m
      join albums al on al.id = m.album_id
     where m.track_id = ${trackId}
     order by al.title, al.id`);
  return {
    id: track.id,
    title: track.title,
    lengthMs: track.length_ms,
    credit: track.credit,
    mbRecordingId: track.mb_recording_id,
    archived: track.archived,
    credits: credits.rows.map((credit) => ({
      artistId: credit.artist_id,
      artistName: credit.name,
      archived: credit.archived,
    })),
    albums: albums.rows,
  };
}
