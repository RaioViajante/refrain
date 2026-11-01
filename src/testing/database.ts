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
