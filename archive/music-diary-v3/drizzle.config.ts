import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

import { readDatabaseUrl } from "./src/db/env";

// Local configuration lives in .env (copy .env.example). Variables already set
// in the environment take precedence.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// Migrations are generated, read, and committed; they are never replaced by
// `drizzle-kit push`. See docs/development.md § Database changes.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: readDatabaseUrl() },
  strict: true,
  verbose: true,
});
