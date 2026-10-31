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

function describeFailure(error: unknown): Record<string, string | undefined> {
  if (error instanceof DatabaseConfigError) {
    return { reason: error.message };
  }
  // PostgreSQL SQLSTATE or Node network code, such as ECONNREFUSED.
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  return { code };
}
