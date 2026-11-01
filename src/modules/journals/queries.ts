import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Locale, VisibilityStatus } from "@/db";
import type { AuthorizedAuthor } from "@/modules/identity";

import { editableText } from "./body";
import { journalId } from "./input";

export interface AlbumJournalProgress {
  entryId: string;
  albumTitle: string;
  tracksWritten: number;
  trackCount: number;
}

/**
 * Tracks written per album journal, for the Desk ("4 of 10 tracks written").
 * Academic requirement AC-05 (aggregate); the SQL is quoted in
 * docs/data-model.md.
 *
 * A track counts as written when its reflection has non-empty text in the
 * journal's original language and is not flagged "still writing". Empty
 * reflections, reflections written only in a translation, and reflections
 * still in progress do not count. `trackCount` is the length of the album's
 * reference edition, and only reflections on its tracks are counted, so the
 * result never reads "11 of 10" when a reflection is on a recording outside
 * the reference edition. Deleted journals are excluded.
 */
export async function listAlbumJournalProgress(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<AlbumJournalProgress[]> {
  const result = await db.execute<{
    entry_id: string;
    album_title: string;
    tracks_written: number;
    track_count: number;
  }>(sql`
    select e.id as entry_id, al.title as album_title,
           count(trt.track_reflection_id)::int as tracks_written,
           (select count(*)::int
              from edition_tracks et
              join album_editions ed on ed.id = et.edition_id
             where ed.album_id = al.id and ed.is_reference) as track_count
      from album_journals aj
      join entries e      on e.id = aj.entry_id
      join albums al      on al.id = aj.album_id
      join entry_texts o  on o.entry_id = e.id and o.is_original
      left join track_reflections tr       on tr.album_journal_id = aj.entry_id
                                          and tr.track_id in (
                                                select et.track_id
                                                  from edition_tracks et
                                                  join album_editions ed on ed.id = et.edition_id
                                                 where ed.album_id = aj.album_id and ed.is_reference)
      left join track_reflection_texts trt on trt.track_reflection_id = tr.id
                                          and trt.locale = o.locale
                                          and trt.body_text <> ''
                                          and not tr.is_still_writing
     where e.deleted_at is null
     group by e.id, al.id, al.title
     order by al.title, e.id`);

  return result.rows.map((row) => ({
    entryId: row.entry_id,
    albumTitle: row.album_title,
    tracksWritten: row.tracks_written,
    trackCount: row.track_count,
  }));
}

// ---------------------------------------------------------------------------
// Album journals in the Writing Studio
//
// Private writing: every query takes the AuthorizedAuthor that only the
// Identity module creates, and none may back a public page. Public reads go
// through the Publication module's predicate.
// ---------------------------------------------------------------------------

function parseTimestamp(value: string): Date {
  return new Date(value);
}

const EXCERPT_LENGTH = 160;

// PostgreSQL returns one more character than the limit, so a cut can be told
// from text that fits exactly.
function toExcerpt(text: string): string {
  const characters = [...text];
  return characters.length > EXCERPT_LENGTH
    ? `${characters.slice(0, EXCERPT_LENGTH).join("").trimEnd()}…`
    : text;
}

export interface AlbumJournalSummary {
  entryId: string;
  albumId: string;
  albumTitle: string;
  /** The album's credited artists, in credit order. */
  artistNames: string;
  /** The language the journal was written in. */
  locale: Locale;
  /** Visibility of that original language version. */
  status: VisibilityStatus;
  /** The author's opening sentence. It is writing, not the journal's title. */
  opening: string | null;
  /**
   * A preview of the reflection: its first words on one line, at most 160
   * characters, with an ellipsis when cut. Empty when nothing is written. For
   * Writing Studio lists only; it is derived from the stored text and never
   * stored, and it must never reach public metadata or a public response.
   */
  excerpt: string;
  wordCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  /** When the journal moved to Recently deleted, if it did. */
  deletedAt: Date | null;
}

type SummaryRow = {
  entry_id: string;
  album_id: string;
  album_title: string;
  artist_names: string;
  locale: Locale;
  status: VisibilityStatus;
  opening: string | null;
  excerpt: string;
  word_count: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function toSummary(row: SummaryRow): AlbumJournalSummary {
  return {
    entryId: row.entry_id,
    albumId: row.album_id,
    albumTitle: row.album_title,
    artistNames: row.artist_names,
    locale: row.locale,
    status: row.status,
    opening: row.opening,
    excerpt: toExcerpt(row.excerpt),
    wordCount: row.word_count,
    version: row.version,
    createdAt: parseTimestamp(row.created_at),
    updatedAt: parseTimestamp(row.updated_at),
    deletedAt: row.deleted_at ? parseTimestamp(row.deleted_at) : null,
  };
}

// The artists are a correlated subquery, so a journal is one row however many
// credits its album has.
const journalSummarySql = sql`
  select e.id as entry_id, j.album_id, al.title as album_title,
         coalesce((select string_agg(coalesce(aa.credited_as, ar.name), ', '
                                     order by aa.position)
                     from album_artists aa
                     join artists ar on ar.id = aa.artist_id
                    where aa.album_id = al.id), '') as artist_names,
         o.locale, o.status, o.opening,
         left(regexp_replace(btrim(o.body_text, E' \t\n'), '[[:space:]]+', ' ', 'g'),
              ${EXCERPT_LENGTH + 1}) as excerpt,
         coalesce(array_length(regexp_split_to_array(btrim(o.body_text, E' \t\n'), '[[:space:]]+'), 1), 0)
           * (btrim(o.body_text, E' \t\n') <> '')::int as word_count,
         e.version, e.created_at, e.updated_at, e.deleted_at
    from album_journals j
    join entries e     on e.id = j.entry_id
    join albums al     on al.id = j.album_id
    join entry_texts o on o.entry_id = e.id and o.is_original`;

/**
 * The author's album journals, newest edit first, not including those in
 * Recently deleted. `albumId` narrows the list to one album. Private and draft
 * journals are included: this is a Writing Studio query.
 */
export async function listAlbumJournals(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  options: { albumId?: string } = {},
): Promise<AlbumJournalSummary[]> {
  const albumId = options.albumId;
  if (albumId !== undefined && !journalId.safeParse(albumId).success) {
    return [];
  }
  const result = await db.execute<SummaryRow>(sql`
    ${journalSummarySql}
    where e.deleted_at is null
      ${albumId === undefined ? sql`` : sql`and j.album_id = ${albumId}`}
    order by e.updated_at desc, e.id`);
  return result.rows.map(toSummary);
}

/** Album journals in Recently deleted, most recently deleted first. */
export async function listDeletedAlbumJournals(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<AlbumJournalSummary[]> {
  const result = await db.execute<SummaryRow>(sql`
    ${journalSummarySql}
    where e.deleted_at is not null
    order by e.deleted_at desc, e.id`);
  return result.rows.map(toSummary);
}

export interface AlbumJournalDetail extends AlbumJournalSummary {
  /** The reflection as plain text, or `null` when the plain editor cannot show it without loss. */
  body: string | null;
  /** Every language version, with its own status. */
  versions: { locale: Locale; isOriginal: boolean; status: VisibilityStatus }[];
  /** The journal's current slug, reserved when it was created. */
  slug: string | null;
}

/**
 * One album journal for viewing or editing, including one in Recently
 * deleted (which the studio shows read-only). `null` when it does not exist.
 */
export async function getAlbumJournal(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  entryId: string,
): Promise<AlbumJournalDetail | null> {
  if (!journalId.safeParse(entryId).success) {
    return null;
  }
  const result = await db.execute<SummaryRow & { body: unknown }>(sql`
    select s.*, o.body
      from (${journalSummarySql} where e.id = ${entryId}) s
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
  return {
    ...toSummary(row),
    body: editableText(row.body),
    versions: versions.rows.map((version) => ({
      locale: version.locale,
      isOriginal: version.is_original,
      status: version.status,
    })),
    slug: slug.rows[0]?.slug ?? null,
  };
}

export interface JournalStatistics {
  total: number;
  draft: number;
  private: number;
  published: number;
  deleted: number;
}

/**
 * How many album journals there are by the status of their original language
 * version, for the Desk. Academic requirement AC-05 (aggregate, with
 * `FILTER`). Deleted journals are counted separately and not by status.
 */
export async function getJournalStatistics(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
): Promise<JournalStatistics> {
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
      from album_journals j
      join entries e     on e.id = j.entry_id
      join entry_texts o on o.entry_id = e.id and o.is_original`);
  return result.rows[0]!;
}
