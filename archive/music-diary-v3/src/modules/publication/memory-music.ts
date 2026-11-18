import "server-only";

import { sql } from "drizzle-orm";

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
// - The words are catalog metadata (titles and credited artists). They are
//   shown, not bound into a confirmation: the documented gap C11, which gate
//   G8 must close before any hosted page (ADR 0006 § 2).
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
           end as album_slug
      from memory_music mm
      left join tracks t on t.id = mm.track_id
      left join albums a on a.id = mm.album_id
      left join lateral (
        select al.title, j.slug
          from album_tracks atr
          join albums al on al.id = atr.album_id
          left join journal_of_album j on j.album_id = al.id
         where atr.track_id = mm.track_id
         order by (j.slug is not null) desc,
                  al.first_release_year asc nulls last, al.title asc, al.id asc
         limit 1
      ) shown on mm.track_id is not null
     where mm.memory_id = ${memoryId}
       and (${!onlyIfPublic}
            or exists (select 1 from (${publicLanguageVersions}) pv
                        where pv.entry_id = mm.memory_id))
     order by mm.position asc, mm.id asc`);

  const needsAddresses = result.rows.some((row) => row.artists.length > 0);
  const addresses = needsAddresses
    ? await publicArtistAddresses(db)
    : new Map<string, string>();

  return result.rows.map((row, index) => ({
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
  }));
}
