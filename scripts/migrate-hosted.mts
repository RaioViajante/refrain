// Applies the committed migrations to a HOSTED database, after checking that
// it is this application's own (decision 0002 § 7). Drizzle Kit stays
// local-only; this script is the one way to migrate the hosted database.
//
//   HOSTED_DATABASE_URL=… node scripts/migrate-hosted.mts --expect-host <host>
//   HOSTED_DATABASE_URL=… node scripts/migrate-hosted.mts --expect-host <host> --apply
//
// Without --apply it only reports. It refuses: a missing or non-TLS URL, a
// host other than the expected one, a local host, and any database holding a
// table that is not this application's (the archived music diary's included).
// It never prints the connection string.
import { readdirSync } from "node:fs";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const OWN_TABLES = new Set([
  "images",
  "image_files",
  "mixtapes",
  "mixtape_tracks",
  "songs",
  "site_texts",
  "site_images",
  "studio_sessions",
  "studio_login_attempts",
  "trash_items",
  "trash_files",
  "trash_image_refs",
  "text_versions",
]);
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

function fail(message: string): never {
  console.error(`refused: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const expectHost = args[args.indexOf("--expect-host") + 1];
const apply = args.includes("--apply");
if (!args.includes("--expect-host") || !expectHost) {
  fail("pass --expect-host <host> (the hosted database's host name).");
}

const raw = process.env.HOSTED_DATABASE_URL?.trim();
if (!raw) fail("HOSTED_DATABASE_URL is not set.");
let url: URL;
try {
  url = new URL(raw);
} catch {
  fail("HOSTED_DATABASE_URL is not a valid URL.");
}
if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  fail("HOSTED_DATABASE_URL must be a postgres:// URL.");
}
if (LOCAL.has(url.hostname))
  fail("this is a local database; use pnpm db:migrate.");
if (url.hostname !== expectHost) {
  fail(`the URL's host is not the expected one (${expectHost}).`);
}
if (
  url.searchParams.get("sslmode") !== "require" &&
  url.searchParams.get("sslmode") !== "verify-full"
) {
  fail("the URL must require TLS (sslmode=require).");
}

const client = new pg.Client({ connectionString: raw });
await client.connect();
try {
  const { rows: info } = await client.query<{ db: string; version: string }>(
    "select current_database() as db, current_setting('server_version') as version",
  );
  const { rows: tables } = await client.query<{ name: string }>(
    "select table_name as name from information_schema.tables where table_schema = 'public' order by 1",
  );
  const foreign = tables.map((t) => t.name).filter((t) => !OWN_TABLES.has(t));
  const migrations = readdirSync("src/db/migrations").filter((f) =>
    f.endsWith(".sql"),
  );
  const { rows: applied } = await client
    .query<{ n: string }>(
      "select count(*)::text as n from drizzle.__drizzle_migrations",
    )
    .catch(() => ({ rows: [{ n: "0" }] }));

  console.log(`host:       ${url.hostname}`);
  console.log(`database:   ${info[0]?.db} (PostgreSQL ${info[0]?.version})`);
  console.log(
    `tables:     ${tables.length ? tables.map((t) => t.name).join(", ") : "none (empty database)"}`,
  );
  console.log(`migrations: ${applied[0]?.n} of ${migrations.length} applied`);

  if (foreign.length > 0) {
    fail(
      `the database holds tables that are not this application's: ${foreign.join(", ")}.`,
    );
  }
  if (!apply) {
    console.log("dry run: nothing changed. Re-run with --apply to migrate.");
  } else {
    await migrate(drizzle(client), { migrationsFolder: "src/db/migrations" });
    const { rows: after } = await client.query<{ n: string }>(
      "select count(*)::text as n from drizzle.__drizzle_migrations",
    );
    console.log(`applied:    now ${after[0]?.n} of ${migrations.length}`);
  }
} finally {
  await client.end();
}
