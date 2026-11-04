import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Locale } from "@/db";

import { artistAddresses } from "./artist-address";
import { publicArtworkOf, type PublicArtwork } from "./public-album-journal";
import {
  listPublicMemoryArchive,
  memorySongRows,
  nameOrder,
  shownAlbumJournals,
  type PublicArtistCard,
  type PublicMemoryCard,
  type PublicMemorySong,
} from "./public-archives";
import { publicLanguageVersions } from "./predicate";
import {
  presentedJournals,
  publicArtists,
  servedAlbumJournalAddresses,
  servedMemoryAddresses,
  versionPreference,
} from "./queries";
import { inSnapshot } from "./snapshot";

// The read model of the public Home (M3.4, extended in M3.8b under ADR 0006
// amendment A6): what a reader may find from the front page. Every row starts
// from the publication predicate (`predicate.ts`) and from the addresses that
// are actually served (the sitemap's rule), so the Home lists exactly what has
// a page that answers, and links to each by its current address. No fragment
// here decides visibility in a new way:
//
// - album journals at `servedAlbumJournalAddresses`;
// - memories at `servedMemoryAddresses`;
// - artists in `publicArtists` (A5), addressed over the whole visible set;
// - for each entry, the version `versionPreference` chooses among the
//   publicly visible ones.
//
// The rows carry only what A6 lists: for an album journal, what its page
// shows on a card; for a memory, its title, "when", a server-cut excerpt, and
// its music as catalog wording; for an artist, its name, address, and the
// Artists archive's served counts. No entry or catalog identifier, status,
// deletion state, private date, photograph, unpublished language, or whole
// writing is returned. Each section is a prefix of what its archive (or, for
// "Recently written", the sitemap) lists.

/** How many entries "Recently written" lists (the approved screen: five). */
export const HOME_RECENT_LIMIT = 5;

/** How many albums the Home shows (the approved screen: four). */
export const HOME_ALBUM_LIMIT = 4;

/** How many artists the Home shows (the approved screen: three). */
export const HOME_ARTIST_LIMIT = 3;

/** How many memories the Home shows (the approved screen: three). */
export const HOME_MEMORY_LIMIT = 3;

/** One album journal as the Home shows it. */
export interface PublicJournalCard {
  /** The current, served address is `/albums/<slug>`. */
  slug: string;
  albumTitle: string;
  /** The album's credited artists, in order. */
  credits: string[];
  firstReleaseYear: number | null;
  /** The journal's rating, in half steps (0 to 10), when one is set. */
  ratingHalfSteps: number | null;
  /** The chosen cover's image sources, or null for the fallback. */
  artwork: PublicArtwork | null;
  /** When the version a reader is shown was published. */
  publishedAt: Date;
}

/** An album journal in "Recently written": its card, unchanged since M3.4. */
export interface PublicHomeAlbumJournal extends PublicJournalCard {
  kind: "album_journal";
}

/** A memory in "Recently written" (ADR 0006 A6). */
export interface PublicHomeMemory {
  kind: "memory";
  /** The current, served address is `/memories/<slug>`. */
  slug: string;
  /** The language of the version shown, for the title's `lang`. */
  locale: Locale;
  /** The title of the version shown. */
  title: string;
  /** The memory's first piece of music, named as its page names it. */
  firstSong: PublicMemorySong | null;
  /** When the version shown was published. */
  publishedAt: Date;
}

/** One entry of "Recently written"; the first is "Most recent". */
export type PublicHomeEntry = PublicHomeAlbumJournal | PublicHomeMemory;

export interface PublicHome {
  /**
   * Album journals and memories in one chronology, the most recently
   * published version first (ties: album journal before memory, then address).
   */
  recent: PublicHomeEntry[];
  /** Each album once, by its presented journal (ADR 0002, D1.2). */
  albums: PublicJournalCard[];
  /**
   * Publicly visible artists, the newest served album journal about them
   * first (ties: name, then address), with the Artists archive's counts.
   */
  artists: PublicArtistCard[];
  /** The Memories archive's first memories, in its order. */
  memories: PublicMemoryCard[];
}

interface CardRow extends Record<string, unknown> {
  slug: string;
  published_at: string;
  rating_half_steps: number | null;
  album_title: string;
  first_release_year: number | null;
  cover_url: string | null;
  cover_source: string | null;
  credits: string[] | null;
}

// The album facts of a card, read only for a journal that a row above has
// already found visible: the same columns as the album-journal page's frame.
const cardColumns = sql`
  aj.rating_half_steps, a.title as album_title, a.first_release_year,
  a.cover_url, a.cover_source,
  (select array_agg(coalesce(aa.credited_as, ar.name) order by aa.position)
     from album_artists aa
     join artists ar on ar.id = aa.artist_id
    where aa.album_id = a.id) as credits`;

function toCard(row: CardRow): PublicJournalCard {
  return {
    slug: row.slug,
    albumTitle: row.album_title,
    credits: row.credits ?? [],
    firstReleaseYear: row.first_release_year,
    ratingHalfSteps: row.rating_half_steps,
    artwork: publicArtworkOf(row.cover_url, row.cover_source),
    // Drizzle's node-postgres driver returns timestamptz from raw SQL as
    // text with an explicit offset.
    publishedAt: new Date(row.published_at),
  };
}

interface RecentRow extends CardRow {
  kind: "album_journal" | "memory";
  locale: Locale;
  memory_title: string | null;
  song_title: string | null;
  song_artists: string[] | null;
}

/**
 * The most recently published album journals and memories, together, each at
 * its served address, dated by the publication of the version a reader of
 * `readerLocale` is shown. Several journals about one album are each listed:
 * they are separate pieces of writing (docs/design-system.md § Featured
 * journal). A memory carries its title and only its first piece of music.
 * Artist journals are never read (they have no public reading contract).
 */
export async function listRecentPublicEntries(
  db: DatabaseExecutor,
  readerLocale: Locale,
  limit: number = HOME_RECENT_LIMIT,
): Promise<PublicHomeEntry[]> {
  const result = await db.execute<RecentRow>(sql`
    with shown as (
      select 'album_journal' as kind, 0 as kind_rank, served.entry_id,
             served.slug, version.locale, version.published_at
        from (${servedAlbumJournalAddresses}) served
       cross join lateral (
         select pv.locale, pv.published_at
           from (${publicLanguageVersions}) pv
          where pv.entry_id = served.entry_id
          order by ${versionPreference(readerLocale)}
          limit 1
       ) version
      union all
      select 'memory' as kind, 1 as kind_rank, served.entry_id,
             served.slug, version.locale, version.published_at
        from (${servedMemoryAddresses}) served
       cross join lateral (
         select pv.locale, pv.published_at
           from (${publicLanguageVersions}) pv
          where pv.entry_id = served.entry_id
          order by ${versionPreference(readerLocale)}
          limit 1
       ) version
    ),
    newest as (
      select * from shown
       order by published_at desc, kind_rank asc, slug asc
       limit ${limit}
    )
    select newest.kind, newest.slug, newest.locale, newest.published_at,
           ${cardColumns},
           memory_text.title as memory_title,
           song.title as song_title, song.artists as song_artists
      from newest
      left join album_journals aj
        on newest.kind = 'album_journal' and aj.entry_id = newest.entry_id
      left join albums a on a.id = aj.album_id
      left join entry_texts memory_text
        on newest.kind = 'memory'
       and memory_text.entry_id = newest.entry_id
       and memory_text.locale = newest.locale
      left join lateral (
        select first_song.title, first_song.artists
          from (${memorySongRows}) first_song
         where newest.kind = 'memory'
           and first_song.memory_id = newest.entry_id
         order by first_song.position asc, first_song.id asc
         limit 1
      ) song on true
     order by newest.published_at desc, newest.kind_rank asc, newest.slug asc`);
  return result.rows.map((row): PublicHomeEntry => {
    if (row.kind === "album_journal") {
      return { kind: "album_journal", ...toCard(row) };
    }
    return {
      kind: "memory",
      slug: row.slug,
      locale: row.locale,
      // The memory commands require a title, and publishing refuses a memory
      // without one; only a write outside the application could leave it empty.
      title: row.memory_title ?? "",
      firstSong:
        row.song_title === null
          ? null
          : { title: row.song_title, artists: row.song_artists ?? [] },
      publishedAt: new Date(row.published_at),
    };
  });
}

/**
 * The albums that have a publicly presented journal, each once, linked to
 * that journal (the featured one if it is visible, otherwise the most
 * recently published), the most recently published first.
 */
export async function listPublicAlbums(
  db: DatabaseExecutor,
  readerLocale: Locale,
  limit: number = HOME_ALBUM_LIMIT,
): Promise<PublicJournalCard[]> {
  const result = await db.execute<CardRow>(sql`
    select served.slug, presented.published_at, ${cardColumns}
      from (${presentedJournals("album", readerLocale)}) presented
      join (${servedAlbumJournalAddresses}) served
        on served.entry_id = presented.entry_id
      join album_journals aj on aj.entry_id = presented.entry_id
      join albums a on a.id = presented.subject_id
     order by presented.published_at desc, served.slug asc
     limit ${limit}`);
  return result.rows.map(toCard);
}

interface ArtistRow extends Record<string, unknown> {
  artist_id: string;
  name: string;
  album_count: number | string;
  journal_count: number | string;
  latest_published_at: string;
}

/**
 * The publicly visible artists (`publicArtists`, ADR 0006 A5), the newest
 * served album journal about an album that credits them first, then by name
 * and address, each at the address of its page. The addresses are derived
 * from every visible artist before the limit is applied, so a namesake's
 * suffix is the one its page answers at. The counts are the Artists archive's:
 * albums crediting the artist that have a served journal, and those journals.
 * The date orders the list and is not returned.
 */
export async function listHomeArtists(
  db: DatabaseExecutor,
  readerLocale: Locale,
  limit: number = HOME_ARTIST_LIMIT,
): Promise<PublicArtistCard[]> {
  const result = await db.execute<ArtistRow>(sql`
    with visible as (${publicArtists}),
    shown as (${shownAlbumJournals(readerLocale)})
    select visible.artist_id, visible.name,
           count(distinct shown.album_id) as album_count,
           count(distinct shown.entry_id) as journal_count,
           max(shown.published_at) as latest_published_at
      from visible
      join album_artists aa on aa.artist_id = visible.artist_id
      join shown on shown.album_id = aa.album_id
     group by visible.artist_id, visible.name`);

  // Every visible artist's address, from this one statement's rows, which are
  // the whole visible set; only then is the list ordered and cut.
  const addresses = artistAddresses(
    result.rows.map((row) => ({ artistId: row.artist_id, name: row.name })),
  );
  return result.rows
    .flatMap((row) => {
      const address = addresses.get(row.artist_id);
      return address
        ? [
            {
              card: {
                address,
                name: row.name,
                albumCount: Number(row.album_count),
                journalCount: Number(row.journal_count),
              },
              latest: new Date(row.latest_published_at).getTime(),
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        b.latest - a.latest ||
        nameOrder.compare(a.card.name, b.card.name) ||
        (a.card.address < b.card.address
          ? -1
          : a.card.address > b.card.address
            ? 1
            : 0),
    )
    .slice(0, limit)
    .map(({ card }) => card);
}

/**
 * What the Home shows. `readerLocale` selects versions only, never entries.
 * Every section is read in one read-only snapshot (ADR 0006 A6, item 8), so
 * the sections of one response agree with each other; a publication that
 * commits after the snapshot began is shown from the next request on.
 */
export async function getPublicHome(
  db: DatabaseExecutor,
  readerLocale: Locale,
): Promise<PublicHome> {
  return inSnapshot(db, async (snapshot) => ({
    recent: await listRecentPublicEntries(snapshot, readerLocale),
    albums: await listPublicAlbums(snapshot, readerLocale),
    artists: await listHomeArtists(snapshot, readerLocale),
    memories: await listPublicMemoryArchive(
      snapshot,
      readerLocale,
      HOME_MEMORY_LIMIT,
    ),
  }));
}
