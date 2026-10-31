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
import type { TestProject } from "vitest/node";

import {
  assertDisposableTestDatabase,
  effectiveTarget,
  readTestDatabaseUrl,
  TestDatabaseSafetyError,
} from "./test-database";

// Vitest global setup for the HTTP project (`pnpm test:http`). It tests the
// real production build, `next start`, over real HTTP:
//
// 1. Applies the same safety checks as the integration tests to
//    TEST_DATABASE_URL, including the server-side disposable marker, then the
//    versioned migrations. The server and the command below receive only that
//    URL as DATABASE_URL, so nothing here can reach the development database.
// 2. Refuses to start unless the identity tables are empty, so it never
//    touches identity rows it did not create.
// 3. Creates a synthetic author with the real provisioning command
//    (`pnpm author:provision`), the password on standard input.
// 4. Starts `next start` on 127.0.0.1 with a random secret and port.
//
// Unlike the integration tests, these rows are committed: the server has its
// own connections. Teardown deletes them, and only them. If a run is
// interrupted, `pnpm db:test:down && pnpm db:test:up` gives a clean database.

declare module "vitest" {
  export interface ProvidedContext {
    studioBaseURL: string;
    studioAuthorEmail: string;
    studioAuthorPassword: string;
    /** `host:port/database` of the test database, for --target. */
    studioDatabaseTarget: string;
    /** Environment for the author command, as given to the server. */
    studioCommandEnv: Record<string, string>;
    /** File that receives the server's standard output and error. */
    studioServerLog: string;
  }
}

const AUTHOR_EMAIL = "author@example.com";
const AUTHOR_PASSWORD = "[Test] correct horse battery staple";
const IDENTITY_TABLES = [
  "auth_users",
  "auth_sessions",
  "auth_accounts",
  "auth_verifications",
  "auth_rate_limits",
] as const;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
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
      if (response.status === 200) {
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

export default async function setup(project: TestProject) {
  try {
    return await prepare(project);
  } catch (error) {
    // Print the refusal plainly: Vitest's own report of a global-setup error
    // can fail while formatting the stack trace and hide the message.
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      error instanceof TestDatabaseSafetyError
        ? `\nRefusing to run HTTP tests: ${message}\n`
        : `\nThe HTTP tests could not start: ${message}\n`,
    );
    throw error;
  }
}

async function prepare({ provide }: TestProject) {
  const connectionString = readTestDatabaseUrl(process.env);
  if (!existsSync(".next/BUILD_ID")) {
    throw new Error(
      "The HTTP tests need a production build. Run `pnpm build` first.",
    );
  }

  await withVerifiedClient(connectionString, async (client) => {
    await migrate(drizzle({ client }), {
      migrationsFolder: "src/db/migrations",
    });
    if ((await identityRowCount(client)) > 0) {
      throw new Error(
        "The test database already has identity rows, so the HTTP tests will not " +
          "touch it. Reset it with `pnpm db:test:down && pnpm db:test:up`.",
      );
    }
  });

  const target = effectiveTarget(connectionString, "TEST_DATABASE_URL");
  const databaseTarget = `${target.host}:${target.port}/${target.database}`;
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const commandEnv = {
    DATABASE_URL: connectionString,
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    BETTER_AUTH_URL: baseURL,
    REFRAIN_AUTHOR_EMAIL: AUTHOR_EMAIL,
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

  const provisioned = await run(
    "pnpm",
    ["--silent", "author:provision", `--target=${databaseTarget}`],
    env,
    `${AUTHOR_PASSWORD}\n`,
  );
  if (provisioned.code !== 0) {
    throw new Error(
      `Provisioning the test author failed:\n${provisioned.output}`,
    );
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

  const teardown = async () => {
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await exited;
    }
    logStream.end();
    // Only the rows this run created: the tables were empty when it began.
    await withVerifiedClient(connectionString, async (client) => {
      await client.query("delete from auth_users");
      await client.query("delete from auth_rate_limits");
      await client.query("delete from auth_verifications");
    });
    rmSync(logDirectory, { recursive: true, force: true });
  };

  try {
    await waitUntilReady(`${baseURL}/studio/sign-in`, server, serverLog);
  } catch (error) {
    await teardown();
    throw error;
  }

  provide("studioBaseURL", baseURL);
  provide("studioAuthorEmail", AUTHOR_EMAIL);
  provide("studioAuthorPassword", AUTHOR_PASSWORD);
  provide("studioDatabaseTarget", databaseTarget);
  provide("studioCommandEnv", commandEnv);
  provide("studioServerLog", serverLog);

  return teardown;
}
