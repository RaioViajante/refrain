import { expect } from "vitest";

import { getDb, type Transaction } from "@/db";

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

export interface DatabaseErrorShape {
  /** PostgreSQL SQLSTATE, for example 23503 (foreign_key_violation). */
  code: string;
  /** Name of the violated constraint, when PostgreSQL reports one. */
  constraint?: string;
}

/** Finds the PostgreSQL error behind a Drizzle query error. */
export function databaseErrorOf(
  error: unknown,
): DatabaseErrorShape | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    if ("code" in current && typeof current.code === "string") {
      const constraint =
        "constraint" in current && typeof current.constraint === "string"
          ? current.constraint
          : undefined;
      return { code: current.code, constraint };
    }
    current = "cause" in current ? current.cause : undefined;
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

/** SQLSTATE codes used by the tests. */
export const SqlState = {
  notNullViolation: "23502",
  foreignKeyViolation: "23503",
  uniqueViolation: "23505",
  checkViolation: "23514",
} as const;
