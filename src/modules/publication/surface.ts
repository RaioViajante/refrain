import "server-only";

import { sql, type SQL } from "drizzle-orm";

import type {
  DatabaseExecutor,
  EntryKind,
  Locale,
  VisibilityStatus,
} from "@/db";

import { canonicalJson } from "./disclosure";
import { PublicationError } from "./errors";

// The public surface of one album journal and the exposure delta of a change
// (ADR 0006 §§ 1 and 5). Internal to the Publication module.
//
// `readEntrySurface` reads the raw rows. `publicAtoms` says which atoms a
// reader can see in that state, by the rules of the publication predicate
// (docs/security.md § Publication predicate): the entry is not deleted, a
// language version is public through its own `published` status, a track
// reflection is public in a language only through its own flag, a parent
// version that is public in that language, and a text in that language.
// `applyChange` says what the rows will be after a proposed change, so the
// delta can be shown, and bound to a confirmation, before anything is written.
// The save then compares what it really wrote with that prediction.
//
// "Still writing" and "featured" play no part in visibility (INV-1, INV-2).
// Catalog wording (track titles) is not an atom: the documented gap C11.

/** One language version of the entry, as stored. */
export interface SurfaceVersion {
  locale: Locale;
  isOriginal: boolean;
  status: VisibilityStatus;
  /** `updated_at`, UTC with microseconds. */
  updatedAt: string;
  title: string | null;
  opening: string | null;
  marginNote: string | null;
  body: unknown;
  bodyText: string;
}

/** One track reflection, as stored. A text row means text (ADR 0006 § 1). */
export interface SurfaceReflection {
  trackId: string;
  isPublished: boolean;
  isStillWriting: boolean;
  isFavourite: boolean;
  ratingHalfSteps: number | null;
  /** The stored document per language, for every language that has a text row. */
  texts: Partial<Record<Locale, unknown>>;
}

export interface EntrySurface {
  entryId: string;
  kind: EntryKind;
  deleted: boolean;
  version: number;
  /** `entries.updated_at`, UTC with microseconds. */
  updatedAt: string;
  /** The database clock when this state was read, in milliseconds. */
  nowMs: number;
  versions: SurfaceVersion[];
  albumRating: number | null;
  /** In track id order. */
  reflections: SurfaceReflection[];
}

/** A text as the save will store it: the document and its plain-text projection. */
export interface ProposedText {
  document: unknown;
  text: string;
}

export interface ProposedReflection {
  trackId: string;
  isPublished?: boolean;
  isStillWriting?: boolean;
  isFavourite?: boolean;
  ratingHalfSteps?: number | null;
  /** A language set to `null` has its text removed. Others are untouched. */
  texts?: Partial<Record<Locale, ProposedText | null>>;
}

/**
 * What a save would change, already validated and normalized by the Journals
 * module. A field left out is unchanged.
 */
export interface ProposedChange {
  version?: {
    locale: Locale;
    opening?: string | null;
    body?: ProposedText | null;
  };
  albumRating?: number | null;
  reflections?: ProposedReflection[];
}

/** What the delta says about one atom. */
export type ExposureSubject =
  | {
      type: "version";
      locale: Locale;
      field: "title" | "opening" | "marginNote" | "body";
    }
  | { type: "albumRating" }
  | {
      type: "reflection";
      trackId: string;
      locale: Locale;
      field: "text" | "favourite" | "rating" | "stillWriting";
    };

/**
 * An atom a reader can see after the change and could not see, or saw
 * differently, before. `before` is private writing and is returned only to a
 * request that passed authorization; it is never logged.
 */
export interface ExposureChange {
  atom: string;
  kind: "added" | "edited";
  subject: ExposureSubject;
  before?: unknown;
  after: unknown;
}

export interface PublicChangeDelta {
  entryId: string;
  /** `entries.version` the delta was computed at. */
  entryVersion: number;
  changes: ExposureChange[];
}

// UTC text with microseconds, so the connection's TimeZone cannot change it.
const utcText = (column: SQL) =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/**
 * Reads the rows of one album journal. Takes no lock: the caller takes the
 * entry lock first when it must decide on what it reads (the save), and reads
 * inside one snapshot when it must not (the preview). `entry_not_found` for an
 * unknown entry.
 */
export async function readEntrySurface(
  db: DatabaseExecutor,
  entryId: string,
): Promise<EntrySurface> {
  const head = await db.execute<{
    kind: EntryKind;
    deleted: boolean;
    version: number;
    updated_at: string;
    now_ms: string;
  }>(sql`
    select e.kind, e.deleted_at is not null as deleted, e.version,
           ${utcText(sql`e.updated_at`)} as updated_at,
           floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
             as now_ms
      from entries e
     where e.id = ${entryId}`);
  const entry = head.rows[0];
  if (!entry) {
    throw new PublicationError("entry_not_found");
  }

  const versions = await db.execute<{
    locale: Locale;
    is_original: boolean;
    status: VisibilityStatus;
    updated_at: string;
    title: string | null;
    opening: string | null;
    margin_note: string | null;
    body: unknown;
    body_text: string;
  }>(sql`
    select t.locale, t.is_original, t.status,
           ${utcText(sql`t.updated_at`)} as updated_at,
           t.title, t.opening, t.margin_note, t.body, t.body_text
      from entry_texts t
     where t.entry_id = ${entryId}
     order by t.locale`);

  let albumRating: number | null = null;
  const reflections: SurfaceReflection[] = [];
  if (entry.kind === "album_journal") {
    const journal = await db.execute<{ rating_half_steps: number | null }>(
      sql`select rating_half_steps from album_journals
           where entry_id = ${entryId}`,
    );
    albumRating = journal.rows[0]?.rating_half_steps ?? null;

    const rows = await db.execute<{
      id: string;
      track_id: string;
      is_published: boolean;
      is_still_writing: boolean;
      is_favourite: boolean;
      rating_half_steps: number | null;
    }>(sql`
      select id, track_id, is_published, is_still_writing, is_favourite,
             rating_half_steps
        from track_reflections
       where album_journal_id = ${entryId}
       order by track_id`);
    const texts = await db.execute<{
      track_reflection_id: string;
      locale: Locale;
      body: unknown;
    }>(sql`
      select trt.track_reflection_id, trt.locale, trt.body
        from track_reflection_texts trt
        join track_reflections tr on tr.id = trt.track_reflection_id
       where tr.album_journal_id = ${entryId}`);
    for (const row of rows.rows) {
      const own: Partial<Record<Locale, unknown>> = {};
      for (const text of texts.rows) {
        if (text.track_reflection_id === row.id) {
          own[text.locale] = text.body;
        }
      }
      reflections.push({
        trackId: row.track_id,
        isPublished: row.is_published,
        isStillWriting: row.is_still_writing,
        isFavourite: row.is_favourite,
        ratingHalfSteps: row.rating_half_steps,
        texts: own,
      });
    }
  }

  return {
    entryId,
    kind: entry.kind,
    deleted: entry.deleted,
    version: entry.version,
    updatedAt: entry.updated_at,
    nowMs: Number(entry.now_ms),
    versions: versions.rows.map((row) => ({
      locale: row.locale,
      isOriginal: row.is_original,
      status: row.status,
      updatedAt: row.updated_at,
      title: row.title,
      opening: row.opening,
      marginNote: row.margin_note,
      body: row.body,
      bodyText: row.body_text,
    })),
    albumRating,
    reflections,
  };
}

/**
 * The atoms a reader can see in this state (ADR 0006 § 1), by key. Empty when
 * the entry is deleted or no language version is published. The address is
 * not an atom here: changing it is exempt from this confirmation (ADR 0006
 * § 5), and the publication fingerprint binds it.
 */
export function publicAtoms(surface: EntrySurface): Map<string, unknown> {
  const atoms = new Map<string, unknown>();
  if (surface.deleted) {
    return atoms;
  }
  const publicVersions = surface.versions.filter(
    (version) => version.status === "published",
  );
  if (publicVersions.length === 0) {
    return atoms;
  }
  for (const version of publicVersions) {
    atoms.set(`version|${version.locale}|title`, version.title);
    atoms.set(`version|${version.locale}|opening`, version.opening);
    atoms.set(`version|${version.locale}|marginNote`, version.marginNote);
    // The canonical document, not only the text, so a formatting-only edit
    // is caught.
    atoms.set(`version|${version.locale}|body`, version.body);
  }
  if (surface.kind === "album_journal" && surface.albumRating !== null) {
    atoms.set("albumRating", surface.albumRating);
  }
  for (const reflection of surface.reflections) {
    if (!reflection.isPublished) {
      continue;
    }
    for (const version of publicVersions) {
      if (!(version.locale in reflection.texts)) {
        continue;
      }
      const key = `reflection|${reflection.trackId}|${version.locale}`;
      atoms.set(`${key}|text`, reflection.texts[version.locale]);
      atoms.set(`${key}|favourite`, reflection.isFavourite);
      atoms.set(`${key}|rating`, reflection.ratingHalfSteps);
      atoms.set(`${key}|stillWriting`, reflection.isStillWriting);
    }
  }
  return atoms;
}

/** The rows after `change`, without writing anything. */
export function applyChange(
  surface: EntrySurface,
  change: ProposedChange,
): EntrySurface {
  const next: EntrySurface = {
    ...surface,
    versions: surface.versions.map((version) => {
      if (change.version?.locale !== version.locale) {
        return version;
      }
      const edit = change.version;
      return {
        ...version,
        ...(edit.opening !== undefined ? { opening: edit.opening } : {}),
        ...(edit.body !== undefined
          ? {
              body: edit.body?.document ?? null,
              bodyText: edit.body?.text ?? "",
            }
          : {}),
      };
    }),
    albumRating:
      change.albumRating !== undefined
        ? change.albumRating
        : surface.albumRating,
    reflections: surface.reflections.map((reflection) => ({
      ...reflection,
      texts: { ...reflection.texts },
    })),
  };
  for (const proposed of change.reflections ?? []) {
    let reflection = next.reflections.find(
      (candidate) => candidate.trackId === proposed.trackId,
    );
    if (!reflection) {
      reflection = {
        trackId: proposed.trackId,
        isPublished: false,
        isStillWriting: false,
        isFavourite: false,
        ratingHalfSteps: null,
        texts: {},
      };
      next.reflections.push(reflection);
    }
    if (proposed.isPublished !== undefined) {
      reflection.isPublished = proposed.isPublished;
    }
    if (proposed.isStillWriting !== undefined) {
      reflection.isStillWriting = proposed.isStillWriting;
    }
    if (proposed.isFavourite !== undefined) {
      reflection.isFavourite = proposed.isFavourite;
    }
    if (proposed.ratingHalfSteps !== undefined) {
      reflection.ratingHalfSteps = proposed.ratingHalfSteps;
    }
    for (const locale of Object.keys(proposed.texts ?? {}) as Locale[]) {
      const text = proposed.texts![locale];
      if (text === null || text === undefined) {
        delete reflection.texts[locale];
      } else {
        reflection.texts[locale] = text.document;
      }
    }
  }
  return next;
}

function subjectOf(key: string): ExposureSubject {
  const parts = key.split("|");
  if (parts[0] === "albumRating") {
    return { type: "albumRating" };
  }
  if (parts[0] === "version") {
    return {
      type: "version",
      locale: parts[1] as Locale,
      field: parts[2] as "title" | "opening" | "marginNote" | "body",
    };
  }
  return {
    type: "reflection",
    trackId: parts[1]!,
    locale: parts[2] as Locale,
    field: parts[3] as "text" | "favourite" | "rating" | "stillWriting",
  };
}

/**
 * The exposure delta (ADR 0006 § 5): the atoms that are public after and were
 * not public before (additions), or were public with another value (edits),
 * in a fixed order. A removal is not part of it, and neither is a save whose
 * canonical values are identical. Any difference counts, a shorter text and a
 * cleared field included.
 */
export function exposureDelta(
  before: Map<string, unknown>,
  after: Map<string, unknown>,
): ExposureChange[] {
  const changes: ExposureChange[] = [];
  for (const key of [...after.keys()].sort()) {
    const next = after.get(key);
    if (!before.has(key)) {
      changes.push({
        atom: key,
        kind: "added",
        subject: subjectOf(key),
        after: next,
      });
    } else if (canonicalJson(before.get(key)) !== canonicalJson(next)) {
      changes.push({
        atom: key,
        kind: "edited",
        subject: subjectOf(key),
        before: before.get(key),
        after: next,
      });
    }
  }
  return changes;
}

/**
 * Whether two states show the reader exactly the same thing. The save uses it
 * to check that what it wrote is what it predicted.
 */
export function samePublicAtoms(a: EntrySurface, b: EntrySurface): boolean {
  const left = publicAtoms(a);
  const right = publicAtoms(b);
  return (
    left.size === right.size &&
    [...left].every(
      ([key, value]) =>
        right.has(key) &&
        canonicalJson(right.get(key)) === canonicalJson(value),
    )
  );
}

/**
 * A language version that is public must stay publishable: its opening
 * sentence or its body keeps non-whitespace content (ADR 0006 § 5, owner
 * decision R1). Checked on the versions the change touches.
 */
export function publicVersionsStayPublishable(
  predicted: EntrySurface,
  change: ProposedChange,
): boolean {
  const filled = (text: string | null) =>
    text !== null && /\P{White_Space}/u.test(text);
  return predicted.versions
    .filter(
      (version) =>
        version.status === "published" &&
        change.version?.locale === version.locale,
    )
    .every((version) => filled(version.opening) || filled(version.bodyText));
}
