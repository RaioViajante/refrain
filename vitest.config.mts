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
        // Runs only against the disposable test database in TEST_DATABASE_URL
        // (`pnpm db:test:up`), never against DATABASE_URL. Global setup refuses
        // to start unless the target passes the safety checks in
        // src/testing/test-database.ts. Test files run one at a time so their
        // rolled-back transactions never wait on each other.
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
          globalSetup: ["src/testing/global-setup.ts"],
          setupFiles: ["src/testing/worker-setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
