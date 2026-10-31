import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Local configuration lives in .env (copy .env.example). Variables already set
// in the environment, as in CI, take precedence.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const src = fileURLToPath(new URL("./src/", import.meta.url));
// `server-only` throws outside a React Server Components bundle. Tests run
// server modules directly in Node, so they use the package's own empty module.
const serverOnly = fileURLToPath(
  new URL("./node_modules/server-only/empty.js", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: src },
      { find: /^server-only$/, replacement: serverOnly },
    ],
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        // Requires a running PostgreSQL (`pnpm db:up`) and DATABASE_URL.
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
        },
      },
    ],
  },
});
