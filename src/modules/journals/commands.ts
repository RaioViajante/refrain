import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import {
  schema,
  type DatabaseExecutor,
  type Locale,
  type Transaction,
} from "@/db";
import type { AuthorizedAuthor } from "@/modules/identity";
import {
  assertWrittenAsPredicted,
  normalizeSlug,
  previewPublicChange,
  PublicationError,
  requirePublicChangeConfirmation,
  reserveInitialSlug,
  restoreDeletedEntry,
  retireEntrySlugs,
  unpublishLanguageVersion,
  verifyChangeConfirmation,
  type PublicChangePreview,
} from "@/modules/publication";
import { fieldErrorsOf } from "@/validation";

import { documentToText, textToDocument } from "./body";
import { JournalError, type JournalFailure } from "./errors";
import {
  createAlbumJournalInput,
  journalId,
  journalPrivacyInput,
  saveAlbumJournalInput,
} from "./input";
import { prepareChange, writeReflection } from "./reflections";

export { JournalError, type JournalFailure };

// Journal commands. Each validates its own input with Zod and runs in one
// transaction (docs/data-model.md § Transaction boundaries). Mutations take
// the `AuthorizedAuthor` that only the Identity module can create, so
// presentation code cannot call one before authorizing the request.
//
// This module never changes visibility on its own: a journal starts as a
// `draft`, and the only visibility change offered here goes through the
// Publication module and can only reach `draft` or `private`.

function parse<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new JournalError("invalid_input", {
      fields: fieldErrorsOf(result.error),
    });
  }
  return result.data;
}

interface LockedJournal {
  deleted: boolean;
  version: number;
  albumId: string;
}

// Locks the entry of an album journal for the rest of the transaction, so
// concurrent saves, privacy changes, and deletions run one after the other.
// Joining the subtype table means an entry of another kind is never found.
async function lockAlbumJournal(
  tx: Transaction,
  entryId: string,
): Promise<LockedJournal> {
  const result = await tx.execute<{
    deleted: boolean;
    version: number;
    album_id: string;
  }>(sql`
    select e.deleted_at is not null as deleted, e.version, j.album_id
      from entries e
      join album_journals j on j.entry_id = e.id
     where e.id = ${entryId}
       for update of e`);
  const row = result.rows[0];
  if (!row) {
    throw new JournalError("entry_not_found");
  }
  return { deleted: row.deleted, version: row.version, albumId: row.album_id };
}

/**
 * Creates an album journal, one transaction (data model, boundary 2): the
 * entry, its original language version as a `draft`, the album-journal row,
 * and its reserved slug. An album may have several independent journals
 * (ADR 0002, D1.1), so nothing here limits their number.
 *
 * The writing is stored as the accepted document format, and the language it
 * is written in is recorded as the original. Nothing is published,
 * translated, or featured.
 */
export async function createAlbumJournal(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<{ entryId: string; version: number }> {
  const data = parse(createAlbumJournalInput, input);
  return translatePublication(() =>
    db.transaction(async (tx) => {
      const [album] = await tx
        .select({
          title: schema.albums.title,
          archivedAt: schema.albums.archivedAt,
        })
        .from(schema.albums)
        .where(eq(schema.albums.id, data.albumId));
      if (!album) {
        throw new JournalError("album_not_found");
      }
      if (album.archivedAt) {
        throw new JournalError("album_archived");
      }

      const [entry] = await tx
        .insert(schema.entries)
        .values({ kind: "album_journal" })
        .returning({ id: schema.entries.id });
      const entryId = entry!.id;

      const document = textToDocument(data.body);
      await tx.insert(schema.entryTexts).values({
        entryId,
        locale: data.locale,
        isOriginal: true,
        status: "draft",
        opening: data.opening,
        body: document,
        bodyText: document ? documentToText(document)! : "",
      });
      await tx
        .insert(schema.albumJournals)
        .values({ entryId, albumId: data.albumId });

      // The slug follows the album's title (ADR 0002, D7.2). A title with no
      // usable characters falls back to "journal"; the address can be changed
      // until the first publication.
      await reserveInitialSlug(
        tx,
        entryId,
        normalizeSlug(album.title) || "journal",
      );
      return { entryId, version: 1 };
    }),
  );
}

/**
 * Saves an album journal, one transaction (data model, boundary 3): the
 * opening sentence and reflection of its original language version, the album
 * rating, and any number of track reflections, each with its texts per
 * language, its favourite mark, "still writing" label, rating, and its
 * "show on the public page" flag.
 *
 * - Optimistic concurrency: `expectedVersion` must equal `entries.version`
 *   once the entry is locked, or the save is refused with `version_conflict`
 *   and nothing is written. Every save of anything the entry owns bumps the
 *   version (ADR 0006 § 6), so two editors never overwrite each other.
 * - A journal in Recently deleted cannot be saved.
 * - It is a patch (docs/data-model.md): a field left out is unchanged, and a
 *   save naming nothing is refused. Clearing is done on purpose with `null`
 *   or a blank string. A reflection's text in one language never touches
 *   another language, and flags or ratings never touch its text.
 * - A reflection exists for a recording of the journal's album
 *   (`track_not_in_album`), and a new one cannot start on an archived
 *   recording (`track_archived`); an existing one stays editable.
 * - Replacing text that the plain editor would not reproduce exactly is
 *   refused, and the text is left untouched: `unsupported_content`.
 * - **A confirmed save (ADR 0006 § 5).** When the save would change what a
 *   reader sees of a public journal, anything added or edited on the public
 *   page (a text, longer or shorter, a rating, a mark, a flag turned on, text
 *   added to a flagged reflection in a public language), it needs a
 *   `confirmation` token from `previewAlbumJournalChange` for exactly that
 *   change. Without one it is refused as `confirmation_required` and nothing
 *   is written; so is an expired, stale, or misbound one. A save that only
 *   removes something from the public page, or changes nothing a reader
 *   sees, needs none. The studio's change dialog obtains the token from
 *   `previewAlbumJournalPublicChange` and sends it only from its confirm
 *   control (M2.3).
 * - Visibility is never touched, and a reflection's flag alone never makes
 *   anything public: the publication predicate still decides.
 *
 * Returns the new version.
 */
export async function saveAlbumJournal(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<{ version: number }> {
  const data = parse(saveAlbumJournalInput, input);
  return translatePublication(async () => {
    // A pure computation: a forged token is refused before it holds a lock.
    const presented =
      data.confirmation === undefined
        ? undefined
        : verifyChangeConfirmation(author, data.confirmation, {
            entryId: data.entryId,
            expectedVersion: data.expectedVersion,
          });
    return db.transaction(async (tx) => {
      const journal = await lockAlbumJournal(tx, data.entryId);
      if (journal.deleted) {
        throw new JournalError("entry_deleted");
      }
      if (journal.version !== data.expectedVersion) {
        throw new JournalError("version_conflict");
      }

      const change = await prepareChange(tx, data, journal);
      // Nothing is written before this passes (ADR 0006 § 5).
      const { predicted } = await requirePublicChangeConfirmation(tx, author, {
        entryId: data.entryId,
        expectedVersion: data.expectedVersion,
        change,
        confirmation: presented,
      });

      // The stored text is only replaced when the save names it. A save that
      // names only the opening sentence leaves the body exactly as it is.
      if (change.version) {
        const changes: {
          opening?: string | null;
          body?: unknown;
          bodyText?: string;
        } = {};
        if (change.version.opening !== undefined) {
          changes.opening = change.version.opening;
        }
        if (change.version.body !== undefined) {
          changes.body = change.version.body?.document ?? null;
          changes.bodyText = change.version.body?.text ?? "";
        }
        await tx
          .update(schema.entryTexts)
          .set(changes)
          .where(
            and(
              eq(schema.entryTexts.entryId, data.entryId),
              eq(schema.entryTexts.isOriginal, true),
            ),
          );
      }
      if (change.albumRating !== undefined) {
        await tx
          .update(schema.albumJournals)
          .set({ ratingHalfSteps: change.albumRating })
          .where(eq(schema.albumJournals.entryId, data.entryId));
      }
      for (const reflection of change.reflections ?? []) {
        await writeReflection(tx, data.entryId, journal.albumId, reflection);
      }

      const version = journal.version + 1;
      await tx
        .update(schema.entries)
        .set({ version })
        .where(eq(schema.entries.id, data.entryId));
      // What a reader sees must be exactly what was confirmed.
      await assertWrittenAsPredicted(tx, predicted);
      return { version };
    });
  });
}

/**
 * Previews a save of an album journal that changes a public page (ADR 0006
 * § 5): the exposure delta, the atoms that a reader would see added or
 * edited, and, when there is one, a `change_public` confirmation token for
 * exactly that change. Takes the same input as `saveAlbumJournal`, makes the
 * same refusals (a deleted journal, a stale `expectedVersion`, unsupported
 * text, an unknown track, a public version left empty), and writes nothing and
 * holds no lock: one read-only snapshot.
 *
 * Private writing: the delta is for an authorized request only. The token is
 * evidence that this server computed this change for this session, not proof
 * that the author read it. Only the studio's preview action calls it, through
 * `previewAlbumJournalPublicChange` (M2.3).
 */
export async function previewAlbumJournalChange(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<PublicChangePreview> {
  // The token of a save is never an input to its own preview.
  const data = parse(saveAlbumJournalInput, input);
  return translatePublication(() =>
    db.transaction(
      async (tx) => {
        const result = await tx.execute<{
          album_id: string;
        }>(sql`
          select j.album_id
            from album_journals j
           where j.entry_id = ${data.entryId}`);
        const journal = result.rows[0];
        if (!journal) {
          throw new JournalError("entry_not_found");
        }
        const change = await prepareChange(tx, data, {
          albumId: journal.album_id,
        });
        return previewPublicChange(tx, author, {
          entryId: data.entryId,
          expectedVersion: data.expectedVersion,
          change,
        });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    ),
  );
}

/**
 * Sets one language version of an album journal to `draft` or `private`, if
 * it still has the `expectedStatus` the author's screen showed (otherwise
 * `status_changed`, and nothing changes).
 * Nothing here can publish: the status is validated against those two values,
 * and the change goes through the Publication module's own command, which
 * refuses a deleted entry. Moving a version that is currently published to one
 * of them unpublishes it and deletes nothing.
 */
export async function setAlbumJournalPrivacy(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<void> {
  const data = parse(journalPrivacyInput, input);
  await translatePublication(() =>
    db.transaction(async (tx) => {
      const journal = await lockAlbumJournal(tx, data.entryId);
      if (journal.deleted) {
        throw new JournalError("entry_deleted");
      }
      // Under the entry lock: the version must still be what the author saw.
      const current = await tx.execute<{ status: string }>(sql`
        select status from entry_texts
         where entry_id = ${data.entryId} and locale = ${data.locale}`);
      if (current.rows.length === 0) {
        throw new JournalError("entry_not_found");
      }
      if (current.rows[0]!.status !== data.expectedStatus) {
        throw new JournalError("status_changed");
      }
      await unpublishLanguageVersion(
        tx,
        author,
        data.entryId,
        data.locale,
        data.status,
      );
    }),
  );
}

/**
 * Moves an album journal to Recently deleted by setting `deleted_at`. It is
 * recoverable and removes nothing: the writing, its versions, and its slug
 * stay. It is not a visibility state (ADR 0002, D4.2). The only permanent
 * deletion is `permanentlyDeleteEntry`, which the studio does not offer yet.
 */
export async function deleteAlbumJournal(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  entryId: unknown,
): Promise<void> {
  const id = parse(journalId, entryId);
  await db.transaction(async (tx) => {
    const journal = await lockAlbumJournal(tx, id);
    if (journal.deleted) {
      throw new JournalError("entry_deleted");
    }
    await tx
      .update(schema.entries)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.entries.id, id));
  });
}

/**
 * Restores an album journal from Recently deleted, one transaction, under the
 * owner-accepted restoration policy (docs/roadmap.md): `draft` and `private`
 * language versions keep their status, `published` ones return as `private`,
 * and nothing is published. The writing, the publication history, and the
 * slugs are untouched. See `restoreDeletedEntry` for the exact guarantees.
 *
 * - The entry row is locked first (`lockAlbumJournal`), which also admits only
 *   album journals, so an entry of another kind is `entry_not_found`.
 * - A journal that is not in Recently deleted is refused as
 *   `entry_not_deleted` and nothing changes. A repeated restore, or the loser
 *   of two concurrent restores, receives that same refusal.
 *
 * Returns the locales that were published and are now private, so the studio
 * can say so.
 */
export async function restoreAlbumJournal(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  entryId: unknown,
): Promise<{ madePrivate: Locale[] }> {
  const id = parse(journalId, entryId);
  return translatePublication(() =>
    db.transaction(async (tx) => {
      await lockAlbumJournal(tx, id);
      return restoreDeletedEntry(tx, id);
    }),
  );
}

// Publication failures that a journal command can cause, as journal failures.
export async function translatePublication<Result>(
  work: () => Promise<Result>,
): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PublicationError) {
      switch (error.failure) {
        case "entry_not_found":
        case "version_not_found":
          throw new JournalError("entry_not_found");
        case "entry_deleted":
          throw new JournalError("entry_deleted");
        case "entry_not_deleted":
          throw new JournalError("entry_not_deleted");
        case "invalid_status":
        case "invalid_input":
          throw new JournalError("invalid_input");
        case "slug_taken":
        case "invalid_slug":
          throw new JournalError("slug_unavailable");
        case "version_conflict":
          throw new JournalError("version_conflict");
        case "unavailable":
        case "nothing_to_publish":
        case "no_current_slug":
        case "confirmation_invalid":
          throw new JournalError(error.failure);
        case "confirmation_required":
        case "confirmation_expired":
        case "confirmation_stale":
          throw new JournalError(error.failure, {}, error.delta);
      }
    }
    throw error;
  }
}

/**
 * "Delete now": permanently deletes an entry that is already in Recently
 * deleted (ADR 0002, D4.4; data model, transaction boundary 9). It is the
 * only permanent deletion; nothing deletes entries automatically.
 *
 * In one transaction, the entry's published slugs are retired and its other
 * slugs released (ADR 0003), then the entry is deleted with everything it
 * owns: language versions, subtype row, track reflections and their texts,
 * and memory links. Catalog records are never affected.
 */
export async function permanentlyDeleteEntry(
  db: DatabaseExecutor,
  entryId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx.execute<{ deleted: boolean }>(sql`
      select deleted_at is not null as deleted
        from entries where id = ${entryId} for update`);
    const entry = result.rows[0];
    if (!entry) {
      throw new JournalError("entry_not_found");
    }
    if (!entry.deleted) {
      throw new JournalError("entry_not_deleted");
    }
    await retireEntrySlugs(tx, entryId);
    await tx.execute(sql`delete from entries where id = ${entryId}`);
  });
}
