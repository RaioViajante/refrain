import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const { PUBLIC_REVALIDATION_PATHS, STUDIO_ROUTE_PATHS, revalidateAfter } =
  await import("./revalidation");

// ADR 0006 § 11: nothing is cached publicly, so there is nothing public to
// revalidate yet. This is the one seam, and these tests keep it honest.

describe("revalidateAfter", () => {
  beforeEach(() => revalidatePath.mockClear());

  it("does nothing for a read", () => {
    revalidateAfter("none");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // PR 3 (ADR 0008 § 9): both Studio trees, each by its own route path, after
  // every write, whichever language the action was called from.
  it("refreshes only the private studio, in both languages, after a write", () => {
    revalidateAfter("writing");
    expect(revalidatePath.mock.calls).toEqual([
      ["/(en)/studio", "layout"],
      ["/pt/studio", "layout"],
    ]);
  });

  it("refreshes only the private studio, in both languages, after a visibility change, because no public path exists yet", () => {
    revalidateAfter("visibility");
    expect(revalidatePath.mock.calls).toEqual([
      ["/(en)/studio", "layout"],
      ["/pt/studio", "layout"],
    ]);
  });

  it("names each tree by its route file, which exists", () => {
    expect(STUDIO_ROUTE_PATHS).toEqual(["/(en)/studio", "/pt/studio"]);
    for (const path of STUDIO_ROUTE_PATHS) {
      expect(existsSync(join("src/app", path, "layout.tsx")), path).toBe(true);
    }
  });

  it("has no public path yet; filling it needs the M3.1 work and its tests", () => {
    expect(PUBLIC_REVALIDATION_PATHS).toEqual([]);
  });
});

describe("the revalidation module is the only caller", () => {
  const NAMES = new Set(["revalidatePath", "revalidateTag", "updateTag"]);

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { recursive: true, encoding: "utf8" })
      .map((file) => join(directory, file))
      .filter(
        (file) => /\.(m?[jt]sx?)$/.test(file) && !/\.test\.[jt]sx?$/.test(file),
      );
  }

  it("holds for all production source", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
      if (file.endsWith(join("studio", "revalidation.ts"))) {
        continue;
      }
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && NAMES.has(node.text)) {
          offenders.push(`${file}: ${node.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
  });
});
