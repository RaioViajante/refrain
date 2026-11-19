import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { readTestDatabaseUrl } from "../db/env";

/**
 * Rebuilds the disposable test database from empty and applies every
 * committed migration in order, exactly as a new database would receive them.
 */
export default async function setup() {
  const pool = new Pool({ connectionString: readTestDatabaseUrl() });
  try {
    const db = drizzle(pool);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`create schema public`);
    await migrate(db, { migrationsFolder: "src/db/migrations" });
  } finally {
    await pool.end();
  }
}
