// Safety checks for the integration-test database.
//
// Integration tests write data, so they must never reach the development
// database or any database whose contents matter. They connect only to
// TEST_DATABASE_URL, never to DATABASE_URL, and refuse to run unless the
// target passes two independent checks:
//
// 1. Client side, before connecting. The checks compare *effective* targets:
//    the host, port, and database that node-postgres would actually connect
//    to, after query parameters such as `?host=` and `?port=` and its
//    defaults are applied. TEST_DATABASE_URL must be a PostgreSQL URL without
//    query parameters whose effective host is loopback and whose effective
//    database ends in `_test`. If DATABASE_URL is set, it must be parseable
//    and must not resolve to the same database; anything that cannot be
//    compared unambiguously is refused, never skipped.
// 2. Server side, after connecting: the database itself carries the
//    disposable-test marker, a database comment written only by
//    docker/postgres-test/01-mark-disposable.sql. Names can be mistyped; the
//    marker has to be placed on purpose.
//
// Error messages never contain a connection string, user, or password.

import { Client } from "pg";

export const TEST_DATABASE_MARKER = "refrain:disposable-test-database";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TEST_DATABASE_NAME = /^[a-z0-9_]+_test$/;

export class TestDatabaseSafetyError extends Error {
  override name = "TestDatabaseSafetyError";
}

type Env = Readonly<Record<string, string | undefined>>;

/** Where node-postgres would connect: host, port, and database. */
export interface EffectiveTarget {
  /** Lowercase host without brackets, or a Unix-socket directory path. */
  host: string;
  port: number;
  database: string;
}

function assertPostgresUrl(value: string, variable: string): URL {
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
  return url;
}

/**
 * The effective target of a connection string, resolved by node-postgres
 * itself (constructing a Client parses the string; it does not connect).
 * Throws TestDatabaseSafetyError when the target is ambiguous.
 */
export function effectiveTarget(
  connectionString: string,
  variable: string,
): EffectiveTarget {
  let client: Client;
  try {
    client = new Client({ connectionString });
  } catch {
    throw new TestDatabaseSafetyError(`${variable} cannot be parsed.`);
  }
  const host = String(client.host ?? "")
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  const database = String(client.database ?? "");
  if (host === "" || host.includes(",") || database === "") {
    throw new TestDatabaseSafetyError(
      `${variable} does not name exactly one host and one database.`,
    );
  }
  return { host, port: Number(client.port), database };
}

// Loopback names and Unix sockets all reach a server on this machine, so
// they are treated as the same host when comparing targets.
function isLocal(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.startsWith("/");
}

function sameDatabase(a: EffectiveTarget, b: EffectiveTarget): boolean {
  return (
    a.database === b.database &&
    a.port === b.port &&
    (a.host === b.host || (isLocal(a.host) && isLocal(b.host)))
  );
}

/**
 * Returns TEST_DATABASE_URL after the client-side checks. Throws
 * TestDatabaseSafetyError when it is missing, suspicious, or cannot be
 * proven distinct from DATABASE_URL. It never falls back to DATABASE_URL.
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

  const url = assertPostgresUrl(value, "TEST_DATABASE_URL");
  if (url.search !== "") {
    throw new TestDatabaseSafetyError(
      "TEST_DATABASE_URL must not have query parameters, which can override its host or port.",
    );
  }
  const target = effectiveTarget(value, "TEST_DATABASE_URL");

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
    // Refused rather than skipped: if DATABASE_URL cannot be resolved, the
    // test database cannot be proven to be a different database.
    let development: EffectiveTarget;
    try {
      assertPostgresUrl(developmentValue, "DATABASE_URL");
      development = effectiveTarget(developmentValue, "DATABASE_URL");
    } catch (error) {
      const reason =
        error instanceof TestDatabaseSafetyError ? ` (${error.message})` : "";
      throw new TestDatabaseSafetyError(
        `DATABASE_URL is set but its target cannot be determined${reason}, ` +
          "so the test database cannot be proven distinct. Fix or unset DATABASE_URL.",
      );
    }
    if (sameDatabase(development, target)) {
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
