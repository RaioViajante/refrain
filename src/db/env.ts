/**
 * Thrown when the database configuration is missing, malformed, or points at
 * a database this tool may not use. Its message never contains the connection
 * string, which can include a password.
 */
export class DatabaseConfigError extends Error {
  override name = "DatabaseConfigError";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The archived music diary's local databases (archive/music-diary-v3/
// compose.yaml and its .env). A checkout that still holds that application's
// .env would otherwise point schema tooling at its development data.
const ARCHIVED_DATABASE_NAMES = new Set(["refrain", "refrain_test"]);

/**
 * Returns the validated PostgreSQL connection string from `DATABASE_URL`.
 * Pure, with no `server-only` guard, because Drizzle Kit's config uses it
 * outside the Next.js runtime.
 */
export function readDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = env.DATABASE_URL?.trim();
  if (!value) {
    throw new DatabaseConfigError(
      "DATABASE_URL is not set. Copy .env.example to .env.",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DatabaseConfigError("DATABASE_URL is not a valid URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DatabaseConfigError(
      "DATABASE_URL must use the postgres:// or postgresql:// scheme.",
    );
  }

  return value;
}

/**
 * Like `readDatabaseUrl`, but refuses any host other than this machine, and
 * the archived application's local databases. The application has no hosted
 * database, so schema tooling may only reach its own local Compose database.
 */
export function readLocalDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = readDatabaseUrl(env);
  const url = new URL(value);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new DatabaseConfigError(
      "DATABASE_URL must point at a local database (localhost, 127.0.0.1, or ::1).",
    );
  }
  if (ARCHIVED_DATABASE_NAMES.has(databaseName(url))) {
    throw new DatabaseConfigError(
      "DATABASE_URL names the archived music diary's local database. Use this application's own database (see .env.example).",
    );
  }
  return value;
}

/**
 * The disposable integration-test database (compose.yaml, `postgres-test`).
 * Refuses any host other than this machine and any database whose name does
 * not end in `_test`, so tests can never truncate real data.
 */
export const DEFAULT_TEST_DATABASE_URL =
  "postgres://refrain_test:refrain_test@127.0.0.1:5443/refrain_mixtapes_test";

export function readTestDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = readLocalDatabaseUrl({
    DATABASE_URL: env.TEST_DATABASE_URL?.trim() || DEFAULT_TEST_DATABASE_URL,
  });
  if (!databaseName(new URL(value)).endsWith("_test")) {
    throw new DatabaseConfigError(
      "TEST_DATABASE_URL must name a disposable database ending in _test.",
    );
  }
  return value;
}

function databaseName(url: URL): string {
  try {
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    throw new DatabaseConfigError(
      "DATABASE_URL has a malformed database name.",
    );
  }
}
