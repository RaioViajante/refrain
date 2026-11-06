// End-to-end tests of the hosted-backup toolchain (ops/backup, F-02,
// docs/hosted-backups.md) on the disposable PostgreSQL 18 test server.
//
// Everything happens in databases and a role this file creates, with
// synthetic "[Test]" data, on the server in TEST_DATABASE_URL, which must
// pass the same safety checks as every database suite (loopback, `*_test`,
// the disposable marker) and be PostgreSQL 18. Each database and role is
// removed by name in afterAll. The tools run in the image built from
// ops/backup/Dockerfile, attached to the test server's network namespace, as
// the scheduled job runs them.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema, type Transaction } from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestMemory,
  createTestTrackReflection,
} from "@/testing/fixtures";
import {
  assertDisposableTestDatabase,
  readTestDatabaseUrl,
} from "@/testing/test-database";

import { RESTORE_SERVERS, runVerify } from "./backup";

const IMAGE = "refrain-backup-tools:test";
const run = randomBytes(4).toString("hex");
const sourceDatabase = `refrain_bksrc_${run}_test`;
const copyDatabase = `refrain_bkcopy_${run}_test`;
const runtimeRole = `refrain_runtime_${run}`;
const backupRole = `refrain_backup_${run}`;
const backupPassword = randomBytes(24).toString("base64url");
const repositoryRoot = resolve(__dirname, "..", "..");

let admin: URL;
let serverContainer: string;
let composeServer = false;
let config: string;
/** Tables in the schemas public and drizzle of the migrated source. */
let tableCount: number;
const outputs: string[] = [];
/** Scratch databases db:backup:verify created (it leaves them for db:test18:down). */
const verifyScratch: string[] = [];

function docker(args: string[], input?: string) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Runs a command in the tools image, on the test server's network. */
function tools(
  command: string[],
  options: { out?: string; env?: Record<string, string> } = {},
) {
  const env = {
    PGSERVICEFILE: "/cfg/pg_service.conf",
    PGPASSFILE: "/cfg/pgpass",
    REFRAIN_BACKUP_RECIPIENTS_FILE: "/cfg/recipients.txt",
    REFRAIN_BACKUP_IDENTITY_FILE: "/cfg/identity.txt",
    REFRAIN_BACKUP_TEST_ONLY_INSECURE_SOURCE: "1",
    ...options.env,
  };
  return docker([
    "run",
    "--rm",
    "--network",
    `container:${serverContainer}`,
    "--user",
    `${process.getuid!()}:${process.getgid!()}`,
    "-v",
    `${config}:/cfg`,
    ...(options.out ? ["-v", `${options.out}:/out`] : []),
    ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    IMAGE,
    ...command,
  ]);
}

function newOutput(): string {
  const directory = mkdtempSync(join(tmpdir(), "refrain-bk-out-"));
  chmodSync(directory, 0o777); // the container's user writes here
  outputs.push(directory);
  return directory;
}

async function connect(database: string, user?: string, password?: string) {
  const url = new URL(admin);
  url.pathname = `/${database}`;
  if (user) {
    url.username = user;
    url.password = password ?? "";
  }
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

async function asAdmin<T>(
  database: string,
  work: (client: Client) => Promise<T>,
) {
  const client = await connect(database);
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function bundleIn(directory: string): string {
  const names = readdirSync(directory).filter((name) =>
    name.endsWith(".tar.age"),
  );
  expect(names).toHaveLength(1);
  return names[0]!;
}

async function seed(client: Client) {
  const db = drizzle({ client, schema });
  await db.transaction(async (raw) => {
    const tx = raw as unknown as Transaction;
    const artistId = await createTestArtist(tx, "[Test] F02 Artist");
    const album = await createTestAlbum(tx, {
      title: "[Test] F02 Album",
      artistIds: [artistId],
    });
    const published = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      slug: `test-f02-${run}-published`,
      versions: [
        { locale: "en", status: "published", text: "[Test] F02 published" },
        { locale: "pt-BR", status: "private", text: "[Test] F02 privado" },
      ],
    });
    await createTestTrackReflection(tx, {
      albumJournalId: published,
      albumId: album.albumId,
      trackId: album.trackIds[0]!,
      isPublished: true,
      texts: { en: "[Test] F02 reflection" },
    });
    await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      slug: `test-f02-${run}-draft`,
      versions: [{ locale: "en", status: "draft", text: "[Test] F02 draft" }],
    });
    await createTestMemory(tx, {
      slug: `test-f02-${run}-deleted`,
      deletedAt: new Date("2026-11-01T00:00:00Z"),
      versions: [{ locale: "en", status: "private", text: "[Test] F02 gone" }],
      music: [{ trackId: album.trackIds[1]! }],
    });
  });
  // The author's account (kept by a backup) and the transient rows a backup
  // leaves out: two sessions, a verification value, a rate-limit counter.
  const user = await client.query<{ id: string }>(
    `insert into auth_users (name, email) values ('[Test] F02 Author', 'f02-${run}@example.com') returning id`,
  );
  const userId = user.rows[0]!.id;
  await client.query(
    `insert into auth_accounts (account_id, provider_id, user_id, password) values ($1::text, 'credential', $1::uuid, '[Test]-not-a-real-hash')`,
    [userId],
  );
  for (const token of ["a", "b"]) {
    await client.query(
      `insert into auth_sessions (token, user_id, expires_at) values ($1, $2, now() + interval '7 days')`,
      [`[Test]-session-${token}-${run}`, userId],
    );
  }
  await client.query(
    `insert into auth_verifications (identifier, value, expires_at) values ('[Test]', '[Test]', now() + interval '1 hour')`,
  );
  await client.query(
    `insert into auth_rate_limits (key, count, last_request) values ('[Test]-rl', 3, 0)`,
  );
}

beforeAll(async () => {
  const url = readTestDatabaseUrl(process.env);
  admin = new URL(url);
  const check = new Client({ connectionString: url });
  await check.connect();
  try {
    await assertDisposableTestDatabase(check);
    const version = await check.query<{ v: string }>(
      "select current_setting('server_version_num') as v",
    );
    if (Math.floor(Number(version.rows[0]!.v) / 10000) !== 18) {
      throw new Error(
        "The backup suite needs the PostgreSQL 18 test server (pnpm db:test18:up).",
      );
    }
  } finally {
    await check.end();
  }

  // The container that publishes the test server's port.
  const port = admin.port || "5432";
  const found = docker([
    "ps",
    "--filter",
    `publish=${port}`,
    "--format",
    "{{.ID}} {{.Names}}",
  ]);
  const lines = found.stdout.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(
      `Expected exactly one container publishing port ${port}, found ${lines.length}.`,
    );
  }
  const [id, name] = lines[0]!.split(" ");
  serverContainer = id!;
  composeServer = /postgres-test-18/.test(name ?? "");

  const built = docker([
    "build",
    "--quiet",
    "--tag",
    IMAGE,
    join(repositoryRoot, "ops/backup"),
  ]);
  if (built.code !== 0) {
    throw new Error(`docker build failed:\n${built.stderr.slice(0, 2000)}`);
  }

  await asAdmin("refrain_test", (client) =>
    client.query(`create database ${sourceDatabase}`),
  );
  await asAdmin(sourceDatabase, async (client) => {
    await migrate(drizzle({ client }), {
      migrationsFolder: join(repositoryRoot, "src/db/migrations"),
    });
    await seed(client);
    tableCount = (
      await client.query<{ n: number }>(
        "select count(*)::int as n from pg_tables where schemaname in ('public', 'drizzle')",
      )
    ).rows[0]!.n;
  });

  config = mkdtempSync(join(tmpdir(), "refrain-bk-cfg-"));
  chmodSync(config, 0o755);
  const adminUser = decodeURIComponent(admin.username);
  const adminPassword = decodeURIComponent(admin.password);
  writeFileSync(
    join(config, "pg_service.conf"),
    [
      "[refrain_source]",
      "host=127.0.0.1",
      "port=5432",
      `dbname=${sourceDatabase}`,
      `user=${backupRole}`,
      "",
      "[refrain_restore]",
      "host=127.0.0.1",
      "port=5432",
      "dbname=refrain_test",
      `user=${adminUser}`,
      "",
      "[refrain_owner]",
      "host=127.0.0.1",
      "port=5432",
      `dbname=${sourceDatabase}`,
      `user=${adminUser}`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(config, "pgpass"),
    `127.0.0.1:5432:*:${backupRole}:${backupPassword}\n127.0.0.1:5432:*:${adminUser}:${adminPassword}\n`,
    { mode: 0o600 },
  );
  // A disposable age key pair for this run only.
  const keys = tools([
    "sh",
    "-c",
    "age-keygen -o /cfg/identity.txt 2>/dev/null && age-keygen -y /cfg/identity.txt > /cfg/recipients.txt",
  ]);
  if (keys.code !== 0) {
    throw new Error(`age-keygen failed: ${keys.stderr}`);
  }

  // The role, exactly as an owner would provision it.
  const provisioned = tools([
    "psql",
    "service=refrain_owner",
    "-X",
    "-q",
    "-v",
    `backup_role=${backupRole}`,
    "-v",
    `owner_role=${adminUser}`,
    "-v",
    `database=${sourceDatabase}`,
    "-f",
    "/opt/refrain-backup/backup-role.sql",
  ]);
  if (provisioned.code !== 0) {
    throw new Error(`backup-role.sql failed: ${provisioned.stderr}`);
  }
  await asAdmin(sourceDatabase, (client) =>
    client.query(`alter role ${backupRole} password '${backupPassword}'`),
  );
}, 600_000);

afterAll(async () => {
  if (!admin) {
    return;
  }
  await asAdmin("refrain_test", async (client) => {
    for (const database of [sourceDatabase, copyDatabase, ...verifyScratch]) {
      await client.query(`drop database if exists ${database} with (force)`);
    }
    // Scratch databases a failed run could have left (named by this tool).
    const left = await client.query<{ datname: string }>(
      "select datname from pg_database where datname like 'refrain\\_verify\\_%\\_test'",
    );
    for (const row of left.rows) {
      await client.query(
        `drop database if exists "${row.datname}" with (force)`,
      );
    }
    await client.query(`drop role if exists ${backupRole}`);
    await client.query(`drop role if exists ${runtimeRole}`);
  });
  for (const directory of [...outputs, config]) {
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("the backup role (ops/backup/backup-role.sql)", () => {
  it("passes its own privilege audit", () => {
    const audit = tools([
      "psql",
      "service=refrain_owner",
      "-X",
      "-q",
      "-v",
      `backup_role=${backupRole}`,
      "-v",
      `database=${sourceDatabase}`,
      "-f",
      "/opt/refrain-backup/backup-role-audit.sql",
    ]);
    expect(audit.code, audit.stderr).toBe(0);
    const lines = audit.stdout.trim().split("\n");
    expect(lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);
    expect(lines.at(-1)).toBe("result|pass");
    expect(lines.filter((line) => line.startsWith("ok|")).length).toBe(15);
  });

  it("reads everything, and can write, create, or become nothing", async () => {
    const client = await connect(sourceDatabase, backupRole, backupPassword);
    try {
      const counted = await client.query<{ n: number }>(
        "select count(*)::int as n from entry_texts",
      );
      expect(counted.rows[0]!.n).toBeGreaterThan(0);
      const migrations = await client.query<{ n: number }>(
        "select count(*)::int as n from drizzle.__drizzle_migrations",
      );
      expect(migrations.rows[0]!.n).toBeGreaterThan(0);

      const refused = async (statement: string) => {
        const error = await client
          .query(statement)
          .then(() => undefined)
          .catch((caught: { code?: string }) => caught);
        expect(error, statement).toBeDefined();
        return (error as { code?: string }).code;
      };
      // Read-only by default, as the role's settings say.
      expect(
        await refused(
          "insert into artists (name, kind) values ('[Test] x', 'person')",
        ),
      ).toBe("25006");
      // And still refused by privileges once a session lifts that default.
      await client.query("set default_transaction_read_only = off");
      for (const statement of [
        "insert into artists (name, kind) values ('[Test] x', 'person')",
        "update entry_texts set status = 'published'",
        "delete from entries",
        "truncate auth_sessions",
        "select nextval('drizzle.__drizzle_migrations_id_seq')",
        "create table public.f02_intruder (id int)",
        "create schema f02_intruder",
        `set role ${decodeURIComponent(admin.username)}`,
      ]) {
        expect(await refused(statement), statement).toBe("42501");
      }
      expect(await refused("create database f02_intruder_test")).toBe("42501");
      expect(await refused("create role f02_intruder")).toBe("42501");
    } finally {
      await client.end();
    }
  });

  it("reads a table the owner creates later (default privileges)", async () => {
    await asAdmin(sourceDatabase, (client) =>
      client.query(
        "create table public.f02_later (id int primary key); insert into public.f02_later values (1)",
      ),
    );
    try {
      const client = await connect(sourceDatabase, backupRole, backupPassword);
      try {
        const rows = await client.query("select * from public.f02_later");
        expect(rows.rowCount).toBe(1);
      } finally {
        await client.end();
      }
      const out = newOutput();
      const backup = tools(["refrain-backup", "backup", "/out"], { out });
      expect(backup.code, backup.stderr).toBe(0);
    } finally {
      await asAdmin(sourceDatabase, (client) =>
        client.query("drop table public.f02_later"),
      );
    }
  });
});

describe("a backup (refrain-backup backup)", () => {
  let out: string;
  let backup: ReturnType<typeof tools>;
  beforeAll(() => {
    out = newOutput();
    backup = tools(["refrain-backup", "backup", "/out"], { out });
  });

  it("restores its plaintext dump, compares every table, and writes only an encrypted bundle", () => {
    expect(backup.code, backup.stderr).toBe(0);
    const name = bundleIn(out);
    expect(readdirSync(out).sort()).toEqual(
      [name, `${name}.sha256`, "summary.txt"].sort(),
    );
    const bytes = readFileSync(join(out, name));
    expect(bytes.subarray(0, 21).toString()).toBe("age-encryption.org/v1");
    const summary = readFileSync(join(out, "summary.txt"), "utf8");
    // Every table of the schemas public and drizzle.
    expect(tableCount).toBeGreaterThan(20);
    expect(summary).toMatch(new RegExp(`^tables_verified=${tableCount}$`, "m"));
    expect(summary).toMatch(/decryption_drill=not performed/);
    expect(readFileSync(join(out, `${name}.sha256`), "utf8")).toBe(
      `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`,
    );
  });

  it("prints and writes nothing private: no writing, no password, no connection detail", () => {
    const visible = [
      backup.stdout,
      backup.stderr,
      readFileSync(join(out, "summary.txt"), "utf8"),
    ].join("\n");
    for (const secret of [
      "[Test]",
      backupPassword,
      decodeURIComponent(admin.password),
      sourceDatabase,
      "AGE-SECRET-KEY",
      "postgres://",
    ]) {
      expect(visible).not.toContain(secret);
    }
    // The ciphertext does not contain the writing either.
    const name = bundleIn(out);
    expect(readFileSync(join(out, name)).includes("[Test] F02")).toBe(false);
  });

  it("is intact without being decrypted (refrain-backup check)", () => {
    const checked = tools(
      ["refrain-backup", "check", `/out/${bundleIn(out)}`],
      {
        out,
      },
    );
    expect(checked.code, checked.stderr).toBe(0);
    expect(checked.stdout).toMatch(/not decrypted, nothing restored/);
  });

  it("passes the owner's drill: decrypt, restore into a new database, identical fingerprint", () => {
    const drill = tools(["refrain-backup", "drill", `/out/${bundleIn(out)}`], {
      out,
    });
    expect(drill.code, drill.stderr).toBe(0);
    expect(drill.stdout).toMatch(/drill passed/);
    expect(drill.stdout).toContain(`(${tableCount} tables)`);
  });

  describe("the restored copy", () => {
    beforeAll(async () => {
      // Decrypt and restore it ourselves, into a database this file keeps
      // until afterAll, to look inside.
      await asAdmin("refrain_test", (client) =>
        client.query(`create database ${copyDatabase}`),
      );
      const restored = tools(
        [
          "bash",
          "-o",
          "pipefail",
          "-c",
          `age -d -i /cfg/identity.txt /out/${bundleIn(out)} | tar -xOf - bundle/refrain.dump | pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname="service=refrain_restore dbname=${copyDatabase}"`,
        ],
        { out },
      );
      expect(restored.code, restored.stderr).toBe(0);
    });

    async function both<T>(sql: string, read: (rows: T[]) => unknown) {
      const [source, copy] = await Promise.all(
        [sourceDatabase, copyDatabase].map((database) =>
          asAdmin(database, async (client) =>
            read((await client.query(sql)).rows as T[]),
          ),
        ),
      );
      return { source, copy };
    }

    it("has every row of the writing, catalog, account, and migrations, and no session, verification, or rate-limit row", async () => {
      const tables = await asAdmin(copyDatabase, async (client) =>
        (
          await client.query<{ name: string }>(
            "select schemaname || '.' || tablename as name from pg_tables where schemaname in ('public', 'drizzle') order by 1",
          )
        ).rows.map((row) => row.name),
      );
      expect(tables).toHaveLength(tableCount);
      for (const table of tables) {
        const { source, copy } = await both<{ n: number }>(
          `select count(*)::int as n from ${table}`,
          (rows) => rows[0]!.n,
        );
        if (
          [
            "public.auth_sessions",
            "public.auth_verifications",
            "public.auth_rate_limits",
          ].includes(table)
        ) {
          expect(source, table).toBeGreaterThan(0);
          expect(copy, table).toBe(0);
        } else {
          expect(copy, table).toBe(source);
        }
      }
    });

    it("keeps every language version's status, deletion, publication history, slugs, reflections, and the password hash", async () => {
      for (const sql of [
        "select e.id, e.kind, e.deleted_at, e.first_published_at, t.locale, t.status, t.published_at, t.first_published_at, t.body_text from entries e join entry_texts t on t.entry_id = e.id order by e.id, t.locale",
        "select slug, kind, entry_id, is_current, was_published from entry_slugs order by slug",
        "select id, is_published, album_journal_id, track_id from track_reflections order by id",
        "select u.email, a.password from auth_users u join auth_accounts a on a.user_id = u.id order by u.email",
        "select id, hash, created_at from drizzle.__drizzle_migrations order by id",
      ]) {
        const { source, copy } = await both(sql, (rows) => rows);
        expect(copy, sql).toEqual(source);
      }
      const statuses = await asAdmin(
        copyDatabase,
        async (client) =>
          (
            await client.query<{ status: string; n: number }>(
              "select status, count(*)::int as n from entry_texts group by status order by status",
            )
          ).rows,
      );
      expect(statuses).toEqual([
        { status: "draft", n: 1 },
        { status: "private", n: 2 },
        { status: "published", n: 1 },
      ]);
    });

    it("enforces its foreign keys, unique and check constraints, and continues its sequence", async () => {
      await asAdmin(copyDatabase, async (client) => {
        const codeOf = (statement: string) =>
          client
            .query(statement)
            .then(() => "none")
            .catch((error: { code?: string }) => error.code);
        expect(
          await codeOf(
            "insert into album_journals (entry_id, album_id) values (gen_random_uuid(), gen_random_uuid())",
          ),
        ).toBe("23503");
        expect(
          await codeOf(
            "insert into auth_users (name, email) select name, email from auth_users limit 1",
          ),
        ).toBe("23505");
        expect(
          await codeOf(
            "insert into auth_users (name, email) values ('[Test]', 'UPPER@example.com')",
          ),
        ).toBe("23514");
        const constraints = await client.query<{ n: number }>(
          "select count(*)::int as n from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and not c.convalidated",
        );
        expect(constraints.rows[0]!.n).toBe(0);
        const next = await client.query<{ next: number; max: number }>(
          "select nextval('drizzle.__drizzle_migrations_id_seq')::int as next, (select max(id) from drizzle.__drizzle_migrations)::int as max",
        );
        expect(next.rows[0]!.next).toBeGreaterThan(next.rows[0]!.max);
      });
    });

    it("is made private by recovery-demote.sql, which recovery-check.sql requires before a switch", () => {
      const sql = (file: string) =>
        tools([
          "psql",
          `service=refrain_restore dbname=${copyDatabase}`,
          "-X",
          "-q",
          "-f",
          `/opt/refrain-backup/${file}`,
        ]);
      const before = sql("recovery-check.sql");
      expect(before.code).not.toBe(0);
      expect(before.stderr).toMatch(/run recovery-demote\.sql first/);
      const demoted = sql("recovery-demote.sql");
      expect(demoted.code, demoted.stderr).toBe(0);
      expect(demoted.stdout.trim()).toBe("demoted|1");
      const after = sql("recovery-check.sql");
      expect(after.code, after.stderr).toBe(0);
      expect(after.stdout.trim()).toBe("published|0");
      expect(sql("recovery-demote.sql").stdout.trim()).toBe("demoted|0");
    });

    it("keeps the publication history and slugs after the demotion", async () => {
      const rows = await asAdmin(
        copyDatabase,
        async (client) =>
          (
            await client.query<{
              status: string;
              published_at: Date | null;
              first_published_at: Date | null;
            }>(
              "select status, published_at, first_published_at from entry_texts where first_published_at is not null",
            )
          ).rows,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("private");
      expect(rows[0]!.published_at).toBeNull();
      expect(rows[0]!.first_published_at).not.toBeNull();
      const slugs = await both(
        "select slug, is_current, was_published from entry_slugs order by slug",
        (found) => found,
      );
      expect(slugs.copy).toEqual(slugs.source);
    });

    it("keeps owners and grants in the archive, for a recovery into Neon", () => {
      const listing = tools(
        [
          "bash",
          "-o",
          "pipefail",
          "-c",
          `age -d -i /cfg/identity.txt /out/${bundleIn(out)} | tar -xOf - bundle/refrain.dump | pg_restore --list`,
        ],
        { out },
      );
      expect(listing.code, listing.stderr).toBe(0);
      expect(listing.stdout).toMatch(/ ACL public TABLE entries /);
      expect(listing.stdout).toMatch(/ DEFAULT ACL /);
      expect(listing.stdout).toMatch(/Dumped by pg_dump version: 18\./);
    });

    it("carries an inventory of identifiers and states only", () => {
      const inventory = tools(
        [
          "bash",
          "-o",
          "pipefail",
          "-c",
          `age -d -i /cfg/identity.txt /out/${bundleIn(out)} | tar -xOf - bundle/inventory.txt`,
        ],
        { out },
      );
      expect(inventory.code, inventory.stderr).toBe(0);
      const lines = inventory.stdout.trim().split("\n");
      expect(lines.filter((line) => line.startsWith("entry|"))).toHaveLength(3);
      expect(
        lines.filter((line) => line.startsWith("reflection|")),
      ).toHaveLength(1);
      expect(inventory.stdout).toMatch(/\|memory\|deleted=true\|en:private$/m);
      expect(inventory.stdout).toMatch(
        /\|album_journal\|deleted=false\|en:published,pt-BR:private$/m,
      );
      expect(inventory.stdout).not.toContain("[Test]");
      expect(inventory.stdout).not.toContain("test-f02-");
    });
  });

  describe("a damaged bundle", () => {
    function damaged(change: (bytes: Buffer) => Buffer, resum: boolean) {
      const name = bundleIn(out);
      const copy = newOutput();
      const bytes = change(readFileSync(join(out, name)));
      writeFileSync(join(copy, name), bytes);
      writeFileSync(
        join(copy, `${name}.sha256`),
        resum
          ? `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`
          : readFileSync(join(out, `${name}.sha256`)),
      );
      return { copy, name };
    }
    const flip = (bytes: Buffer) => {
      const changed = Buffer.from(bytes);
      const at = Math.floor(changed.length * 0.6);
      changed[at] = changed[at]! ^ 0x01;
      return changed;
    };

    it("fails its checksum when changed", () => {
      const { copy, name } = damaged(flip, false);
      const checked = tools(["refrain-backup", "check", `/out/${name}`], {
        out: copy,
      });
      expect(checked.code).not.toBe(0);
      expect(checked.stderr).toMatch(/does not match its \.sha256/);
    });

    it("fails decryption when changed or truncated, even with a matching checksum, and restores nothing", async () => {
      for (const change of [
        flip,
        (bytes: Buffer) => bytes.subarray(0, Math.floor(bytes.length / 2)),
      ]) {
        const { copy, name } = damaged(change, true);
        const drill = tools(["refrain-backup", "drill", `/out/${name}`], {
          out: copy,
        });
        expect(drill.code).not.toBe(0);
        expect(drill.stderr).toMatch(/decryption failed/);
        expect(drill.stderr).not.toContain("[Test]");
      }
      const left = await asAdmin(
        "refrain_test",
        async (client) =>
          (
            await client.query(
              "select 1 from pg_database where datname like 'refrain\\_verify\\_%'",
            )
          ).rowCount,
      );
      expect(left).toBe(0);
    });

    it("cannot be decrypted with another key", () => {
      const other = newOutput();
      copyFileSync(join(out, bundleIn(out)), join(other, bundleIn(out)));
      copyFileSync(
        join(out, `${bundleIn(out)}.sha256`),
        join(other, `${bundleIn(out)}.sha256`),
      );
      const drill = tools(
        [
          "sh",
          "-c",
          `age-keygen -o /out/other.key 2>/dev/null && REFRAIN_BACKUP_IDENTITY_FILE=/out/other.key refrain-backup drill /out/${bundleIn(out)}`,
        ],
        { out: other },
      );
      expect(drill.code).not.toBe(0);
      expect(drill.stderr).toMatch(/decryption failed/);
    });
  });

  it("restores the decrypted dump with db:backup:verify --postgres=18", async (context) => {
    // db:backup:verify restores through `docker compose exec`, so it can
    // reach the test server only when that is the Compose service (locally;
    // CI's PostgreSQL 18 server is a job service container).
    if (!composeServer) {
      context.skip();
    }
    // The synthetic plaintext goes to a temporary directory, removed in afterAll.
    const plain = newOutput();
    const again = docker([
      "run",
      "--rm",
      "--user",
      `${process.getuid!()}:${process.getgid!()}`,
      "-v",
      `${config}:/cfg`,
      "-v",
      `${out}:/out`,
      "-v",
      `${plain}:/plain`,
      IMAGE,
      "bash",
      "-o",
      "pipefail",
      "-c",
      `age -d -i /cfg/identity.txt /out/${bundleIn(out)} | tar -xOf - bundle/refrain.dump > /plain/refrain.dump`,
    ]);
    expect(again.code, again.stderr).toBe(0);
    expect(existsSync(join(plain, "refrain.dump"))).toBe(true);
    // `docker compose exec` interpolates the whole compose.yaml, whose
    // development service requires POSTGRES_PASSWORD (from .env, which a
    // clean checkout lacks). The exec never uses it.
    const hadPassword = "POSTGRES_PASSWORD" in process.env;
    process.env.POSTGRES_PASSWORD ??= "unused-by-compose-exec";
    const result = await runVerify({
      file: join(plain, "refrain.dump"),
      postgres: "18",
      env: process.env,
      repositoryRoot,
    }).finally(() => {
      if (!hadPassword) {
        delete process.env.POSTGRES_PASSWORD;
      }
    });
    verifyScratch.push(result.scratch);
    expect(result.scratch).toMatch(/^refrain_restore_[0-9a-f]{8}_test$/);
    expect(result.restoreServer).toBe(RESTORE_SERVERS["18"]);
    expect(result.serverMajor).toBe(18);
    expect(result.counts.entry_texts).toBe("4");
    expect(result.counts.auth_users).toBe("1");
  });
});

describe("owners and grants of roles the restore server lacks", () => {
  it("restores them onto placeholder roles, compares them, and drops the placeholders", async () => {
    await asAdmin(sourceDatabase, (client) =>
      client.query(
        `create role ${runtimeRole} nologin; grant select on public.artists to ${runtimeRole}`,
      ),
    );
    const out = newOutput();
    const backup = tools(["refrain-backup", "backup", "/out"], { out });
    expect(backup.code, backup.stderr).toBe(0);
    // The role now exists nowhere on the restore server.
    await asAdmin(sourceDatabase, (client) =>
      client.query(
        `revoke select on public.artists from ${runtimeRole}; drop role ${runtimeRole}`,
      ),
    );
    const drill = tools(["refrain-backup", "drill", `/out/${bundleIn(out)}`], {
      out,
    });
    expect(drill.code, drill.stderr).toBe(0);
    const left = await asAdmin(
      "refrain_test",
      async (client) =>
        (
          await client.query("select 1 from pg_roles where rolname = $1", [
            runtimeRole,
          ])
        ).rowCount,
    );
    expect(left).toBe(0);
  });
});

describe("refusals", () => {
  it("refuses a database with a schema besides public and drizzle", async () => {
    await asAdmin(sourceDatabase, (client) =>
      client.query("create schema f02_extra"),
    );
    try {
      const out = newOutput();
      const backup = tools(["refrain-backup", "backup", "/out"], { out });
      expect(backup.code).not.toBe(0);
      expect(backup.stderr).toMatch(
        /schema besides public and drizzle \(f02_extra\)/,
      );
      expect(readdirSync(out)).toEqual([]);
    } finally {
      await asAdmin(sourceDatabase, (client) =>
        client.query("drop schema f02_extra"),
      );
    }
  });

  it("fails, writing nothing, when the role cannot read a table", async () => {
    await asAdmin(sourceDatabase, (client) =>
      client.query(`revoke select on public.memories from ${backupRole}`),
    );
    try {
      const out = newOutput();
      const backup = tools(["refrain-backup", "backup", "/out"], { out });
      expect(backup.code).not.toBe(0);
      expect(backup.stderr).toMatch(/permission denied/);
      expect(readdirSync(out)).toEqual([]);
      expect(backup.stderr).not.toContain("[Test]");
    } finally {
      await asAdmin(sourceDatabase, (client) =>
        client.query(`grant select on public.memories to ${backupRole}`),
      );
    }
  });

  it("fails loudly instead of dumping part of a table when row-level security applies", async () => {
    await asAdmin(sourceDatabase, (client) =>
      client.query("alter table public.artists enable row level security"),
    );
    try {
      const out = newOutput();
      const backup = tools(["refrain-backup", "backup", "/out"], { out });
      expect(backup.code).not.toBe(0);
      expect(backup.stderr).toMatch(/row-level security|row security/i);
      expect(readdirSync(out)).toEqual([]);
    } finally {
      await asAdmin(sourceDatabase, (client) =>
        client.query("alter table public.artists disable row level security"),
      );
    }
  });

  it("refuses a source without TLS unless in test mode, without printing a host or a password", () => {
    const out = newOutput();
    const backup = tools(["refrain-backup", "backup", "/out"], {
      out,
      env: { REFRAIN_BACKUP_TEST_ONLY_INSECURE_SOURCE: "0" },
    });
    expect(backup.code).not.toBe(0);
    expect(backup.stderr).toMatch(/could not connect to the source/);
    expect(backup.stderr).not.toContain(backupPassword);
    expect(backup.stderr).not.toContain("127.0.0.1");
    expect(readdirSync(out)).toEqual([]);
  });

  it("refuses a superuser source and an unmarked restore server", () => {
    writeFileSync(
      join(config, "pg_service.alt.conf"),
      readFileSync(join(config, "pg_service.conf"), "utf8").replace(
        `user=${backupRole}`,
        `user=${decodeURIComponent(admin.username)}`,
      ),
    );
    const superuser = tools(["refrain-backup", "backup", "/out"], {
      out: newOutput(),
      env: { PGSERVICEFILE: "/cfg/pg_service.alt.conf" },
    });
    expect(superuser.code).not.toBe(0);
    expect(superuser.stderr).toMatch(/superuser/);

    writeFileSync(
      join(config, "pg_service.alt.conf"),
      readFileSync(join(config, "pg_service.conf"), "utf8").replace(
        "dbname=refrain_test",
        `dbname=${sourceDatabase}`,
      ),
    );
    const unmarked = tools(["refrain-backup", "backup", "/out"], {
      out: newOutput(),
      env: { PGSERVICEFILE: "/cfg/pg_service.alt.conf" },
    });
    expect(unmarked.code).not.toBe(0);
    expect(unmarked.stderr).toMatch(/not marked as disposable/);
  });

  it("refuses a source role that can write, create, or become a role that can", async () => {
    const writer = `refrain_writer_${run}`;
    for (const [grant, revoke] of [
      [
        `grant insert on public.artists to ${backupRole}`,
        `revoke insert on public.artists from ${backupRole}`,
      ],
      [
        `grant create on schema public to ${backupRole}`,
        `revoke create on schema public from ${backupRole}`,
      ],
      [
        `create role ${writer} nologin; grant insert on public.artists to ${writer}; grant ${writer} to ${backupRole} with inherit false`,
        `revoke ${writer} from ${backupRole}; revoke insert on public.artists from ${writer}; drop role ${writer}`,
      ],
    ] as const) {
      await asAdmin(sourceDatabase, (client) => client.query(grant));
      try {
        const out = newOutput();
        const backup = tools(["refrain-backup", "backup", "/out"], { out });
        expect(backup.code, grant).not.toBe(0);
        expect(backup.stderr, grant).toMatch(/can write or create/);
        expect(readdirSync(out)).toEqual([]);
      } finally {
        await asAdmin(sourceDatabase, (client) => client.query(revoke));
      }
    }
  });

  it("refuses a recipients file that holds a private key, and a non-empty output directory", () => {
    const out = newOutput();
    const leaked = tools(["refrain-backup", "backup", "/out"], {
      out,
      env: { REFRAIN_BACKUP_RECIPIENTS_FILE: "/cfg/identity.txt" },
    });
    expect(leaked.code).not.toBe(0);
    expect(leaked.stderr).toMatch(/holds a private key/);
    expect(leaked.stderr).not.toContain("AGE-SECRET-KEY");

    writeFileSync(join(out, "existing"), "x");
    const busy = tools(["refrain-backup", "backup", "/out"], { out });
    expect(busy.code).not.toBe(0);
    expect(busy.stderr).toMatch(/not empty/);
  });
});
