// Safety checks for the integration-test database.
//
// Integration tests write data, so they must never reach the development
// database or any database whose contents matter. They connect only to
// TEST_DATABASE_URL, never to DATABASE_URL, and refuse to run unless the
// target passes two independent checks:
//
// 1. Client side, before connecting: the URL is a PostgreSQL URL on this
//    machine (loopback host), its database name ends in `_test`, it has no
//    query parameters (node-postgres lets `?host=` and `?port=` override the
//    host and port the other checks validated), and it does not point at the
//    same database as DATABASE_URL.
// 2. Server side, after connecting: the database itself carries the
//    disposable-test marker, a database comment written only by
//    docker/postgres-test/01-mark-disposable.sql. Names can be mistyped; the
//    marker has to be placed on purpose.
//
// Error messages never contain a connection string, which can hold a password.

export const TEST_DATABASE_MARKER = "refrain:disposable-test-database";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TEST_DATABASE_NAME = /^[a-z0-9_]+_test$/;

export class TestDatabaseSafetyError extends Error {
  override name = "TestDatabaseSafetyError";
}

type Env = Readonly<Record<string, string | undefined>>;

interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
}

function parseTarget(value: string, variable: string): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TestDatabaseSafetyError(`${variable} is not a valid URL.`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new TestDatabaseSafetyError(
      `${variable} must use the postgres:// or postgresql:// scheme.`,
    );
  }
  if (url.search !== "") {
    throw new TestDatabaseSafetyError(
      `${variable} must not have query parameters, which can override its host or port.`,
    );
  }
  return {
    host: url.hostname.toLowerCase(),
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

/**
 * Returns TEST_DATABASE_URL after the client-side checks. Throws
 * TestDatabaseSafetyError when it is missing or suspicious. It never falls
 * back to DATABASE_URL.
 */
export function readTestDatabaseUrl(env: Env): string {
  const value = env.TEST_DATABASE_URL?.trim();
  if (!value) {
    throw new TestDatabaseSafetyError(
      "TEST_DATABASE_URL is not set. Integration tests never use DATABASE_URL. " +
        "Start the test database with `pnpm db:test:up` and set TEST_DATABASE_URL " +
        "(see .env.example and docs/development.md).",
    );
  }

  const target = parseTarget(value, "TEST_DATABASE_URL");

  if (!LOOPBACK_HOSTS.has(target.host)) {
    throw new TestDatabaseSafetyError(
      "TEST_DATABASE_URL must point to a database on this machine " +
        "(localhost, 127.0.0.1, or [::1]).",
    );
  }

  if (!TEST_DATABASE_NAME.test(target.database)) {
    throw new TestDatabaseSafetyError(
      "The database named in TEST_DATABASE_URL must end in `_test` " +
        "(lowercase letters, digits, and underscores).",
    );
  }

  const developmentValue = env.DATABASE_URL?.trim();
  if (developmentValue) {
    let development: DatabaseTarget | undefined;
    try {
      development = parseTarget(developmentValue, "DATABASE_URL");
    } catch {
      // A malformed DATABASE_URL, or one with query parameters, cannot be
      // compared reliably. TEST_DATABASE_URL has already passed its own
      // checks, and the server-side marker check still applies.
    }
    if (
      development &&
      development.database === target.database &&
      development.port === target.port &&
      (development.host === target.host ||
        (LOOPBACK_HOSTS.has(development.host) &&
          LOOPBACK_HOSTS.has(target.host)))
    ) {
      throw new TestDatabaseSafetyError(
        "TEST_DATABASE_URL and DATABASE_URL point to the same database. " +
          "Integration tests need their own disposable database.",
      );
    }
  }

  return value;
}

interface Queryable {
  query<Row extends Record<string, unknown>>(
    text: string,
  ): Promise<{ rows: Row[] }>;
}

/**
 * Verifies, on the server, that the connected database is a marked,
 * disposable test database. Throws TestDatabaseSafetyError otherwise.
 */
export async function assertDisposableTestDatabase(
  client: Queryable,
): Promise<void> {
  const { rows } = await client.query<{
    name: string;
    marker: string | null;
  }>(
    `select current_database() as name,
            shobj_description(oid, 'pg_database') as marker
       from pg_database
      where datname = current_database()`,
  );
  const database = rows[0];
  if (!database || !TEST_DATABASE_NAME.test(database.name)) {
    throw new TestDatabaseSafetyError(
      "The connected database is not named like a test database (`*_test`).",
    );
  }
  if (database.marker !== TEST_DATABASE_MARKER) {
    throw new TestDatabaseSafetyError(
      "The connected database is not marked as Refrain's disposable test " +
        "database. Use the `postgres-test` service (`pnpm db:test:up`); see " +
        "docs/development.md.",
    );
  }
}
