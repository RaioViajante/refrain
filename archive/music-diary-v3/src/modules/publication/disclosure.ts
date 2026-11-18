import "server-only";

import { createHash } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

import type {
  DatabaseExecutor,
  EntryKind,
  Locale,
  VisibilityStatus,
} from "@/db";

import { artistPhotoOf } from "@/integrations/wikimedia-commons";

import { artistAddresses } from "./artist-address";
import { PublicationError } from "./errors";
import { readMemoryMusic, type PublicMemoryMusic } from "./memory-music";
import { isFilled } from "./text";
import {
  publicLanguageVersions,
  trackReflectionTextsWithStatus,
} from "./predicate";
import { publicArtists } from "./queries";

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
 * An artist page that publishing this version would open for the first time
 * (M3.5; proposed ADR 0006 A5): an artist credited on the journal's album,
 * not archived, with no public page today. Bound into the fingerprint.
 */
export interface DisclosedArtistPage {
  artistId: string;
  name: string;
  /** The page's address, `/artists/<address>`, or null if none is served. */
  address: string | null;
  /** The photograph the page would show, or null for its empty frame. */
  photo: {
    title: string;
    sha1: string;
    credit: string;
    license: string;
  } | null;
}

/**
 * An artist page that is public already and whose address publishing this
 * version would change: a namesake opening beside it (artist-address.ts).
 */
export interface DisclosedArtistAddressChange {
  artistId: string;
  name: string;
  from: string;
  /** Null when no address would be served for it any more. */
  to: string | null;
}

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
   * A memory's music as the public page shows it, in the same order as
   * `memory.music`: titles, credited artists, the album, and where each is
   * linked now (M3.7). Catalog wording, shown and not part of the
   * fingerprint (C11). Empty for every other kind.
   */
  memoryMusic: PublicMemoryMusic[];
  /**
   * Every pair (track reflection, this language) that will be public: the
   * reflection's flag is set and it has text in this language. In track
   * reflection id order.
   */
  reflections: DisclosedReflection[];
  /** Flagged reflections with no text in this language: not public in it. */
  flaggedWithoutText: number;
  /** The artist pages publishing this version would open (M3.5). */
  artistPages: DisclosedArtistPage[];
  /** The public artist pages whose address it would change. */
  artistAddressChanges: DisclosedArtistAddressChange[];
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
  memoryMusic: PublicMemoryMusic[];
  reflections: DisclosedReflection[];
  flaggedWithoutText: number;
  artistPages: DisclosedArtistPage[];
  artistAddressChanges: DisclosedArtistAddressChange[];
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
  let memoryMusic: PublicMemoryMusic[] = [];
  if (row.kind === "memory") {
    memoryMusic = await readMemoryMusic(db, entryId);
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

  const artists =
    row.kind === "album_journal"
      ? await readArtistExposure(db, entryId)
      : { pages: [], changes: [] };

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
    memoryMusic,
    reflections,
    flaggedWithoutText,
    artistPages: artists.pages,
    artistAddressChanges: artists.changes,
  };
}

/**
 * The artist pages that publishing a version of this album journal would open,
 * and the public pages whose address that would change (M3.5; proposed ADR
 * 0006 A5). Publishing makes the journal served, so every artist credited on
 * its album that is not archived and has no public page today would get one:
 * the same rule as the pages (`publicArtists`). When the journal is public
 * already, every such artist has a page already, and both lists are empty.
 * The addresses are computed exactly as the pages compute them, over the
 * visible artists with and without the new ones. In artist id order.
 */
async function readArtistExposure(
  db: DatabaseExecutor,
  entryId: string,
): Promise<{
  pages: DisclosedArtistPage[];
  changes: DisclosedArtistAddressChange[];
}> {
  const opening = await db.execute<{
    id: string;
    name: string;
    photo_url: string | null;
    photo_credit: string | null;
    photo_license: string | null;
    photo_source_url: string | null;
    photo_file_sha1: string | null;
    photo_file_timestamp: string | null;
    photo_chosen_at: string | null;
  }>(sql`
    select distinct ar.id, ar.name, ar.photo_url, ar.photo_credit,
           ar.photo_license, ar.photo_source_url, ar.photo_file_sha1,
           ${utcText(sql`ar.photo_file_timestamp`)} as photo_file_timestamp,
           ${utcText(sql`ar.photo_chosen_at`)} as photo_chosen_at
      from album_journals aj
      join album_artists aa on aa.album_id = aj.album_id
      join artists ar on ar.id = aa.artist_id
     where aj.entry_id = ${entryId}
       and ar.archived_at is null
       and not exists (select 1
                         from (${publicArtists}) visible
                        where visible.artist_id = ar.id)
     order by ar.id`);
  if (opening.rows.length === 0) {
    return { pages: [], changes: [] };
  }
  const visible = await db.execute<{ artist_id: string; name: string }>(sql`
    select visible.artist_id, visible.name
      from (${publicArtists}) visible
     order by visible.artist_id`);
  const now = visible.rows.map((artist) => ({
    artistId: artist.artist_id,
    name: artist.name,
  }));
  const before = artistAddresses(now);
  const after = artistAddresses([
    ...now,
    ...opening.rows.map((artist) => ({
      artistId: artist.id,
      name: artist.name,
    })),
  ]);

  const pages = opening.rows.map((artist): DisclosedArtistPage => {
    const photo = artistPhotoOf({
      photoUrl: artist.photo_url,
      photoCredit: artist.photo_credit,
      photoLicense: artist.photo_license,
      photoSourceUrl: artist.photo_source_url,
      photoFileSha1: artist.photo_file_sha1,
      photoFileTimestamp: artist.photo_file_timestamp,
      photoChosenAt: artist.photo_chosen_at,
    });
    return {
      artistId: artist.id,
      name: artist.name,
      address: after.get(artist.id) ?? null,
      photo: photo
        ? {
            title: photo.title,
            sha1: artist.photo_file_sha1!,
            credit: photo.credit,
            license: photo.license.name,
          }
        : null,
    };
  });
  const changes: DisclosedArtistAddressChange[] = [];
  for (const artist of now) {
    const from = before.get(artist.artistId);
    const to = after.get(artist.artistId) ?? null;
    if (from !== undefined && from !== to) {
      changes.push({ artistId: artist.artistId, name: artist.name, from, to });
    }
  }
  return { pages, changes };
}

/**
 * A version is publishable when its opening sentence or its body contains
 * non-whitespace content (owner decision R1). A memory also needs its title
 * (ADR 0006 § 4, step 6: "Memories will also need their title"), which the
 * memory commands already require; this refuses a version written outside
 * them. Unicode white space only is empty. Evaluated on the opening sentence
 * and on `body_text`, the plain-text projection the save keeps in step with
 * the body.
 */
export function hasPublishableContent(
  kind: EntryKind,
  text: { title: string | null; opening: string | null; bodyText: string },
): boolean {
  if (kind === "memory" && !isFilled(text.title)) {
    return false;
  }
  return isFilled(text.opening) || isFilled(text.bodyText);
}

export function hasPublishableText(state: PublishState): boolean {
  return hasPublishableContent(state.kind, state.text);
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
    memoryMusic: state.memoryMusic,
    reflections: state.reflections,
    flaggedWithoutText: state.flaggedWithoutText,
    artistPages: state.artistPages,
    artistAddressChanges: state.artistAddressChanges,
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
 * Catalog wording (a track's title, a memory's music as the page names it,
 * `memoryMusic`) is deliberately not in it: that is the documented gap C11,
 * closed by gate G8, not accepted as harmless. The one
 * exception (M3.5; proposed ADR 0006 A5) is the artist pages publishing
 * would open, with their names, addresses, and photographs, and the public
 * pages whose address would change: a new page is exposure, not wording, so
 * a change to any of them between the preview and the publication makes the
 * confirmation stale.
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
    artistPages: disclosure.artistPages,
    artistAddressChanges: disclosure.artistAddressChanges,
  };
  return createHash("sha256")
    .update(canonicalJson(material), "utf8")
    .digest("base64url");
}
