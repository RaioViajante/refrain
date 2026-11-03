import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Locale } from "@/db";

import { publicArtworkOf, type PublicArtwork } from "./public-album-journal";
import { publicLanguageVersions } from "./predicate";
import {
  presentedJournals,
  servedAlbumJournalAddresses,
  versionPreference,
} from "./queries";

// The read model of the public Home (M3.4): the journals a reader may find
// from the front page. Every row starts from the publication predicate
// (`predicate.ts`) and from the addresses that are actually served
// (`servedAlbumJournalAddresses`, the sitemap's rule), so the Home lists
// exactly the album journals whose page answers, and links to each by its
// current address. The rows carry what the public album-journal page already
// shows, and nothing else: no entry id, no status, no deletion state, no
// count, no unpublished language, and no writing.

/** How many journals "Recently written" lists (the approved screen: five). */
export const HOME_RECENT_LIMIT = 5;

/** How many albums the Home shows (the approved screen: four). */
export const HOME_ALBUM_LIMIT = 4;

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

export interface PublicHome {
  /** Every publicly visible album journal, the most recently published first. */
  recent: PublicJournalCard[];
  /** Each album once, by its presented journal (ADR 0002, D1.2). */
  albums: PublicJournalCard[];
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

/**
 * The most recently published album journals, each at its served address,
 * with the publication date of the version a reader of `readerLocale` is
 * shown. Several journals about one album are each listed: they are separate
 * pieces of writing (docs/design-system.md § Featured journal).
 */
export async function listRecentPublicAlbumJournals(
  db: DatabaseExecutor,
  readerLocale: Locale,
  limit: number = HOME_RECENT_LIMIT,
): Promise<PublicJournalCard[]> {
  const result = await db.execute<CardRow>(sql`
    with shown as (
      select served.entry_id, served.slug, version.published_at
        from (${servedAlbumJournalAddresses}) served
       cross join lateral (
         select pv.published_at
           from (${publicLanguageVersions}) pv
          where pv.entry_id = served.entry_id
          order by ${versionPreference(readerLocale)}
          limit 1
       ) version
    )
    select shown.slug, shown.published_at, ${cardColumns}
      from shown
      join album_journals aj on aj.entry_id = shown.entry_id
      join albums a on a.id = aj.album_id
     order by shown.published_at desc, shown.slug asc
     limit ${limit}`);
  return result.rows.map(toCard);
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

/** What the Home shows. `readerLocale` selects versions only, never journals. */
export async function getPublicHome(
  db: DatabaseExecutor,
  readerLocale: Locale,
): Promise<PublicHome> {
  return {
    recent: await listRecentPublicAlbumJournals(db, readerLocale),
    albums: await listPublicAlbums(db, readerLocale),
  };
}
