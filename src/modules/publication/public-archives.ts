import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Locale } from "@/db";

import { artistAddresses } from "./artist-address";
import { memoryExcerpt } from "./excerpt";
import { publicArtworkOf, type PublicArtwork } from "./public-album-journal";
import {
  publicLanguageVersions,
  publicTrackReflectionTexts,
} from "./predicate";
import {
  presentedJournals,
  publicArtists,
  servedAlbumJournalAddresses,
  servedMemoryAddresses,
  versionPreference,
} from "./queries";
import { isFilled } from "./text";

// The read models of the public archives (M3.8a): `/albums`, `/artists`, and
// `/memories`. Each starts from the publication predicate (`predicate.ts`) and
// from the addresses that are actually served (the sitemap's rule), so an
// archive lists exactly what has a page that answers, and links to each at its
// current address. Nothing here adds a visibility rule:
//
// - an album journal is listed when its address is served;
// - an artist is listed when it is publicly visible (`publicArtists`, ADR 0006
//   A5: credited on an album that has a served journal, and not archived);
// - a memory is listed when its address is served.
//
// What is returned carries what the detail pages already show, and nothing
// else: no entry or catalog identifier, no status, no deletion state, no
// unpublished language, no unpublished track reflection, and no writing
// beyond a memory's title and the excerpt of the version a reader is shown.

/** One served album journal that is not the one an album's card opens. */
export interface PublicAlbumJournalLink {
  /** The served address is `/albums/<slug>`. */
  slug: string;
  /** When the version a reader is shown was published. */
  publishedAt: Date;
}

/** One album as the Albums archive shows it. */
export interface PublicAlbumCard {
  /** The served address of the journal the card opens, `/albums/<slug>`. */
  slug: string;
  albumTitle: string;
  /** The album's credited artists, in order. */
  credits: string[];
  firstReleaseYear: number | null;
  /** The card journal's rating, in half steps (0 to 10), when one is set. */
  ratingHalfSteps: number | null;
  artwork: PublicArtwork | null;
  /** When the version of the card journal a reader is shown was published. */
  publishedAt: Date;
  /** The tracks of the album's reference edition. */
  trackCount: number;
  /**
   * How many of them have a public reflection in the version of the card
   * journal a reader is shown (never more than `trackCount`).
   */
  writtenTrackCount: number;
  /** Every other served journal about the album, the newest first. */
  otherJournals: PublicAlbumJournalLink[];
}

/** One artist as the Artists archive shows it. */
export interface PublicArtistCard {
  /** The artist's page is `/artists/<address>`. */
  address: string;
  name: string;
  /** Albums crediting the artist that have a served journal. */
  albumCount: number;
  /** Served journals about those albums (at least `albumCount`). */
  journalCount: number;
}

/** One piece of music on a memory's line in the Memories archive. */
export interface PublicMemorySong {
  /** The recording's title, or the album's for a link to a whole album. */
  title: string;
  /** The credited artists' names, in credit order. */
  artists: string[];
}

/** One memory as the Memories archive shows it. */
export interface PublicMemoryCard {
  /** The served address is `/memories/<slug>`. */
  slug: string;
  /** The language of the version shown, for the title's and excerpt's `lang`. */
  locale: Locale;
  title: string;
  /** "A date, a season, a year", as written, when the memory has one. */
  rememberedWhen: string | null;
  /** When the version shown was published. */
  publishedAt: Date;
  /** The first readable paragraph, cut to about 240 characters, or null. */
  excerpt: string | null;
  /** The memory's music, in its order. */
  music: PublicMemorySong[];
}

// Drizzle's node-postgres driver returns timestamptz values from raw SQL as
// text with an explicit offset.
const timestamp = (value: string) => new Date(value);

/**
 * Every served album journal, with the version a reader of `readerLocale` is
 * shown, its album, and whether it is the journal ADR 0002 presents for that
 * album. Columns: entry_id, slug, album_id, locale, published_at,
 * is_presented.
 */
function shownAlbumJournals(readerLocale: Locale) {
  return sql`
    select served.entry_id, served.slug, aj.album_id, version.locale,
           version.published_at,
           (presented.entry_id is not null) as is_presented
      from (${servedAlbumJournalAddresses}) served
      join album_journals aj on aj.entry_id = served.entry_id
      left join (${presentedJournals("album", readerLocale)}) presented
        on presented.entry_id = served.entry_id
     cross join lateral (
       select pv.locale, pv.published_at
         from (${publicLanguageVersions}) pv
        where pv.entry_id = served.entry_id
        order by ${versionPreference(readerLocale)}
        limit 1
     ) version`;
}

interface AlbumJournalRow extends Record<string, unknown> {
  slug: string;
  album_id: string;
  published_at: string;
  rank: number | string;
  rating_half_steps: number | null;
  album_title: string;
  first_release_year: number | null;
  cover_url: string | null;
  cover_source: string | null;
  credits: string[] | null;
  track_count: number | string;
  written_track_count: number | string;
}

/**
 * The Albums archive: each album that has a served journal, once. Its card
 * opens the journal ADR 0002 presents for it (the featured one if visible,
 * otherwise the most recently published) and, should that one ever not be
 * served, the most recently published served one, so an album with a served
 * journal is never left out. Every other served journal about the album is
 * listed with the card, so no published journal is reachable only through
 * "Recently written" on the Home. Albums are ordered by the publication date
 * of the card's version, the newest first.
 */
export async function listPublicAlbumArchive(
  db: DatabaseExecutor,
  readerLocale: Locale,
): Promise<PublicAlbumCard[]> {
  const result = await db.execute<AlbumJournalRow>(sql`
    with shown as (${shownAlbumJournals(readerLocale)}),
    ranked as (
      select shown.*,
             row_number() over (
               partition by shown.album_id
               order by shown.is_presented desc, shown.published_at desc,
                        shown.slug asc) as rank
        from shown
    )
    select ranked.slug, ranked.album_id, ranked.published_at, ranked.rank,
           aj.rating_half_steps, a.title as album_title, a.first_release_year,
           a.cover_url, a.cover_source,
           (select array_agg(coalesce(aa.credited_as, ar.name)
                             order by aa.position)
              from album_artists aa
              join artists ar on ar.id = aa.artist_id
             where aa.album_id = a.id) as credits,
           (select count(*)
              from album_editions ed
              join edition_tracks et on et.edition_id = ed.id
             where ed.album_id = a.id
               and ed.is_reference) as track_count,
           (select count(distinct visible.track_id)
              from (${publicTrackReflectionTexts}) visible
              join album_editions ed
                on ed.album_id = a.id and ed.is_reference
              join edition_tracks et
                on et.edition_id = ed.id and et.track_id = visible.track_id
             where visible.album_journal_id = ranked.entry_id
               and visible.locale = ranked.locale) as written_track_count
      from ranked
      join album_journals aj on aj.entry_id = ranked.entry_id
      join albums a on a.id = ranked.album_id
     order by ranked.album_id, ranked.rank`);

  const cards = new Map<string, PublicAlbumCard>();
  for (const row of result.rows) {
    const card = cards.get(row.album_id);
    if (!card) {
      cards.set(row.album_id, {
        slug: row.slug,
        albumTitle: row.album_title,
        credits: row.credits ?? [],
        firstReleaseYear: row.first_release_year,
        ratingHalfSteps: row.rating_half_steps,
        artwork: publicArtworkOf(row.cover_url, row.cover_source),
        publishedAt: timestamp(row.published_at),
        trackCount: Number(row.track_count),
        writtenTrackCount: Number(row.written_track_count),
        otherJournals: [],
      });
    } else {
      card.otherJournals.push({
        slug: row.slug,
        publishedAt: timestamp(row.published_at),
      });
    }
  }
  const byNewest = (
    a: { publishedAt: Date; slug: string },
    b: { publishedAt: Date; slug: string },
  ) =>
    b.publishedAt.getTime() - a.publishedAt.getTime() ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const albums = [...cards.values()].sort(byNewest);
  for (const album of albums) {
    album.otherJournals.sort(byNewest);
  }
  return albums;
}

interface ArtistRow extends Record<string, unknown> {
  artist_id: string;
  name: string;
  album_count: number | string;
  journal_count: number | string;
}

// One stable order for names, whatever the database's collation: case and
// accents do not separate names, and numbers sort as numbers.
const nameOrder = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

/**
 * The Artists archive: exactly the publicly visible artists (`publicArtists`,
 * ADR 0006 A5), each at the address of their page, in alphabetical order. The
 * addresses are derived from this one statement's rows, which are the whole
 * visible set, by the same rule as every artist page (`artist-address.ts`), so
 * namesakes get the addresses their pages answer at.
 */
export async function listPublicArtistArchive(
  db: DatabaseExecutor,
): Promise<PublicArtistCard[]> {
  const result = await db.execute<ArtistRow>(sql`
    with visible as (${publicArtists}),
    served as (${servedAlbumJournalAddresses})
    select visible.artist_id, visible.name,
           count(distinct aj.album_id) as album_count,
           count(distinct served.entry_id) as journal_count
      from visible
      join album_artists aa on aa.artist_id = visible.artist_id
      join album_journals aj on aj.album_id = aa.album_id
      join served on served.entry_id = aj.entry_id
     group by visible.artist_id, visible.name`);

  const addresses = artistAddresses(
    result.rows.map((row) => ({ artistId: row.artist_id, name: row.name })),
  );
  return result.rows
    .flatMap((row) => {
      const address = addresses.get(row.artist_id);
      return address
        ? [
            {
              address,
              name: row.name,
              albumCount: Number(row.album_count),
              journalCount: Number(row.journal_count),
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        nameOrder.compare(a.name, b.name) ||
        (a.address < b.address ? -1 : a.address > b.address ? 1 : 0),
    );
}

interface MemoryRow extends Record<string, unknown> {
  entry_id: string;
  slug: string;
  locale: Locale;
  published_at: string;
  title: string | null;
  body: unknown;
  remembered_when: string | null;
}

interface SongRow extends Record<string, unknown> {
  memory_id: string;
  title: string;
  artists: string[] | null;
}

/**
 * The Memories archive: every memory whose address is served, with the
 * version a reader of `readerLocale` is shown, the newest publication first
 * (ties by address). "When" is shown as written and never read as a date.
 */
export async function listPublicMemoryArchive(
  db: DatabaseExecutor,
  readerLocale: Locale,
): Promise<PublicMemoryCard[]> {
  const memories = await db.execute<MemoryRow>(sql`
    select served.entry_id, served.slug, version.locale, version.published_at,
           t.title, t.body, m.remembered_when
      from (${servedMemoryAddresses}) served
     cross join lateral (
       select pv.locale, pv.published_at
         from (${publicLanguageVersions}) pv
        where pv.entry_id = served.entry_id
        order by ${versionPreference(readerLocale)}
        limit 1
     ) version
      join memories m on m.entry_id = served.entry_id
      join entry_texts t
        on t.entry_id = served.entry_id and t.locale = version.locale
     order by version.published_at desc, served.slug asc`);
  if (memories.rows.length === 0) {
    return [];
  }

  // The music of those memories, in one statement, named as the memory page
  // names it (`memory-music.ts`): a recording by its credited artists, an
  // album link by the album's credits. Read only while the memory is still
  // publicly visible, so a memory unpublished in between gives no songs.
  const ids = memories.rows.map((row) => row.entry_id);
  const songs = await db.execute<SongRow>(sql`
    select mm.memory_id, coalesce(t.title, a.title) as title,
           case
             when mm.track_id is not null then
               (select array_agg(ar.name order by ta.position)
                  from track_artists ta
                  join artists ar on ar.id = ta.artist_id
                 where ta.track_id = mm.track_id)
             else
               (select array_agg(coalesce(aa.credited_as, ar.name)
                                 order by aa.position)
                  from album_artists aa
                  join artists ar on ar.id = aa.artist_id
                 where aa.album_id = mm.album_id)
           end as artists
      from memory_music mm
      left join tracks t on t.id = mm.track_id
      left join albums a on a.id = mm.album_id
     where mm.memory_id in (${sql.join(
       ids.map((id) => sql`${id}`),
       sql`, `,
     )})
       and exists (select 1 from (${publicLanguageVersions}) pv
                    where pv.entry_id = mm.memory_id)
     order by mm.memory_id, mm.position asc, mm.id asc`);
  const music = new Map<string, PublicMemorySong[]>();
  for (const row of songs.rows) {
    const list = music.get(row.memory_id) ?? [];
    list.push({ title: row.title, artists: row.artists ?? [] });
    music.set(row.memory_id, list);
  }

  return memories.rows.map((row) => ({
    slug: row.slug,
    locale: row.locale,
    // The memory commands require a title, and publishing refuses a memory
    // without one; only a write outside the application could leave it empty.
    title: row.title ?? "",
    rememberedWhen: isFilled(row.remembered_when) ? row.remembered_when : null,
    publishedAt: timestamp(row.published_at),
    excerpt: memoryExcerpt(row.body),
    music: music.get(row.entry_id) ?? [],
  }));
}
