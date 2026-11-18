import { sql } from "drizzle-orm";
import { expect } from "vitest";

import {
  databaseErrorOf,
  getDb,
  SqlState,
  type DatabaseErrorShape,
  type Transaction,
} from "@/db";

export { databaseErrorOf, SqlState, type DatabaseErrorShape };

class RollbackSignal extends Error {}

/**
 * Runs `work` inside a transaction that is always rolled back, so a test
 * leaves nothing behind and never needs a destructive reset. Nested
 * `tx.transaction(...)` calls become savepoints.
 */
export async function inRollbackTransaction(
  work: (tx: Transaction) => Promise<void>,
): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await work(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}

const COUNTED_TABLES = [
  "artists",
  "albums",
  "album_artists",
  "album_editions",
  "tracks",
  "track_artists",
  "album_tracks",
  "edition_tracks",
  "entries",
  "entry_texts",
  "album_journals",
  "track_reflections",
  "entry_slugs",
] as const;

export type CountedTable = (typeof COUNTED_TABLES)[number];

let baseline: Record<string, number> = {};

async function tableCounts(tx: Transaction): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const result = await tx.execute<{ n: number }>(
      sql.raw(`select count(*)::int as n from ${table}`),
    );
    counts[table] = result.rows[0]!.n;
  }
  return counts;
}

/**
 * Like `inRollbackTransaction`, and records how many rows each counted table
 * has when the test starts, so `rowsAdded` is correct even if another suite
 * committed rows to the shared test database.
 */
export async function inScratchTransaction(
  work: (tx: Transaction) => Promise<void>,
): Promise<void> {
  await inRollbackTransaction(async (tx) => {
    baseline = await tableCounts(tx);
    await work(tx);
  });
}

/** How many rows `table` gained since `inScratchTransaction` began. */
export async function rowsAdded(
  tx: Transaction,
  table: CountedTable,
): Promise<number> {
  const result = await tx.execute<{ n: number }>(
    sql.raw(`select count(*)::int as n from ${table}`),
  );
  return result.rows[0]!.n - (baseline[table] ?? 0);
}

/**
 * Runs `work` in a savepoint and returns whatever it threw, or `undefined`.
 * The savepoint is rolled back on failure, so the outer test transaction
 * stays usable even when a statement fails.
 */
export async function captureFailure(
  tx: Transaction,
  work: (savepoint: Transaction) => Promise<unknown>,
): Promise<unknown> {
  try {
    await tx.transaction(async (savepoint) => {
      await work(savepoint);
    });
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Runs `work` in a savepoint and returns the error it raised, if any. */
export async function captureDatabaseError(
  tx: Transaction,
  work: (savepoint: Transaction) => Promise<unknown>,
): Promise<DatabaseErrorShape | undefined> {
  return tx
    .transaction(async (savepoint) => {
      await work(savepoint);
    })
    .then(
      () => undefined,
      (error: unknown) => {
        const databaseError = databaseErrorOf(error);
        if (!databaseError) {
          throw error;
        }
        return databaseError;
      },
    );
}

/**
 * Asserts that PostgreSQL rejects `work` with the given SQLSTATE and, when
 * given, the named constraint. The savepoint is rolled back, so the outer
 * test transaction stays usable.
 */
export async function expectRejected(
  tx: Transaction,
  expected: DatabaseErrorShape,
  work: (savepoint: Transaction) => Promise<unknown>,
): Promise<void> {
  const error = await captureDatabaseError(tx, work);
  expect(error, "PostgreSQL should have rejected the write").toBeDefined();
  expect(error).toMatchObject(
    expected.constraint === undefined ? { code: expected.code } : expected,
  );
}

/**
 * The SQLSTATE that the server under test reports when an `ON DELETE
 * RESTRICT` foreign key refuses to delete a row it refers to: 23503
 * (foreign_key_violation) on PostgreSQL 17, 23001 (restrict_violation) on
 * PostgreSQL 18. Tests expect exactly this code, so each supported version is
 * checked strictly rather than accepting either.
 */
export async function restrictedDeleteCode(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ server_version_num: string }>(
    sql`show server_version_num`,
  );
  const version = Number(result.rows[0]?.server_version_num);
  return version >= 180000
    ? SqlState.restrictViolation
    : SqlState.foreignKeyViolation;
}
