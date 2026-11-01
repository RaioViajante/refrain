import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync } from "node:fs";

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

// The visual review (VISUAL_REVIEW=1) also builds a realistic sample with the
// names the owner asked for. Those exact names are removed as well, and only
// then, from the verified disposable database; the review refuses to start if
// such records already exist, so it can never remove anything it did not make.
const REVIEW_ALBUMS = ["Grace"];
const REVIEW_ARTISTS = ["Jeff Buckley"];

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
      // Kept only when asked, to look at (or capture evidence from) what the
      // run left in the disposable database; `pnpm db:test:down && pnpm
      // db:test:up` discards it.
      if (!process.env.E2E_KEEP_DATA) {
        await removeSyntheticRecords();
      }
    } finally {
      // For diagnosis on one's own machine: the log can hold a stack trace
      // but, by the application's logging rules, no writing or credentials.
      if (process.env.E2E_KEEP_SERVER_LOG) {
        try {
          mkdirSync("test-results", { recursive: true });
          copyFileSync(server.serverLog, "test-results/server.log");
        } catch {
          // Diagnosis only: it must never stop the server from being stopped.
        }
      }
      await server.stop();
    }
  };
}

// Removes only the records whose names start with the E2E prefix, from the
// verified disposable database, in dependency order. These journals are never published through the application, so no
// published slug is retired here; a slug the tests marked published directly
// in the database is simply deleted with its disposable row.
async function removeSyntheticRecords(): Promise<void> {
  const client = new Client({
    connectionString: readTestDatabaseUrl(process.env),
    application_name: "refrain-e2e-teardown",
  });
  await client.connect();
  try {
    await assertDisposableTestDatabase(client);
    const own = `${RECORD_PREFIX}%`;
    const review = Boolean(process.env.VISUAL_REVIEW);
    const albums = [own, ...(review ? REVIEW_ALBUMS : [])];
    const artists = [own, ...(review ? REVIEW_ARTISTS : [])];
    const journals = `select aj.entry_id from album_journals aj
                        join albums a on a.id = aj.album_id
                       where a.title like any($1)`;
    await client.query(
      `delete from entry_slugs where entry_id in (${journals})`,
      [albums],
    );
    await client.query(`delete from entries where id in (${journals})`, [
      albums,
    ]);
    await client.query("delete from albums where title like any($1)", [albums]);
    await client.query("delete from tracks where title like $1", [own]);
    await client.query("delete from artists where name like any($1)", [
      artists,
    ]);
  } finally {
    await client.end();
  }
}
