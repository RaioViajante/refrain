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
  // The application's tsconfig keeps JSX for Next.js to compile; tests compile
  // it themselves.
  esbuild: { jsx: "automatic" },
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
          exclude: [
            "src/**/*.integration.test.ts",
            "src/**/*.http.test.ts",
            "src/**/*.backup.test.ts",
          ],
          setupFiles: ["src/testing/unit-setup.ts"],
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
      {
        // The production build (`pnpm build` first) served by `next start`,
        // tested over real HTTP. Global setup applies the same safety checks
        // to TEST_DATABASE_URL, and gives the server only that database
        // (src/testing/http-global-setup.ts).
        extends: true,
        test: {
          name: "http",
          include: ["src/**/*.http.test.ts"],
          globalSetup: ["src/testing/http-global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // The hosted-backup toolchain (ops/backup) end to end: it builds the
        // tools image, and dumps, restores, encrypts, and drills against
        // scratch databases on the disposable PostgreSQL 18 test server in
        // TEST_DATABASE_URL (`pnpm db:test18:up`). Needs Docker. It refuses
        // any database that fails the same safety checks as the other
        // database suites, and any server that is not PostgreSQL 18.
        extends: true,
        test: {
          name: "backup",
          include: ["src/**/*.backup.test.ts"],
          fileParallelism: false,
          testTimeout: 180_000,
          hookTimeout: 600_000,
        },
      },
    ],
  },
});
