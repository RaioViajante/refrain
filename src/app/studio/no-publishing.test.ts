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
      // The one exception is the Publication module's public reading entry
      // point (reads and the public-reads switch, never a command), and only
      // outside the studio: the public pages, the proxy, and the sitemap use
      // it (src/app/public-surface.test.ts). The studio never does.
      const readsOnly =
        node.moduleSpecifier.text === "@/modules/publication/public" &&
        !file.startsWith("src/app/studio/");
      if (!readsOnly) {
        found.push("imports the Publication module");
      }
    }
    // Evasions by string: an element access by name, and a dynamic import of a
    // module that holds a command or a wrapper.
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      (FORBIDDEN_NAMES.has(node.argumentExpression.text) ||
        node.argumentExpression.text in WRAPPER_FILES)
    ) {
      found.push(`reaches ${node.argumentExpression.text} by name`);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      /^@\/modules\/(publication|journals|identity)/.test(
        node.arguments[0].text,
      )
    ) {
      found.push("imports a domain module dynamically");
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
    // The reading entry point is allowed for public files, never the studio.
    expect(
      violations(
        'import { x } from "@/modules/publication/public";',
        "src/app/(public)/albums/page.tsx",
      ),
    ).toEqual([]);
    expect(
      violations(
        'import { x } from "@/modules/publication/public";',
        "src/app/studio/journals/page.tsx",
      ),
    ).toHaveLength(1);
    expect(
      violations('import { x } from "@/modules/publication/commands";'),
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
    expect(violations('const f = ns["publishLanguageVersion"];')).toHaveLength(
      1,
    );
    expect(
      violations('const m = await import("@/modules/journals");'),
    ).toHaveLength(1);
    expect(violations('const m = await import("./local");')).toEqual([]);
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

describe("a preview refreshes nothing", () => {
  // A preview reads. If it asked Next.js to refresh the studio it would also
  // re-render the author's page for nothing, and a visibility effect would
  // suggest that it had changed something.
  it.each([
    "src/app/studio/journals/preview-publication-action.ts",
    "src/app/studio/journals/preview-change-action.ts",
  ])("%s runs its command with the effect none", (file) => {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const effects: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "perform"
      ) {
        const effect = node.arguments[1];
        effects.push(
          effect && ts.isStringLiteralLike(effect) ? effect.text : "missing",
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(effects).toEqual(["none"]);
  });
});
