import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const { PUBLIC_REVALIDATION_PATHS, revalidateAfter } =
  await import("./revalidation");

// ADR 0006 § 11: nothing is cached publicly, so there is nothing public to
// revalidate yet. This is the one seam, and these tests keep it honest.

describe("revalidateAfter", () => {
  beforeEach(() => revalidatePath.mockClear());

  it("does nothing for a read", () => {
    revalidateAfter("none");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refreshes only the private studio after a write", () => {
    revalidateAfter("writing");
    expect(revalidatePath.mock.calls).toEqual([["/studio", "layout"]]);
  });

  it("refreshes only the private studio after a visibility change, because no public path exists yet", () => {
    revalidateAfter("visibility");
    expect(revalidatePath.mock.calls).toEqual([["/studio", "layout"]]);
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
