import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  fchmodSync,
  mkdtempSync,
  rmSync,
  closeSync,
  createReadStream,
  existsSync,
  readFileSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import { TEST_DATABASE_MARKER } from "@/testing/test-database";

// Backup of a local PostgreSQL database, and a verification that the backup
// can be restored (docs/development.md § Backup and restore).
//
// Principles, all enforced here and tested in ./backup.test.ts:
//
// - **Explicit target.** The database to back up is named on the command line
//   (`--target=<host>:<port>/<database>`) and must equal the target that the
//   environment itself resolves for one of the two local Compose services. A
//   mistyped or surprising target is refused, never guessed.
// - **No credentials on any command line or in any output.** pg_dump and
//   pg_restore run *inside* the Compose container, over its local socket, as
//   the container's own user; nothing here reads, passes, or prints a
//   password or a connection string.
// - **The restore server's major version is explicit.** `verify` restores
//   into the PostgreSQL 17 test container by default, or into the PostgreSQL
//   18 one with `--postgres=18` (the hosted database's version). An archive
//   made by a newer pg_dump than the restore server is refused before
//   anything is created.
// - **Nothing is overwritten or deleted.** The output file must not exist,
//   is created with owner-only permissions (0600), and a partial file left by
//   a failed run is removed (and only that, the file this run created). No
//   `--clean`, no `dropdb`, no `DROP`. Restores never target the development
//   database: the verification restores only into a *new* scratch database on
//   the disposable test container.
// - **Outside the repository.** A backup holds the author's writing and
//   authentication data; it is refused inside the working tree.
// - **Not valid until restored.** A backup is reported as *unverified* until
//   `verify` has restored it into a scratch database and compared it.

export class OpsError extends Error {
  override name = "OpsError";
}

/** The two local Compose services, and the environment that names each. */
export interface Service {
  name: "postgres" | "postgres-test" | "postgres-test-18";
  /** `host:port/database`, lowercase, as the environment resolves it. */
  target: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** The disposable containers a backup can be restored into, by major version. */
export const RESTORE_SERVERS = {
  "17": "postgres-test",
  "18": "postgres-test-18",
} as const satisfies Record<string, Service["name"]>;

export type RestoreVersion = keyof typeof RESTORE_SERVERS;

/** The Compose profile that defines each service (compose.yaml). */
function profileOf(service: Service["name"]): string[] {
  if (service === "postgres-test") {
    return ["--profile", "test"];
  }
  if (service === "postgres-test-18") {
    return ["--profile", "test-18"];
  }
  return [];
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);
const DATABASE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** `host:port/database` of a postgres URL, or `undefined` if it is not one. */
export function targetOfUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return undefined;
  }
  // Query parameters can move the effective host, port, or database.
  if (url.search !== "") {
    return undefined;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = url.port || "5432";
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return undefined;
  }
  return `${host}:${port}/${database}`;
}

/** The services the environment defines. Nothing else can be a target. */
export function knownServices(env: Env): Service[] {
  const services: Service[] = [];
  const development = targetOfUrl(env.DATABASE_URL);
  if (development) {
    services.push({ name: "postgres", target: development });
  }
  const test = targetOfUrl(env.TEST_DATABASE_URL);
  if (test) {
    services.push({ name: "postgres-test", target: test });
  }
  return services;
}

/**
 * The service that a `--target` names. Refused unless it is exactly the
 * effective target of DATABASE_URL (the development service) or
 * TEST_DATABASE_URL (the test service), on a loopback host, with a plain
 * database name.
 */
export function resolveTarget(target: string, env: Env): Service {
  const match = /^([^/]+):(\d{1,5})\/([^/?#\s]+)$/.exec(target);
  if (!match) {
    throw new OpsError("--target must look like <host>:<port>/<database>.");
  }
  const [, host, , database] = match;
  if (!LOOPBACK.has(host!.replace(/^\[|\]$/g, "").toLowerCase())) {
    throw new OpsError("--target must be a local database (a loopback host).");
  }
  if (!DATABASE_NAME.test(database!)) {
    throw new OpsError("--target names a database that is not allowed.");
  }
  const wanted = target.toLowerCase();
  const service = knownServices(env).find((candidate) => {
    return candidate.target === wanted;
  });
  if (!service) {
    throw new OpsError(
      "--target does not match DATABASE_URL or TEST_DATABASE_URL, so nothing was done. " +
        "Name the database exactly as the environment resolves it.",
    );
  }
  return service;
}

/**
 * Where a backup file may be written. It must be an absolute path to a file
 * that does not exist, in an existing directory outside the repository (a
 * backup holds the author's writing), and not behind a symbolic link.
 */
export function checkOutputPath(output: string, repositoryRoot: string): void {
  if (!isAbsolute(output)) {
    throw new OpsError("--output must be an absolute path.");
  }
  if (/[\0\n\r]/.test(output)) {
    throw new OpsError("--output contains characters that are not allowed.");
  }
  if (
    existsSync(output) ||
    safeLstat(output) ||
    existsSync(`${output}.sha256`) ||
    safeLstat(`${output}.sha256`)
  ) {
    throw new OpsError(
      "The output file already exists, so nothing was written. Backups are never overwritten; choose a new name.",
    );
  }
  const directory = dirname(output);
  const stat = safeLstat(directory);
  if (!stat?.isDirectory()) {
    throw new OpsError("The directory for --output does not exist.");
  }
  // `.native` canonicalizes the case of a path on a case-insensitive file
  // system, so a wrongly cased path into the repository is still inside it.
  const real = realpathSync.native(directory);
  const root = realpathSync.native(repositoryRoot);
  const inside = relative(root, real);
  const leavesRoot = inside === ".." || inside.startsWith(`..${sep}`);
  if (!leavesRoot) {
    throw new OpsError(
      "--output is inside the repository. A backup holds private writing and authentication data and never belongs in it.",
    );
  }
}

function safeLstat(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

export type Command =
  | { command: "backup"; target: string; output: string }
  | {
      command: "verify";
      file: string;
      compareWith?: string;
      postgres: RestoreVersion;
    };

/** Only the documented flags exist: an unknown flag is refused. */
export function parseArguments(argv: readonly string[]): Command {
  const [command, ...flags] = argv;
  const allowed =
    command === "backup"
      ? ["target", "output"]
      : command === "verify"
        ? ["file", "compare-with", "postgres"]
        : undefined;
  if (!allowed) {
    throw new OpsError("The command is backup or verify.");
  }
  const values = new Map<string, string>();
  for (const flag of flags) {
    const match = /^--([a-z-]+)=(.+)$/.exec(flag);
    if (!match || !allowed.includes(match[1]!) || values.has(match[1]!)) {
      throw new OpsError(
        `Unexpected argument. ${command} takes ${allowed.map((a) => `--${a}=<value>`).join(" ")}.`,
      );
    }
    values.set(match[1]!, match[2]!);
  }
  if (command === "backup") {
    const target = values.get("target");
    const output = values.get("output");
    if (!target || !output) {
      throw new OpsError(
        "backup needs --target=<host>:<port>/<database> and --output=<absolute path>.",
      );
    }
    return { command, target, output };
  }
  const file = values.get("file");
  if (!file) {
    throw new OpsError("verify needs --file=<absolute path of a backup>.");
  }
  const postgres = values.get("postgres") ?? "17";
  if (!Object.hasOwn(RESTORE_SERVERS, postgres)) {
    throw new OpsError(
      "--postgres names the restore server's major version: 17 (the default) or 18.",
    );
  }
  return {
    command: "verify",
    file,
    compareWith: values.get("compare-with"),
    postgres: postgres as RestoreVersion,
  };
}

// ---------------------------------------------------------------------------
// Running PostgreSQL's own tools inside the Compose container.

interface Execution {
  code: number | null;
  stdout: string;
  stderr: string;
}

function composeArguments(service: Service["name"]): string[] {
  return ["compose", ...profileOf(service), "exec", "-T", service];
}

// The container's own user runs the tool, over its local socket: nothing here
// ever holds a password. `$1` is a database name that matched DATABASE_NAME.
function inContainer(
  service: Service["name"],
  script: string,
  args: string[],
  options: { stdin?: NodeJS.ReadableStream; stdout?: number; cwd: string },
): Promise<Execution> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "docker",
      [...composeArguments(service), "sh", "-c", script, "sh", ...args],
      {
        cwd: options.cwd,
        stdio: [
          options.stdin ? "pipe" : "ignore",
          options.stdout === undefined ? "pipe" : options.stdout,
          "pipe",
        ],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    if (options.stdin && child.stdin) {
      // The tool may exit before it has read the whole file (a file that is
      // not an archive): that is its answer, not a crash here.
      child.stdin.on("error", () => undefined);
      options.stdin.pipe(child.stdin);
    }
  });
}

const PSQL = `PGTZ=UTC exec psql -X -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER"`;

async function scalar(
  service: Service["name"],
  database: string,
  sql: string,
  cwd: string,
): Promise<string> {
  const result = await inContainer(
    service,
    `${PSQL} -d "$1" -Atc "$2"`,
    [database, sql],
    { cwd },
  );
  if (result.code !== 0) {
    throw new OpsError(
      `A database check failed:\n${firstLines(result.stderr)}`,
    );
  }
  return result.stdout.trim();
}

function firstLines(text: string, count = 5): string {
  return text.split("\n").slice(0, count).join("\n");
}

// Authentication data that must never travel in a backup: sessions can be
// replayed, and the rest is transient. The account and its password hash are
// kept, so the author can sign in after a restore (and that is sensitive).
//
// The three tables keep their structure in the backup; only their rows are left
// out: live session tokens, one-time verification values (nothing in Refrain
// sends or uses them), and sign-in rate-limit counters. None holds writing,
// publication state, slugs, or the account's credentials.
export const EXCLUDED_DATA = [
  "auth_sessions",
  "auth_verifications",
  "auth_rate_limits",
] as const;

function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

/**
 * If a `.sha256` sidecar sits next to the archive, the archive must match it.
 * A mismatch means the file was changed or damaged after it was written.
 * Returns whether a sidecar was found and matched.
 */
export async function checkSidecar(
  file: string,
  /** The archive the checksum file sits next to, when `file` is a copy of it. */
  original: string = file,
): Promise<boolean> {
  const sidecar = `${original}.sha256`;
  const stat = safeLstat(sidecar);
  if (!stat) {
    return false;
  }
  if (!stat.isFile()) {
    throw new OpsError(
      "The .sha256 next to the archive is not a regular file (symbolic links are refused). Nothing was restored.",
    );
  }
  const expected = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new OpsError(
      "The .sha256 next to the archive is not a checksum written by db:backup. Nothing was restored.",
    );
  }
  if (expected !== (await sha256OfFile(file))) {
    throw new OpsError(
      "The archive does not match its .sha256 file: it was changed or damaged after it was written. Nothing was restored.",
    );
  }
  return true;
}

function runHost(args: string[], cwd: string): Promise<Execution> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function assertServicePort(service: Service, cwd: string): Promise<void> {
  const port = service.target.split("/")[0]!.split(":").pop();
  const published = await runHost(
    ["compose", ...profileOf(service.name), "port", service.name, "5432"],
    cwd,
  ).catch(() => undefined);
  if (!published || published.code !== 0) {
    throw new OpsError(
      `Could not find the ${service.name} container. Is it running (pnpm db:up, or pnpm db:test:up)? Nothing was written.`,
    );
  }
  if (published.stdout.trim().split(":").pop() !== port) {
    throw new OpsError(
      `The ${service.name} container does not publish port ${port}, so --target does not name it. Nothing was written.`,
    );
  }
}

export interface BackupResult {
  output: string;
  bytes: number;
  sha256: string;
  service: Service["name"];
}

/** Dumps one database to a new, owner-only file. See the header comment. */
export async function runBackup(options: {
  target: string;
  output: string;
  env: Env;
  repositoryRoot: string;
}): Promise<BackupResult> {
  const service = resolveTarget(options.target, options.env);
  checkOutputPath(options.output, options.repositoryRoot);
  const database = service.target.split("/")[1]!;

  // The Compose container is the one that answers on the target's port, so a
  // different local PostgreSQL with a database of the same name is not
  // mistaken for it.
  await assertServicePort(service, options.repositoryRoot);

  // The database named is the one the container serves, and it exists.
  const served = await scalar(
    service.name,
    database,
    "select current_database()",
    options.repositoryRoot,
  ).catch(() => {
    throw new OpsError(
      `Could not reach ${service.name}. Is it running (pnpm db:up, or pnpm db:test:up)? Nothing was written.`,
    );
  });
  if (served !== database) {
    throw new OpsError(
      "The container does not serve that database. Nothing was written.",
    );
  }

  // `wx` fails if the file exists: a second guard behind checkOutputPath.
  // 0600: only the owner can read it, whatever the umask.
  const descriptor = openSync(options.output, "wx", 0o600);
  let finished = false;
  // An interrupt mid-dump must not leave a partial archive behind.
  const onInterrupt = () => {
    try {
      unlinkSync(options.output);
    } catch {
      // Already gone.
    }
    process.exit(130);
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  try {
    fchmodSync(descriptor, 0o600);
    const excludes = EXCLUDED_DATA.map(
      (table) => `--exclude-table-data=public.${table}`,
    ).join(" ");
    const result = await inContainer(
      service.name,
      `exec pg_dump --format=custom --no-owner --no-privileges ${excludes} -U "$POSTGRES_USER" -d "$1"`,
      [database],
      { cwd: options.repositoryRoot, stdout: descriptor },
    );
    if (result.code !== 0) {
      throw new OpsError(`pg_dump failed:\n${firstLines(result.stderr)}`);
    }
    const bytes = fstatSync(descriptor).size;
    if (bytes === 0) {
      throw new OpsError("pg_dump wrote nothing.");
    }
    finished = true;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    closeSync(descriptor);
    if (!finished) {
      // Only the file this run just created.
      unlinkSync(options.output);
    }
  }
  const sha256 = await sha256OfFile(options.output);
  try {
    writeFileSync(
      `${options.output}.sha256`,
      `${sha256}  ${options.output.split("/").pop()}\n`,
      { mode: 0o600, flag: "wx" },
    );
  } catch {
    throw new OpsError(
      `The backup was written to ${options.output}, but its .sha256 file could not be created (one appeared in the meantime). Keep the backup, and do not trust it until it is verified.`,
    );
  }
  return {
    output: options.output,
    bytes: statSync(options.output).size,
    sha256,
    service: service.name,
  };
}

// Every table of the application's schema is accounted for, one way or the
// other: its rows are compared between the source and the restored copy
// (COMPARED_TABLES, which is everything that holds writing, the catalog,
// publication state, slugs, and the author's account), or its rows are
// deliberately left out of the backup (EXCLUDED_DATA). A table that is in
// neither list fails the restore check, so a table added later can never be
// silently left out of the comparison.
export const COMPARED_TABLES = [
  "artists",
  "albums",
  "tracks",
  "album_artists",
  "album_tracks",
  "entries",
  "entry_texts",
  "album_journals",
  "entry_slugs",
  "album_editions",
  "edition_tracks",
  "track_artists",
  "track_reflections",
  "track_reflection_texts",
  "memories",
  "memory_music",
  "artist_journals",
  "auth_users",
  "auth_accounts",
] as const;

/** Tables of the `public` schema that are neither compared nor excluded. */
export function unaccountedTables(tables: readonly string[]): string[] {
  const known = new Set<string>([...COMPARED_TABLES, ...EXCLUDED_DATA]);
  return tables.filter((table) => !known.has(table)).sort();
}

// For each compared table: its row count, and a digest over the text of every
// row in a fixed order, so any changed column (the writing, its status and
// publication history, deletion, versions, slugs and their marks, the
// account's password hash) makes the restored copy differ. The digests are
// computed inside PostgreSQL and never printed.
const TABLE_QUERY = COMPARED_TABLES.map(
  (table) =>
    `select '${table}' as t, count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), 'empty') as n from public.${table} x`,
).join(" union all ");

interface Snapshot {
  /** Row count and content digest of each compared table. */
  tables: Record<string, { rows: string; digest: string }>;
  migrations: string;
}

async function snapshotOf(
  service: Service["name"],
  database: string,
  cwd: string,
): Promise<Snapshot> {
  const rows = await scalar(
    service,
    database,
    `select t || '=' || n from (${TABLE_QUERY}) c order by t`,
    cwd,
  );
  return {
    tables: Object.fromEntries(
      rows.split("\n").map((row) => {
        const [table, value] = row.split("=") as [string, string];
        const [count, digest] = value.split(":") as [string, string];
        return [table, { rows: count, digest }];
      }),
    ),
    migrations: await scalar(
      service,
      database,
      "select count(*) from drizzle.__drizzle_migrations",
      cwd,
    ),
  };
}

/** The major version of the pg_dump that made an archive, from its listing. */
export function dumpedByMajor(listing: string): number | undefined {
  const match = /^;\s+Dumped by pg_dump version: (\d+)\./m.exec(listing);
  return match ? Number(match[1]) : undefined;
}

/**
 * Refuses an archive whose maker is unknown or newer than the restore server:
 * PostgreSQL promises that a dump loads into the same or a newer server, not
 * an older one.
 */
export function checkArchiveVersion(
  listing: string,
  serverMajor: number,
): void {
  const major = dumpedByMajor(listing);
  if (major === undefined) {
    throw new OpsError(
      "The archive does not say which pg_dump made it, so nothing was restored.",
    );
  }
  if (major > serverMajor) {
    throw new OpsError(
      `The archive was made by pg_dump ${major}, which is newer than the PostgreSQL ${serverMajor} restore server. Use --postgres=${major}. Nothing was restored.`,
    );
  }
}

export interface VerifyResult {
  scratch: string;
  /** The disposable container that holds the scratch database. */
  restoreServer: Service["name"];
  serverMajor: number;
  counts: Record<string, string>;
  migrations: string;
  compared: boolean;
  checksumChecked: boolean;
}

/**
 * Restores a backup into a NEW scratch database on the disposable test
 * container (never the development database, and never an existing
 * database), then checks it. The archive is first copied to a private
 * temporary file (0600, in a 0700 directory), and the checksum, the listing,
 * and the restore all read that one copy, so what was checked is what runs.
 * The copy is removed afterwards. With `compareWith`, the restored copy must
 * equal the source table by table.
 */
export async function runVerify(options: {
  file: string;
  compareWith?: string;
  /** The restore server's major version; 17 unless stated. */
  postgres?: RestoreVersion;
  env: Env;
  repositoryRoot: string;
}): Promise<VerifyResult> {
  if (!isAbsolute(options.file)) {
    throw new OpsError("--file must be an absolute path.");
  }
  if (!safeLstat(options.file)?.isFile()) {
    throw new OpsError(
      "--file is not a regular file (symbolic links are refused).",
    );
  }
  const directory = mkdtempSync(join(tmpdir(), "refrain-verify-"));
  // An interrupt must not leave a full copy of the backup behind.
  const onInterrupt = () => {
    try {
      rmSync(directory, { recursive: true, force: true });
    } finally {
      process.exit(130);
    }
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  process.once("SIGHUP", onInterrupt);
  try {
    const copy = join(directory, "archive.dump");
    try {
      copyFileSync(options.file, copy, constants.COPYFILE_EXCL);
      chmodSync(copy, 0o600);
    } catch {
      throw new OpsError(
        "The archive could not be copied for checking (it may be unreadable or changed, or the disk may be full). Nothing was restored.",
      );
    }
    return await verifyArchive({
      ...options,
      file: copy,
      original: options.file,
    });
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    process.off("SIGHUP", onInterrupt);
    rmSync(directory, { recursive: true, force: true });
  }
}

async function verifyArchive(options: {
  file: string;
  /** The archive the user named, when `file` is a private copy of it. */
  original: string;
  compareWith?: string;
  postgres?: RestoreVersion;
  env: Env;
  repositoryRoot: string;
}): Promise<VerifyResult> {
  if (!isAbsolute(options.file)) {
    throw new OpsError("--file must be an absolute path.");
  }
  const stat = safeLstat(options.file);
  if (!stat?.isFile()) {
    throw new OpsError(
      "--file is not a regular file (symbolic links are refused).",
    );
  }
  // `--file` must be a backup you made: restoring runs its contents as SQL on
  // the disposable container. The checksum catches damage and edits, not a
  // file that was hostile from the start.
  const checked = await checkSidecar(options.file, options.original);
  const source = options.compareWith
    ? resolveTarget(options.compareWith, options.env)
    : undefined;
  if (source) {
    await assertServicePort(source, options.repositoryRoot);
  }

  // The destination is always a disposable test container, which must carry
  // the disposable marker: the PostgreSQL 17 one, or the 18 one when asked.
  // Nothing else can be named.
  const version = options.postgres ?? "17";
  const restore = RESTORE_SERVERS[version];
  const startCommand =
    version === "18" ? "pnpm db:test18:up" : "pnpm db:test:up";
  const marker = await scalar(
    restore,
    "refrain_test",
    "select shobj_description(oid, 'pg_database') from pg_database where datname = current_database()",
    options.repositoryRoot,
  ).catch(() => {
    throw new OpsError(
      `The disposable PostgreSQL ${version} test database is not running. Start it with ${startCommand}.`,
    );
  });
  if (marker !== TEST_DATABASE_MARKER) {
    throw new OpsError(
      "The test container is not marked as disposable. Nothing was restored.",
    );
  }

  // The archive must be a readable pg_dump archive, made by a pg_dump no
  // newer than the restore server, and is checked before anything is created.
  const listing = await inContainer(restore, `exec pg_restore --list`, [], {
    cwd: options.repositoryRoot,
    stdin: createReadStream(options.file),
  });
  if (listing.code !== 0) {
    throw new OpsError(
      `The file is not a valid PostgreSQL archive:\n${firstLines(listing.stderr)}` +
        (version === "17"
          ? "\nAn archive made by a newer pg_dump (the hosted database is PostgreSQL 18) needs --postgres=18."
          : ""),
    );
  }
  const serverMajor = Math.floor(
    Number(
      await scalar(
        restore,
        "refrain_test",
        "show server_version_num",
        options.repositoryRoot,
      ),
    ) / 10000,
  );
  checkArchiveVersion(listing.stdout, serverMajor);
  // A new database, with a name that cannot already exist, and the restore in
  // one transaction that stops at the first error. `create database`
  // fails if it does; nothing is dropped, cleaned, or overwritten.
  const scratch = `refrain_restore_${randomBytes(4).toString("hex")}_test`;
  const created = await inContainer(
    restore,
    `${PSQL} -d postgres -c "create database ${scratch}"`,
    [],
    { cwd: options.repositoryRoot },
  );
  if (created.code !== 0) {
    throw new OpsError(
      `Could not create the scratch database:\n${firstLines(created.stderr)}`,
    );
  }

  const restored = await inContainer(
    restore,
    `exec pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -U "$POSTGRES_USER" -d "$1"`,
    [scratch],
    { cwd: options.repositoryRoot, stdin: createReadStream(options.file) },
  );
  if (restored.code !== 0) {
    throw new OpsError(`The restore failed:\n${firstLines(restored.stderr)}`);
  }

  // Every table of the restored copy is accounted for, and the tables whose
  // rows are deliberately left out of a backup really came back empty.
  const present = (
    await scalar(
      restore,
      scratch,
      "select coalesce(string_agg(tablename, ' ' order by tablename), '') from pg_tables where schemaname = 'public'",
      options.repositoryRoot,
    )
  )
    .split(" ")
    .filter(Boolean);
  const unaccounted = unaccountedTables(present);
  if (unaccounted.length > 0) {
    throw new OpsError(
      `The restored copy has tables that the restore check neither compares nor excludes: ${unaccounted.join(", ")}. Add them to src/ops/backup.ts before relying on this check.`,
    );
  }
  for (const table of EXCLUDED_DATA) {
    const left = await scalar(
      restore,
      scratch,
      `select count(*) from public.${table}`,
      options.repositoryRoot,
    );
    if (left !== "0") {
      throw new OpsError(
        `The backup carries rows of ${table}, which must never be in a backup.`,
      );
    }
  }

  const after = await snapshotOf(restore, scratch, options.repositoryRoot);
  let compared = false;
  if (source) {
    const database = source.target.split("/")[1]!;
    const before = await snapshotOf(
      source.name,
      database,
      options.repositoryRoot,
    );
    const differences = COMPARED_TABLES.filter(
      (table) =>
        before.tables[table]?.rows !== after.tables[table]?.rows ||
        before.tables[table]?.digest !== after.tables[table]?.digest,
    ).map(String);
    if (before.migrations !== after.migrations) {
      differences.push("migrations");
    }
    if (differences.length > 0) {
      throw new OpsError(
        `The restored copy differs from the source in: ${differences.join(", ")}.`,
      );
    }
    compared = true;
  }
  return {
    scratch,
    restoreServer: restore,
    serverMajor,
    counts: Object.fromEntries(
      Object.entries(after.tables).map(([table, value]) => [table, value.rows]),
    ),
    migrations: after.migrations,
    compared,
    checksumChecked: checked,
  };
}
