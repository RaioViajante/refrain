import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests only, in Node. They never connect to a database. Database
// integration tests arrive with the first table, on a disposable database.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["archive/**", "node_modules/**"],
  },
});
