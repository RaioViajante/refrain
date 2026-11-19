import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Integration tests against real PostgreSQL: the disposable Compose service
// `postgres-test` (pnpm db:test:up). src/db/env.ts refuses any database that
// is not local and named *_test. Files run one at a time: they share it.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    exclude: ["archive/**", "e2e/**", "node_modules/**"],
    globalSetup: ["src/test/db-global-setup.ts"],
    fileParallelism: false,
  },
});
