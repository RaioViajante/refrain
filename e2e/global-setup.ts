import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync } from "node:fs";
import { promisify } from "node:util";

import { Client } from "pg";

import { removeMusicFixtureRecords } from "@/testing/music-records";
import {
  startProductionServer,
  type ProductionServer,
} from "@/testing/production-server";
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

import { PORT, VISUAL_REVIEW } from "./constants";

const RECORD_PREFIX = "[Test] E2E";

// The visual review (VISUAL_REVIEW=1) also builds a realistic sample with the
// names the owner asked for. Those exact names are removed as well, and only
// then, from the verified disposable database; the review refuses to start if
// such records already exist, so it can never remove anything it did not make.
const REVIEW_ALBUMS = ["Grace"];
const REVIEW_ARTISTS = ["Jeff Buckley"];

// The guarantee in the comment above is kept here, before any teardown exists:
// if a record with one of those names is already there, the run stops, and no
// cleanup is registered, so nothing that was not made by the review is removed.
async function assertReviewNamesAreFree(): Promise<void> {
  const client = new Client({
    connectionString: readTestDatabaseUrl(process.env),
    application_name: "refrain-e2e-review-guard",
  });
  await client.connect();
  try {
    await assertDisposableTestDatabase(client);
    const found = await client.query<{ count: string }>(
      "select (select count(*) from albums where title = any($1)) + (select count(*) from artists where name = any($2)) as count",
      [REVIEW_ALBUMS, REVIEW_ARTISTS],
    );
    if (Number(found.rows[0]!.count) !== 0) {
      throw new Error(
        "The disposable database already has a record named like the review sample (Grace, Jeff Buckley). The review will not run, and will not remove it. Reset the disposable database (pnpm db:test:down && pnpm db:test:up) or delete the record yourself.",
      );
    }
  } finally {
    await client.end();
  }
}

const execFileAsync = promisify(execFile);

// The public pages are read from a second server of the same build, with the
// public-reads switch on and no author: the studio's server keeps the switch
// off, as a default deployment does. Its journals are seeded by a command that
// runs under `--conditions=react-server`, because Playwright's own process
// cannot load server-only modules (src/testing/public-seed-cli.ts).
async function seedPublic(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "pnpm",
    [
      "--silent",
      "tsx",
      "--conditions=react-server",
      "src/testing/public-seed-cli.ts",
      ...args,
    ],
    { env: process.env },
  );
  return stdout.trim();
}

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

  if (VISUAL_REVIEW) {
    try {
      await assertReviewNamesAreFree();
    } catch (error) {
      await server.stop();
      throw error;
    }
  }

  let publicServer: ProductionServer | undefined;
  let seededPublic: string | undefined;
  const publicPrefix = `e2e${randomUUID().slice(0, 6)}`;
  try {
    publicServer = await startProductionServer({
      withAuthor: false,
      env: { REFRAIN_PUBLIC_READS_ENABLED: "true" },
    });
    seededPublic = await seedPublic(["seed", publicPrefix]);
  } catch (error) {
    if (seededPublic) {
      await seedPublic(["remove", seededPublic, publicPrefix]).catch(() => {});
    }
    await publicServer?.stop().catch(() => {});
    await server.stop();
    throw error;
  }
  const pub = publicServer;
  const seeded = JSON.parse(seededPublic) as {
    grace: { slug: string; entryId: string };
    draft: { slug: string };
    shelf: { slug: string; entryId: string }[];
    opening: string;
  };
  process.env.E2E_PUBLIC_URL = pub.baseURL;
  process.env.E2E_PUBLIC_SLUG = seeded.grace.slug;
  process.env.E2E_PUBLIC_ENTRY_ID = seeded.grace.entryId;
  process.env.E2E_PUBLIC_DRAFT_SLUG = seeded.draft.slug;
  // The Home's shelf (M3.4): three more published journals beside Grace.
  process.env.E2E_PUBLIC_SHELF = JSON.stringify(
    seeded.shelf.map(({ slug, entryId }) => ({ slug, entryId })),
  );
  process.env.E2E_PUBLIC_OPENING = seeded.opening;
  process.env.E2E_PUBLIC_SERVER_LOG = pub.serverLog;
  process.env.E2E_PUBLIC_SEED_PREFIX = publicPrefix;

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
      await seedPublic(["remove", seededPublic, publicPrefix]).catch(() => {});
      await pub.stop().catch(() => {});
    } catch {
      // The studio's own teardown below must still run.
    }
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
// verified disposable database, in dependency order. Some journals were
// published through the studio during a run, so their slugs are marked
// published; they are simply deleted with their disposable rows, and none is
// retired (this is the test database, never the author's).
async function removeSyntheticRecords(): Promise<void> {
  const client = new Client({
    connectionString: readTestDatabaseUrl(process.env),
    application_name: "refrain-e2e-teardown",
  });
  await client.connect();
  try {
    await assertDisposableTestDatabase(client);
    const own = `${RECORD_PREFIX}%`;
    const review = VISUAL_REVIEW;
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
    // Memories (M3.6) are found by their title, and go before the recordings
    // they link, which their links would otherwise keep (RESTRICT).
    const memories = `select m.entry_id from memories m
                        join entry_texts t on t.entry_id = m.entry_id
                       where t.title like $1`;
    await client.query(
      `delete from entry_slugs where entry_id in (${memories})`,
      [own],
    );
    await client.query(`delete from entries where id in (${memories})`, [own]);
    await client.query("delete from albums where title like any($1)", [albums]);
    // The review's sample tracks carry the catalog's own titles, so they are
    // found by the artists they are credited to, as well as by the prefix.
    await client.query(
      `delete from tracks
        where title like $1
           or id in (select ta.track_id from track_artists ta
                       join artists ar on ar.id = ta.artist_id
                      where ar.name like any($2))`,
      [own, artists],
    );
    await client.query("delete from artists where name like any($1)", [
      artists,
    ]);
    // What Add music imported from the provider fixtures (M3.2).
    await removeMusicFixtureRecords(client);
  } finally {
    await client.end();
  }
}
