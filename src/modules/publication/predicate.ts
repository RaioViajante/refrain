import "server-only";

import { sql } from "drizzle-orm";

// The publication predicate (docs/security.md § Publication predicate),
// defined once. Every public query in this module selects writing through
// these fragments, and nothing else decides public visibility.
//
// "Still writing" (track_reflections.is_still_writing) and "featured" play no
// part in visibility, so neither appears here (ADR 0002, D1.2 and D5.1).

/**
 * The publicly visible language versions: the entry is not deleted and that
 * version's own status is `published`. A translation is visible only through
 * its own row, never because the original is published (ADR 0002, D3.2).
 *
 * Columns: entry_id, kind, locale, is_original, published_at.
 */
export const publicLanguageVersions = sql`
  select t.entry_id, e.kind, t.locale, t.is_original, t.published_at
    from entry_texts t
    join entries e on e.id = t.entry_id
   where e.deleted_at is null
     and t.status = 'published'`;

/**
 * The publicly visible track-reflection texts: the reflection is explicitly
 * authorized (`is_published`), the parent journal's version in the same
 * language is publicly visible, and a text exists in that language
 * (ADR 0002, D5.2).
 *
 * Columns: track_reflection_id, album_journal_id, track_id, locale.
 */
export const publicTrackReflectionTexts = sql`
  select tr.id as track_reflection_id, tr.album_journal_id, tr.track_id,
         trt.locale
    from track_reflections tr
    join track_reflection_texts trt on trt.track_reflection_id = tr.id
    join (${publicLanguageVersions}) pv
      on pv.entry_id = tr.album_journal_id
     and pv.locale = trt.locale
   where tr.is_published`;
