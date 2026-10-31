import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/db";

import { TEST_DATABASE_MARKER } from "./test-database";

// The application's own client (getDb, which reads DATABASE_URL) must reach
// the marked test database during integration tests, never the development
// database.
describe("integration-test database isolation", () => {
  it("routes the application client to the marked *_test database", async () => {
    const result = await getDb().execute<{ name: string; marker: string }>(
      sql`select current_database() as name,
                 shobj_description(oid, 'pg_database') as marker
            from pg_database
           where datname = current_database()`,
    );
    expect(result.rows[0]?.name).toMatch(/_test$/);
    expect(result.rows[0]?.marker).toBe(TEST_DATABASE_MARKER);
  });
});
