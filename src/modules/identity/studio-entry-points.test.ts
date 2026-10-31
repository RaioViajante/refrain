import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// Every studio entry point authorizes the request itself (docs/security.md §
// Authorization contract). A layout or proxy is never the check, so this
// test looks at each studio page, route handler, and file-based metadata
// route, and at every server-action file anywhere in src/ (a server action
// is a public POST endpoint wherever it lives). The HTTP tests remain the
// proof that the check works.
//
// Limits: the check is per file, not per entry point. It passes a file in
// which any function calls the authorization, so it does not yet catch:
// - a "use server" file with one exported action that skips the check;
// - an inline action (a function-level "use server" directive);
// - a generateMetadata that skips the check;
// - a route handler outside src/app/studio.
// No server action or studio route handler exists in M1.3A. With the first
// one, M1.3B extends this test to check every exported action, every
// function-level action, and every route handler, each starting with an
// awaited requireAuthor (issue #6).
//
// Layouts are not entry points that can be authorized on their own (they do
// not re-run on every navigation); they must never render private data.

const SOURCE = /\.(m?[jt]sx?)$/;
const STUDIO = join("src", "app", "studio");
const STUDIO_ENTRY =
  /(^|[\\/])(page|route|default|template|opengraph-image|twitter-image|icon|apple-icon|sitemap)\.(m?[jt]sx?)$/;
const AUTHORIZATION_FUNCTIONS = new Set(["authorizeAuthor", "requireAuthor"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .map((file) => join(directory, file))
    .filter((file) => SOURCE.test(file) && !/\.test\.[jt]sx?$/.test(file));
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

// A "use server" directive at the top of the file (not in a comment).
function isServerActionFile(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use server") {
      return true;
    }
  }
  return false;
}

// An actual call of an authorization function, found in the syntax tree, so
// a comment or a string that mentions it does not count.
function callsAuthorization(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      AUTHORIZATION_FUNCTIONS.has(node.expression.text)
    ) {
      found = true;
    }
    if (!found) {
      ts.forEachChild(node, visit);
    }
  };
  visit(source);
  return found;
}

function entryPoints(): string[] {
  const studio = sourceFiles(STUDIO).filter((file) => STUDIO_ENTRY.test(file));
  const actions = sourceFiles("src").filter((file) =>
    isServerActionFile(parse(file)),
  );
  return [...new Set([...studio, ...actions])].sort();
}

describe("studio entry points", () => {
  it("are found by the scan", () => {
    expect(entryPoints()).toEqual(
      expect.arrayContaining([
        join(STUDIO, "page.tsx"),
        join(STUDIO, "sign-in", "page.tsx"),
      ]),
    );
  });

  it.each(entryPoints())("%s authorizes the request itself", (file) => {
    expect(callsAuthorization(parse(file))).toBe(true);
  });

  it("does not count a mention in a comment or a string", () => {
    const commented = ts.createSourceFile(
      "x.ts",
      '// TODO call authorizeAuthor() here\nconst note = "requireAuthor()";\n',
      ts.ScriptTarget.Latest,
      true,
    );
    expect(callsAuthorization(commented)).toBe(false);
  });

  it("recognizes a server-action file only by its directive", () => {
    const action = ts.createSourceFile(
      "x.ts",
      '"use server";\nexport async function save() {}\n',
      ts.ScriptTarget.Latest,
      true,
    );
    const mention = ts.createSourceFile(
      "y.ts",
      '// "use server"\nexport const x = 1;\n',
      ts.ScriptTarget.Latest,
      true,
    );
    expect(isServerActionFile(action)).toBe(true);
    expect(isServerActionFile(mention)).toBe(false);
  });
});
