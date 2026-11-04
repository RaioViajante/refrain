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
const M = "src/app/studio/memories";
const WRAPPER_FILES: Record<string, string[]> = {
  previewAlbumJournalPublication: [`${J}/preview-publication-action.ts`],
  previewAlbumJournalPublicChange: [`${J}/preview-change-action.ts`],
  publishAlbumJournalVersion: [`${J}/actions.ts`],
  // M3.7: the memory wrappers, the same way.
  previewMemoryPublication: [`${M}/preview-publication-action.ts`],
  previewMemoryPublicChange: [`${M}/preview-change-action.ts`],
  publishMemoryVersion: [`${M}/actions.ts`],
};

// The confirmation token reaches the browser only inside a dialog and leaves
// it only from that dialog's confirm control (ADR 0006 § 5). The two dialogs
// are the only client files that may name it, and each preview action is
// imported by its own dialog alone.
const TOKEN_FILES = new Set([
  `${J}/publish-dialog.tsx`,
  `${J}/change-dialog.tsx`,
  `${M}/memory-publish-dialog.tsx`,
  `${M}/memory-change-dialog.tsx`,
]);
const PREVIEW_ACTION_IMPORTERS: Record<string, string> = {
  "@/app/studio/journals/preview-publication-action": `${J}/publish-dialog.tsx`,
  "@/app/studio/journals/preview-change-action": `${J}/change-dialog.tsx`,
  "@/app/studio/memories/preview-publication-action": `${M}/memory-publish-dialog.tsx`,
  "@/app/studio/memories/preview-change-action": `${M}/memory-change-dialog.tsx`,
};

// Any module path that names the Publication module, whatever it begins with:
// the alias, or a relative path that climbs to it.
const PUBLICATION_MODULE = /(^|\/)modules\/publication(\/|$)/;

// The only files under src/app that may import its reading entry point.
const PUBLIC_READING_FILES =
  /^src\/app\/(\(public\)\/|\(artists\)\/|\(memories\)\/|\(archives\)\/|page\.tsx$|not-found\.tsx$|sitemap\.xml\/route\.ts$|robots\.txt\/route\.ts$)/;

/** The module path a node names, if it names one with a string literal. */
function moduleNamed(node: ts.Node): string | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) &&
        node.expression.text === "require")) &&
    node.arguments[0] !== undefined &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    return node.arguments[0].text;
  }
  return undefined;
}

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
    // Every way of naming the Publication module: `import`, `export ... from`,
    // `import x = require()`, `require()`, and `import()`, by alias or by a
    // relative path. The one exception is the module's public reading entry
    // point (reads and the public-reads switch, never a command), and only from
    // the public files: the public pages, the not-found view, and the two
    // documents (src/app/public-surface.test.ts checks the rest). The studio
    // never uses it.
    const named = moduleNamed(node);
    if (named !== undefined && PUBLICATION_MODULE.test(named)) {
      const readsOnly =
        named === "@/modules/publication/public" &&
        PUBLIC_READING_FILES.test(file);
      if (!readsOnly) {
        found.push("imports the Publication module");
      }
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] !== undefined &&
      !ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push("loads a module by a computed name");
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

  describe("a public file cannot reach a command, and only public files read", () => {
    const publicFile = "src/app/(public)/albums/[slug]/page.tsx";

    it.each([
      ["a command", 'import { x } from "@/modules/publication/commands";'],
      ["the module's index", 'import { x } from "@/modules/publication";'],
      [
        "a type import of a command",
        'import type { x } from "@/modules/publication/commands";',
      ],
      [
        "a re-export of a command",
        'export { x } from "@/modules/publication/commands";',
      ],
      [
        "a namespace re-export",
        'export * from "@/modules/publication/commands";',
      ],
      [
        "an import-equals",
        'import x = require("@/modules/publication/commands");',
      ],
      [
        "a require call",
        'const x = require("@/modules/publication/commands");',
      ],
      [
        "a dynamic import",
        'const x = await import("@/modules/publication/commands");',
      ],
      [
        "a relative path to a command",
        'import { x } from "../../../../modules/publication/commands";',
      ],
      [
        "a relative path to the reading entry point (only the alias is allowed)",
        'import { x } from "../../../../modules/publication/public";',
      ],
      [
        "a relative dynamic import",
        'const x = await import("../../../modules/publication/commands");',
      ],
      ["a computed dynamic import", "const x = await import(name);"],
      ["a computed require", "const x = require(name);"],
      ["a command by name", "changeEntrySlug(a, b, c);"],
      [
        "a command by element access",
        'const f = ns["publishLanguageVersion"];',
      ],
    ])("rejects %s", (_label, code) => {
      expect(violations(code, publicFile).length).toBeGreaterThan(0);
    });

    it("allows the reading entry point to the public files, and to no one else", () => {
      const reading = 'import { x } from "@/modules/publication/public";';
      for (const file of [
        publicFile,
        "src/app/(public)/layout.tsx",
        "src/app/sitemap.xml/route.ts",
        "src/app/robots.txt/route.ts",
        "src/app/not-found.tsx",
        // The Home (M3.4), and only the root one.
        "src/app/page.tsx",
        // M3.7: the memory pages.
        "src/app/(memories)/memories/[slug]/page.tsx",
        // M3.8a: the archives.
        "src/app/(archives)/albums/page.tsx",
      ]) {
        expect(violations(reading, file), file).toEqual([]);
      }
      for (const file of [
        "src/app/studio/journals/page.tsx",
        "src/app/studio/page.tsx",
        "src/app/x/page.tsx",
        "src/app/layout.tsx",
        "src/app/api/auth/[...all]/route.ts",
        "src/app/api/export/route.ts",
        "src/app/studio/(public)/x.tsx",
        "src/app/feed.xml/route.ts",
      ]) {
        expect(violations(reading, file).length, file).toBeGreaterThan(0);
      }
    });
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
    // M3.7: the memory wrappers, token, and preview actions, the same way.
    const memoryPreview = `${M}/preview-publication-action.ts`;
    expect(violations("previewMemoryPublication(a, i)", memoryPreview)).toEqual(
      [],
    );
    expect(violations("previewMemoryPublication(a, i)")).toHaveLength(1);
    expect(
      violations("previewMemoryPublication(a, i)", `${M}/actions.ts`),
    ).toHaveLength(1);
    expect(violations("publishMemoryVersion(a, i)", `${M}/actions.ts`)).toEqual(
      [],
    );
    expect(
      violations("publishMemoryVersion(a, i)", `${J}/actions.ts`),
    ).toHaveLength(1);
    expect(
      violations("previewMemoryPublicChange(a, i)", `${M}/actions.ts`),
    ).toHaveLength(1);
    expect(
      violations("const t = result.confirmation;", `${M}/memory-editor.tsx`),
    ).toHaveLength(1);
    expect(
      violations(
        "const t = result.confirmation;",
        `${M}/memory-change-dialog.tsx`,
      ),
    ).toEqual([]);
    expect(
      violations(
        'import { p } from "@/app/studio/memories/preview-change-action";',
        `${M}/memory-publish-dialog.tsx`,
      ),
    ).toHaveLength(1);
    expect(
      violations(
        'import { p } from "@/app/studio/memories/preview-publication-action";',
        `${J}/publish-dialog.tsx`,
      ),
    ).toHaveLength(1);
  });
});

describe("a preview refreshes nothing", () => {
  // A preview reads. If it asked Next.js to refresh the studio it would also
  // re-render the author's page for nothing, and a visibility effect would
  // suggest that it had changed something.
  it.each([
    "src/app/studio/journals/preview-publication-action.ts",
    "src/app/studio/journals/preview-change-action.ts",
    "src/app/studio/memories/preview-publication-action.ts",
    "src/app/studio/memories/preview-change-action.ts",
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
