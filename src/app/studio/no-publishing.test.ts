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
  // The confirmed save's domain pieces. The Journals wrappers that M2.3
  // exposes to the studio are in WRAPPER_FILES below, each in one file only.
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

// The Journals wrappers that studio actions call (ADR 0006 § 9), and the one
// file each may be named in. A token is minted only by the two preview actions,
// each alone in its own file, and the publish wrapper is called only by the
// publish action. Adding a file here needs review.
const J = "src/app/studio/journals";
const WRAPPER_FILES: Record<string, string[]> = {
  previewAlbumJournalPublication: [`${J}/preview-publication-action.ts`],
  previewAlbumJournalPublicChange: [`${J}/preview-change-action.ts`],
  publishAlbumJournalVersion: [`${J}/actions.ts`],
};

// The confirmation token reaches the browser only inside a dialog and leaves
// it only from that dialog's confirm control (ADR 0006 § 5). The two dialogs
// are the only client files that may name it, and each preview action is
// imported by its own dialog alone.
const TOKEN_FILES = new Set([
  `${J}/publish-dialog.tsx`,
  `${J}/change-dialog.tsx`,
]);
const PREVIEW_ACTION_IMPORTERS: Record<string, string> = {
  "@/app/studio/journals/preview-publication-action": `${J}/publish-dialog.tsx`,
  "@/app/studio/journals/preview-change-action": `${J}/change-dialog.tsx`,
};

function appFiles(): string[] {
  return readdirSync("src/app", { recursive: true, encoding: "utf8" })
    .map((file) => join("src/app", file))
    .filter((file) => /\.(m?[jt]sx?)$/.test(file) && !/\.test\./.test(file));
}

function violations(code: string, file = "x.tsx"): string[] {
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
    if (ts.isIdentifier(node) && node.text in WRAPPER_FILES) {
      if (!WRAPPER_FILES[node.text]!.includes(file)) {
        found.push(`mentions ${node.text} outside its action`);
      }
    }
    if (
      ts.isIdentifier(node) &&
      node.text === "confirmation" &&
      !TOKEN_FILES.has(file)
    ) {
      found.push("names the confirmation token outside a dialog");
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text in PREVIEW_ACTION_IMPORTERS &&
      PREVIEW_ACTION_IMPORTERS[node.moduleSpecifier.text] !== file
    ) {
      found.push("imports a preview action that is not its own");
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
      expect(
        violations(readFileSync(file, "utf8"), file.split("\\").join("/")),
        file,
      ).toEqual([]);
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

  it("keeps each wrapper, the token, and each preview action to its own file", () => {
    const preview = "src/app/studio/journals/preview-publication-action.ts";
    expect(violations("previewAlbumJournalPublication(a, i)", preview)).toEqual(
      [],
    );
    expect(violations("previewAlbumJournalPublication(a, i)")).toHaveLength(1);
    expect(
      violations("publishAlbumJournalVersion(a, i)", `${J}/actions.ts`),
    ).toEqual([]);
    expect(
      violations("publishAlbumJournalVersion(a, i)", preview),
    ).toHaveLength(1);
    expect(
      violations("previewAlbumJournalPublicChange(a, i)", `${J}/actions.ts`),
    ).toHaveLength(1);
    expect(
      violations("const t = result.confirmation;", `${J}/journal-editor.tsx`),
    ).toHaveLength(1);
    expect(
      violations("const t = result.confirmation;", `${J}/change-dialog.tsx`),
    ).toEqual([]);
    expect(
      violations(
        'import { p } from "@/app/studio/journals/preview-change-action";',
        `${J}/publish-dialog.tsx`,
      ),
    ).toHaveLength(1);
    expect(
      violations(
        'import { p } from "@/app/studio/journals/preview-change-action";',
        `${J}/change-dialog.tsx`,
      ),
    ).toEqual([]);
  });
});
