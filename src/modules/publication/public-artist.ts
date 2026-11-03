import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Locale } from "@/db";
import {
  artistPhotoOf,
  photoCreditCaption,
} from "@/integrations/wikimedia-commons";

import { publicArtworkOf, type PublicArtwork } from "./public-album-journal";
import { publicTrackReflectionTexts } from "./predicate";
import {
  presentedJournals,
  publicArtistAddresses,
  publicArtists,
  servedAlbumJournalAddresses,
} from "./queries";

// The read model of a public artist page (M3.5). An artist is shown only
// while it is publicly visible (`publicArtists`: credited on an album that has
// a served album journal, and not archived), and the page lists only writing
// that the predicate makes public. Artist-journal text is never read: artist
// journals have no public reading contract yet, so a page about an artist is
// built from the album journals about its albums alone.
//
// The photograph is the one the author chose in the studio (M3.3), parsed
// from the stored row in the one strict form Refrain writes
// (`artistPhotoOf`); anything else in those columns shows the fallback. No
// provider is called, and no address is taken from the database as it stands:
// every image and page address is rebuilt from the stored file name, and the
// license link comes from Refrain's own license table.
//
// Nothing returned carries a database identifier, a status, a deletion state,
// an unpublished language, or the text of any writing.

/** An artist photograph as a public page shows it, with its attribution. */
export interface PublicArtistPhoto {
  /** The 330 px thumbnail. */
  src: string;
  /** The 330 and 500 px thumbnails. */
  srcSet: string;
  /** The work's title on Wikimedia Commons ("Some photo.jpg"). */
  title: string;
  /** The file's description page on Wikimedia Commons: the source. */
  sourceUrl: string;
  /** The credit line the license asks for, as the file gives it. */
  credit: string;
  /** The credit as the caption shows it ("Photo: …"). */
  caption: string;
  license: {
    name: string;
    /** The license deed, or null for a public-domain mark. */
    url: string | null;
    shareAlike: boolean;
  };
  /** The changes Refrain makes to the photograph. */
  modifications: string;
}

/** One album about which a journal is presented on the artist's page. */
export interface PublicArtistAlbum {
  /** The presented journal's served address is `/albums/<slug>`. */
  slug: string;
  title: string;
  firstReleaseYear: number | null;
  artwork: PublicArtwork | null;
  /** The tracks of the album's reference edition. */
  trackCount: number;
  /** How many of them have a public reflection in the journal shown. */
  writtenTrackCount: number;
}

/** A track with a public reflection, in a journal presented on the page. */
export interface PublicArtistTrack {
  title: string;
  albumTitle: string;
  /** The journal's served address is `/albums/<slug>`. */
  slug: string;
  /** Its position in the album's reference edition, or null if not in it. */
  number: number | null;
}

export interface PublicArtist {
  /** The page's own address is `/artists/<address>`. */
  address: string;
  name: string;
  photo: PublicArtistPhoto | null;
  albums: PublicArtistAlbum[];
  tracks: PublicArtistTrack[];
}

interface HeadRow extends Record<string, unknown> {
  name: string;
  photo_url: string | null;
  photo_credit: string | null;
  photo_license: string | null;
  photo_source_url: string | null;
  photo_file_sha1: string | null;
  photo_file_timestamp: string | null;
  photo_chosen_at: string | null;
}

interface AlbumRow extends Record<string, unknown> {
  slug: string;
  title: string;
  first_release_year: number | null;
  cover_url: string | null;
  cover_source: string | null;
  track_count: number | string;
}

interface TrackRow extends Record<string, unknown> {
  slug: string;
  album_title: string;
  track_title: string;
  number: number | string | null;
}

/**
 * The albums crediting the artist that have a presented, served journal
 * (ADR 0002, D1.2: the featured journal if visible, otherwise the most
 * recently published), each with the version a reader of `readerLocale` is
 * shown. Columns: entry_id, locale, slug, album_id, title,
 * first_release_year, cover_url, cover_source.
 */
function shownAlbums(artistId: string, readerLocale: Locale) {
  return sql`
    select presented.entry_id, presented.locale, served.slug,
           a.id as album_id, a.title, a.first_release_year,
           a.cover_url, a.cover_source
      from (${presentedJournals("album", readerLocale)}) presented
      join (${servedAlbumJournalAddresses}) served
        on served.entry_id = presented.entry_id
      join albums a on a.id = presented.subject_id
     where exists (select 1
                     from album_artists aa
                    where aa.album_id = a.id
                      and aa.artist_id = ${artistId})`;
}

/** The photograph to show, or null for the fallback. */
export function publicArtistPhotoOf(row: HeadRow): PublicArtistPhoto | null {
  const photo = artistPhotoOf({
    photoUrl: row.photo_url,
    photoCredit: row.photo_credit,
    photoLicense: row.photo_license,
    photoSourceUrl: row.photo_source_url,
    photoFileSha1: row.photo_file_sha1,
    photoFileTimestamp: row.photo_file_timestamp,
    photoChosenAt: row.photo_chosen_at,
  });
  if (!photo) {
    return null;
  }
  return {
    src: photo.src,
    srcSet: photo.srcSet,
    title: photo.title,
    sourceUrl: photo.sourceUrl,
    credit: photo.credit,
    caption: photoCreditCaption(photo.credit),
    license: {
      name: photo.license.name,
      url: photo.license.url,
      shareAlike: photo.license.shareAlike,
    },
    modifications: photo.modifications,
  };
}

/**
 * The public page of a visible artist, or null when the artist is not
 * publicly visible (or stopped being visible between statements).
 * `readerLocale` selects journal versions only, never which journals.
 */
export async function getPublicArtist(
  db: DatabaseExecutor,
  artistId: string,
  readerLocale: Locale,
): Promise<PublicArtist | null> {
  const address = (await publicArtistAddresses(db)).get(artistId);
  if (!address) {
    return null;
  }

  // Each statement starts from the visible artists or the served journals,
  // so an artist that stopped being visible in between yields nothing.
  const head = await db.execute<HeadRow>(sql`
    select ar.name, ar.photo_url, ar.photo_credit, ar.photo_license,
           ar.photo_source_url, ar.photo_file_sha1,
           to_char(ar.photo_file_timestamp at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as photo_file_timestamp,
           to_char(ar.photo_chosen_at at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as photo_chosen_at
      from (${publicArtists}) visible
      join artists ar on ar.id = visible.artist_id
     where visible.artist_id = ${artistId}`);
  const headRow = head.rows[0];
  if (!headRow) {
    return null;
  }

  const albums = await db.execute<AlbumRow>(sql`
    select shown.slug, shown.title, shown.first_release_year,
           shown.cover_url, shown.cover_source,
           (select count(*)
              from album_editions ed
              join edition_tracks et on et.edition_id = ed.id
             where ed.album_id = shown.album_id
               and ed.is_reference) as track_count
      from (${shownAlbums(artistId, readerLocale)}) shown
     order by shown.first_release_year asc nulls last, shown.title asc,
              shown.slug asc`);
  if (albums.rows.length === 0) {
    return null;
  }

  // The public reflections of each presented journal, in the version shown,
  // numbered as the album journal numbers its tracks (reference-edition
  // order); a reflection on a recording missing from that edition has none.
  const tracks = await db.execute<TrackRow>(sql`
    with shown as (${shownAlbums(artistId, readerLocale)})
    select shown.slug, shown.title as album_title, t.title as track_title,
           numbered.number
      from shown
      join (${publicTrackReflectionTexts}) visible
        on visible.album_journal_id = shown.entry_id
       and visible.locale = shown.locale
      join tracks t on t.id = visible.track_id
      left join lateral (
        select listed.number
          from (select et.track_id,
                       row_number() over (order by et.disc_number,
                                                   et.position) as number
                  from album_editions ed
                  join edition_tracks et on et.edition_id = ed.id
                 where ed.album_id = shown.album_id
                   and ed.is_reference) listed
         where listed.track_id = visible.track_id
      ) numbered on true
     order by shown.first_release_year asc nulls last, shown.title asc,
              shown.slug asc, numbered.number asc nulls last, t.title asc`);

  const publicTracks: PublicArtistTrack[] = tracks.rows.map((row) => ({
    title: row.track_title,
    albumTitle: row.album_title,
    slug: row.slug,
    number: row.number === null ? null : Number(row.number),
  }));

  return {
    address,
    name: headRow.name,
    photo: publicArtistPhotoOf(headRow),
    albums: albums.rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      firstReleaseYear: row.first_release_year,
      artwork: publicArtworkOf(row.cover_url, row.cover_source),
      trackCount: Number(row.track_count),
      writtenTrackCount: publicTracks.filter((track) => track.slug === row.slug)
        .length,
    })),
    tracks: publicTracks,
  };
}

/** Every public artist address, for the sitemap, in order. */
export async function listPublicArtistAddresses(
  db: DatabaseExecutor,
): Promise<string[]> {
  return [...(await publicArtistAddresses(db)).values()].sort();
}
