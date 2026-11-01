import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { schema, type Database } from "@/db";

import {
  assertDisposableTestDatabase,
  TestDatabaseSafetyError,
} from "./test-database";

// The URL these connections use. Global setup validated TEST_DATABASE_URL with
// the five safety checks, and the worker setup then pinned the application's
// DATABASE_URL to that validated value. The checks are not repeated here
// (they would refuse, by design, because DATABASE_URL is now the test URL).
// Instead this requires that both are present and identical, which proves
// that this is the pinned URL and not anything else, and every connection is
// then verified on the server (a `*_test` name and the disposable marker).
function pinnedTestUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL) {
    throw new TestDatabaseSafetyError(
      "Concurrency tests connect only to the test database that the worker " +
        "setup pinned. TEST_DATABASE_URL is missing or differs from it.",
    );
  }
  return url;
}

// Support for concurrency tests. The integration tests normally run inside
// one rolled-back transaction, which cannot show a race. These tests open
// several real connections to the disposable test database, commit their
// rows, and remove them afterwards. Every connection first passes the
// server-side disposable-database check, so nothing here can reach the
// development database.

/**
 * Runs `work` with `count` independent database connections, each with its
 * own pool of one connection, and closes them afterwards.
 */
export async function withConnections<Result>(
  count: number,
  work: (databases: Database[]) => Promise<Result>,
): Promise<Result> {
  const pools = Array.from(
    { length: count },
    () =>
      new Pool({
        connectionString: pinnedTestUrl(),
        max: 1,
        application_name: "refrain-concurrency-tests",
      }),
  );
  try {
    for (const pool of pools) {
      await assertDisposableTestDatabase(pool);
    }
    return await work(pools.map((pool) => drizzle({ client: pool, schema })));
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
  }
}

/** A synthetic name that no other test uses, so rows can be told apart. */
export function uniqueLabel(prefix: string): string {
  return `[Test] ${prefix} ${randomUUID().slice(0, 8)}`;
}

/** Starts all of `jobs` at the same moment, and waits for every outcome. */
export async function raceAll<Jobs extends (() => Promise<unknown>)[]>(
  jobs: Jobs,
): Promise<PromiseSettledResult<Awaited<ReturnType<Jobs[number]>>>[]> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const started = jobs.map(async (job) => {
    await gate;
    return job();
  });
  release();
  return Promise.allSettled(started) as Promise<
    PromiseSettledResult<Awaited<ReturnType<Jobs[number]>>>[]
  >;
}
