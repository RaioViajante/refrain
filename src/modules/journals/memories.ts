import "server-only";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { z } from "zod";

import {
  databaseErrorOf,
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
  requirePublicChangeConfirmation,
  reserveInitialSlug,
  restoreDeletedEntry,
  unpublishLanguageVersion,
  verifyChangeConfirmation,
  type ProposedChange,
  type PublicChangePreview,
} from "@/modules/publication";
import { fieldErrorsOf } from "@/validation";

import { documentToText, editableText, textToDocument } from "./body";
import { translatePublication } from "./commands";
import { JournalError } from "./errors";
import {
  createMemoryInput,
  journalId,
  journalPrivacyInput,
  saveMemoryInput,
} from "./input";

// Memory commands (M3.6, M3.7): the studio's writing of the `memory` entry
// kind. Each validates its own input with Zod and runs in one transaction
// (docs/data-model.md § Transaction boundaries 2, 3, 4, 8, and 10), and each
// mutation takes the `AuthorizedAuthor` that only Identity can create.
//
// What these commands never do:
//
// - **Publish.** A memory starts as a `draft`, and the only visibility change
//   here goes through the Publication module's `unpublishLanguageVersion`,
//   which can reach only `draft` or `private`. Publishing is the memory
//   wrapper of the Publication engine (`memory-publishing.ts`), with a token
//   from a separate preview (ADR 0006 § 4).
// - **Change a public memory without a confirmation.** Saving a memory that
//   readers can see is the confirmed save of ADR 0006 § 5 (M3.7): anything it
//   would add to the public page, or change on it, needs a `change_public`
//   token for exactly that change, checked under the entry lock before the
//   first write. A save that only removes something (a song, the "when")
//   needs none.
// - **Touch another kind of entry.** Every command locks the entry joined to
//   the `memories` subtype table, so an album journal (or anything else) is
//   `entry_not_found` and its rows are never read for writing.
// - **Change the catalog.** A recording is linked and unlinked through
//   `memory_music` only. No explicit lock is taken on a catalog row (ADR 0006
//   § 7, L3): the checks are plain reads, and the foreign-key check of an
//   insert is the only catalog lock held.

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

interface LockedMemory {
  deleted: boolean;
  version: number;
}

// Locks the entry of a memory for the rest of the transaction (ADR 0006 § 7,
// L1), so saves, publications, privacy changes, deletions, and restores of one
// memory run one after the other. Joining the subtype table means an entry of
// another kind is never found.
//
// Whatever a command decides from the language versions or the memory's rows
// is read in later statements, after the lock is held. Read in the locking
// statement, they would come from the snapshot it started with: a publication
// that committed while this transaction waited for the lock would not be seen
// (READ COMMITTED re-reads only the locked row). The confirmed save's gate
// (`requirePublicChangeConfirmation`) reads them that way.
async function lockMemory(
  tx: Transaction,
  entryId: string,
): Promise<LockedMemory> {
  const result = await tx.execute<{ deleted: boolean; version: number }>(sql`
    select e.deleted_at is not null as deleted, e.version
      from entries e
      join memories m on m.entry_id = e.id
     where e.id = ${entryId}
       for update of e`);
  const row = result.rows[0];
  if (!row) {
    throw new JournalError("entry_not_found");
  }
  return { deleted: row.deleted, version: row.version };
}

/**
 * Checks recordings about to be linked: each exists (`track_not_found`), and
 * a recording that is not linked already is not archived (`track_archived`).
 * An archived recording that the memory already links stays linked: archiving
 * never takes music away from writing (Product, rule 6).
 */
async function checkRecordings(
  tx: Transaction,
  trackIds: readonly string[],
  alreadyLinked: ReadonlySet<string>,
): Promise<void> {
  if (trackIds.length === 0) {
    return;
  }
  const found = await tx
    .select({ id: schema.tracks.id, archivedAt: schema.tracks.archivedAt })
    .from(schema.tracks)
    .where(inArray(schema.tracks.id, [...trackIds]));
  const byId = new Map(found.map((track) => [track.id, track]));
  for (const trackId of trackIds) {
    const track = byId.get(trackId);
    if (!track) {
      throw new JournalError("track_not_found");
    }
    if (track.archivedAt && !alreadyLinked.has(trackId)) {
      throw new JournalError("track_archived");
    }
  }
}

/**
 * A recording deleted from the catalog between the check and the insert
 * becomes a domain failure, never a raw database error. (The link's foreign
 * key is what refuses it; nothing about the catalog changes.)
 */
function linkRefusal(error: unknown): unknown {
  return databaseErrorOf(error)?.constraint === "memory_music_track_fk"
    ? new JournalError("track_not_found")
    : error;
}

/**
 * Creates a memory, one transaction (data model, boundary 2): the entry, its
 * original English version as a `draft` with the title and the writing, the
 * memory row with its "when", the ordered recording links, and a reserved
 * slug. Nothing is published, translated, rated, or marked as a favourite,
 * and no album journal or track reflection is read or written.
 *
 * Refused: `invalid_input` (a blank title, a duplicated recording, text too
 * long), `track_not_found`, `track_archived`, `slug_unavailable`.
 */
export async function createMemory(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<{ entryId: string; version: number }> {
  const data = parse(createMemoryInput, input);
  return translatePublication(() =>
    db.transaction(async (tx) => {
      await checkRecordings(tx, data.trackIds, new Set());

      const [entry] = await tx
        .insert(schema.entries)
        .values({ kind: "memory" })
        .returning({ id: schema.entries.id });
      const entryId = entry!.id;

      const document = textToDocument(data.body);
      await tx.insert(schema.entryTexts).values({
        entryId,
        locale: data.locale,
        isOriginal: true,
        status: "draft",
        title: data.title,
        body: document,
        bodyText: document ? documentToText(document)! : "",
      });
      await tx
        .insert(schema.memories)
        .values({ entryId, rememberedWhen: data.rememberedWhen });
      if (data.trackIds.length > 0) {
        try {
          await tx.insert(schema.memoryMusic).values(
            data.trackIds.map((trackId, index) => ({
              memoryId: entryId,
              position: index + 1,
              trackId,
            })),
          );
        } catch (error) {
          throw linkRefusal(error);
        }
      }

      // The slug follows the title (ADR 0002, D7.2) and stays private until a
      // version is published. A title with no usable characters falls back
      // to "memory"; the address can be changed until the first publication.
      await reserveInitialSlug(
        tx,
        entryId,
        normalizeSlug(data.title) || "memory",
      );
      return { entryId, version: 1 };
    }),
  );
}

type ParsedMemorySave = z.output<typeof saveMemoryInput>;

/**
 * Validates a save against the stored rows, and returns what it would change
 * in the form the Publication module weighs (ADR 0006 § 5). Nothing is
 * written. Works inside the locked save and inside the preview's read-only
 * snapshot, so the two refuse exactly the same requests: `entry_not_found`,
 * `unsupported_content` (writing the plain editor cannot reproduce, or a list
 * for a memory that links an album, which the studio cannot show and would
 * otherwise drop), `track_not_found`, and `track_archived`.
 */
async function prepareMemoryChange(
  tx: Transaction,
  data: ParsedMemorySave,
): Promise<ProposedChange> {
  const change: ProposedChange = {};

  if (data.title !== undefined || data.body !== undefined) {
    const [stored] = await tx
      .select({
        locale: schema.entryTexts.locale,
        body: schema.entryTexts.body,
      })
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
    const version: NonNullable<ProposedChange["version"]> = {
      locale: stored.locale,
    };
    if (data.title !== undefined) {
      version.title = data.title;
    }
    if (data.body !== undefined) {
      // The stored text is only replaced when the editor reproduces it
      // exactly. Otherwise it is left untouched.
      if (editableText(stored.body) === null) {
        throw new JournalError("unsupported_content");
      }
      const document = textToDocument(data.body ?? "");
      version.body = {
        document,
        text: document ? documentToText(document)! : "",
      };
    }
    change.version = version;
  }

  const memory: NonNullable<ProposedChange["memory"]> = {};
  if (data.rememberedWhen !== undefined) {
    memory.rememberedWhen = data.rememberedWhen;
  }
  if (data.trackIds !== undefined) {
    const linked = await tx
      .select({
        trackId: schema.memoryMusic.trackId,
        albumId: schema.memoryMusic.albumId,
      })
      .from(schema.memoryMusic)
      .where(eq(schema.memoryMusic.memoryId, data.entryId));
    if (linked.some((link) => link.albumId !== null)) {
      throw new JournalError("unsupported_content");
    }
    await checkRecordings(
      tx,
      data.trackIds,
      new Set(linked.map((link) => link.trackId!)),
    );
    memory.trackIds = data.trackIds;
  }
  if (Object.keys(memory).length > 0) {
    change.memory = memory;
  }
  return change;
}

/**
 * Saves a memory, one transaction (data model, boundaries 3 and 8): its
 * title, its writing, its "when", and its ordered recordings, together or
 * not at all.
 *
 * - Optimistic concurrency: `expectedVersion` must equal `entries.version`
 *   once the entry is locked, or the save is refused as `version_conflict`
 *   and nothing is written. Every save bumps the version (ADR 0006 § 6).
 * - It is a patch: a field left out is unchanged, a save naming nothing is
 *   refused. `trackIds`, when named, is the whole ordered list: a recording
 *   left out is unlinked (the link row is deleted, never the recording), one
 *   kept keeps its link and takes its new place, and one added is checked
 *   like a new link (`track_not_found`, `track_archived`).
 * - **A confirmed save (ADR 0006 § 5).** When the memory is public and the
 *   save would add something to its page or change something on it (the
 *   title or the writing, longer or shorter; the "when"; a song added; the
 *   order of the songs), it needs a `confirmation` token from
 *   `previewMemoryChange` for exactly that change. Without one it is refused
 *   as `confirmation_required` and nothing is written; so is an expired,
 *   stale, or misbound one. A save that only removes something from the page
 *   (a song, the "when"), or changes nothing a reader sees, needs none. A
 *   public memory cannot be left without writing (`nothing_to_publish`).
 * - Refused, writing nothing: a memory in Recently deleted (`entry_deleted`),
 *   writing the plain editor cannot reproduce exactly (`unsupported_content`,
 *   for the body), and a list for a memory that links an album
 *   (`unsupported_content`: the studio links recordings only, and an album
 *   link is left untouched rather than dropped).
 * - Visibility is never touched.
 *
 * Returns the new version.
 */
export async function saveMemory(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<{ version: number }> {
  const data = parse(saveMemoryInput, input);
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
      const memory = await lockMemory(tx, data.entryId);
      if (memory.deleted) {
        throw new JournalError("entry_deleted");
      }
      if (memory.version !== data.expectedVersion) {
        throw new JournalError("version_conflict");
      }

      // Every check comes before the first write, so a refusal writes nothing.
      const change = await prepareMemoryChange(tx, data);
      // Nothing is written before this passes (ADR 0006 § 5).
      const { predicted } = await requirePublicChangeConfirmation(tx, author, {
        entryId: data.entryId,
        expectedVersion: data.expectedVersion,
        change,
        confirmation: presented,
      });

      if (change.version) {
        const text: { title?: string; body?: unknown; bodyText?: string } = {};
        if (change.version.title !== undefined) {
          text.title = change.version.title;
        }
        if (change.version.body !== undefined) {
          text.body = change.version.body?.document ?? null;
          text.bodyText = change.version.body?.text ?? "";
        }
        await tx
          .update(schema.entryTexts)
          .set(text)
          .where(
            and(
              eq(schema.entryTexts.entryId, data.entryId),
              eq(schema.entryTexts.isOriginal, true),
            ),
          );
      }
      if (change.memory?.rememberedWhen !== undefined) {
        await tx
          .update(schema.memories)
          .set({ rememberedWhen: change.memory.rememberedWhen })
          .where(eq(schema.memories.entryId, data.entryId));
      }
      if (change.memory?.trackIds !== undefined) {
        // The whole ordered list replaces the stored one. Only link rows
        // change: the recordings stay in the catalog. Written here, in the
        // save itself, because the writers of `memory_music` are a reviewed
        // list (ADR 0006 § 9).
        const next = change.memory.trackIds;
        const linked = await tx
          .select({ trackId: schema.memoryMusic.trackId })
          .from(schema.memoryMusic)
          .where(eq(schema.memoryMusic.memoryId, data.entryId))
          .orderBy(schema.memoryMusic.position, schema.memoryMusic.id);
        const current = linked.map((link) => link.trackId!);
        const unchanged =
          next.length === current.length &&
          next.every((trackId, index) => current[index] === trackId);
        if (!unchanged) {
          // Unlink what is left out.
          await tx
            .delete(schema.memoryMusic)
            .where(
              next.length === 0
                ? eq(schema.memoryMusic.memoryId, data.entryId)
                : and(
                    eq(schema.memoryMusic.memoryId, data.entryId),
                    notInArray(schema.memoryMusic.trackId, [...next]),
                  ),
            );
          // Kept links take their new places. (memory_id, position) is
          // unique and deferred to the commit, so a swap needs no detour.
          const kept = new Set(current);
          for (const [index, trackId] of next.entries()) {
            if (kept.has(trackId)) {
              await tx
                .update(schema.memoryMusic)
                .set({ position: index + 1 })
                .where(
                  and(
                    eq(schema.memoryMusic.memoryId, data.entryId),
                    eq(schema.memoryMusic.trackId, trackId),
                  ),
                );
            }
          }
          const added = next.flatMap((trackId, index) =>
            kept.has(trackId)
              ? []
              : [{ memoryId: data.entryId, position: index + 1, trackId }],
          );
          if (added.length > 0) {
            try {
              await tx.insert(schema.memoryMusic).values(added);
            } catch (error) {
              throw linkRefusal(error);
            }
          }
        }
      }

      const version = memory.version + 1;
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
 * Previews a save of a memory that may change its public page (ADR 0006 § 5):
 * the exposure delta, and, when there is one, a `change_public` confirmation
 * token for exactly that change. Takes the same input as `saveMemory`, makes
 * the same refusals (another kind, a deleted memory, a stale
 * `expectedVersion`, unsupported text, an album link, an unknown or archived
 * recording, a public memory left without writing), writes nothing, and holds
 * no lock: one read-only snapshot.
 *
 * Private writing: the delta is for an authorized request only. The token is
 * evidence that this server computed this change for this session, not proof
 * that the author read it. Only the studio's memory preview action calls it,
 * through `previewMemoryPublicChange`.
 */
export async function previewMemoryChange(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<PublicChangePreview> {
  // The token of a save is never an input to its own preview.
  const data = parse(saveMemoryInput, input);
  return translatePublication(() =>
    db.transaction(
      async (tx) => {
        const found = await tx.execute(sql`
          select 1 from memories where entry_id = ${data.entryId}`);
        if (found.rows.length === 0) {
          throw new JournalError("entry_not_found");
        }
        const change = await prepareMemoryChange(tx, data);
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
 * Sets one language version of a memory to `draft` or `private`, if it still
 * has the `expectedStatus` the author's screen showed (otherwise
 * `status_changed`). Nothing here can publish: the status is validated against
 * those two values, and the change goes through the Publication module's own
 * command. Moving a published version to one of them unpublishes it, which
 * only reduces what readers can see, and deletes nothing.
 */
export async function setMemoryPrivacy(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<void> {
  const data = parse(journalPrivacyInput, input);
  await translatePublication(() =>
    db.transaction(async (tx) => {
      const memory = await lockMemory(tx, data.entryId);
      if (memory.deleted) {
        throw new JournalError("entry_deleted");
      }
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
 * Moves a memory to Recently deleted by setting `deleted_at`. It is
 * recoverable and removes nothing: the writing, the recording links, and the
 * slug stay, and the catalog is untouched.
 */
export async function deleteMemory(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  entryId: unknown,
): Promise<void> {
  const id = parse(journalId, entryId);
  await db.transaction(async (tx) => {
    const memory = await lockMemory(tx, id);
    if (memory.deleted) {
      throw new JournalError("entry_deleted");
    }
    await tx
      .update(schema.entries)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.entries.id, id));
  });
}

/**
 * Restores a memory from Recently deleted, under the owner-accepted
 * restoration policy that album journals follow (docs/roadmap.md): `draft`
 * and `private` versions keep their status, `published` ones return as
 * `private`, and nothing is published. The writing, the recording links, the
 * publication history, the slugs, and `entries.version` are untouched.
 * A memory that is not in Recently deleted is `entry_not_deleted`, which is
 * also what a second, concurrent restore receives.
 */
export async function restoreMemory(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  entryId: unknown,
): Promise<{ madePrivate: Locale[] }> {
  const id = parse(journalId, entryId);
  return translatePublication(() =>
    db.transaction(async (tx) => {
      await lockMemory(tx, id);
      return restoreDeletedEntry(tx, id);
    }),
  );
}
