/**
 * Thrown when the database configuration is missing, malformed, or points at
 * a database this tool may not use. Its message never contains the connection
 * string, which can include a password.
 */
export class DatabaseConfigError extends Error {
  override name = "DatabaseConfigError";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
 * Like `readDatabaseUrl`, but refuses any host other than this machine. The
 * new application has no hosted database, so schema tooling may only ever
 * reach the local Compose database, never the archived application's.
 */
export function readLocalDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = readDatabaseUrl(env);
  if (!LOOPBACK_HOSTS.has(new URL(value).hostname)) {
    throw new DatabaseConfigError(
      "DATABASE_URL must point at a local database (localhost, 127.0.0.1, or ::1).",
    );
  }
  return value;
}
