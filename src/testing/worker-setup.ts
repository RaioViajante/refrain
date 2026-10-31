import { afterAll } from "vitest";

import { closeDb } from "@/db";

import { readTestDatabaseUrl } from "./test-database";

// Runs in every integration-test worker before its test files load. The
// application's database client reads DATABASE_URL, so it is replaced with the
// validated test URL: code under test cannot reach the development database.
// Global setup has already verified the server-side marker for this URL.
process.env.DATABASE_URL = readTestDatabaseUrl(process.env);

afterAll(async () => {
  await closeDb();
});
