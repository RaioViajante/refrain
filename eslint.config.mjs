import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries from docs/architecture.md § Dependency rules.
const publicEntryPointsOnly = {
  group: ["@/db/*", "@/modules/*/*", "@/integrations/*/*"],
  message:
    "Import another module only through its public entry point (index.ts).",
};

// The Publication module's second entry point, `public`, exports reads and the
// public-reads switch, never a command (src/modules/publication/public.ts). Only
// the public pages (the Home among them), the sitemap, robots.txt, and the
// proxy may use it, through
// the override below; src/app/public-surface.test.ts holds the same list.
const publicEntryPointsPlusReads = {
  group: [...publicEntryPointsOnly.group, "!@/modules/publication/public"],
  message: publicEntryPointsOnly.message,
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
  {
    // The public surface: the one place that may import the Publication
    // module's reading entry point. Rule options do not merge, so the
    // presentation restrictions are repeated.
    files: [
      "src/app/\\(public\\)/**",
      // The artist pages (M3.5): their own route group, for their header.
      "src/app/\\(artists\\)/**",
      // The memory pages (M3.7): their own route group, for their header.
      "src/app/\\(memories\\)/**",
      // The Home (M3.4): the root page, outside the route group.
      "src/app/page.tsx",
      "src/app/sitemap.xml/**",
      "src/app/robots.txt/**",
    ],
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
            publicEntryPointsPlusReads,
            noParentRelativeImports,
            { group: ["drizzle-orm/*"], message: presentationMessage },
          ],
        },
      ],
    },
  },
  {
    files: ["src/proxy.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [publicEntryPointsPlusReads, noParentRelativeImports] },
      ],
    },
  },
]);

export default eslintConfig;
