import { randomBytes } from "node:crypto";

import { afterAll } from "vitest";

import { closeDb } from "@/db";

import { readTestDatabaseUrl } from "./test-database";

// Runs in every integration-test worker before its test files load. The
// application's database client reads DATABASE_URL, so it is replaced with the
// validated test URL: code under test cannot reach the development database.
// Global setup has already verified the server-side marker for this URL.
process.env.DATABASE_URL = readTestDatabaseUrl(process.env);

// The application reads its authentication configuration from the
// environment, and the publication commands need its secret to issue and
// check confirmation tokens (ADR 0006 § 3). Tests never use the development
// secret: each worker gets a synthetic one that exists only in its memory.
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

afterAll(async () => {
  await closeDb();
});
