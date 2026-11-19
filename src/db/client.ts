import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { readDatabaseUrl } from "./env";
import * as schema from "./schema";

let database: ReturnType<typeof createDatabase> | undefined;

function createDatabase() {
  // Small and short-lived: serverless instances should not hold idle
  // connections (the hosted URL already goes through Neon's pooler).
  return drizzle(
    new Pool({
      connectionString: readDatabaseUrl(),
      max: 5,
      idleTimeoutMillis: 10_000,
    }),
    { schema },
  );
}

/**
 * The application's Drizzle client, created on first use. Importing this module
 * never connects, so builds do not depend on a database.
 */
export function getDatabase() {
  database ??= createDatabase();
  return database;
}
