import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

async function importErrors(source: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(source, {
    filePath: `${root}src/app/boundary-check.ts`,
  });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

describe("eslint.config.mjs", () => {
  it("refuses imports from the archived application", async () => {
    for (const specifier of [
      "../../archive/music-diary-v3/src/db",
      "@/../archive/music-diary-v3/src/db/schema",
      "archive/music-diary-v3/next.config",
    ]) {
      expect(await importErrors(`import "${specifier}";\n`)).toEqual([
        expect.stringContaining("archived music diary"),
      ]);
    }
  });

  it("allows the application's own modules", async () => {
    expect(
      await importErrors(`import "@/db/env";\nimport "./archived";\n`),
    ).toEqual([]);
  });
});
