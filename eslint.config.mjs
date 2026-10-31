import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries from docs/architecture.md § Dependency rules.
const publicEntryPointsOnly = {
  group: ["@/db/*", "@/modules/*/*", "@/integrations/*/*"],
  message:
    "Import another module only through its public entry point (index.ts).",
};

// Relative imports may not leave the current directory. Anything else uses
// the @/ alias, so the patterns above cannot be bypassed with a ../ path.
const noParentRelativeImports = {
  regex: "^\\.\\./",
  message:
    "Use the @/ alias for imports outside the current directory, so module boundaries can be checked.",
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
    // Local-only design references (ignored by Git), not application code.
    "reference/**",
  ]),
  {
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [publicEntryPointsOnly, noParentRelativeImports] },
      ],
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
            noParentRelativeImports,
            { group: ["drizzle-orm/*"], message: presentationMessage },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
