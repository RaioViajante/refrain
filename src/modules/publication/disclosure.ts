import "server-only";

import { createHash } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

import type {
  DatabaseExecutor,
  EntryKind,
  Locale,
  VisibilityStatus,
} from "@/db";

import { PublicationError } from "./errors";
import {
  publicLanguageVersions,
  trackReflectionTextsWithStatus,
} from "./predicate";

// What a reader would see if one language version of one entry were published
// (ADR 0006 §§ 1 and 2), and the fingerprint that binds a confirmation to it.
//
// The disclosure is read from the actual database state, with the same SQL
// fragments as the public queries (./predicate), for the hypothetical state
// "this version has its current status and is public". It reads and writes
// nothing else and takes no lock; the publish command calls it again under the
// entry lock. Internal to the Publication module.

export interface DisclosedReflection {
  trackReflectionId: string;
  trackId: string;
  /** Catalog wording: shown to the author, not part of the fingerprint. */
  trackTitle: string;
  locale: Locale;
  isFavourite: boolean;
  ratingHalfSteps: number | null;
  /** Shown as the "still writing" label; it never decides visibility. */
  isStillWriting: boolean;
  body: unknown;
}

export type DisclosedMusicLink = { trackId: string } | { albumId: string };

/**
 * The disclosure for one language version. It is private writing: it is
 * returned only to a request that passed authorization, and never logged.
 */
export interface PublishDisclosure {
  entryId: string;
  kind: EntryKind;
  locale: Locale;
  /** `entries.version` the disclosure was computed at. */
  entryVersion: number;
  /** The status the version has now, which publication would leave. */
  status: VisibilityStatus;
  /** The text atoms of the version (ADR 0006 § 1). */
  version: {
    title: string | null;
    opening: string | null;
    marginNote: string | null;
    body: unknown;
  };
  /** The address that will be public. */
  address: { slug: string; wasPublic: boolean };
  /**
   * The album rating, for an album journal that has one. It belongs to the
   * journal, not to a language: `alreadyPublic` says some version is public
   * already.
   */
  albumRating: { halfSteps: number; alreadyPublic: boolean } | null;
  /** The remembered-when text and ordered music links, for a memory. */
  memory: { rememberedWhen: string | null; music: DisclosedMusicLink[] } | null;
  /**
   * Every pair (track reflection, this language) that will be public: the
   * reflection's flag is set and it has text in this language. In track
   * reflection id order.
   */
  reflections: DisclosedReflection[];
  /** Flagged reflections with no text in this language: not public in it. */
  flaggedWithoutText: number;
}

/** Everything read for one version, before any rule is applied to it. */
export interface PublishState {
  kind: EntryKind;
  deleted: boolean;
  entryVersion: number;
  status: VisibilityStatus;
  /** The database clock when this state was read, in milliseconds. */
  nowMs: number;
  /** `entries.updated_at`, UTC with microseconds. */
  entryUpdatedAt: string;
  /** The version's `updated_at`, UTC with microseconds. */
  versionUpdatedAt: string;
  text: {
    title: string | null;
    opening: string | null;
    marginNote: string | null;
    body: unknown;
    bodyText: string;
  };
  slug: { slug: string; wasPublic: boolean } | null;
  albumRating: { halfSteps: number; alreadyPublic: boolean } | null;
  memory: { rememberedWhen: string | null; music: DisclosedMusicLink[] } | null;
  reflections: DisclosedReflection[];
  flaggedWithoutText: number;
}

// UTC text with microseconds, so the connection's TimeZone setting cannot
// change the value, and no JavaScript Date (which loses microseconds) is used.
const utcText = (column: SQL) =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/**
 * Reads the state of one language version. Throws `entry_not_found` for an
 * unknown entry and `version_not_found` for a missing language version. Takes
 * no lock: the caller takes the entry lock first when it must decide on it
 * (publish), and reads inside one snapshot when it must not (preview).
 */
export async function readPublishState(
  db: DatabaseExecutor,
  entryId: string,
  locale: Locale,
): Promise<PublishState> {
  const head = await db.execute<{
    kind: EntryKind;
    deleted: boolean;
    version: number;
    entry_updated_at: string;
    now_ms: string;
    status: VisibilityStatus | null;
    version_updated_at: string | null;
    title: string | null;
    opening: string | null;
    margin_note: string | null;
    body: unknown;
    body_text: string | null;
  }>(sql`
    select e.kind, e.deleted_at is not null as deleted, e.version,
           ${utcText(sql`e.updated_at`)} as entry_updated_at,
           floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
             as now_ms,
           t.status, ${utcText(sql`t.updated_at`)} as version_updated_at,
           t.title, t.opening, t.margin_note, t.body, t.body_text
      from entries e
      left join entry_texts t on t.entry_id = e.id and t.locale = ${locale}
     where e.id = ${entryId}`);
  const row = head.rows[0];
  if (!row) {
    throw new PublicationError("entry_not_found");
  }
  if (row.status === null || row.version_updated_at === null) {
    throw new PublicationError("version_not_found");
  }
  const status = row.status;

  const slugRows = await db.execute<{ slug: string; was_published: boolean }>(
    sql`select slug, was_published from entry_slugs
         where entry_id = ${entryId} and is_current`,
  );
  const slug = slugRows.rows[0];

  let albumRating: PublishState["albumRating"] = null;
  if (row.kind === "album_journal") {
    const rating = await db.execute<{
      rating_half_steps: number | null;
      already_public: boolean;
    }>(sql`
      select j.rating_half_steps,
             exists (select 1 from (${publicLanguageVersions}) pv
                      where pv.entry_id = j.entry_id) as already_public
        from album_journals j
       where j.entry_id = ${entryId}`);
    const found = rating.rows[0];
    if (found && found.rating_half_steps !== null) {
      albumRating = {
        halfSteps: found.rating_half_steps,
        alreadyPublic: found.already_public,
      };
    }
  }

  let memory: PublishState["memory"] = null;
  if (row.kind === "memory") {
    const remembered = await db.execute<{ remembered_when: string | null }>(
      sql`select remembered_when from memories where entry_id = ${entryId}`,
    );
    const links = await db.execute<{
      track_id: string | null;
      album_id: string | null;
    }>(sql`
      select track_id, album_id from memory_music
       where memory_id = ${entryId}
       order by position asc, id asc`);
    memory = {
      rememberedWhen: remembered.rows[0]?.remembered_when ?? null,
      // The order of the links is the atom, not the raw position numbers:
      // renumbering without reordering changes nothing a reader sees.
      music: links.rows.map((link) =>
        link.track_id !== null
          ? { trackId: link.track_id }
          : { albumId: link.album_id! },
      ),
    };
  }

  let reflections: DisclosedReflection[] = [];
  let flaggedWithoutText = 0;
  if (row.kind === "album_journal") {
    // The pairs the public queries would return for this language once the
    // version is public, from the same fragment (ADR 0006 § 2).
    const pairs = await db.execute<{
      track_reflection_id: string;
      track_id: string;
      track_title: string;
      is_favourite: boolean;
      rating_half_steps: number | null;
      is_still_writing: boolean;
      body: unknown;
    }>(sql`
      select v.track_reflection_id, v.track_id, t.title as track_title,
             tr.is_favourite, tr.rating_half_steps, tr.is_still_writing,
             trt.body
        from (${trackReflectionTextsWithStatus(status)}) v
        join track_reflections tr on tr.id = v.track_reflection_id
        join track_reflection_texts trt
          on trt.track_reflection_id = v.track_reflection_id
         and trt.locale = v.locale
        join tracks t on t.id = v.track_id
       where v.album_journal_id = ${entryId}
         and v.locale = ${locale}
       order by v.track_reflection_id asc`);
    reflections = pairs.rows.map((pair) => ({
      trackReflectionId: pair.track_reflection_id,
      trackId: pair.track_id,
      trackTitle: pair.track_title,
      locale,
      isFavourite: pair.is_favourite,
      ratingHalfSteps: pair.rating_half_steps,
      isStillWriting: pair.is_still_writing,
      body: pair.body,
    }));

    const withoutText = await db.execute<{ n: number }>(sql`
      select count(*)::int as n
        from track_reflections tr
       where tr.album_journal_id = ${entryId}
         and tr.is_published
         and not exists (select 1 from track_reflection_texts trt
                          where trt.track_reflection_id = tr.id
                            and trt.locale = ${locale})`);
    flaggedWithoutText = withoutText.rows[0]?.n ?? 0;
  }

  return {
    kind: row.kind,
    deleted: row.deleted,
    entryVersion: row.version,
    status,
    nowMs: Number(row.now_ms),
    entryUpdatedAt: row.entry_updated_at,
    versionUpdatedAt: row.version_updated_at,
    text: {
      title: row.title,
      opening: row.opening,
      marginNote: row.margin_note,
      body: row.body,
      bodyText: row.body_text ?? "",
    },
    slug: slug ? { slug: slug.slug, wasPublic: slug.was_published } : null,
    albumRating,
    memory,
    reflections,
    flaggedWithoutText,
  };
}

/**
 * A version is publishable when its opening sentence or its body contains
 * non-whitespace content (owner decision R1). Unicode white space only is
 * empty. Evaluated on the opening sentence and on `body_text`, the plain-text
 * projection the save keeps in step with the body.
 */
export function hasPublishableText(state: PublishState): boolean {
  const filled = (text: string | null) =>
    text !== null && /\P{White_Space}/u.test(text);
  return filled(state.text.opening) || filled(state.text.bodyText);
}

/** The disclosure of a state that has already passed the publishing rules. */
export function disclosureOf(
  state: PublishState,
  entryId: string,
  locale: Locale,
): PublishDisclosure {
  if (state.slug === null) {
    throw new PublicationError("no_current_slug");
  }
  return {
    entryId,
    kind: state.kind,
    locale,
    entryVersion: state.entryVersion,
    status: state.status,
    version: {
      title: state.text.title,
      opening: state.text.opening,
      marginNote: state.text.marginNote,
      body: state.text.body,
    },
    address: state.slug,
    albumRating: state.albumRating,
    memory: state.memory,
    reflections: state.reflections,
    flaggedWithoutText: state.flaggedWithoutText,
  };
}

// Canonical JSON: keys sorted, no insignificant whitespace, UTF-8. Every
// string is JSON-quoted, so no two different values share a spelling.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(",")}}`;
}

/**
 * The state fingerprint of ADR 0006 § 3: the base64url SHA-256 of the
 * canonical JSON of the entry, the operation, the locale, `entries.version`,
 * every atom of the disclosure with its value, and the state stamp
 * (`entries.updated_at`, the version's `updated_at`, and its status). It is
 * unkeyed and proves nothing about who computed it: it only says whether two
 * states are the same. The token is what carries authority.
 *
 * Catalog wording (a track's title) is deliberately not in it: that is the
 * documented gap C11, closed by gate G8, not accepted as harmless.
 */
export function fingerprintOf(
  state: PublishState,
  disclosure: PublishDisclosure,
): string {
  const material = {
    entryId: disclosure.entryId,
    kind: disclosure.kind,
    operation: "publish",
    locale: disclosure.locale,
    entryVersion: disclosure.entryVersion,
    stamp: {
      entryUpdatedAt: state.entryUpdatedAt,
      versionUpdatedAt: state.versionUpdatedAt,
      versionStatus: state.status,
    },
    version: disclosure.version,
    address: disclosure.address.slug,
    albumRating: disclosure.albumRating,
    memory: disclosure.memory,
    reflections: disclosure.reflections.map((reflection) => ({
      trackReflectionId: reflection.trackReflectionId,
      trackId: reflection.trackId,
      locale: reflection.locale,
      isFavourite: reflection.isFavourite,
      ratingHalfSteps: reflection.ratingHalfSteps,
      isStillWriting: reflection.isStillWriting,
      body: reflection.body,
    })),
  };
  return createHash("sha256")
    .update(canonicalJson(material), "utf8")
    .digest("base64url");
}
