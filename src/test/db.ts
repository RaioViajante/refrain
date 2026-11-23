import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach } from "vitest";

import { readTestDatabaseUrl } from "@/db/env";
import * as schema from "@/db/schema";
import type { Database } from "@/db/types";

/**
 * A connection to the disposable test database, emptied before each test and
 * closed after the file. Use only from *.db.test.ts files.
 */
export function connectTestDatabase(): Database {
  const pool = new Pool({ connectionString: readTestDatabaseUrl(), max: 4 });
  const db = drizzle(pool, { schema });

  beforeEach(async () => {
    await db.execute(sql`
      truncate trash_image_refs, trash_files, trash_items, text_versions, mixtape_tracks, site_images, site_texts, mixtapes, songs, image_files, images, studio_sessions, studio_login_attempts
    `);
  });
  afterAll(async () => {
    await pool.end();
  });

  return db;
}

/** The PostgreSQL error code (and constraint) behind a failed query. */
export async function pgError(
  promise: Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    const { code, constraint } = cause as {
      code?: string;
      constraint?: string;
    };
    return { code, constraint };
  }
  throw new Error("expected the query to fail");
}
