import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "./client";
import { checkDatabaseConnection, describeFailure } from "./health";

// Runs against the disposable test database (local: `pnpm db:test:up`; CI: a
// service container). Database behavior is never mocked.
describe("PostgreSQL connection", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("runs SELECT 1 through the server-side Drizzle client", async () => {
    const result = await getDb().execute<{ ok: number }>(sql`select 1 as ok`);
    expect(result.rows).toEqual([{ ok: 1 }]);
  });

  // The supported major versions: 17 (Compose, the academic demonstration)
  // and 18 (the hosted database). Each is tested in CI. Any other major fails
  // here until it has been tested and added.
  it("connects to a supported PostgreSQL major version (17 or 18)", async () => {
    const result = await getDb().execute<{ server_version_num: string }>(
      sql`show server_version_num`,
    );
    const version = Number(result.rows[0]?.server_version_num);
    expect([17, 18]).toContain(Math.floor(version / 10000));
  });

  it("reports the connection as healthy", async () => {
    await expect(checkDatabaseConnection()).resolves.toBe(true);
  });

  it("finds the SQLSTATE of a real failed query wrapped by Drizzle", async () => {
    const error = await getDb()
      .execute(sql`select * from m1_1_table_that_does_not_exist`)
      .then(
        () => undefined,
        (rejection: unknown) => rejection,
      );
    // 42P01: undefined_table.
    expect(describeFailure(error)).toEqual({ code: "42P01" });
  });
});
