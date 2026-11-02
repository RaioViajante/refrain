import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// M1.3B offers no way to publish, change an address, or delete permanently
// (docs/roadmap.md). The commands exist in the domain modules, so this proves
// that nothing under src/app can reach them: not by name, and not by importing
// the Publication module at all. A command that takes a DatabaseExecutor also
// cannot be called from presentation code, which has no database client; this
// is the second lock.

const FORBIDDEN_NAMES = new Set([
  "publishLanguageVersion",
  "unpublishLanguageVersion",
  "previewPublication",
  "previewPublicChange",
  // M2.2: the confirmed save's domain pieces. The studio's save action may
  // call only the save, and never forwards a confirmation (M2.3 builds the
  // dialogs that may).
  "previewAlbumJournalChange",
  "verifyChangeConfirmation",
  "requirePublicChangeConfirmation",
  "assertWrittenAsPredicted",
  "signConfirmation",
  "verifyConfirmation",
  "confirmationIsCurrent",
  "changeEntrySlug",
  "reserveInitialSlug",
  "retireEntrySlugs",
  "permanentlyDeleteEntry",
]);

function appFiles(): string[] {
  return readdirSync("src/app", { recursive: true, encoding: "utf8" })
    .map((file) => join("src/app", file))
    .filter((file) => /\.(m?[jt]sx?)$/.test(file) && !/\.test\./.test(file));
}

function violations(code: string): string[] {
  const source = ts.createSourceFile(
    "x.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith("@/modules/publication")
    ) {
      found.push("imports the Publication module");
    }
    if (ts.isIdentifier(node) && FORBIDDEN_NAMES.has(node.text)) {
      found.push(`mentions ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the studio cannot publish, re-address, or permanently delete", () => {
  it("holds for every file under src/app", () => {
    const files = appFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      expect(violations(readFileSync(file, "utf8")), file).toEqual([]);
    }
  });

  it("would catch each way of reaching those commands", () => {
    expect(
      violations('import { x } from "@/modules/publication";'),
    ).toHaveLength(1);
    expect(violations("publishLanguageVersion(db, id, 'en');")).toHaveLength(1);
    expect(violations("const f = permanentlyDeleteEntry;")).toHaveLength(1);
    expect(violations("changeEntrySlug(a, b, c)")).toHaveLength(1);
    expect(violations("previewPublication(db, author, input)")).toHaveLength(1);
    expect(violations("signConfirmation(author, issue)")).toHaveLength(1);
    expect(violations("verifyConfirmation(a, t, b)")).toHaveLength(1);
    expect(violations("previewAlbumJournalChange(db, a, i)")).toHaveLength(1);
    expect(violations("verifyChangeConfirmation(a, t, b)")).toHaveLength(1);
    expect(violations("export const ok = 1;")).toEqual([]);
  });
});
