import type { TestProject } from "vitest/node";

import { startProductionServer } from "./production-server";
import { TestDatabaseSafetyError } from "./test-database";

// Vitest global setup for the HTTP project (`pnpm test:http`). It tests the
// real production build, `next start`, over real HTTP, started by the shared
// helper in ./production-server.ts: the same five safety checks on
// TEST_DATABASE_URL, the migrations, a synthetic author created with the real
// provisioning command, and a server on a free port that can reach only the
// disposable test database. Teardown stops the server and deletes the
// identity rows it created.

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
  const server = await startProductionServer();
  provide("studioBaseURL", server.baseURL);
  provide("studioAuthorEmail", server.authorEmail);
  provide("studioAuthorPassword", server.authorPassword);
  provide("studioDatabaseTarget", server.databaseTarget);
  provide("studioCommandEnv", server.commandEnv);
  provide("studioServerLog", server.serverLog);
  return server.stop;
}
