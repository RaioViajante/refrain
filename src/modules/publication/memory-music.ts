import "server-only";

import { sql, type SQL } from "drizzle-orm";

import type { DatabaseExecutor } from "@/db";

import { publicLanguageVersions } from "./predicate";
import {
  presentedJournals,
  publicArtistAddresses,
  servedAlbumJournalAddresses,
} from "./queries";

// A memory's music as a reader sees it (M3.7): each link in the memory's order,
// named with catalog wording, and linked only to pages that are public now.
// The publication review (./disclosure) and the public memory page
// (./public-memory) read it through this one function, so what the author
// reviews is what the page shows. Internal to the Publication module.
//
// - The words are catalog metadata (titles and credited artists). Since ADR
//   0013 step 2 a confirmation binds them (catalog-binding.ts), so a catalog
//   edit between a review and its confirmation makes it stale. A catalog edit
//   with no publication in progress still changes them unconfirmed until
//   steps 3 and 4 (G8 stays open).
// - A credited artist is linked only when it already has a public page
//   (`publicArtistAddresses`: credited on a served album journal and not
//   archived). A memory never opens an artist page (ADR 0006 A5: memories open
//   none), so an artist without a page, or archived, is plain text.
// - A recording names one album: the album with a served journal when there is
//   one (ADR 0002, D1.2, the journal presented for the album, at its served
//   address), otherwise the earliest album it is on, as plain text. A link to
//   an album names the album itself, linked the same way.
// - Nothing returned carries a database identifier, a MusicBrainz identifier,
//   a status, or any journal text.

/** One credited artist: linked (`/artists/<address>`) only if it has a page. */
export interface PublicMemoryArtist {
  name: string;
  address: string | null;
}

/** One piece of music in a memory, in the memory's order. */
export interface PublicMemoryMusic {
  /** Its place in the memory's list, from 1. */
  number: number;
  /** A recording (the studio's only kind of link) or a whole album. */
  kind: "recording" | "album";
  /** The recording's title, or the album's. */
  title: string;
  /** Credited artists in credit order: the recording's, or the album's. */
  artists: PublicMemoryArtist[];
  /**
   * The album named with it: for a recording, the album it is on that has a
   * served journal, otherwise its earliest; for an album link, the album
   * itself. `journalSlug` is the served album journal's address
   * (`/albums/<slug>`), or null when none is served.
   */
  album: { title: string; journalSlug: string | null } | null;
}

interface LinkRow extends Record<string, unknown> {
  position: number;
  track_id: string | null;
  album_id: string | null;
  title: string;
  artists: { artist_id: string; name: string }[];
  album_title: string | null;
  album_slug: string | null;
  /** The album named with the link (not public: for the review's binding). */
  named_album_id: string | null;
}

/** One link as the page renders it, with the album it names (internal). */
export interface RenderedMusicLink {
  music: PublicMemoryMusic;
  /** The id of the album named with it, or null. Never reaches a page. */
  namedAlbumId: string | null;
}

/**
 * The rows of `source` (columns: position, id, track_id, album_id; one row
 * per link, aliased `mm`) as the memory page renders them, in order. The one
 * place a memory's music is named: the page, the review, and the binding of
 * a confirmation all read it here.
 */
async function renderMusicLinks(
  db: DatabaseExecutor,
  source: SQL,
): Promise<RenderedMusicLink[]> {
  // `presentedJournals` and the served addresses come from the publication
  // predicate; the version a reader is shown does not change the address.
  const result = await db.execute<LinkRow>(sql`
    with presented as (${presentedJournals("album", "en")}),
    served as (${servedAlbumJournalAddresses}),
    journal_of_album as (
      select presented.subject_id as album_id, served.slug
        from presented
        join served on served.entry_id = presented.entry_id
    )
    select mm.position, mm.track_id, mm.album_id,
           coalesce(t.title, a.title) as title,
           case
             when mm.track_id is not null then
               coalesce((select json_agg(json_build_object(
                                  'artist_id', ar.id, 'name', ar.name)
                                order by ta.position)
                           from track_artists ta
                           join artists ar on ar.id = ta.artist_id
                          where ta.track_id = mm.track_id), '[]'::json)
             else
               coalesce((select json_agg(json_build_object(
                                  'artist_id', ar.id,
                                  'name', coalesce(aa.credited_as, ar.name))
                                order by aa.position)
                           from album_artists aa
                           join artists ar on ar.id = aa.artist_id
                          where aa.album_id = mm.album_id), '[]'::json)
           end as artists,
           coalesce(shown.title, a.title) as album_title,
           case when mm.track_id is not null then shown.slug
                else (select j.slug from journal_of_album j
                       where j.album_id = mm.album_id)
           end as album_slug,
           case when mm.track_id is not null then shown.id
                else a.id
           end as named_album_id
      from (${source}) mm
      left join tracks t on t.id = mm.track_id
      left join albums a on a.id = mm.album_id
      left join lateral (
        select al.id, al.title, j.slug
          from album_tracks atr
          join albums al on al.id = atr.album_id
          left join journal_of_album j on j.album_id = al.id
         where atr.track_id = mm.track_id
         order by (j.slug is not null) desc,
                  al.first_release_year asc nulls last, al.title asc, al.id asc
         limit 1
      ) shown on mm.track_id is not null
     order by mm.position asc, mm.id asc`);

  const needsAddresses = result.rows.some((row) => row.artists.length > 0);
  const addresses = needsAddresses
    ? await publicArtistAddresses(db)
    : new Map<string, string>();

  return result.rows.map((row, index) => ({
    music: {
      number: index + 1,
      kind: row.track_id !== null ? "recording" : "album",
      title: row.title,
      artists: row.artists.map((artist) => ({
        name: artist.name,
        address: addresses.get(artist.artist_id) ?? null,
      })),
      album:
        row.album_title === null
          ? null
          : { title: row.album_title, journalSlug: row.album_slug },
    },
    namedAlbumId: row.named_album_id,
  }));
}

/**
 * The music of one memory, in its order, as the page shows it. The disclosure
 * reads it for the memory being reviewed, whatever its state; the public
 * reader passes `onlyIfPublic`, so that the rows are read only while a
 * language version of the memory is publicly visible (a memory unpublished
 * between two statements yields nothing).
 */
export async function readMemoryMusic(
  db: DatabaseExecutor,
  memoryId: string,
  { onlyIfPublic = false }: { onlyIfPublic?: boolean } = {},
): Promise<PublicMemoryMusic[]> {
  const rendered = await renderMusicLinks(
    db,
    sql`select position, id, track_id, album_id
          from memory_music
         where memory_id = ${memoryId}
           and (${!onlyIfPublic}
                or exists (select 1 from (${publicLanguageVersions}) pv
                            where pv.entry_id = ${memoryId}))`,
  );
  return rendered.map((link) => link.music);
}

/**
 * Any list of links, as a memory page would render them in that order: for
 * the binding of a confirmation (ADR 0013 § 5), including links a save would
 * add. Internal to the Publication module.
 */
export async function renderLinkList(
  db: DatabaseExecutor,
  links: readonly ({ trackId: string } | { albumId: string })[],
): Promise<RenderedMusicLink[]> {
  if (links.length === 0) {
    return [];
  }
  const rows = links.map(
    (link, index) =>
      sql`(${index + 1}::int, null::uuid, ${
        "trackId" in link ? link.trackId : null
      }::uuid, ${"albumId" in link ? link.albumId : null}::uuid)`,
  );
  return renderMusicLinks(
    db,
    sql`select * from (values ${sql.join(rows, sql`, `)})
          as links(position, id, track_id, album_id)`,
  );
}
