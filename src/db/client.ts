import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { readDatabaseUrl } from "./env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

interface Connection {
  pool: Pool;
  db: Database;
}

// Kept on globalThis so that development hot reloads reuse one pool instead of
// opening a new one on every edit.
const globalForDb = globalThis as typeof globalThis & {
  refrainDatabase?: Connection;
};

function connect(): Connection {
  const pool = new Pool({
    connectionString: readDatabaseUrl(),
    application_name: "refrain",
    connectionTimeoutMillis: 5_000,
  });

  // An idle client can fail (for example when PostgreSQL restarts). Without a
  // listener, the error would crash the process. Log only the error code:
  // driver messages can include connection details.
  pool.on("error", (error: Error & { code?: string }) => {
    console.error("PostgreSQL idle client error", { code: error.code });
  });

  return { pool, db: drizzle({ client: pool, schema }) };
}

/**
 * The Drizzle database. The pool is created on first use, so importing this
 * module (for example during `next build`) never opens a connection.
 */
export function getDb(): Database {
  globalForDb.refrainDatabase ??= connect();
  return globalForDb.refrainDatabase.db;
}

/** Closes the pool, if one was opened. */
export async function closeDb(): Promise<void> {
  const connection = globalForDb.refrainDatabase;
  globalForDb.refrainDatabase = undefined;
  await connection?.pool.end();
}
