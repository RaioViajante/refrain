import "server-only";

import { sql } from "drizzle-orm";

import type { VisibilityStatus } from "@/db";

// The publication predicate (docs/security.md § Publication predicate),
// defined once. Every public query in this module selects writing through
// these fragments, and nothing else decides public visibility.
//
// "Still writing" (track_reflections.is_still_writing) and "featured" play no
// part in visibility, so neither appears here (ADR 0002, D1.2 and D5.1).
//
// The fragments are parameterized by the status a language version must have
// (ADR 0006 § 2). That exists for one reason: the publication disclosure asks
// "what would a reader see if this version were published?", and answers it
// with the same SQL as the public queries, so the two cannot disagree. The
// live public queries use only the two constants at the bottom of this file,
// which fix the status to `published`. A public route never passes a status:
// nothing outside this module can reach the builders.

/**
 * The language versions that have `status`, on entries that are not deleted.
 * With `published` these are the publicly visible versions: a translation is
 * visible only through its own row, never because the original is published
 * (ADR 0002, D3.2).
 *
 * Columns: entry_id, kind, locale, is_original, published_at.
 */
export function languageVersionsWithStatus(status: VisibilityStatus) {
  return sql`
  select t.entry_id, e.kind, t.locale, t.is_original, t.published_at
    from entry_texts t
    join entries e on e.id = t.entry_id
   where e.deleted_at is null
     and t.status = ${status}`;
}

/**
 * The track-reflection texts that are visible in each language version that
 * has `status`: the reflection is explicitly authorized (`is_published`), the
 * parent journal's version in the same language has that status (and the
 * entry is not deleted), and a text exists in that language (ADR 0002, D5.2).
 *
 * Columns: track_reflection_id, album_journal_id, track_id, locale.
 */
export function trackReflectionTextsWithStatus(status: VisibilityStatus) {
  return sql`
  select tr.id as track_reflection_id, tr.album_journal_id, tr.track_id,
         trt.locale
    from track_reflections tr
    join track_reflection_texts trt on trt.track_reflection_id = tr.id
    join (${languageVersionsWithStatus(status)}) pv
      on pv.entry_id = tr.album_journal_id
     and pv.locale = trt.locale
   where tr.is_published`;
}

/**
 * The publicly visible language versions: the entry is not deleted and that
 * version's own status is `published`.
 *
 * Columns: entry_id, kind, locale, is_original, published_at.
 */
export const publicLanguageVersions = languageVersionsWithStatus("published");

/**
 * The publicly visible track-reflection texts: the reflection is explicitly
 * authorized (`is_published`), the parent journal's version in the same
 * language is publicly visible, and a text exists in that language
 * (ADR 0002, D5.2).
 *
 * Columns: track_reflection_id, album_journal_id, track_id, locale.
 */
export const publicTrackReflectionTexts =
  trackReflectionTextsWithStatus("published");
