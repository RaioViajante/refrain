import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";

import { Client } from "pg";

import { startProductionServer } from "@/testing/production-server";
import {
  assertDisposableTestDatabase,
  readTestDatabaseUrl,
  TestDatabaseSafetyError,
} from "@/testing/test-database";

// Playwright global setup. Starts the production build on a fixed port
// against the disposable test database with a synthetic author (the same
// helper as `pnpm test:http`: the five safety checks, the empty-identity
// check, provisioning with the real command, no existing server reused), and
// hands the run's details to the tests through the environment. The teardown
// removes the synthetic records the tests left, then the server and the
// author.

import { PORT } from "./constants";

const RECORD_PREFIX = "[Test] E2E";

export default async function setup() {
  let server;
  try {
    server = await startProductionServer({
      port: PORT,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      error instanceof TestDatabaseSafetyError
        ? `\nRefusing to run the browser tests: ${message}\n`
        : `\nThe browser tests could not start: ${message}\n`,
    );
    throw error;
  }

  process.env.E2E_BASE_URL = server.baseURL;
  process.env.E2E_AUTHOR_EMAIL = server.authorEmail;
  process.env.E2E_AUTHOR_PASSWORD = server.authorPassword;
  // Signs the cookies that some tests mint for sessions of their own.
  process.env.E2E_SESSION_SECRET = server.commandEnv.BETTER_AUTH_SECRET!;
  process.env.E2E_SERVER_LOG = server.serverLog;
  // Names every record of this run, so each test can find its own.
  process.env.E2E_RUN_ID = randomUUID().slice(0, 8);

  return async () => {
    try {
      await removeSyntheticRecords();
    } finally {
      // For diagnosis on one's own machine: the log can hold a stack trace
      // but, by the application's logging rules, no writing or credentials.
      if (process.env.E2E_KEEP_SERVER_LOG) {
        copyFileSync(server.serverLog, "test-results/server.log");
      }
      await server.stop();
    }
  };
}

// Removes only the records whose names start with the E2E prefix, from the
// verified disposable database, in dependency order. Published slugs would
// stay reserved by design (ADR 0003), but these journals are never published.
async function removeSyntheticRecords(): Promise<void> {
  const client = new Client({
    connectionString: readTestDatabaseUrl(process.env),
    application_name: "refrain-e2e-teardown",
  });
  await client.connect();
  try {
    await assertDisposableTestDatabase(client);
    const own = `${RECORD_PREFIX}%`;
    const journals = `select aj.entry_id from album_journals aj
                        join albums a on a.id = aj.album_id
                       where a.title like $1`;
    await client.query(
      `delete from entry_slugs where entry_id in (${journals})`,
      [own],
    );
    await client.query(`delete from entries where id in (${journals})`, [own]);
    await client.query("delete from albums where title like $1", [own]);
    await client.query("delete from tracks where title like $1", [own]);
    await client.query("delete from artists where name like $1", [own]);
  } finally {
    await client.end();
  }
}
