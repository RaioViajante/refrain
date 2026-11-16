import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  databaseErrorOf,
  isReferencedRowRefusal,
  schema,
  SqlState,
  type DatabaseExecutor,
  type Transaction,
} from "@/db";
import {
  MAX_CONFIRMATION_TOKEN_LENGTH,
  type AuthorizedAuthor,
} from "@/modules/identity";
import {
  artistsNewlyExposedByCredit,
  lockAlbumCatalogChange,
  lockArtistPublicExposure,
  lockArtistRestoreExposure,
  lockTrackCatalogChange,
  previewCatalogChange,
  PublicationError,
  requireCatalogChangeConfirmation,
  verifyCatalogChangeConfirmation,
  type CatalogChange,
  type CatalogChangePreview,
  type CatalogSubject,
} from "@/modules/publication";
import { fieldErrorsOf } from "@/validation";

import { CatalogError, type CatalogBlocker } from "./errors";
import {
  albumInput,
  albumPatch,
  artistInput,
  artistPatch,
  catalogId,
  moveDirection,
  newTrackInput,
  trackPatch,
  tracklistInput,
} from "./input";

// Catalog commands (artists, albums, their reference edition and credits,
// tracks, and the ordered tracklist). Each validates its own input with Zod.
// A command that writes several rows runs in one transaction (docs/data-model.md
// § Transaction boundaries) and, called with a transaction, in a savepoint of
// it. A command that is one statement (create, archive, restore, and delete of
// a single record) is atomic by itself and has no savepoint: inside a caller's
// transaction, a refusal aborts that transaction, so a test wraps such a call
// in its own savepoint (`captureFailure`).
//
// Updates are patches (see ./input.ts): a field left out is unchanged, a field
// that is present replaces the stored value, and clearing an optional field is
// done on purpose with `null` or a blank string. A list that is present
// replaces the whole list.
//
// Every command takes the `AuthorizedAuthor` that only the Identity module can
// create, so presentation code cannot call one without having authorized the
// request first. The commands hold no other authorization logic.
//
// Catalog records that writing references are archived, never deleted: a
// delete is attempted and PostgreSQL's ON DELETE RESTRICT decides (ADR 0002,
// D4.5). No command cascades from the catalog into writing.

// Constraints whose violation on DELETE means "something still depends on it".
const BLOCKERS: Record<string, CatalogBlocker> = {
  album_artists_artist_fk: "album_credits",
  track_artists_artist_fk: "track_credits",
  artist_journals_artist_fk: "journals",
  album_journals_album_fk: "journals",
  memory_music_album_fk: "memories",
  memory_music_track_fk: "memories",
  album_tracks_track_fk: "albums",
  track_reflections_album_track_fk: "reflections",
};

const MUSICBRAINZ_IDENTIFIERS = new Set([
  "artists_mb_artist_id_unique",
  "albums_mb_release_group_id_unique",
  "tracks_mb_recording_id_unique",
  "album_editions_mb_release_id_unique",
]);

// Turns a database failure into a fixed domain failure. Anything unrecognized
// is rethrown untouched for the caller to report as an internal error; its
// message is never shown to a client.
/** Internal; exported for the unit test of its mapping only. */
export function translateCatalogFailure(error: unknown): unknown {
  if (error instanceof CatalogError) {
    return error;
  }
  // ADR 0013 step 3: the catalog-change gate's refusals, with nothing
  // written. A fixed code each; no database detail.
  if (error instanceof PublicationError) {
    switch (error.failure) {
      case "confirmation_required":
      case "confirmation_invalid":
      case "confirmation_expired":
      case "confirmation_stale":
      case "impact_unavailable":
      case "retry":
      case "unavailable":
      case "invalid_input":
        return new CatalogError(error.failure);
      default:
        return new CatalogError("impact_unavailable");
    }
  }
  const failure = databaseErrorOf(error);
  if (!failure) {
    return error;
  }
  // A deadlock or serialization failure rolled everything back: the author
  // may try again (ADR 0013 § 4.5).
  if (failure.code === "40P01" || failure.code === "40001") {
    return new CatalogError("retry");
  }
  if (
    failure.code === SqlState.uniqueViolation &&
    failure.constraint &&
    MUSICBRAINZ_IDENTIFIERS.has(failure.constraint)
  ) {
    return new CatalogError("duplicate_identifier");
  }
  // A foreign key: PostgreSQL 17 reports every case as 23503; PostgreSQL 18
  // reports a RESTRICT key's refusal as 23001 (see isReferencedRowRefusal).
  // Either way, only a constraint listed in BLOCKERS becomes `in_use`, so both
  // versions give the same answer for the same constraint.
  if (
    failure.code === SqlState.foreignKeyViolation ||
    failure.code === SqlState.restrictViolation
  ) {
    const blocker = failure.constraint
      ? BLOCKERS[failure.constraint]
      : undefined;
    return blocker && isReferencedRowRefusal(failure)
      ? new CatalogError("in_use", { blockedBy: blocker })
      : new CatalogError("not_found");
  }
  if (failure.code === SqlState.checkViolation) {
    return new CatalogError("invalid_input");
  }
  return error;
}

async function guarded<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    throw translateCatalogFailure(error);
  }
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new CatalogError("invalid_input", {
      fields: fieldErrorsOf(result.error),
    });
  }
  return result.data;
}

// ADR 0013 step 3: a `catalog_change` token, only from the review dialog's
// confirm control. Its form is checked here; its authenticity before any
// lock (verifyCatalogChangeConfirmation); its expiry and fingerprint under
// the locks (requireCatalogChangeConfirmation).
const catalogConfirmation = z
  .string()
  .max(MAX_CONFIRMATION_TOKEN_LENGTH)
  .regex(/^ct1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  .optional();

/** Options of a confirmable catalog command. */
export interface CatalogEditOptions {
  /** The review dialog's token, when the author confirmed. */
  confirmation?: unknown;
}

/**
 * The patch without its token, and the token: the Studio's review dialog
 * sends the token inside the edit's input (as the journal dialogs do), and
 * nothing else in `src/app` names it.
 */
function withoutConfirmation(
  patch: unknown,
  options: CatalogEditOptions,
): { patch: unknown; options: CatalogEditOptions } {
  if (
    patch !== null &&
    typeof patch === "object" &&
    !Array.isArray(patch) &&
    "confirmation" in patch
  ) {
    const { confirmation, ...rest } = patch as Record<string, unknown>;
    if (options.confirmation !== undefined) {
      throw new CatalogError("invalid_input");
    }
    return { patch: rest, options: { confirmation } };
  }
  return { patch, options };
}

function presentedConfirmation(
  author: AuthorizedAuthor,
  subject: CatalogSubject,
  options: CatalogEditOptions,
) {
  const token = parse(catalogConfirmation, options.confirmation);
  return token === undefined
    ? undefined
    : verifyCatalogChangeConfirmation(author, token, subject);
}

// After the gate passed and the rows are written: the subject's `updated_at`
// moves strictly forward, read with microseconds by the fingerprint, so a
// token that was applied can never match again, even after A -> B -> A
// (ADR 0013 § 3.5).
async function advanceArtist(tx: Transaction, id: string) {
  await tx.execute(sql`
    update artists
       set updated_at = greatest(clock_timestamp(),
                                 updated_at + interval '1 microsecond')
     where id = ${id}`);
}
async function advanceAlbum(tx: Transaction, id: string) {
  await tx.execute(sql`
    update albums
       set updated_at = greatest(clock_timestamp(),
                                 updated_at + interval '1 microsecond')
     where id = ${id}`);
}
async function advanceTrack(tx: Transaction, id: string) {
  await tx.execute(sql`
    update tracks
       set updated_at = greatest(clock_timestamp(),
                                 updated_at + interval '1 microsecond')
     where id = ${id}`);
}

// The catalog change a patch would make, as the public impact reads it
// (ADR 0013 § 1.3). Fields no page renders (sort name, kind, identifiers, an
// edition's date and country, a track's length) make no operation.
function artistChangeOf(id: string, data: { name?: string }): CatalogChange {
  return data.name === undefined
    ? []
    : [{ op: "update_artist", artistId: id, name: data.name }];
}

async function albumChangeOf(
  tx: DatabaseExecutor,
  id: string,
  patch: {
    title?: string;
    firstReleaseYear?: number | null;
    label?: string | null;
    credits?: { artistId: string; creditedAs?: string | null }[];
  },
): Promise<CatalogChange> {
  let credits: { artistId: string; creditedAs: string | null }[] | undefined;
  if (patch.credits) {
    // As replaceAlbumCredits writes them: a credit that leaves out
    // `creditedAs` keeps the stored one.
    const stored = await tx
      .select({
        artistId: schema.albumArtists.artistId,
        creditedAs: schema.albumArtists.creditedAs,
      })
      .from(schema.albumArtists)
      .where(eq(schema.albumArtists.albumId, id));
    const keep = new Map(stored.map((row) => [row.artistId, row.creditedAs]));
    credits = patch.credits.map((credit) => ({
      artistId: credit.artistId,
      creditedAs:
        credit.creditedAs === undefined
          ? (keep.get(credit.artistId) ?? null)
          : credit.creditedAs,
    }));
  }
  const operation = {
    op: "update_album" as const,
    albumId: id,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.firstReleaseYear !== undefined
      ? { firstReleaseYear: patch.firstReleaseYear }
      : {}),
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(credits !== undefined ? { credits } : {}),
  };
  return Object.keys(operation).length > 2 ? [operation] : [];
}

function trackChangeOf(
  id: string,
  patch: { title?: string; credit?: string | null; artistIds?: string[] },
): CatalogChange {
  const operation = {
    op: "update_track" as const,
    trackId: id,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.credit !== undefined ? { credit: patch.credit } : {}),
    ...(patch.artistIds !== undefined ? { artistIds: patch.artistIds } : {}),
  };
  return Object.keys(operation).length > 2 ? [operation] : [];
}

/** The gate, then A5: a catalog confirmation never opens an artist page. */
async function confirmCatalogChange(
  tx: Transaction,
  subject: CatalogSubject,
  change: CatalogChange,
  confirmation: ReturnType<typeof presentedConfirmation>,
): Promise<void> {
  if (change.length === 0) {
    return;
  }
  const impact = await requireCatalogChangeConfirmation(tx, {
    subject,
    change,
    confirmation,
  });
  if (impact.opensArtistPage) {
    throw new CatalogError("public_page");
  }
}

async function previewed(
  preview: Promise<CatalogChangePreview>,
): Promise<CatalogChangePreview> {
  const result = await preview;
  if (result.opensArtistPage) {
    throw new CatalogError("public_page");
  }
  return result;
}

// The fields of a patch that are present. A key whose value is `undefined` was
// not sent, so it is not written.
function present<Patch extends Record<string, unknown>>(
  patch: Patch,
): Partial<Patch> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<Patch>;
}

function idOf(value: unknown): string {
  return parse(catalogId, value);
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

export async function createArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<{ id: string }> {
  const data = parse(artistInput, input);
  return guarded(async () => {
    const [artist] = await db
      .insert(schema.artists)
      .values(data)
      .returning({ id: schema.artists.id });
    return { id: artist!.id };
  });
}

/**
 * Updates the fields of an artist that `patch` names; the others are unchanged.
 * `name` and `kind` can be replaced, never cleared. `sortName` and
 * `mbArtistId` are cleared with `null` or a blank string.
 */
export async function updateArtist(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  artistId: unknown,
  patch: unknown,
  given: CatalogEditOptions = {},
): Promise<void> {
  const { patch: edit, options } = withoutConfirmation(patch, given);
  const id = idOf(artistId);
  const data = present(parse(artistPatch, edit));
  const subject: CatalogSubject = { kind: "artist", id };
  await guarded(() =>
    db.transaction(async (tx) => {
      // A forged token is refused before it holds a lock.
      const confirmation = presentedConfirmation(author, subject, options);
      // A name is part of what a publication review shows and binds (the
      // artist pages it would open, and their addresses; M3.5). Taking the
      // entries' share locks first, then the artist row (L3), means a rename
      // waits for a publication in progress of a journal that credits this
      // artist, or that publication sees it. A publication of a journal
      // crediting a namesake is not locked: there the result is as if the
      // rename came just after it (proposed ADR 0006 A5, residual windows).
      // Renaming an artist whose name a served page shows needs the
      // author's confirmation (ADR 0013 step 3): recomputed after the locks.
      await lockArtistPublicExposure(tx, id);
      await confirmCatalogChange(
        tx,
        subject,
        artistChangeOf(id, data),
        confirmation,
      );
      const updated = await tx
        .update(schema.artists)
        .set(data)
        .where(eq(schema.artists.id, id))
        .returning({ id: schema.artists.id });
      if (updated.length === 0) {
        throw new CatalogError("not_found");
      }
      await advanceArtist(tx, id);
    }),
  );
}

/**
 * The review of an artist edit (ADR 0013 § 2): the served pages it would
 * change, and a `catalog_change` token for exactly that, or none. Writes
 * nothing. Only the review dialog's preview action reaches it.
 */
export async function previewArtistChange(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  artistId: unknown,
  patch: unknown,
): Promise<CatalogChangePreview> {
  const id = idOf(artistId);
  const data = present(parse(artistPatch, patch));
  return guarded(() =>
    previewed(
      previewCatalogChange(db, author, { kind: "artist", id }, async () =>
        artistChangeOf(id, data),
      ),
    ),
  );
}

/** Archives an artist: hidden from pickers; writing and credits stay. */
export async function archiveArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  artistId: unknown,
): Promise<void> {
  const id = idOf(artistId);
  await guarded(() =>
    db.transaction(async (tx) => {
      // Archiving only takes a page away. It takes the same locks as a
      // rename, so a publication of a journal crediting this artist sees it
      // or is seen by it; a namesake's address it changes is a residual
      // window of proposed ADR 0006 A5.
      await lockArtistPublicExposure(tx, id);
      const result = await tx.execute(sql`
        update artists
           set archived_at = coalesce(archived_at, now()), updated_at = now()
         where id = ${id}
        returning id`);
      if (result.rows.length === 0) {
        throw new CatalogError("not_found");
      }
    }),
  );
}

/**
 * Restores an archived artist. Refused with `public_page` when restoring
 * would give it a public page (a served album journal credits it), with or
 * without a photograph: the page would appear without a confirmation (M3.5,
 * the owner's review of PR #46). The way to do it is to unpublish those
 * journals, restore, and publish again through the publication review.
 * Decided after the entries' share locks and the artist's row lock, in the
 * photograph command's order (proposed ADR 0006 A5).
 */
export async function restoreArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  artistId: unknown,
): Promise<void> {
  const id = idOf(artistId);
  await guarded(() =>
    db.transaction(async (tx) => {
      const wouldShow = await lockArtistRestoreExposure(tx, id);
      const found = await tx.execute<{ archived: boolean }>(sql`
        select archived_at is not null as archived
          from artists where id = ${id}`);
      const row = found.rows[0];
      if (!row) {
        throw new CatalogError("not_found");
      }
      if (row.archived && wouldShow) {
        throw new CatalogError("public_page");
      }
      await tx
        .update(schema.artists)
        .set({ archivedAt: null })
        .where(eq(schema.artists.id, id));
    }),
  );
}

/**
 * Deletes an artist that nothing refers to. An artist credited on an album or
 * track, or with an artist journal, is refused with `in_use` by PostgreSQL's
 * ON DELETE RESTRICT: archive it instead.
 */
export async function deleteArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  artistId: unknown,
): Promise<void> {
  const id = idOf(artistId);
  await guarded(async () => {
    const deleted = await db
      .delete(schema.artists)
      .where(eq(schema.artists.id, id))
      .returning({ id: schema.artists.id });
    if (deleted.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

// ---------------------------------------------------------------------------
// Shared helpers for credits
// ---------------------------------------------------------------------------

// Every artist must exist, and a new link may not point to an archived one.
// Artists that are already linked stay valid even when archived.
async function assertArtistsLinkable(
  tx: Transaction,
  artistIds: string[],
  alreadyLinked: ReadonlySet<string>,
): Promise<void> {
  if (artistIds.length === 0) {
    return;
  }
  const found = await tx
    .select({
      id: schema.artists.id,
      archivedAt: schema.artists.archivedAt,
    })
    .from(schema.artists)
    .where(inArray(schema.artists.id, artistIds));
  if (found.length !== artistIds.length) {
    throw new CatalogError("not_found");
  }
  if (found.some((a) => a.archivedAt !== null && !alreadyLinked.has(a.id))) {
    throw new CatalogError("archived_reference");
  }
}

async function lockAlbum(tx: Transaction, albumId: string): Promise<void> {
  const locked = await tx.execute<{ archived: boolean }>(
    sql`select archived_at is not null as archived
          from albums where id = ${albumId} for update`,
  );
  if (locked.rows.length === 0) {
    throw new CatalogError("not_found");
  }
}

// An archived album keeps its tracklist as it is, as the studio shows it.
async function lockAlbumForTracklist(
  tx: Transaction,
  albumId: string,
): Promise<void> {
  const locked = await tx.execute<{ archived: boolean }>(
    sql`select archived_at is not null as archived
          from albums where id = ${albumId} for update`,
  );
  if (locked.rows.length === 0) {
    throw new CatalogError("not_found");
  }
  if (locked.rows[0]!.archived) {
    throw new CatalogError("archived_reference");
  }
}

// ---------------------------------------------------------------------------
// Albums, their reference edition, and credits
// ---------------------------------------------------------------------------

async function linkedAlbumArtists(
  tx: Transaction,
  albumId: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ artistId: schema.albumArtists.artistId })
    .from(schema.albumArtists)
    .where(eq(schema.albumArtists.albumId, albumId));
  return new Set(rows.map((row) => row.artistId));
}

async function replaceAlbumCredits(
  tx: Transaction,
  albumId: string,
  // `creditedAs` undefined: keep the one stored for that artist, if any.
  credits: { artistId: string; creditedAs?: string | null }[],
): Promise<void> {
  const stored = await tx
    .select({
      artistId: schema.albumArtists.artistId,
      creditedAs: schema.albumArtists.creditedAs,
    })
    .from(schema.albumArtists)
    .where(eq(schema.albumArtists.albumId, albumId));
  const keep = new Map(stored.map((row) => [row.artistId, row.creditedAs]));
  // (album_id, position) is unique and not deferrable, so the credits are
  // replaced rather than renumbered in place.
  await tx
    .delete(schema.albumArtists)
    .where(eq(schema.albumArtists.albumId, albumId));
  await tx.insert(schema.albumArtists).values(
    credits.map((credit, index) => ({
      albumId,
      artistId: credit.artistId,
      position: index + 1,
      creditedAs:
        credit.creditedAs === undefined
          ? (keep.get(credit.artistId) ?? null)
          : credit.creditedAs,
    })),
  );
}

/**
 * Creates an album (the release group) with its one reference edition and its
 * ordered artist credits, in one transaction (data model: every album has a
 * reference edition). Titles are not unique. At least one credited artist is
 * required.
 */
export async function createAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<{ id: string }> {
  const data = parse(albumInput, input);
  return guarded(() =>
    db.transaction(async (tx) => {
      await assertArtistsLinkable(
        tx,
        data.credits.map((credit) => credit.artistId),
        new Set(),
      );
      const [album] = await tx
        .insert(schema.albums)
        .values({
          title: data.title,
          firstReleaseYear: data.firstReleaseYear,
          mbReleaseGroupId: data.mbReleaseGroupId,
        })
        .returning({ id: schema.albums.id });
      const albumId = album!.id;
      await tx
        .insert(schema.albumEditions)
        .values({ albumId, isReference: true, ...data.edition });
      await replaceAlbumCredits(tx, albumId, data.credits);
      return { id: albumId };
    }),
  );
}

/**
 * Updates the parts of an album that `patch` names, in one transaction; the
 * rest is unchanged. The album row is locked, so two concurrent edits run one
 * after the other and the credits never interleave.
 *
 * - `title` can be replaced, never cleared; the other album fields are cleared
 *   with `null`.
 * - `edition` is a patch of the reference edition: its fields left out are
 *   unchanged.
 * - `credits`, when present, is the complete new list (at least one artist, in
 *   credit order). An item that leaves out `creditedAs` keeps the stored one.
 *   Leaving `credits` out leaves the credits untouched.
 */
export async function updateAlbum(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  albumId: unknown,
  patch: unknown,
  given: CatalogEditOptions = {},
): Promise<void> {
  const { patch: edit, options } = withoutConfirmation(patch, given);
  const id = idOf(albumId);
  const { credits, edition, ...fields } = parse(albumPatch, edit);
  const creditedIds = [
    ...new Set((credits ?? []).map((credit) => credit.artistId)),
  ].sort();
  const subject: CatalogSubject = { kind: "album", id };
  await guarded(() =>
    db.transaction(async (tx) => {
      const confirmation = presentedConfirmation(author, subject, options);
      // Credits decide which artists have a public page (M3.5). The entries
      // first, then the album, then the credited artists (ADR 0006 § 7, L3),
      // then the decision: a credit that would put an artist on a public page
      // for the first time is refused, because no confirmation covers it;
      // the way to do it is to unpublish, change the credits, and publish
      // again, through the publication review.
      // ADR 0013 § 4.1: every entry the album's pages depend on, the album
      // (FOR UPDATE), its stored and new credited artists, and its tracks,
      // in that order; for a credit change also the journals of every album
      // crediting the new artists (A5's set). Decided only after.
      await lockAlbumCatalogChange(tx, id, {
        artistIds: creditedIds,
        creditJournalsOf: credits ? creditedIds : undefined,
      });
      await lockAlbum(tx, id);
      if (credits) {
        const linked = await linkedAlbumArtists(tx, id);
        await assertArtistsLinkable(tx, creditedIds, linked);
        const added = creditedIds.filter((artistId) => !linked.has(artistId));
        if ((await artistsNewlyExposedByCredit(tx, id, added)).length > 0) {
          throw new CatalogError("public_page");
        }
      }
      // ADR 0013 step 3: a change to what a served page renders needs the
      // author's confirmation, recomputed after the locks.
      await confirmCatalogChange(
        tx,
        subject,
        await albumChangeOf(tx, id, {
          title: fields.title,
          firstReleaseYear: fields.firstReleaseYear,
          label: edition?.label,
          credits,
        }),
        confirmation,
      );
      const albumFields = present(fields);
      if (Object.keys(albumFields).length > 0) {
        await tx
          .update(schema.albums)
          .set(albumFields)
          .where(eq(schema.albums.id, id));
      }

      const editionFields = present(edition ?? {});
      if (Object.keys(editionFields).length > 0) {
        const updated = await tx
          .update(schema.albumEditions)
          .set(editionFields)
          .where(
            and(
              eq(schema.albumEditions.albumId, id),
              eq(schema.albumEditions.isReference, true),
            ),
          )
          .returning({ id: schema.albumEditions.id });
        if (updated.length === 0) {
          await tx
            .insert(schema.albumEditions)
            .values({ albumId: id, isReference: true, ...editionFields });
        }
      }
      if (credits) {
        await replaceAlbumCredits(tx, id, credits);
      }
      await advanceAlbum(tx, id);
    }),
  );
}

/** The review of an album edit (ADR 0013 § 2); see `previewArtistChange`. */
export async function previewAlbumChange(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  albumId: unknown,
  patch: unknown,
): Promise<CatalogChangePreview> {
  const id = idOf(albumId);
  const { credits, edition, ...fields } = parse(albumPatch, patch);
  return guarded(() =>
    previewed(
      previewCatalogChange(db, author, { kind: "album", id }, (executor) =>
        albumChangeOf(executor, id, {
          title: fields.title,
          firstReleaseYear: fields.firstReleaseYear,
          label: edition?.label,
          credits,
        }),
      ),
    ),
  );
}

export async function archiveAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
): Promise<void> {
  const id = idOf(albumId);
  await guarded(async () => {
    const result = await db.execute(sql`
      update albums
         set archived_at = coalesce(archived_at, now()), updated_at = now()
       where id = ${id}
      returning id`);
    if (result.rows.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

export async function restoreAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
): Promise<void> {
  const id = idOf(albumId);
  await guarded(async () => {
    const updated = await db
      .update(schema.albums)
      .set({ archivedAt: null })
      .where(eq(schema.albums.id, id))
      .returning({ id: schema.albums.id });
    if (updated.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

/**
 * Deletes an album that no writing refers to, with its credits, edition, and
 * tracklist membership. Its tracks stay in the catalog. An album with a
 * journal (even one in Recently deleted) or a memory link is refused with
 * `in_use` by ON DELETE RESTRICT: archive it instead.
 */
export async function deleteAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
): Promise<void> {
  const id = idOf(albumId);
  await guarded(() =>
    db.transaction(async (tx) => {
      // ADR 0013 § 4.1: the album's entries and its tracks' memories, then
      // the album, before the delete (which decides nothing in its own
      // statement).
      await lockAlbumCatalogChange(tx, id);
      const deleted = await tx
        .delete(schema.albums)
        .where(eq(schema.albums.id, id))
        .returning({ id: schema.albums.id });
      if (deleted.length === 0) {
        throw new CatalogError("not_found");
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

async function replaceTrackCredits(
  tx: Transaction,
  trackId: string,
  artistIds: string[],
): Promise<void> {
  await tx
    .delete(schema.trackArtists)
    .where(eq(schema.trackArtists.trackId, trackId));
  if (artistIds.length > 0) {
    await tx.insert(schema.trackArtists).values(
      artistIds.map((artistId, index) => ({
        trackId,
        artistId,
        position: index + 1,
      })),
    );
  }
}

/**
 * Creates a track (a recording). It exists independently of albums. With
 * `albumId`, it is also appended to that album's tracklist, in the same
 * transaction.
 */
export async function createTrack(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<{ id: string }> {
  const { albumId, artistIds, ...fields } = parse(newTrackInput, input);
  return guarded(() =>
    db.transaction(async (tx) => {
      // ADR 0013 § 4.1: with an album, its entries, the album, and the named
      // artists are locked before anything is inserted (an insert first would
      // hold the artists' key-share locks out of order).
      if (albumId) {
        await lockAlbumCatalogChange(tx, albumId, { artistIds });
        await lockAlbumForTracklist(tx, albumId);
      }
      await assertArtistsLinkable(tx, artistIds, new Set());
      const [track] = await tx
        .insert(schema.tracks)
        .values(fields)
        .returning({ id: schema.tracks.id });
      const trackId = track!.id;
      await replaceTrackCredits(tx, trackId, artistIds);
      if (albumId) {
        const tracklist = await currentTracklist(tx, albumId);
        await rewriteTracklist(tx, albumId, [
          ...tracklist,
          { trackId, discNumber: tracklist.at(-1)?.discNumber ?? 1 },
        ]);
      }
      return { id: trackId };
    }),
  );
}

/**
 * Updates the fields of a track that `patch` names; the others are unchanged.
 * `title` can be replaced, never cleared. `lengthMs`, `credit` and
 * `mbRecordingId` are cleared with `null`. `artistIds`, when present, is the
 * complete new list of credited artists (an empty list removes them all, on
 * purpose); leaving it out leaves the credits untouched.
 */
export async function updateTrack(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  trackId: unknown,
  patch: unknown,
  given: CatalogEditOptions = {},
): Promise<void> {
  const { patch: edit, options } = withoutConfirmation(patch, given);
  const id = idOf(trackId);
  const { artistIds, ...fields } = parse(trackPatch, edit);
  const subject: CatalogSubject = { kind: "track", id };
  await guarded(() =>
    db.transaction(async (tx) => {
      const confirmation = presentedConfirmation(author, subject, options);
      // ADR 0013 § 4.1: the entries, then the albums containing the track,
      // then its stored and new artists, then the track (FOR UPDATE). The
      // album set read to plan the locks is never used to decide.
      await lockTrackCatalogChange(tx, id, artistIds ?? []);
      const locked = await tx.execute(
        sql`select id from tracks where id = ${id} for update`,
      );
      if (locked.rows.length === 0) {
        throw new CatalogError("not_found");
      }
      if (artistIds) {
        const linked = await tx
          .select({ artistId: schema.trackArtists.artistId })
          .from(schema.trackArtists)
          .where(eq(schema.trackArtists.trackId, id));
        await assertArtistsLinkable(
          tx,
          artistIds,
          new Set(linked.map((row) => row.artistId)),
        );
      }
      // ADR 0013 step 3: recomputed after the locks.
      await confirmCatalogChange(
        tx,
        subject,
        trackChangeOf(id, {
          title: fields.title,
          credit: fields.credit,
          artistIds,
        }),
        confirmation,
      );
      const trackFields = present(fields);
      if (Object.keys(trackFields).length > 0) {
        await tx
          .update(schema.tracks)
          .set(trackFields)
          .where(eq(schema.tracks.id, id));
      }
      if (artistIds) {
        await replaceTrackCredits(tx, id, artistIds);
      }
      await advanceTrack(tx, id);
    }),
  );
}

/** The review of a track edit (ADR 0013 § 2); see `previewArtistChange`. */
export async function previewTrackChange(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  trackId: unknown,
  patch: unknown,
): Promise<CatalogChangePreview> {
  const id = idOf(trackId);
  const { artistIds, ...fields } = parse(trackPatch, patch);
  return guarded(() =>
    previewed(
      previewCatalogChange(db, author, { kind: "track", id }, async () =>
        trackChangeOf(id, {
          title: fields.title,
          credit: fields.credit,
          artistIds,
        }),
      ),
    ),
  );
}

export async function archiveTrack(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  trackId: unknown,
): Promise<void> {
  const id = idOf(trackId);
  await guarded(async () => {
    const result = await db.execute(sql`
      update tracks
         set archived_at = coalesce(archived_at, now()), updated_at = now()
       where id = ${id}
      returning id`);
    if (result.rows.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

export async function restoreTrack(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  trackId: unknown,
): Promise<void> {
  const id = idOf(trackId);
  await guarded(async () => {
    const updated = await db
      .update(schema.tracks)
      .set({ archivedAt: null })
      .where(eq(schema.tracks.id, id))
      .returning({ id: schema.tracks.id });
    if (updated.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

/**
 * Deletes a track that is on no album and in no memory. A track on an album is
 * refused with `in_use` (ON DELETE RESTRICT on album membership): remove it
 * from the album first, which itself is refused while a reflection exists.
 */
export async function deleteTrack(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  trackId: unknown,
): Promise<void> {
  const id = idOf(trackId);
  await guarded(async () => {
    const deleted = await db
      .delete(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .returning({ id: schema.tracks.id });
    if (deleted.length === 0) {
      throw new CatalogError("not_found");
    }
  });
}

// ---------------------------------------------------------------------------
// The ordered tracklist of an album's reference edition
// ---------------------------------------------------------------------------

interface TracklistItem {
  trackId: string;
  discNumber: number;
}

async function referenceEditionId(
  tx: Transaction,
  albumId: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: schema.albumEditions.id })
    .from(schema.albumEditions)
    .where(
      and(
        eq(schema.albumEditions.albumId, albumId),
        eq(schema.albumEditions.isReference, true),
      ),
    );
  if (existing) {
    return existing.id;
  }
  const [created] = await tx
    .insert(schema.albumEditions)
    .values({ albumId, isReference: true })
    .returning({ id: schema.albumEditions.id });
  return created!.id;
}

// The album's recordings in reference-edition order. A member that has no
// position in the edition (possible only for data not written by these
// commands) follows the ordered ones, by title.
async function currentTracklist(
  tx: Transaction,
  albumId: string,
): Promise<TracklistItem[]> {
  const result = await tx.execute<{
    track_id: string;
    disc_number: number;
  }>(sql`
    select m.track_id, coalesce(et.disc_number, 1) as disc_number
      from album_tracks m
      join tracks t on t.id = m.track_id
      left join album_editions ed on ed.album_id = m.album_id and ed.is_reference
      left join edition_tracks et on et.edition_id = ed.id
                                 and et.track_id = m.track_id
     where m.album_id = ${albumId}
     order by (et.position is null), coalesce(et.disc_number, 1),
              et.position, t.title, t.id`);
  return result.rows.map((row) => ({
    trackId: row.track_id,
    discNumber: row.disc_number,
  }));
}

// Replaces the album's membership and the reference edition's order with
// `desired`, inside the caller's transaction, with the album row locked. The
// edition's rows are replaced rather than renumbered because
// (edition_id, disc_number, position) is unique and not deferrable. Nothing
// authored refers to edition_tracks, so this cannot touch writing; removing a
// recording that a reflection refers to is refused.
async function rewriteTracklist(
  tx: Transaction,
  albumId: string,
  desired: TracklistItem[],
): Promise<void> {
  const editionId = await referenceEditionId(tx, albumId);
  const current = await currentTracklist(tx, albumId);
  const currentIds = new Set(current.map((item) => item.trackId));
  const desiredIds = new Set(desired.map((item) => item.trackId));
  const added = desired
    .map((item) => item.trackId)
    .filter((trackId) => !currentIds.has(trackId));
  const removed = current
    .map((item) => item.trackId)
    .filter((trackId) => !desiredIds.has(trackId));

  if (added.length > 0) {
    const found = await tx
      .select({ id: schema.tracks.id, archivedAt: schema.tracks.archivedAt })
      .from(schema.tracks)
      .where(inArray(schema.tracks.id, added));
    if (found.length !== added.length) {
      throw new CatalogError("not_found");
    }
    if (found.some((track) => track.archivedAt !== null)) {
      throw new CatalogError("archived_reference");
    }
  }

  if (removed.length > 0) {
    const reflected = await tx
      .select({ trackId: schema.trackReflections.trackId })
      .from(schema.trackReflections)
      .where(
        and(
          eq(schema.trackReflections.albumId, albumId),
          inArray(schema.trackReflections.trackId, removed),
        ),
      )
      .limit(1);
    if (reflected.length > 0) {
      throw new CatalogError("in_use", { blockedBy: "reflections" });
    }
  }

  await tx
    .delete(schema.editionTracks)
    .where(eq(schema.editionTracks.editionId, editionId));
  if (removed.length > 0) {
    await tx
      .delete(schema.albumTracks)
      .where(
        and(
          eq(schema.albumTracks.albumId, albumId),
          inArray(schema.albumTracks.trackId, removed),
        ),
      );
  }
  if (added.length > 0) {
    await tx
      .insert(schema.albumTracks)
      .values(added.map((trackId) => ({ albumId, trackId })));
  }

  const nextPosition = new Map<number, number>();
  const rows = desired.map((item) => {
    const position = (nextPosition.get(item.discNumber) ?? 0) + 1;
    nextPosition.set(item.discNumber, position);
    return {
      editionId,
      albumId,
      trackId: item.trackId,
      discNumber: item.discNumber,
      position,
    };
  });
  if (rows.length > 0) {
    await tx.insert(schema.editionTracks).values(rows);
  }
}

/**
 * Sets an album's tracklist: which recordings belong to it, and their order
 * in the reference edition, in one transaction. A recording may be on several
 * albums and is never duplicated. New recordings must exist and not be
 * archived. A recording that a track reflection refers to cannot be removed
 * (`in_use`, blocked by `reflections`). `tracks` is the complete list: leaving
 * it out is refused, and a track that leaves out `discNumber` keeps its disc.
 */
export async function setAlbumTracklist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
  input: unknown,
): Promise<void> {
  const id = idOf(albumId);
  const data = parse(tracklistInput, input);
  await guarded(() =>
    db.transaction(async (tx) => {
      await lockAlbumCatalogChange(tx, id, {
        addedTrackIds: data.tracks.map((item) => item.trackId),
      });
      await lockAlbumForTracklist(tx, id);
      // A track that leaves out its disc keeps the one it is on now.
      const discs = new Map(
        (await currentTracklist(tx, id)).map((item) => [
          item.trackId,
          item.discNumber,
        ]),
      );
      await rewriteTracklist(
        tx,
        id,
        data.tracks.map((item) => ({
          trackId: item.trackId,
          discNumber: item.discNumber ?? discs.get(item.trackId) ?? 1,
        })),
      );
    }),
  );
}

/** Appends an existing track to the end of an album's tracklist. */
export async function addTrackToAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
  trackId: unknown,
): Promise<void> {
  const id = idOf(albumId);
  const track = idOf(trackId);
  await guarded(() =>
    db.transaction(async (tx) => {
      await lockAlbumCatalogChange(tx, id, { addedTrackIds: [track] });
      await lockAlbumForTracklist(tx, id);
      const tracklist = await currentTracklist(tx, id);
      if (tracklist.some((item) => item.trackId === track)) {
        return;
      }
      await rewriteTracklist(tx, id, [
        ...tracklist,
        { trackId: track, discNumber: tracklist.at(-1)?.discNumber ?? 1 },
      ]);
    }),
  );
}

/** Removes a track from an album's tracklist. The track stays in the catalog. */
export async function removeTrackFromAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
  trackId: unknown,
): Promise<void> {
  const id = idOf(albumId);
  const track = idOf(trackId);
  await guarded(() =>
    db.transaction(async (tx) => {
      await lockAlbumCatalogChange(tx, id);
      await lockAlbumForTracklist(tx, id);
      const tracklist = await currentTracklist(tx, id);
      if (!tracklist.some((item) => item.trackId === track)) {
        throw new CatalogError("not_found");
      }
      await rewriteTracklist(
        tx,
        id,
        tracklist.filter((item) => item.trackId !== track),
      );
    }),
  );
}

/**
 * Moves a track one place up or down in an album's tracklist, within its disc.
 * At the start or end of the list or of its disc it stays where it is, which is
 * not an error.
 */
export async function moveTrackInAlbum(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
  trackId: unknown,
  direction: unknown,
): Promise<void> {
  const id = idOf(albumId);
  const track = idOf(trackId);
  const way = parse(moveDirection, direction);
  await guarded(() =>
    db.transaction(async (tx) => {
      await lockAlbumCatalogChange(tx, id);
      await lockAlbumForTracklist(tx, id);
      const tracklist = await currentTracklist(tx, id);
      const index = tracklist.findIndex((item) => item.trackId === track);
      if (index === -1) {
        throw new CatalogError("not_found");
      }
      const target = way === "up" ? index - 1 : index + 1;
      // The start, the end, and a disc boundary are all ends: a track moves
      // within its own disc, so there is nothing to change.
      if (
        target < 0 ||
        target >= tracklist.length ||
        tracklist[target]!.discNumber !== tracklist[index]!.discNumber
      ) {
        return;
      }
      const moved = [...tracklist];
      [moved[index], moved[target]] = [moved[target]!, moved[index]!];
      await rewriteTracklist(tx, id, moved);
    }),
  );
}
