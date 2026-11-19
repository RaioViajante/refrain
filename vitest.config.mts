import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests only, in Node. They never connect to a database; integration
// tests (*.db.test.ts) run with vitest.db.config.mts on a disposable one.
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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["archive/**", "node_modules/**", "src/**/*.db.test.ts"],
  },
});
