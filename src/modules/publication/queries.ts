import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, EntryKind, Locale } from "@/db";

import {
  publicLanguageVersions,
  publicTrackReflectionTexts,
} from "./predicate";

// Public read queries. Each one applies the publication predicate in SQL and
// returns a projection without private fields: no status, no deletion state,
// no unpublished language, and no unpublished track reflection.

// Drizzle's node-postgres driver returns timestamptz values from raw SQL as
// PostgreSQL text (for example "2026-01-10 00:00:00+00"), which always
// carries an explicit offset.
function parseTimestamp(value: string): Date {
  return new Date(value);
}

export type JournalSubject =
  { kind: "album"; albumId: string } | { kind: "artist"; artistId: string };

export interface PresentedJournal {
  entryId: string;
  /** The language version to show for the reader's interface language. */
  locale: Locale;
}

const journalTables = {
  album: { table: sql.identifier("album_journals"), column: "album_id" },
  artist: { table: sql.identifier("artist_journals"), column: "artist_id" },
} as const;

/**
 * The journal presented publicly for an album or artist (ADR 0002, D1.2):
 *
 * 1. the featured journal, if it is publicly visible in any language;
 * 2. otherwise the publicly visible journal with the most recent
 *    `published_at` among its visible versions, ties broken by lowest id;
 * 3. otherwise none.
 *
 * `readerLocale` never changes which journal is chosen. It selects only the
 * version: the reader's language if visible, otherwise the original if
 * visible, otherwise the remaining visible version.
 */
export async function resolvePresentedJournal(
  db: DatabaseExecutor,
  subject: JournalSubject,
  readerLocale: Locale,
): Promise<PresentedJournal | null> {
  const { table, column } = journalTables[subject.kind];
  const subjectId =
    subject.kind === "album" ? subject.albumId : subject.artistId;

  const result = await db.execute<{ entry_id: string; locale: Locale }>(sql`
    with public_versions as (${publicLanguageVersions}),
    candidates as (
      select j.entry_id, j.is_featured,
             max(pv.published_at) as latest_published_at
        from ${table} j
        join public_versions pv on pv.entry_id = j.entry_id
       where j.${sql.identifier(column)} = ${subjectId}
       group by j.entry_id, j.is_featured
    ),
    chosen as (
      select entry_id
        from candidates
       order by is_featured desc, latest_published_at desc, entry_id asc
       limit 1
    )
    select chosen.entry_id, version.locale
      from chosen
     cross join lateral (
       select pv.locale
         from public_versions pv
        where pv.entry_id = chosen.entry_id
        order by (pv.locale = ${readerLocale}) desc, pv.is_original desc,
                 pv.locale asc
        limit 1
     ) version`);

  const row = result.rows[0];
  return row ? { entryId: row.entry_id, locale: row.locale } : null;
}

export interface PublicLanguageVersionSummary {
  locale: Locale;
  isOriginal: boolean;
  publishedAt: Date;
}

/**
 * The publicly visible language versions of an entry, original first. A
 * translation appears here, and so may be linked or mentioned, only when it
 * is itself publicly visible (ADR 0002, INV-3).
 */
export async function listPublicLanguageVersions(
  db: DatabaseExecutor,
  entryId: string,
): Promise<PublicLanguageVersionSummary[]> {
  const result = await db.execute<{
    locale: Locale;
    is_original: boolean;
    published_at: string;
  }>(sql`
    select pv.locale, pv.is_original, pv.published_at
      from (${publicLanguageVersions}) pv
     where pv.entry_id = ${entryId}
     order by pv.is_original desc, pv.locale asc`);

  return result.rows.map((row) => ({
    locale: row.locale,
    isOriginal: row.is_original,
    publishedAt: parseTimestamp(row.published_at),
  }));
}

export interface PublicLanguageVersion {
  entryId: string;
  kind: EntryKind;
  locale: Locale;
  isOriginal: boolean;
  publishedAt: Date;
  title: string | null;
  opening: string | null;
  body: unknown;
  marginNote: string | null;
}

/** One language version's public content, or null if it is not visible. */
export async function getPublicLanguageVersion(
  db: DatabaseExecutor,
  entryId: string,
  locale: Locale,
): Promise<PublicLanguageVersion | null> {
  const result = await db.execute<{
    entry_id: string;
    kind: EntryKind;
    locale: Locale;
    is_original: boolean;
    published_at: string;
    title: string | null;
    opening: string | null;
    body: unknown;
    margin_note: string | null;
  }>(sql`
    select pv.entry_id, pv.kind, pv.locale, pv.is_original, pv.published_at,
           t.title, t.opening, t.body, t.margin_note
      from (${publicLanguageVersions}) pv
      join entry_texts t on t.entry_id = pv.entry_id and t.locale = pv.locale
     where pv.entry_id = ${entryId}
       and pv.locale = ${locale}`);

  const row = result.rows[0];
  return row
    ? {
        entryId: row.entry_id,
        kind: row.kind,
        locale: row.locale,
        isOriginal: row.is_original,
        publishedAt: parseTimestamp(row.published_at),
        title: row.title,
        opening: row.opening,
        body: row.body,
        marginNote: row.margin_note,
      }
    : null;
}

export interface PublicTrackReflection {
  trackReflectionId: string;
  trackId: string;
  trackTitle: string;
  /** Shown as the "still writing" label; it never decides visibility. */
  isStillWriting: boolean;
  isFavourite: boolean;
  ratingHalfSteps: number | null;
  body: unknown;
}

/**
 * The publicly visible track reflections of an album journal in one
 * language, in reference-edition order. Reflections on recordings missing
 * from the reference edition follow the ordered tracks.
 */
export async function listPublicTrackReflections(
  db: DatabaseExecutor,
  albumJournalId: string,
  locale: Locale,
): Promise<PublicTrackReflection[]> {
  const result = await db.execute<{
    track_reflection_id: string;
    track_id: string;
    track_title: string;
    is_still_writing: boolean;
    is_favourite: boolean;
    rating_half_steps: number | null;
    body: unknown;
  }>(sql`
    select visible.track_reflection_id, visible.track_id,
           t.title as track_title, tr.is_still_writing, tr.is_favourite,
           tr.rating_half_steps, trt.body
      from (${publicTrackReflectionTexts}) visible
      join track_reflections tr on tr.id = visible.track_reflection_id
      join track_reflection_texts trt
        on trt.track_reflection_id = visible.track_reflection_id
       and trt.locale = visible.locale
      join tracks t on t.id = visible.track_id
      left join album_editions ed
        on ed.album_id = tr.album_id and ed.is_reference
      left join edition_tracks et
        on et.edition_id = ed.id and et.track_id = visible.track_id
     where visible.album_journal_id = ${albumJournalId}
       and visible.locale = ${locale}
     order by et.disc_number asc nulls last, et.position asc nulls last,
              t.title asc, visible.track_reflection_id asc`);

  return result.rows.map((row) => ({
    trackReflectionId: row.track_reflection_id,
    trackId: row.track_id,
    trackTitle: row.track_title,
    isStillWriting: row.is_still_writing,
    isFavourite: row.is_favourite,
    ratingHalfSteps: row.rating_half_steps,
    body: row.body,
  }));
}

export type SlugResolution =
  | { outcome: "found"; entryId: string }
  | { outcome: "redirect"; currentSlug: string }
  | { outcome: "not_found" };

const notFound: SlugResolution = { outcome: "not_found" };

/**
 * Resolves a public slug (ADR 0002, D7.5 and INV-5). A current slug of a
 * publicly visible entry is found; a previous slug of a publicly visible
 * entry redirects (308) to the current slug. Every other case, including the
 * slugs of draft, private, and deleted entries, returns exactly the same
 * `not_found` result as an unknown slug, so nothing about the entry leaks.
 */
export async function resolvePublicSlug(
  db: DatabaseExecutor,
  kind: EntryKind,
  slug: string,
): Promise<SlugResolution> {
  const result = await db.execute<{
    entry_id: string;
    is_current: boolean;
    current_slug: string;
  }>(sql`
    select requested.entry_id, requested.is_current,
           current_slug.slug as current_slug
      from entry_slugs requested
      join entry_slugs current_slug
        on current_slug.entry_id = requested.entry_id
       and current_slug.is_current
     where requested.kind = ${kind}
       and requested.slug = ${slug}
       and exists (select 1
                     from (${publicLanguageVersions}) pv
                    where pv.entry_id = requested.entry_id)`);

  const row = result.rows[0];
  if (!row) {
    return notFound;
  }
  return row.is_current
    ? { outcome: "found", entryId: row.entry_id }
    : { outcome: "redirect", currentSlug: row.current_slug };
}
