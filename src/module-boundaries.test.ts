import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Proves that the lint rules in eslint.config.mjs enforce the dependency rules
// in docs/architecture.md, using the repository's real ESLint configuration.
const eslint = new ESLint();

async function boundaryViolations(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter(
    (message) => message.ruleId === "no-restricted-imports",
  );
}

describe("module boundaries", () => {
  it.each([
    'import { getDb } from "@/db";',
    'import { getDb } from "@/db/client";',
    'import { Pool } from "pg";',
    'import { sql } from "drizzle-orm";',
    'import { drizzle } from "drizzle-orm/node-postgres";',
  ])("rejects database access from presentation code: %s", async (code) => {
    const violations = await boundaryViolations(
      `${code}\nexport {};\n`,
      "src/app/example/page.tsx",
    );
    expect(violations).toHaveLength(1);
  });

  it("allows presentation code to call the connection check", async () => {
    const violations = await boundaryViolations(
      'import { checkDatabaseConnection } from "@/db";\nexport { checkDatabaseConnection };\n',
      "src/app/example/page.tsx",
    );
    expect(violations).toEqual([]);
  });

  it("allows presentation code to use the Identity entry point", async () => {
    const violations = await boundaryViolations(
      'import { requireAuthor } from "@/modules/identity";\nexport { requireAuthor };\n',
      "src/app/studio/page.tsx",
    );
    expect(violations).toEqual([]);
  });

  it.each([
    'import { provisionAuthor } from "@/modules/identity/provisioning";',
    'import { createAuth } from "@/modules/identity/auth";',
    'import { main } from "@/modules/identity/cli";',
  ])(
    "keeps account provisioning and the auth instance out of presentation code: %s",
    async (code) => {
      const violations = await boundaryViolations(
        `${code}\nexport {};\n`,
        "src/app/studio/page.tsx",
      );
      expect(violations).toHaveLength(1);
    },
  );

  it.each([
    [
      'import { x } from "@/modules/catalog/queries";',
      "src/modules/journals/x.ts",
    ],
    [
      'import { x } from "@/integrations/musicbrainz/client";',
      "src/modules/catalog/x.ts",
    ],
    ['import { getDb } from "@/db/client";', "src/modules/catalog/x.ts"],
  ])(
    "rejects a deep import into another module: %s",
    async (code, filePath) => {
      const violations = await boundaryViolations(
        `${code}\nexport {};\n`,
        filePath,
      );
      expect(violations).toHaveLength(1);
    },
  );

  it("allows modules to use each other's public entry points", async () => {
    const violations = await boundaryViolations(
      'import { getDb } from "@/db";\nimport { x } from "@/modules/catalog";\nexport { getDb, x };\n',
      "src/modules/journals/x.ts",
    );
    expect(violations).toEqual([]);
  });

  it.each([
    ['import { getDb } from "../db/client";', "src/app/page.tsx"],
    ['import { getDb } from "../../db";', "src/app/example/page.tsx"],
    ['import { x } from "../catalog/queries";', "src/modules/journals/x.ts"],
  ])(
    "rejects a relative import that leaves its directory: %s",
    async (code, filePath) => {
      const violations = await boundaryViolations(
        `${code}\nexport {};\n`,
        filePath,
      );
      expect(violations).toHaveLength(1);
    },
  );

  it("allows relative imports within the same directory", async () => {
    const violations = await boundaryViolations(
      'import { x } from "./queries";\nexport { x };\n',
      "src/modules/catalog/index.ts",
    );
    expect(violations).toEqual([]);
  });
});
