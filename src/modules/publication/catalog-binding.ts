import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor } from "@/db";

import { artistAddresses } from "./artist-address";
import { renderLinkList } from "./memory-music";
import { publicArtists, servedMemoryAddresses } from "./queries";

// The catalog wording a confirmation binds (ADR 0013 § 5; it closes C11).
// ADR 0006 left catalog wording out of the fingerprint; from step 2 it is in:
// the preview and the confirmation each read it here, the confirmation under
// its locks (catalog-locks.ts), so a catalog edit between the two makes the
// confirmation stale and nothing is written. Internal to the Publication
// module. What it returns is fingerprint material only: it is never shown to
// a reader, and it carries nothing a served page or the author's own review
// does not already show, apart from internal ids that name what is bound.

/** An album journal's catalog atoms, as its page renders them. */
export interface AlbumJournalCatalog {
  album: {
    id: string;
    title: string;
    year: number | null;
    label: string | null;
    /** The stored cover, whatever the cover display switch says. */
    cover: { url: string | null; source: string | null };
  };
  /** In credit order: the name shown, and the link's presence and address. */
  credits: { artistId: string; name: string; address: string | null }[];
  /** The reference edition's tracks, in order. */
  tracks: {
    trackId: string;
    title: string;
    credit: string | null;
    disc: number;
    position: number;
  }[];
  /** The tracks the journal's flagged reflections name, by id. */
  reflectionTracks: { trackId: string; title: string }[];
  /**
   * For a publication only (`transitions`): the served memories whose page
   * links this album or one of its tracks, and so may name it or link to it
   * once it is published; and the served memories on which a credit becomes
   * a link because the publication opens that artist's page (A5). By entry
   * id, in order.
   */
  transitions: {
    memoriesNamingAlbum: string[];
    memoriesGainingArtistLinks: string[];
  } | null;
}

/**
 * Reads an album journal's catalog atoms. `asPublished`: compute each
 * credit's link as it will be once the journal is served (the artists it
 * credits that are not archived have a page then), and include the
 * transition lists. A served journal's links are the same either way.
 */
export async function albumJournalCatalog(
  db: DatabaseExecutor,
  entryId: string,
  { asPublished }: { asPublished: boolean },
): Promise<AlbumJournalCatalog | null> {
  const head = await db.execute<{
    album_id: string;
    title: string;
    year: number | null;
    label: string | null;
    cover_url: string | null;
    cover_source: string | null;
  }>(sql`
    select a.id as album_id, a.title, a.first_release_year as year, ed.label,
           a.cover_url, a.cover_source
      from album_journals aj
      join albums a on a.id = aj.album_id
      left join album_editions ed on ed.album_id = a.id and ed.is_reference
     where aj.entry_id = ${entryId}`);
  const album = head.rows[0];
  if (!album) {
    return null;
  }
  const albumId = album.album_id;

  const credits = await db.execute<{
    artist_id: string;
    shown: string;
    name: string;
    live: boolean;
  }>(sql`
    select aa.artist_id, coalesce(aa.credited_as, ar.name) as shown, ar.name,
           ar.archived_at is null as live
      from album_artists aa
      join artists ar on ar.id = aa.artist_id
     where aa.album_id = ${albumId}
     order by aa.position asc`);
  const visible = await db.execute<{ artist_id: string; name: string }>(sql`
    select visible.artist_id, visible.name from (${publicArtists}) visible`);
  const visibleIds = new Set(visible.rows.map((row) => row.artist_id));
  const opened = asPublished
    ? credits.rows.filter((row) => row.live && !visibleIds.has(row.artist_id))
    : [];
  const addresses = artistAddresses([
    ...visible.rows.map((row) => ({ artistId: row.artist_id, name: row.name })),
    ...opened.map((row) => ({ artistId: row.artist_id, name: row.name })),
  ]);

  const tracks = await db.execute<{
    track_id: string;
    title: string;
    credit: string | null;
    disc_number: number;
    position: number;
  }>(sql`
    select et.track_id, t.title, t.credit, et.disc_number, et.position
      from album_editions ed
      join edition_tracks et on et.edition_id = ed.id
      join tracks t on t.id = et.track_id
     where ed.album_id = ${albumId} and ed.is_reference
     order by et.disc_number asc, et.position asc`);
  const reflected = await db.execute<{ track_id: string; title: string }>(sql`
    select tr.track_id, t.title
      from track_reflections tr
      join tracks t on t.id = tr.track_id
     where tr.album_journal_id = ${entryId} and tr.is_published
     order by tr.track_id asc`);

  let transitions: AlbumJournalCatalog["transitions"] = null;
  if (asPublished) {
    const naming = await db.execute<{ entry_id: string }>(sql`
      select distinct served.entry_id
        from (${servedMemoryAddresses}) served
        join memory_music mm on mm.memory_id = served.entry_id
       where mm.album_id = ${albumId}
          or mm.track_id in (select atr.track_id from album_tracks atr
                              where atr.album_id = ${albumId})
       order by served.entry_id`);
    const openedIds = opened.map((row) => row.artist_id);
    const gaining =
      openedIds.length === 0
        ? { rows: [] as { entry_id: string }[] }
        : await db.execute<{ entry_id: string }>(sql`
            select distinct served.entry_id
              from (${servedMemoryAddresses}) served
              join memory_music mm on mm.memory_id = served.entry_id
             where exists (select 1 from track_artists ta
                            where ta.track_id = mm.track_id
                              and ta.artist_id in (${sql.join(
                                openedIds.map((id) => sql`${id}`),
                                sql`, `,
                              )}))
                or exists (select 1 from album_artists aa
                            where aa.album_id = mm.album_id
                              and aa.artist_id in (${sql.join(
                                openedIds.map((id) => sql`${id}`),
                                sql`, `,
                              )}))
             order by served.entry_id`);
    transitions = {
      memoriesNamingAlbum: naming.rows.map((row) => row.entry_id),
      memoriesGainingArtistLinks: gaining.rows.map((row) => row.entry_id),
    };
  }

  return {
    album: {
      id: albumId,
      title: album.title,
      year: album.year,
      label: album.label,
      cover: { url: album.cover_url, source: album.cover_source },
    },
    credits: credits.rows.map((row) => ({
      artistId: row.artist_id,
      name: row.shown,
      address: addresses.get(row.artist_id) ?? null,
    })),
    tracks: tracks.rows.map((row) => ({
      trackId: row.track_id,
      title: row.title,
      credit: row.credit,
      disc: row.disc_number,
      position: row.position,
    })),
    reflectionTracks: reflected.rows.map((row) => ({
      trackId: row.track_id,
      title: row.title,
    })),
    transitions,
  };
}

/** A memory's links as its page renders them, with the albums they name. */
export interface MemoryLinksCatalog {
  links: {
    link: string;
    rendered: unknown;
    namedAlbumId: string | null;
  }[];
  /**
   * Each named album's year and credited names, which the Studio review shows
   * so two albums with one title can be told apart (ADR 0013 § 5).
   */
  namedAlbums: { albumId: string; year: number | null; credits: string[] }[];
}

/** The rendered wording of `links`, in that order, and their named albums. */
export async function memoryLinksCatalog(
  db: DatabaseExecutor,
  links: readonly ({ trackId: string } | { albumId: string })[],
): Promise<MemoryLinksCatalog> {
  const rendered = await renderLinkList(db, links);
  const albumIds = [
    ...new Set(
      rendered.flatMap((link) =>
        link.namedAlbumId === null ? [] : [link.namedAlbumId],
      ),
    ),
  ].sort();
  const named =
    albumIds.length === 0
      ? { rows: [] as { id: string; year: number | null; credits: string[] }[] }
      : await db.execute<{
          id: string;
          year: number | null;
          credits: string[] | null;
        }>(sql`
          select a.id, a.first_release_year as year,
                 (select array_agg(coalesce(aa.credited_as, ar.name)
                                   order by aa.position)
                    from album_artists aa
                    join artists ar on ar.id = aa.artist_id
                   where aa.album_id = a.id) as credits
            from albums a
           where a.id in (${sql.join(
             albumIds.map((id) => sql`${id}`),
             sql`, `,
           )})
           order by a.id`);
  return {
    links: rendered.map((link, index) => {
      const source = links[index]!;
      return {
        link:
          "trackId" in source
            ? `track:${source.trackId}`
            : `album:${source.albumId}`,
        rendered: link.music,
        namedAlbumId: link.namedAlbumId,
      };
    }),
    namedAlbums: named.rows.map((row) => ({
      albumId: row.id,
      year: row.year,
      credits: row.credits ?? [],
    })),
  };
}
