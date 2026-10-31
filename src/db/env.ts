/**
 * Thrown when the database configuration is missing or malformed. Its message
 * never contains the connection string, which can include a password.
 */
export class DatabaseConfigError extends Error {
  override name = "DatabaseConfigError";
}

/**
 * Returns the validated PostgreSQL connection string from `DATABASE_URL`.
 * Pure function with no `server-only` guard, because Drizzle Kit's config
 * also uses it outside the Next.js runtime.
 */
export function readDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = env.DATABASE_URL?.trim();
  if (!value) {
    throw new DatabaseConfigError(
      "DATABASE_URL is not set. Copy .env.example to .env (see docs/development.md).",
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
