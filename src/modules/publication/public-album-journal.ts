import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Locale } from "@/db";
import { coverArtworkOf } from "@/integrations/cover-art-archive";

import { publicLanguageVersions } from "./predicate";
import {
  getPublicLanguageVersion,
  listPublicLanguageVersions,
  listPublicTrackReflections,
  servedAlbumJournalAddresses,
  type PublicLanguageVersionSummary,
  type PublicTrackReflection,
} from "./queries";

// The read model of a public album-journal page (M3.1). Every query here
// selects through the publication predicate (`predicate.ts`) and returns only
// what a reader may see: no status, no deletion state, no unpublished
// language, and no unpublished track reflection. The route never decides
// visibility, and the catalog facts (album, credits, track list) are read only
// in the context of a publicly visible language version, as the Security
// document requires.

/**
 * The version to show (ADR 0002, D1.2): the reader's language if it is
 * visible, otherwise the original if visible, otherwise the remaining visible
 * version. `versions` holds visible versions only, original first.
 */
export function choosePublicVersion(
  versions: readonly PublicLanguageVersionSummary[],
  readerLocale: Locale,
): PublicLanguageVersionSummary | null {
  return (
    versions.find((version) => version.locale === readerLocale) ??
    versions.find((version) => version.isOriginal) ??
    versions[0] ??
    null
  );
}

export interface PublicCredit {
  name: string;
}

export interface PublicJournalTrack {
  // No database id: a page must not carry an internal identifier (not even as
  // a React key), and the position is what identifies a row to a reader.
  /** Position in the displayed list, starting at 1. */
  number: number;
  title: string;
  /** The track's own credit when the catalog has one (for example a cover). */
  credit: string | null;
  /** The reflection, only when it is explicitly public in this language. */
  reflection: {
    body: unknown;
    isStillWriting: boolean;
    isFavourite: boolean;
    ratingHalfSteps: number | null;
  } | null;
}

export interface PublicAlbumJournal {
  entryId: string;
  locale: Locale;
  isOriginal: boolean;
  publishedAt: Date;
  opening: string | null;
  body: unknown;
  marginNote: string | null;
  /** The journal's rating, in half steps (0 to 10), when one is set. */
  ratingHalfSteps: number | null;
  album: {
    title: string;
    firstReleaseYear: number | null;
    label: string | null;
    /**
     * The cover the author chose (M3.2): image sources built from the one
     * stored form, or null for the fallback. Never a stored address.
     */
    artwork: PublicArtwork | null;
  };
  credits: PublicCredit[];
  tracks: PublicJournalTrack[];
}

/** A Cover Art Archive image: a 500 px `src` and a 250/500/1200 `srcSet`. */
export interface PublicArtwork {
  src: string;
  srcSet: string;
}

interface FrameRow extends Record<string, unknown> {
  rating_half_steps: number | null;
  album_title: string;
  first_release_year: number | null;
  label: string | null;
  cover_url: string | null;
  cover_source: string | null;
}

interface CreditRow extends Record<string, unknown> {
  name: string;
}

interface TrackRow extends Record<string, unknown> {
  track_id: string;
  title: string;
  credit: string | null;
}

/**
 * The public page of an album journal, or null when no language version of
 * the entry is publicly visible. `readerLocale` selects the version only.
 */
export async function getPublicAlbumJournal(
  db: DatabaseExecutor,
  entryId: string,
  readerLocale: Locale,
): Promise<PublicAlbumJournal | null> {
  const chosen = choosePublicVersion(
    await listPublicLanguageVersions(db, entryId),
    readerLocale,
  );
  if (!chosen) {
    return null;
  }
  const version = await getPublicLanguageVersion(db, entryId, chosen.locale);
  if (!version || version.kind !== "album_journal") {
    return null;
  }

  // Each statement below starts from the visible language version, so a
  // journal that stopped being visible between statements yields nothing.
  const frame = await db.execute<FrameRow>(sql`
    select aj.rating_half_steps, a.title as album_title,
           a.first_release_year, ed.label, a.cover_url, a.cover_source
      from (${publicLanguageVersions}) pv
      join album_journals aj on aj.entry_id = pv.entry_id
      join albums a on a.id = aj.album_id
      left join album_editions ed on ed.album_id = a.id and ed.is_reference
     where pv.entry_id = ${entryId} and pv.locale = ${version.locale}`);
  const frameRow = frame.rows[0];
  if (!frameRow) {
    return null;
  }

  const credits = await db.execute<CreditRow>(sql`
    select coalesce(aa.credited_as, ar.name) as name
      from (${publicLanguageVersions}) pv
      join album_journals aj on aj.entry_id = pv.entry_id
      join album_artists aa on aa.album_id = aj.album_id
      join artists ar on ar.id = aa.artist_id
     where pv.entry_id = ${entryId} and pv.locale = ${version.locale}
     order by aa.position asc`);

  const listed = await db.execute<TrackRow>(sql`
    select t.id as track_id, t.title, t.credit
      from (${publicLanguageVersions}) pv
      join album_journals aj on aj.entry_id = pv.entry_id
      join album_editions ed on ed.album_id = aj.album_id and ed.is_reference
      join edition_tracks et on et.edition_id = ed.id
      join tracks t on t.id = et.track_id
     where pv.entry_id = ${entryId} and pv.locale = ${version.locale}
     order by et.disc_number asc, et.position asc`);

  const reflections = await listPublicTrackReflections(
    db,
    entryId,
    version.locale,
  );

  return {
    entryId,
    locale: version.locale,
    isOriginal: version.isOriginal,
    publishedAt: version.publishedAt,
    opening: version.opening,
    body: version.body,
    marginNote: version.marginNote,
    ratingHalfSteps: frameRow.rating_half_steps,
    album: {
      title: frameRow.album_title,
      firstReleaseYear: frameRow.first_release_year,
      label: frameRow.label,
      artwork: publicArtworkOf(frameRow.cover_url, frameRow.cover_source),
    },
    credits: credits.rows.map((row) => ({ name: row.name })),
    tracks: mergeTracks(listed.rows, reflections),
  };
}

/**
 * The album's artwork as a page may show it: only the image sources, and only
 * for a stored cover in the exact form Refrain writes. Anything else in those
 * columns shows the fallback, never an address taken from the database.
 */
export function publicArtworkOf(
  coverUrl: string | null,
  coverSource: string | null,
): PublicArtwork | null {
  const artwork = coverArtworkOf(coverUrl, coverSource);
  return artwork ? { src: artwork.src, srcSet: artwork.srcSet } : null;
}

/**
 * The reference edition's tracks in order, each with its public reflection if
 * it has one. A public reflection on a recording missing from the reference
 * edition follows the listed tracks, as `listPublicTrackReflections` orders
 * them. A track whose reflection is not public shows no reflection at all, so
 * a page never says that one exists.
 */
export function mergeTracks(
  listed: readonly TrackRow[],
  reflections: readonly PublicTrackReflection[],
): PublicJournalTrack[] {
  const byTrack = new Map(reflections.map((r) => [r.trackId, r]));
  const used = new Set<string>();
  const rows: Omit<PublicJournalTrack, "number">[] = [];

  for (const track of listed) {
    const reflection = byTrack.get(track.track_id);
    if (reflection) {
      used.add(track.track_id);
    }
    rows.push({
      title: track.title,
      credit: track.credit,
      reflection: reflection ? toPublicReflection(reflection) : null,
    });
  }
  for (const reflection of reflections) {
    if (!used.has(reflection.trackId)) {
      rows.push({
        title: reflection.trackTitle,
        credit: null,
        reflection: toPublicReflection(reflection),
      });
    }
  }
  return rows.map((row, index) => ({ ...row, number: index + 1 }));
}

function toPublicReflection(reflection: PublicTrackReflection) {
  return {
    body: reflection.body,
    isStillWriting: reflection.isStillWriting,
    isFavourite: reflection.isFavourite,
    ratingHalfSteps: reflection.ratingHalfSteps,
  };
}

/**
 * The current address of every publicly visible album journal, for the
 * sitemap. It lists exactly the addresses that `resolvePublicSlug` finds:
 * a current slug that was published, on an entry with a visible language
 * version. Nothing else about an entry is returned.
 */
export async function listPublicAlbumJournalAddresses(
  db: DatabaseExecutor,
): Promise<string[]> {
  const result = await db.execute<{ slug: string }>(sql`
    select served.slug
      from (${servedAlbumJournalAddresses}) served
     order by served.slug asc`);
  return result.rows.map((row) => row.slug);
}
