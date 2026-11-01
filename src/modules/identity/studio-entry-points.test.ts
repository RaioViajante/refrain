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
// Two levels of check:
// - per file, for studio pages and the other file-based studio routes: some
//   function in the file calls the authorization;
// - per entry point, anywhere in src/ (issue #6): each exported function of a
//   "use server" file, each inline action (a function-level "use server"
//   directive), each generateMetadata in the studio, and each route handler
//   under src/app must START with an awaited requireAuthor or authorizeAuthor.
//   Anything the test cannot read as a function literal (a re-export, a
//   wrapped function) is reported, not skipped. The authentication handler is
//   the one explicit exception.
// The probes below show that each bypass is caught. This is defense in depth:
// the HTTP tests remain the proof that the check works.
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

// --- Per-entry-point analysis -------------------------------------------

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
// The authentication handler is the only route handler that does not call the
// authorization: it IS the sign-in surface, and it allow-lists three endpoints.
const ROUTE_ALLOW_LIST = new Set([join("src", "app", "api", "auth", "[...all]", "route.ts")]);

function isAwaitedAuthorizationCall(expression: ts.Expression): boolean {
  return (
    ts.isAwaitExpression(expression) &&
    ts.isCallExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    AUTHORIZATION_FUNCTIONS.has(expression.expression.expression.text)
  );
}

function isAuthorizationStatement(statement: ts.Statement): boolean {
  if (ts.isVariableStatement(statement)) {
    const first = statement.declarationList.declarations[0];
    return (
      first?.initializer !== undefined &&
      isAwaitedAuthorizationCall(first.initializer)
    );
  }
  return (
    ts.isExpressionStatement(statement) &&
    isAwaitedAuthorizationCall(statement.expression)
  );
}

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isDirective(statement: ts.Statement, text?: string): boolean {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    (text === undefined || statement.expression.text === text)
  );
}

// The first statement after any directives, such as "use server".
function firstStatement(fn: FunctionLike): ts.Statement | undefined {
  if (!fn.body || !ts.isBlock(fn.body)) {
    return undefined;
  }
  return fn.body.statements.find((statement) => !isDirective(statement));
}

function startsWithAuthorization(fn: FunctionLike): boolean {
  const first = firstStatement(fn);
  return first !== undefined && isAuthorizationStatement(first);
}

function hasUseServerDirective(fn: FunctionLike): boolean {
  return (
    fn.body !== undefined &&
    ts.isBlock(fn.body) &&
    fn.body.statements.some((statement) => isDirective(statement, "use server"))
  );
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

interface ExportedFunction {
  name: string;
  fn: FunctionLike | undefined;
}

// The functions a module exports, by name. `fn` is undefined for an export
// that is not a function literal here (a re-export, a wrapped function), which
// the test cannot read and therefore reports.
function exportedFunctions(source: ts.SourceFile): ExportedFunction[] {
  const found: ExportedFunction[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      found.push({ name: statement.name?.text ?? "default", fn: statement });
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        found.push({
          name: ts.isIdentifier(declaration.name) ? declaration.name.text : "?",
          fn:
            initializer &&
            (ts.isArrowFunction(initializer) ||
              ts.isFunctionExpression(initializer))
              ? initializer
              : undefined,
        });
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      found.push({ name: "(re-export)", fn: undefined });
    } else if (ts.isExportAssignment(statement)) {
      const expression = statement.expression;
      found.push({
        name: "default",
        fn:
          ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
            ? expression
            : undefined,
      });
    }
  }
  return found;
}

/**
 * Describes every entry point in `source` that does not start with an awaited
 * requireAuthor or authorizeAuthor, or that cannot be checked.
 */
function authorizationViolations(source: ts.SourceFile, file: string): string[] {
  const violations: string[] = [];
  const normalized = file.split("\\").join("/");
  const inStudio = normalized.startsWith("src/app/studio/");
  const isRouteFile =
    normalized.startsWith("src/app/") && /(^|\/)route\.(m?[jt]sx?)$/.test(normalized);
  const useServerFile = isServerActionFile(source);

  const check = (label: string, exported: ExportedFunction) => {
    if (!exported.fn) {
      violations.push(`${file}: ${label} "${exported.name}" is not a function literal, so it cannot be checked`);
    } else if (!startsWithAuthorization(exported.fn)) {
      violations.push(`${file}: ${label} "${exported.name}" does not start with an awaited requireAuthor or authorizeAuthor`);
    }
  };

  const exported = exportedFunctions(source);
  if (useServerFile) {
    for (const entry of exported) {
      check("server action", entry);
    }
  }
  if (inStudio) {
    for (const entry of exported.filter((e) => e.name === "generateMetadata")) {
      check("metadata function", entry);
    }
  }
  if (isRouteFile && !ROUTE_ALLOW_LIST.has(normalized)) {
    for (const entry of exported.filter((e) => HTTP_METHODS.has(e.name) || e.name === "(re-export)")) {
      check("route handler", entry);
    }
  }

  // Inline actions: a function-level "use server" directive, in any file.
  const visit = (node: ts.Node) => {
    if (
      isFunctionLike(node) &&
      hasUseServerDirective(node) &&
      !startsWithAuthorization(node)
    ) {
      violations.push(`${file}: an inline server action does not start with an awaited requireAuthor or authorizeAuthor`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return violations;
}

function parseText(code: string, file = "probe.ts"): ts.SourceFile {
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
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

describe("every entry point authorizes first", () => {
  const files = sourceFiles("src");

  it("holds for each server action, inline action, metadata function, and route handler in src/", () => {
    const violations = files.flatMap((file) =>
      authorizationViolations(parse(file), file),
    );
    expect(violations).toEqual([]);
  });

  it("finds the Studio's server actions, so the check is not vacuous", () => {
    const actionFiles = files.filter((file) => isServerActionFile(parse(file)));
    expect(actionFiles.length).toBeGreaterThan(0);
    const actions = actionFiles.flatMap((file) => exportedFunctions(parse(file)));
    expect(actions.length).toBeGreaterThan(10);
    expect(actions.every((action) => action.fn !== undefined)).toBe(true);
  });

  it("allows the authentication handler and nothing else outside the studio", () => {
    expect([...ROUTE_ALLOW_LIST]).toEqual([
      join("src", "app", "api", "auth", "[...all]", "route.ts"),
    ]);
    expect(
      files.filter((file) => /(^|[\\/])route\.(m?[jt]sx?)$/.test(file)),
    ).toEqual([join("src", "app", "api", "auth", "[...all]", "route.ts")]);
  });

  describe("probes: each bypass the review found is caught", () => {
    const check = (code: string, file: string) =>
      authorizationViolations(parseText(code, file), file);

    it("an exported action without the check", () => {
      expect(
        check(
          '"use server";\nexport async function save() { return 1; }\n',
          "src/app/anywhere/actions.ts",
        ),
      ).toHaveLength(1);
    });

    it("one unchecked action among checked ones", () => {
      const code = `"use server";
import { authorizeAuthor } from "@/modules/identity";
export async function good() { const a = await authorizeAuthor(await headers()); return a; }
export async function bad() { await somethingElse(); await authorizeAuthor(h); }
`;
      expect(check(code, "src/app/x/actions.ts")).toEqual([
        expect.stringContaining('"bad"'),
      ]);
    });

    it("a check that comes after other work, or is not awaited", () => {
      expect(
        check(
          '"use server";\nexport async function a() { log(); await requireAuthor(h); }\n',
          "src/app/x/actions.ts",
        ),
      ).toHaveLength(1);
      expect(
        check(
          '"use server";\nexport async function a() { const x = requireAuthor(h); }\n',
          "src/app/x/actions.ts",
        ),
      ).toHaveLength(1);
    });

    it("an action that is a re-export or a wrapped function", () => {
      expect(
        check('"use server";\nexport { save } from "./impl";\n', "src/app/x/actions.ts"),
      ).toHaveLength(1);
      expect(
        check('"use server";\nexport const save = wrap(async () => 1);\n', "src/app/x/actions.ts"),
      ).toHaveLength(1);
    });

    it("an inline action without the check, in a page", () => {
      const code = `export default function Page() {
  async function save() { "use server"; await write(); }
  return null;
}`;
      expect(check(code, "src/app/studio/page.tsx")).toHaveLength(1);
    });

    it("an inline action with the check after its directive passes", () => {
      const code = `export default function Page() {
  async function save() { "use server"; const a = await authorizeAuthor(h); }
  return null;
}`;
      expect(check(code, "src/app/studio/page.tsx")).toEqual([]);
    });

    it("a generateMetadata without the check in the studio, but not elsewhere", () => {
      const code = "export async function generateMetadata() { return { title: 'x' }; }";
      expect(check(code, "src/app/studio/journals/page.tsx")).toHaveLength(1);
      expect(check(code, "src/app/public/page.tsx")).toEqual([]);
      const guarded =
        "export async function generateMetadata() { const a = await authorizeAuthor(h); }";
      expect(check(guarded, "src/app/studio/journals/page.tsx")).toEqual([]);
    });

    it("a route handler outside the studio, but not the allow-listed one", () => {
      const code = "export async function POST() { return new Response(); }";
      expect(check(code, "src/app/api/export/route.ts")).toHaveLength(1);
      expect(check(code, join("src", "app", "api", "auth", "[...all]", "route.ts"))).toEqual([]);
      expect(check("export const GET = handler;", "src/app/api/x/route.ts")).toHaveLength(1);
      const guarded =
        "export async function POST(request) { const a = await requireAuthor(request.headers); }";
      expect(check(guarded, "src/app/api/export/route.ts")).toEqual([]);
    });

    it("ignores modules that are not entry points", () => {
      expect(
        check("export async function helper() { return 1; }", "src/modules/x/helper.ts"),
      ).toEqual([]);
    });
  });
});
