import type { TrackDraft } from "@/app/studio/journals/track-by-track";
import type { TrackByTrackItem } from "@/modules/journals";

type Language = "en" | "pt-BR";

const LANGUAGES: readonly Language[] = ["en", "pt-BR"];

/**
 * What the server treats as no text (src/modules/journals/input.ts): only
 * white space and invisible characters. Such a text is removed, not saved.
 */
const INVISIBLE_ONLY = /^[\p{White_Space}​-‍⁠﻿]*$/u;

function filled(text: string): boolean {
  return !INVISIBLE_ONLY.test(text);
}

/** One thing a save would take away from what readers see. */
export type JournalRemoval =
  | { kind: "albumRating" }
  | { kind: "reflection"; trackId: string; title: string; locale: Language };

/**
 * What a save of an album journal takes away from its public page (issue #54;
 * ADR 0006 § 5): a reflection that stops being shown in a published language,
 * because it is no longer set to be included or because its text in that
 * language is cleared, and the album rating, when it is cleared while any
 * version is published. A removal needs no token, so the server's change
 * preview never lists one; this is derived from the editor's saved state and
 * from what the save sends, never from the server's delta.
 *
 * It mirrors the public atoms of the Publication module: a reflection is seen
 * in a language when it is set to be included, has text in that language, and
 * that language version is published.
 */
export function journalRemovals({
  published,
  editing,
  tracks,
  base,
  sent,
}: {
  /** The language versions that are published, as the editor showed them. */
  published: readonly Language[];
  /** The language this editor writes: the only text a save can change. */
  editing: Language;
  tracks: readonly TrackByTrackItem[];
  base: { albumRating: number | null; drafts: Record<string, TrackDraft> };
  sent: { albumRating: number | null; drafts: Record<string, TrackDraft> };
}): JournalRemoval[] {
  if (published.length === 0) {
    return [];
  }
  const removals: JournalRemoval[] = [];
  if (base.albumRating !== null && sent.albumRating === null) {
    removals.push({ kind: "albumRating" });
  }
  for (const item of tracks) {
    const before = base.drafts[item.trackId];
    const after = sent.drafts[item.trackId];
    if (!before || !after) {
      continue;
    }
    const stored = item.reflection?.texts ?? {};
    // Whether the reflection has text in a language, before and after. Only
    // the editor's own language can change; a text the plain editor cannot
    // show (`null`) is there, and is never sent unless it is replaced.
    const hadText = (locale: Language) =>
      locale === editing
        ? filled(before.text) || stored[locale] === null
        : Object.hasOwn(stored, locale);
    const hasText = (locale: Language) =>
      locale === editing && after.text !== before.text
        ? filled(after.text)
        : hadText(locale);
    for (const locale of LANGUAGES) {
      if (!published.includes(locale)) {
        continue;
      }
      const seen = before.isPublished && hadText(locale);
      const stillSeen = after.isPublished && hasText(locale);
      if (seen && !stillSeen) {
        removals.push({
          kind: "reflection",
          trackId: item.trackId,
          title: item.title,
          locale,
        });
      }
    }
  }
  return removals;
}
