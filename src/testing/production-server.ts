import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import {
  assertDisposableTestDatabase,
  effectiveTarget,
  readTestDatabaseUrl,
} from "./test-database";

// Starts the real production build (`next start`) against the disposable test
// database, with a synthetic author, for the tests that drive it over HTTP
// (`pnpm test:http`, src/testing/http-global-setup.ts) and in a browser
// (`pnpm test:e2e`, e2e/global-setup.ts). One implementation, so both apply
// the same safety rules:
//
// 1. The same five safety checks as the integration tests apply to
//    TEST_DATABASE_URL, including the server-side disposable marker, and only
//    then the versioned migrations run. The server and the author command
//    receive that URL, and only that URL, as DATABASE_URL, so nothing here can
//    reach the development database.
// 2. It refuses to start unless the identity tables are empty, so it never
//    touches identity rows it did not create (the development database holds
//    the owner's real account; this one must never).
// 3. A synthetic author is created with the real provisioning command
//    (`pnpm author:provision`), the password on standard input.
// 4. `next start` runs on 127.0.0.1, in production mode, with a random secret.
//    With a fixed port, the port must be free: an existing server (a
//    development server, an earlier run) is refused, never reused.
//
// The rows are committed, because the server has its own connections. The
// teardown deletes the identity rows, and only them. If a run is interrupted,
// `pnpm db:test:down && pnpm db:test:up` gives a clean database.

export const SYNTHETIC_AUTHOR_EMAIL = "author@example.com";
export const SYNTHETIC_AUTHOR_PASSWORD = "[Test] correct horse battery staple";

const IDENTITY_TABLES = [
  "auth_users",
  "auth_sessions",
  "auth_accounts",
  "auth_verifications",
  "auth_rate_limits",
] as const;

export interface ProductionServer {
  baseURL: string;
  authorEmail: string;
  authorPassword: string;
  /** `host:port/database` of the test database, for --target. */
  databaseTarget: string;
  /** Environment for the author command, as given to the server. */
  commandEnv: Record<string, string>;
  /** File that receives the server's standard output and error. */
  serverLog: string;
  /** Stops the server and removes the synthetic identity rows. */
  stop: () => Promise<void>;
}

async function listenOnce(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("No port was assigned."));
        }
      });
    });
  });
}

async function choosePort(requested: number | undefined): Promise<number> {
  if (requested === undefined) {
    return listenOnce(0);
  }
  try {
    return await listenOnce(requested);
  } catch {
    throw new Error(
      `Port ${requested} on 127.0.0.1 is already in use, so the test server will not start. ` +
        "It may be a development server or an earlier run; the tests never reuse an existing server.",
    );
  }
}

async function withVerifiedClient<T>(
  connectionString: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString,
    application_name: "refrain-http-tests",
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    await assertDisposableTestDatabase(client);
    return await work(client);
  } finally {
    await client.end();
  }
}

async function identityRowCount(client: Client): Promise<number> {
  const counts = IDENTITY_TABLES.map(
    (table) => `(select count(*) from ${table})`,
  ).join(" + ");
  const result = await client.query<{ total: string }>(
    `select ${counts} as total`,
  );
  return Number(result.rows[0]?.total ?? 0);
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  stdin: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(stdin);
  });
}

async function waitUntilReady(
  url: string,
  server: ChildProcess,
  log: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      break;
    }
    try {
      const response = await fetch(url, { redirect: "manual" });
      // An answer counts only once the server this run started has said it
      // is ready (Next.js prints "Ready in …" after it has bound the port; if
      // a Next.js upgrade renames that line, the setup fails closed after 30 s
      // and shows the log): another process on the same port could answer first, and a
      // child that lost the bind race never prints it.
      if (
        response.status === 200 &&
        readFileSync(log, "utf8").includes("Ready in")
      ) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `The production server did not start.\n${readFileSync(log, "utf8").slice(-2000)}`,
  );
}

export interface ProductionServerOptions {
  /** A fixed port; by default a free one is chosen. */
  port?: number;
  /**
   * Extra environment for the server. A key whose value is `undefined` is
   * removed, so a test can serve the same build with a variable unset.
   */
  env?: Record<string, string | undefined>;
  /**
   * Whether to provision the synthetic author (the default). A server that
   * only serves public pages needs none, and several can run at once.
   */
  withAuthor?: boolean;
}

export async function startProductionServer(
  options: ProductionServerOptions = {},
): Promise<ProductionServer> {
  const withAuthor = options.withAuthor ?? true;
  const connectionString = readTestDatabaseUrl(process.env);
  if (!existsSync(".next/BUILD_ID")) {
    throw new Error(
      "The tests need a production build. Run `pnpm build` first.",
    );
  }

  await withVerifiedClient(connectionString, async (client) => {
    await migrate(drizzle({ client }), {
      migrationsFolder: "src/db/migrations",
    });
    if (withAuthor && (await identityRowCount(client)) > 0) {
      throw new Error(
        "The test database already has identity rows, so the tests will not " +
          "touch it. Reset it with `pnpm db:test:down && pnpm db:test:up`.",
      );
    }
  });

  const target = effectiveTarget(connectionString, "TEST_DATABASE_URL");
  const databaseTarget = `${target.host}:${target.port}/${target.database}`;
  const port = await choosePort(options.port);
  const baseURL = `http://127.0.0.1:${port}`;
  const commandEnv = {
    DATABASE_URL: connectionString,
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    BETTER_AUTH_URL: baseURL,
    REFRAIN_AUTHOR_EMAIL: SYNTHETIC_AUTHOR_EMAIL,
  };
  // Production mode, as deployed. Explicit values override anything that
  // .env would supply (Next.js and the command never override set variables).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...commandEnv,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  delete env.TEST_DATABASE_URL;
  // The public-reads switch is never inherited from the shell that runs the
  // tests: a server has it only if the test sets it (ADR 0006, D4).
  delete env.REFRAIN_PUBLIC_READS_ENABLED;
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  if (withAuthor) {
    const provisioned = await run(
      "pnpm",
      ["--silent", "author:provision", `--target=${databaseTarget}`],
      env,
      `${SYNTHETIC_AUTHOR_PASSWORD}\n`,
    );
    if (provisioned.code !== 0) {
      throw new Error(
        `Provisioning the test author failed:\n${provisioned.output}`,
      );
    }
  }

  const logDirectory = mkdtempSync(join(tmpdir(), "refrain-http-"));
  const serverLog = join(logDirectory, "server.log");
  const logStream = createWriteStream(serverLog);
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.pipe(logStream);
  server.stderr.pipe(logStream);

  const stop = async () => {
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await exited;
    }
    logStream.end();
    if (withAuthor) {
      // Only the rows this run created: the tables were empty when it began.
      await withVerifiedClient(connectionString, async (client) => {
        await client.query("delete from auth_users");
        await client.query("delete from auth_rate_limits");
        await client.query("delete from auth_verifications");
      });
    }
    rmSync(logDirectory, { recursive: true, force: true });
  };

  try {
    await waitUntilReady(`${baseURL}/studio/sign-in`, server, serverLog);
    // Still the server this run started (a child that lost a bind race has
    // exited, and would not have printed its ready line either).
    if (server.exitCode !== null) {
      throw new Error(
        "The test server exited after it was started, so another process may hold its port.",
      );
    }
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    baseURL,
    authorEmail: SYNTHETIC_AUTHOR_EMAIL,
    authorPassword: SYNTHETIC_AUTHOR_PASSWORD,
    databaseTarget,
    commandEnv,
    serverLog,
    stop,
  };
}
