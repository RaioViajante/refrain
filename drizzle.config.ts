import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

import { readLocalDatabaseUrl } from "./src/db/env";

// Local configuration lives in .env (copy .env.example). Variables already set
// in the environment take precedence.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// Migrations are generated, read, and committed; never `drizzle-kit push`.
// Only a local database is accepted (src/db/env.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: readLocalDatabaseUrl() },
  strict: true,
  verbose: true,
});
