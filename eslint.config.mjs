import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries from docs/architecture.md § Dependency rules.
const publicEntryPointsOnly = {
  // The second entry point of the Publication module, `public`, is the only
  // other file that may be imported: it exports reads and the public-reads
  // switch, never a command (src/modules/publication/public.ts). Studio files
  // may not use it (src/app/public-surface.test.ts).
  group: [
    "@/db/*",
    "@/modules/*/*",
    "@/integrations/*/*",
    "!@/modules/publication/public",
  ],
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
    // Playwright output.
    "test-results/**",
    "playwright-report/**",
    "playwright/**",
    "visual-review/**",
  ]),
  {
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [publicEntryPointsOnly, noParentRelativeImports] },
      ],
      // An argument that is deliberately unused starts with an underscore:
      // the AuthorizedAuthor that a studio command takes only as proof that
      // the request was authorized.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
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
