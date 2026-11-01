// Local command for the single author account (ADR 0004). It is the only
// way to create the account or to change its password, and it is never
// reachable over HTTP:
//
//   pnpm author:provision      --target=<host>:<port>/<database>
//   pnpm author:reset-password --target=<host>:<port>/<database>
//
// - The target database must be named explicitly and must match the
//   effective target of DATABASE_URL, as node-postgres resolves it.
// - The password is read from the terminal without echo (twice), or from
//   standard input when it is not a terminal. It is never accepted as an
//   argument or an environment variable, so it never appears in shell
//   history or in the process list.
// - Nothing secret is printed: not the password, its hash, the secret, or the
//   connection string.
//
// The package scripts run ./cli-entry.ts with `tsx --conditions=react-server`, the
// export condition under which `server-only` permits server code.
import { existsSync } from "node:fs";

import { Client } from "pg";

import { closeDb, DatabaseConfigError, getDb, readDatabaseUrl } from "@/db";

import { AuthConfigError, readAuthConfig } from "./config";
import { describeAuthError } from "./logging";
import {
  provisionAuthor,
  ProvisioningError,
  resetAuthorPassword,
} from "./provisioning";

class CommandError extends Error {
  override name = "CommandError";
}

const USAGE = `Usage:
  pnpm author:provision      --target=<host>:<port>/<database>
  pnpm author:reset-password --target=<host>:<port>/<database>

The password is read from the terminal without echo, or from standard input.`;

const MAX_STDIN_BYTES = 4096;

type Command = "provision" | "reset-password";

interface Arguments {
  command: Command;
  target: string;
}

export function parseArguments(argv: readonly string[]): Arguments {
  const [command, ...flags] = argv;
  if (command !== "provision" && command !== "reset-password") {
    throw new CommandError(USAGE);
  }
  let target: string | undefined;
  for (const flag of flags) {
    if (/^--?pass/i.test(flag)) {
      throw new CommandError(
        "Passwords are never accepted as arguments. Run the command without it and type the password when asked.",
      );
    }
    const match = /^--target=(.+)$/.exec(flag);
    if (!match || target !== undefined) {
      throw new CommandError(USAGE);
    }
    target = match[1];
  }
  if (!target) {
    throw new CommandError(USAGE);
  }
  return { command, target };
}

/**
 * The effective target of a connection string, `host:port/database`, as
 * node-postgres resolves it (constructing a Client parses; it does not
 * connect). The same principle as the test-database checks
 * (src/testing/test-database.ts): compare what the driver would actually use.
 */
export function describeTarget(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.search !== "") {
    throw new CommandError(
      "DATABASE_URL must not have query parameters, which can override its host or port.",
    );
  }
  const client = new Client({ connectionString });
  const host = String(client.host ?? "").toLowerCase();
  const port = Number(client.port);
  const database = String(client.database ?? "");
  if (!host || host.includes(",") || !database || !Number.isInteger(port)) {
    throw new CommandError(
      "DATABASE_URL does not name exactly one host, port, and database.",
    );
  }
  return `${host}:${port}/${database}`;
}

// Removes terminal escape sequences, such as arrow keys, from typed input.
const ESCAPE_SEQUENCE = /\u001b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])?/g;

/** The parts of a terminal input stream that the hidden prompt uses. */
export interface HiddenInput {
  setRawMode(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
}

export interface PromptOutput {
  write(text: string): unknown;
}

/**
 * Asks each question in turn and reads one hidden answer per question.
 *
 * Echo is turned off (raw mode) before the first question is written and
 * stays off until every answer has been read, so a password that is typed
 * or pasted at any moment, including between two prompts, is never shown.
 * Answers that arrive together in one chunk are kept, not dropped.
 */
export function readHiddenAnswers(
  questions: readonly string[],
  input: HiddenInput,
  output: PromptOutput,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const answers: string[] = [];
    let value = "";
    let done = false;
    const finish = (error?: Error) => {
      done = true;
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      if (error) {
        output.write("\n");
        reject(error);
      } else {
        resolve(answers);
      }
    };
    const onData = (chunk: string) => {
      for (const character of chunk.replace(ESCAPE_SEQUENCE, "")) {
        if (done) {
          return;
        }
        if (character === "\r" || character === "\n") {
          answers.push(value);
          value = "";
          output.write("\n");
          const next = questions[answers.length];
          if (next === undefined) {
            finish();
            return;
          }
          output.write(next);
        } else if (character === "\u0003" || character === "\u0004") {
          finish(new CommandError("Cancelled. Nothing was changed."));
          return;
        } else if (character === "\u007f" || character === "\b") {
          value = [...value].slice(0, -1).join("");
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    // Echo off first, then the first question: no window in which typed
    // characters are echoed.
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
    output.write(questions[0] ?? "");
  });
}

async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.byteLength;
    if (total > MAX_STDIN_BYTES) {
      throw new CommandError("Standard input is too long for a password.");
    }
    chunks.push(buffer);
  }
  const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  const [password = "", ...rest] = lines;
  if (rest.some((line) => line !== "")) {
    throw new CommandError(
      "Standard input must contain the password on a single line.",
    );
  }
  return password;
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    return readPasswordFromStdin();
  }
  const [password = "", repeated] = await readHiddenAnswers(
    ["Password (not shown): ", "Repeat the password: "],
    process.stdin,
    process.stdout,
  );
  if (password !== repeated) {
    throw new CommandError("The passwords do not match. Nothing was changed.");
  }
  return password;
}

async function run(argv: readonly string[]): Promise<void> {
  const { command, target } = parseArguments(argv);

  // Local configuration lives in .env; variables already set take precedence.
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  const config = readAuthConfig(process.env);
  const effective = describeTarget(readDatabaseUrl(process.env));
  if (effective !== target.toLowerCase()) {
    throw new CommandError(
      `DATABASE_URL points to ${effective}, not to the --target given. Nothing was changed.`,
    );
  }

  console.log(`Database: ${effective}`);
  console.log(`Account:  ${config.authorEmail} (REFRAIN_AUTHOR_EMAIL)`);
  const password = await readPassword();

  if (command === "provision") {
    await provisionAuthor(getDb(), config, password);
    console.log("Created the author account. Sign in at /studio/sign-in.");
  } else {
    const { revokedSessions } = await resetAuthorPassword(
      getDb(),
      config,
      password,
    );
    console.log(
      `Changed the password and signed out ${revokedSessions} session(s).`,
    );
  }
}

/** Runs the command; the entry point is ./cli-entry.ts. */
export async function main(): Promise<void> {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    if (
      error instanceof CommandError ||
      error instanceof ProvisioningError ||
      error instanceof AuthConfigError ||
      error instanceof DatabaseConfigError
    ) {
      console.error(error.message);
    } else {
      // Codes only: a driver message can contain connection details or the
      // parameters of a failed query.
      console.error("The command failed.", describeAuthError(error));
    }
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
