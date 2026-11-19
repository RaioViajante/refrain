// Every Studio entry point authorizes on the server itself (AGENTS.md § 4).
// This test reads the source: each Server Action must start with
// `await requireStudio()`, and each Studio page, layout, and route handler
// must call it, except the sign-in page and the sign-in/out actions.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const studio = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_ACTIONS = new Set(["signInAction", "signOutAction"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe("Studio authorization", () => {
  it("starts every Server Action with requireStudio()", () => {
    const actions = files(path.join(studio, "_actions")).filter(
      (f) =>
        /\.tsx?$/.test(f) && readFileSync(f, "utf8").startsWith('"use server"'),
    );
    expect(actions.length).toBeGreaterThan(0);
    let checked = 0;
    for (const file of actions) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(
        /export async function (\w+)\([^)]*\)[^{]*\{\s*([^\n]*)/g,
      )) {
        const [, name, firstLine] = m;
        checked++;
        if (PUBLIC_ACTIONS.has(name!)) continue;
        expect(firstLine, `${path.basename(file)}: ${name}`).toBe(
          "await requireStudio();",
        );
      }
      // Nothing else may be exported from a "use server" module.
      const exported = [...source.matchAll(/^export (?!async function)/gm)];
      expect(exported, path.basename(file)).toEqual([]);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("guards every Studio page, layout, and route handler", () => {
    const entries = files(studio).filter((f) =>
      /\/(page|layout|route)\.tsx?$/.test(f),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const file of entries) {
      const relative = path.relative(studio, file);
      if (relative.startsWith(`entrar${path.sep}`)) continue;
      expect(readFileSync(file, "utf8"), relative).toContain(
        "await requireStudio()",
      );
    }
  });
});
