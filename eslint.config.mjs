import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries from docs/architecture.md § Dependency rules.
const publicEntryPointsOnly = {
  group: ["@/db/*", "@/modules/*/*", "@/integrations/*/*"],
  message:
    "Import another module only through its public entry point (index.ts).",
};

const presentationMessage =
  "Presentation code calls module functions. It never uses the database client, the schema, or a database driver.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Approved design references are read-only and are not application code.
    "reference/**",
  ]),
  {
    rules: {
      "no-restricted-imports": ["error", { patterns: [publicEntryPointsOnly] }],
    },
  },
  {
    // Rule options do not merge, so this repeats the module-wide patterns.
    files: ["src/app/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/db",
              allowImportNames: ["checkDatabaseConnection"],
              message: presentationMessage,
            },
            { name: "pg", message: presentationMessage },
            { name: "drizzle-orm", message: presentationMessage },
          ],
          patterns: [
            publicEntryPointsOnly,
            { group: ["drizzle-orm/*"], message: presentationMessage },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
