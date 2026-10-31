import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import {
  assertDisposableTestDatabase,
  readTestDatabaseUrl,
  TestDatabaseSafetyError,
} from "./test-database";

/**
 * Vitest global setup for the integration project. Runs once, before any
 * test file. It refuses to continue unless TEST_DATABASE_URL passes the
 * client-side checks and the server confirms the disposable-test marker.
 * Only then does it apply the versioned migrations from src/db/migrations,
 * the same files and the same migrator bookkeeping as `pnpm db:migrate`.
 */
export default async function setup(): Promise<void> {
  try {
    await prepareTestDatabase();
  } catch (error) {
    // Print the refusal plainly: Vitest's own report of a global-setup error
    // can fail while formatting the stack trace and hide the message.
    if (error instanceof TestDatabaseSafetyError) {
      console.error(`\nRefusing to run integration tests: ${error.message}\n`);
    }
    throw error;
  }
}

async function prepareTestDatabase(): Promise<void> {
  const connectionString = readTestDatabaseUrl(process.env);
  const client = new Client({
    connectionString,
    application_name: "refrain-tests",
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    await assertDisposableTestDatabase(client);
    await migrate(drizzle({ client }), {
      migrationsFolder: "src/db/migrations",
    });
  } finally {
    await client.end();
  }
}
