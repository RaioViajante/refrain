import "server-only";

import { sql } from "drizzle-orm";

import type { EntryKind, Transaction } from "@/db";

import { PublicationError } from "./errors";

// The entry row is the lock for everything the entry owns (ADR 0006 § 7, L1).
// Internal to the Publication module.

export interface LockedEntry {
  kind: EntryKind;
  deleted: boolean;
  everPublished: boolean;
}

/**
 * Locks the entry row for the rest of the transaction, so concurrent
 * transitions on the same entry run one after the other.
 */
export async function lockEntry(
  tx: Transaction,
  entryId: string,
): Promise<LockedEntry> {
  const result = await tx.execute<{
    kind: EntryKind;
    deleted: boolean;
    ever_published: boolean;
  }>(sql`
    select kind, deleted_at is not null as deleted,
           first_published_at is not null as ever_published
      from entries
     where id = ${entryId}
       for update`);
  const row = result.rows[0];
  if (!row) {
    throw new PublicationError("entry_not_found");
  }
  return {
    kind: row.kind,
    deleted: row.deleted,
    everPublished: row.ever_published,
  };
}

export async function lockLiveEntry(tx: Transaction, entryId: string) {
  const entry = await lockEntry(tx, entryId);
  if (entry.deleted) {
    throw new PublicationError("entry_deleted");
  }
  return entry;
}
