import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Locale, VisibilityStatus } from "@/db";
import type { AuthorizedAuthor } from "@/modules/identity";

import { editableText } from "./body";
import { journalId } from "./input";

// Memories in the Writing Studio (M3.6). Private writing: every query takes
// the AuthorizedAuthor that only the Identity module creates, and none may
// back a public page. Public reads go through the Publication module's
// predicate, and no public page shows a memory yet (M3.7).
//
// The catalog is read with SQL against the schema, as the album-journal
// queries do (docs/architecture.md, dependency rule 3); nothing here writes.

const EXCERPT_LENGTH = 160;

function toExcerpt(text: string): string {
  const characters = [...text];
  return characters.length > EXCERPT_LENGTH
    ? `${characters.slice(0, EXCERPT_LENGTH).join("").trimEnd()}…`
    : text;
}

export interface MemorySummary {
  entryId: string;
  /** The author's title for the memory. */
  title: string;
  /** "A date, a season, a year", shared by every language version. */
  rememberedWhen: string | null;
  /** The language the memory was written in. */
  locale: Locale;
  /** Visibility of that original language version. */
  status: VisibilityStatus;
  /** A preview of the writing, for studio lists only. Never public. */
  excerpt: string;
  wordCount: number;
  /** The linked recordings' titles, in the memory's order. */
  recordingTitles: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

type SummaryRow = {
  entry_id: string;
  title: string | null;
  remembered_when: string | null;
  locale: Locale;
  status: VisibilityStatus;
  excerpt: string;
  word_count: number;
  recording_titles: string[];
  version: number;
  created_at: string | Date;
  updated_at: string | Date;
  deleted_at: string | Date | null;
};

function toSummary(row: SummaryRow): MemorySummary {
  return {
    entryId: row.entry_id,
    // A memory always has a title (the commands require one). A row written
    // outside them is still listed, under a neutral label.
    title: row.title ?? "Untitled memory",
    rememberedWhen: row.remembered_when,
    locale: row.locale,
    status: row.status,
    excerpt: toExcerpt(row.excerpt),
    wordCount: row.word_count,
    recordingTitles: row.recording_titles,
    version: row.version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

const memorySummarySql = sql`
  select e.id as entry_id, o.title, m.remembered_when, o.locale, o.status,
         left(regexp_replace(btrim(o.body_text, E' \t\n'), '[[:space:]]+', ' ', 'g'),
              ${EXCERPT_LENGTH + 1}) as excerpt,
         coalesce(array_length(regexp_split_to_array(btrim(o.body_text, E' \t\n'), '[[:space:]]+'), 1), 0)
           * (btrim(o.body_text, E' \t\n') <> '')::int as word_count,
         coalesce((select json_agg(t.title order by mm.position)
                     from memory_music mm
                     join tracks t on t.id = mm.track_id
                    where mm.memory_id = e.id), '[]'::json) as recording_titles,
         e.version, e.created_at, e.updated_at, e.deleted_at
    from memories m
    join entries e     on e.id = m.entry_id
    join entry_texts o on o.entry_id = e.id and o.is_original`;

/**
 * The author's memories, newest edit first, not including those in Recently
 * deleted. Private and draft memories are included: a Writing Studio query.
 */
export async function listMemories(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<MemorySummary[]> {
  const result = await db.execute<SummaryRow>(sql`
    ${memorySummarySql}
    where e.deleted_at is null
    order by e.updated_at desc, e.id`);
  return result.rows.map(toSummary);
}

export interface DeletedMemorySummary extends MemorySummary {
  /** Every language version with the status it keeps in Recently deleted. */
  versions: { locale: Locale; isOriginal: boolean; status: VisibilityStatus }[];
}

/** Memories in Recently deleted, most recently deleted first. */
export async function listDeletedMemories(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<DeletedMemorySummary[]> {
  const result = await db.execute<
    SummaryRow & {
      versions: {
        locale: Locale;
        is_original: boolean;
        status: VisibilityStatus;
      }[];
    }
  >(sql`
    select s.*,
           (select coalesce(json_agg(json_build_object(
                     'locale', t.locale, 'is_original', t.is_original,
                     'status', t.status)
                   order by t.is_original desc, t.locale), '[]'::json)
              from entry_texts t where t.entry_id = s.entry_id) as versions
      from (${memorySummarySql} where e.deleted_at is not null) s
     order by s.deleted_at desc, s.entry_id`);
  return result.rows.map((row) => ({
    ...toSummary(row),
    versions: row.versions.map((version) => ({
      locale: version.locale,
      isOriginal: version.is_original,
      status: version.status,
    })),
  }));
}

/**
 * One recording linked from a memory, with the catalog facts that tell it
 * apart from another recording of the same name: its credited artists, the
 * albums it is on, and its length. Nothing is inferred: an empty list or
 * `null` means the catalog does not record it.
 */
export interface MemoryRecording {
  trackId: string;
  title: string;
  /** Credited artists, in credit order. */
  artists: { id: string; name: string }[];
  /** Titles of the albums the recording is on. */
  albums: string[];
  lengthMs: number | null;
  /** Archived in the catalog: the link is kept, and shown as plain text. */
  archived: boolean;
}

export interface MemoryDetail extends MemorySummary {
  /** The writing as plain text, or `null` when the plain editor cannot show it without loss. */
  body: string | null;
  versions: { locale: Locale; isOriginal: boolean; status: VisibilityStatus }[];
  /** The memory's current slug, reserved when it was created. Private. */
  slug: string | null;
  /** The linked recordings, in the memory's order. */
  recordings: MemoryRecording[];
  /**
   * Album links (allowed by the schema, never written by the studio). While
   * there is one, the recording list is shown but cannot be saved, so the
   * album link is never dropped by accident.
   */
  albumLinks: string[];
}

type RecordingRow = {
  track_id: string;
  title: string;
  artists: { id: string; name: string }[];
  albums: string[];
  length_ms: number | null;
  archived: boolean;
};

function toRecording(row: RecordingRow): MemoryRecording {
  return {
    trackId: row.track_id,
    title: row.title,
    artists: row.artists,
    albums: row.albums,
    lengthMs: row.length_ms,
    archived: row.archived,
  };
}

/**
 * One memory for editing, including one in Recently deleted (which the studio
 * shows read-only). `null` when it does not exist, or is another kind of
 * entry.
 */
export async function getMemory(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  entryId: string,
): Promise<MemoryDetail | null> {
  if (!journalId.safeParse(entryId).success) {
    return null;
  }
  const result = await db.execute<SummaryRow & { body: unknown }>(sql`
    select s.*, o.body
      from (${memorySummarySql} where e.id = ${entryId}) s
      join entry_texts o on o.entry_id = s.entry_id and o.is_original`);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const versions = await db.execute<{
    locale: Locale;
    is_original: boolean;
    status: VisibilityStatus;
  }>(sql`
    select locale, is_original, status
      from entry_texts where entry_id = ${entryId}
     order by is_original desc, locale`);
  const slug = await db.execute<{ slug: string }>(sql`
    select slug from entry_slugs where entry_id = ${entryId} and is_current`);
  const recordings = await db.execute<RecordingRow>(sql`
    select t.id as track_id, t.title, t.length_ms,
           t.archived_at is not null as archived,
           coalesce((select json_agg(json_build_object('id', ar.id, 'name', ar.name)
                                     order by ta.position)
                       from track_artists ta
                       join artists ar on ar.id = ta.artist_id
                      where ta.track_id = t.id), '[]'::json) as artists,
           coalesce((select json_agg(al.title order by al.title, al.id)
                       from album_tracks atr
                       join albums al on al.id = atr.album_id
                      where atr.track_id = t.id), '[]'::json) as albums
      from memory_music mm
      join tracks t on t.id = mm.track_id
     where mm.memory_id = ${entryId}
     order by mm.position`);
  const albums = await db.execute<{ title: string }>(sql`
    select al.title
      from memory_music mm
      join albums al on al.id = mm.album_id
     where mm.memory_id = ${entryId}
     order by mm.position`);
  return {
    ...toSummary(row),
    body: editableText(row.body),
    versions: versions.rows.map((version) => ({
      locale: version.locale,
      isOriginal: version.is_original,
      status: version.status,
    })),
    slug: slug.rows[0]?.slug ?? null,
    recordings: recordings.rows.map(toRecording),
    albumLinks: albums.rows.map((album) => album.title),
  };
}

export interface MemoryOfRecording {
  entryId: string;
  title: string;
  /** The language the title is written in. */
  locale: Locale;
  status: VisibilityStatus;
}

/**
 * The memories (not in Recently deleted) that link one recording, for its
 * page in the catalog. Private: the studio only.
 */
export async function listMemoriesOfRecording(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  trackId: string,
): Promise<MemoryOfRecording[]> {
  if (!journalId.safeParse(trackId).success) {
    return [];
  }
  const result = await db.execute<{
    entry_id: string;
    title: string | null;
    locale: Locale;
    status: VisibilityStatus;
  }>(sql`
    select e.id as entry_id, o.title, o.locale, o.status
      from memory_music mm
      join entries e     on e.id = mm.memory_id
      join entry_texts o on o.entry_id = e.id and o.is_original
     where mm.track_id = ${trackId}
       and e.deleted_at is null
     order by e.updated_at desc, e.id`);
  return result.rows.map((row) => ({
    entryId: row.entry_id,
    title: row.title ?? "Untitled memory",
    locale: row.locale,
    status: row.status,
  }));
}

export interface MemoryStatistics {
  total: number;
  draft: number;
  private: number;
  published: number;
  deleted: number;
}

/**
 * How many memories there are by the status of their original language
 * version, and how many are in Recently deleted, for the Desk. A separate
 * aggregate: the album-journal statistics (AC-05) are unchanged.
 */
export async function getMemoryStatistics(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<MemoryStatistics> {
  const result = await db.execute<{
    total: number;
    draft: number;
    private: number;
    published: number;
    deleted: number;
  }>(sql`
    select count(*) filter (where e.deleted_at is null)::int as total,
           count(*) filter (where e.deleted_at is null and o.status = 'draft')::int as draft,
           count(*) filter (where e.deleted_at is null and o.status = 'private')::int as private,
           count(*) filter (where e.deleted_at is null and o.status = 'published')::int as published,
           count(*) filter (where e.deleted_at is not null)::int as deleted
      from memories m
      join entries e     on e.id = m.entry_id
      join entry_texts o on o.entry_id = e.id and o.is_original`);
  return result.rows[0]!;
}
