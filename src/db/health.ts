import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "./client";
import { DatabaseConfigError } from "./env";

/**
 * Runs `SELECT 1` and reports whether PostgreSQL answered. Failures are
 * logged on the server without connection details and are never thrown to
 * the caller.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await getDb().execute(sql`select 1`);
    return true;
  } catch (error) {
    console.error("Database connection check failed", describeFailure(error));
    return false;
  }
}

/**
 * A log-safe description of a database failure: a fixed configuration
 * message or an error code, never an error message, query, or parameters.
 */
export function describeFailure(
  error: unknown,
): Record<string, string | undefined> {
  if (error instanceof DatabaseConfigError) {
    return { reason: error.message };
  }
  return { code: findErrorCode(error) };
}

// Drizzle wraps driver errors in DrizzleQueryError, whose `cause` is the
// original error carrying the PostgreSQL SQLSTATE or the Node.js network code
// (such as ECONNREFUSED). The depth limit guards against cyclic causes.
function findErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    if ("code" in current && current.code !== undefined) {
      return String(current.code);
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}
