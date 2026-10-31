import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "./client";
import { checkDatabaseConnection } from "./health";

// Runs against a real PostgreSQL server (local: `pnpm db:up`; CI: a service
// container). Database behavior is never mocked.
describe("PostgreSQL connection", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("runs SELECT 1 through the server-side Drizzle client", async () => {
    const result = await getDb().execute<{ ok: number }>(sql`select 1 as ok`);
    expect(result.rows).toEqual([{ ok: 1 }]);
  });

  it("connects to PostgreSQL 17", async () => {
    const result = await getDb().execute<{ server_version_num: string }>(
      sql`show server_version_num`,
    );
    const version = Number(result.rows[0]?.server_version_num);
    expect(version).toBeGreaterThanOrEqual(170000);
    expect(version).toBeLessThan(180000);
  });

  it("reports the connection as healthy", async () => {
    await expect(checkDatabaseConnection()).resolves.toBe(true);
  });
});
