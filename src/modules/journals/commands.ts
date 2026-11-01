import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import { schema, type DatabaseExecutor, type Transaction } from "@/db";
import type { AuthorizedAuthor } from "@/modules/identity";
import {
  normalizeSlug,
  PublicationError,
  reserveInitialSlug,
  retireEntrySlugs,
  unpublishLanguageVersion,
} from "@/modules/publication";
import { fieldErrorsOf } from "@/validation";

import { documentToText, editableText, textToDocument } from "./body";
import { JournalError, type JournalFailure } from "./errors";
import {
  createAlbumJournalInput,
  journalId,
  journalPrivacyInput,
  saveAlbumJournalInput,
} from "./input";

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
}

// Locks the entry of an album journal for the rest of the transaction, so
// concurrent saves, privacy changes, and deletions run one after the other.
// Joining the subtype table means an entry of another kind is never found.
async function lockAlbumJournal(
  tx: Transaction,
  entryId: string,
): Promise<LockedJournal> {
  const result = await tx.execute<{ deleted: boolean; version: number }>(sql`
    select e.deleted_at is not null as deleted, e.version
      from entries e
      join album_journals j on j.entry_id = e.id
     where e.id = ${entryId}
       for update of e`);
  const row = result.rows[0];
  if (!row) {
    throw new JournalError("entry_not_found");
  }
  return row;
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
 * Saves the reflection and opening sentence of an album journal's original
 * language version, in one transaction.
 *
 * - Optimistic concurrency: `expectedVersion` must equal `entries.version`
 *   when the entry is locked, or the save is refused with `version_conflict`
 *   and nothing is written. Two editors never overwrite each other silently.
 * - A journal in Recently deleted cannot be saved.
 * - It is a patch (docs/data-model.md): `opening` and `body` left out are
 *   unchanged, and a save naming neither is refused. Clearing either is done on
 *   purpose with `null` or a blank string.
 * - Replacing the body of stored text that the plain editor would not
 *   reproduce exactly (see `editableText`) is refused, and the text is left
 *   untouched: `unsupported_content`. The opening sentence can still change.
 * - Visibility is never touched.
 *
 * Returns the new version.
 */
export async function saveAlbumJournal(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<{ version: number }> {
  const data = parse(saveAlbumJournalInput, input);
  return db.transaction(async (tx) => {
    const journal = await lockAlbumJournal(tx, data.entryId);
    if (journal.deleted) {
      throw new JournalError("entry_deleted");
    }
    if (journal.version !== data.expectedVersion) {
      throw new JournalError("version_conflict");
    }

    const [stored] = await tx
      .select({ body: schema.entryTexts.body })
      .from(schema.entryTexts)
      .where(
        and(
          eq(schema.entryTexts.entryId, data.entryId),
          eq(schema.entryTexts.isOriginal, true),
        ),
      );
    if (!stored) {
      throw new JournalError("entry_not_found");
    }
    // The stored text is only replaced when the save names a body. A save
    // that names only the opening sentence leaves the body exactly as it is,
    // whatever it holds.
    const changes: {
      opening?: string | null;
      body?: unknown;
      bodyText?: string;
    } = {};
    if (data.opening !== undefined) {
      changes.opening = data.opening;
    }
    if (data.body !== undefined) {
      if (editableText(stored.body) === null) {
        throw new JournalError("unsupported_content");
      }
      const document = textToDocument(data.body ?? "");
      changes.body = document;
      changes.bodyText = document ? documentToText(document)! : "";
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
    const version = journal.version + 1;
    await tx
      .update(schema.entries)
      .set({ version })
      .where(eq(schema.entries.id, data.entryId));
    return { version };
  });
}

/**
 * Sets one language version of an album journal to `draft` or `private`.
 * Nothing here can publish: the status is validated against those two values,
 * and the change goes through the Publication module's own command, which
 * refuses a deleted entry. Moving a version that is currently published to one
 * of them unpublishes it and deletes nothing.
 */
export async function setAlbumJournalPrivacy(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<void> {
  const data = parse(journalPrivacyInput, input);
  await translatePublication(() =>
    db.transaction(async (tx) => {
      const journal = await lockAlbumJournal(tx, data.entryId);
      if (journal.deleted) {
        throw new JournalError("entry_deleted");
      }
      await unpublishLanguageVersion(
        tx,
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

// Publication failures that a journal command can cause, as journal failures.
async function translatePublication<Result>(
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
        case "invalid_status":
          throw new JournalError("invalid_input");
        case "slug_taken":
        case "invalid_slug":
          throw new JournalError("slug_unavailable");
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
