import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor } from "@/db";
import { retireEntrySlugs } from "@/modules/publication";

export type JournalFailure = "entry_not_found" | "entry_not_deleted";

export class JournalError extends Error {
  override name = "JournalError";
  constructor(readonly failure: JournalFailure) {
    super(`Journal operation refused: ${failure}`);
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
