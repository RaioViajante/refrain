import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// Static checks of the public surface (M3.1; ADR 0006 § 9, § 11, and D4). They
// are tripwires, like the studio's: they read the syntax tree, not behavior,
// and the HTTP tests are the proof. What they hold in place:
//
// 1. Public files reach the database only through the Publication module's
//    reading entry point, and import no command, studio file, or test helper.
// 2. Every function that reads public content applies the public-reads switch
//    first, and no code can pass the switch an environment of its own.
// 3. Nothing public is cached or generated at build time (ADR 0006 § 11), and
//    no public file renders raw HTML or calls out to the network.
// 4. The Publication reading module itself imports no command.

const READS = new Set([
  "getPublicAlbumJournal",
  "getPublicHome",
  "listPublicAlbumJournalAddresses",
  "resolvePublicAlbumJournalSlug",
  "routeAlbumJournalRequest",
  "routePublicDocumentRequest",
  // M3.5: the artist pages.
  "getPublicArtist",
  "listPublicArtistAddresses",
  "resolvePublicArtistAddress",
  "routeArtistRequest",
  // M3.7: the memory pages.
  "getPublicMemory",
  "listPublicMemoryAddresses",
  "resolvePublicMemorySlug",
  "routeMemoryRequest",
  // M3.8a: the archives.
  "listPublicAlbumArchive",
  "listPublicArtistArchive",
  "listPublicMemoryArchive",
  "routePublicArchiveRequest",
]);

// The reads that a caller must guard itself. The routing functions apply the
// switch as their own first step, which `public-routing.ts` is scanned for
// below and the database tests prove.
const CALLER_READS: ReadonlySet<string> = new Set(
  [...READS].filter((name) => !name.startsWith("route")),
);

function walk(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .map((file) => join(directory, file).split("\\").join("/"))
    .filter((file) => /\.(m?[jt]sx?)$/.test(file) && !/\.test\./.test(file));
}

/** The files that serve, or help to serve, anonymous readers. */
function publicFiles(): string[] {
  const inApp = walk("src/app").filter(
    (file) =>
      file.startsWith("src/app/(public)/") ||
      // M3.5: the artist pages, in a route group of their own.
      file.startsWith("src/app/(artists)/") ||
      // M3.7: the memory pages, in a route group of their own.
      file.startsWith("src/app/(memories)/") ||
      // M3.8a: the archives, in a route group of their own.
      file.startsWith("src/app/(archives)/") ||
      file === "src/app/page.tsx" ||
      file === "src/app/not-found.tsx" ||
      file === "src/app/public-fonts.ts" ||
      file === "src/app/sitemap.xml/route.ts" ||
      file === "src/app/robots.txt/route.ts",
  );
  return ["src/proxy.ts", "src/address-normalization.ts", ...inApp];
}

/** The strings of `export const config = { matcher: [...] }`, from the syntax tree. */
function matcherOf(code: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText() === "matcher" &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (ts.isStringLiteralLike(element)) {
          found.push(element.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(code, "proxy.ts"));
  return found;
}

function parse(code: string, file = "x.tsx"): ts.SourceFile {
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
}

type FunctionLike =
  ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

function calledName(node: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }
  return undefined;
}

const ALLOWED_IMPORTS = [
  /^next(\/.*)?$/,
  /^react(\/.*)?$/,
  /^@\/modules\/publication\/public$/,
  /^@\/app\/(public\.css|public-fonts|not-found)$/,
  /^@\/app\/\(public\)\/_components\/[a-z-]+$/,
  // M3.8a: the archives' shared frame, metadata, and lines.
  /^@\/app\/\(archives\)\/_components\/[a-z-]+$/,
  /^\.\/(_components\/)?[a-z-]+$/,
];

const FORBIDDEN_CALLS = new Set([
  "revalidatePath",
  "revalidateTag",
  "updateTag",
  "refresh",
  "unstable_cache",
  "cacheLife",
  "cacheTag",
  "generateStaticParams",
  "fetch",
  "require",
]);

// ---------------------------------------------------------------------------
// The switch is a guard that dominates every read. Moving it, wrapping it,
// ignoring its result, or reading around it must be caught, so the rule is
// structural and not "the word appears before the read":
//
//  - the function body is a block (a concise arrow body would hide the order);
//  - one of its own top-level statements is `if (<disabled>) <exit>`, where
//    `<disabled>` is `!publicReadsEnabled()`, alone or as an operand of `||`
//    (so the guard cannot depend on a condition that might be false), and the
//    consequent ends in `return` or `throw`, or calls `notFound()` or
//    `redirect()`; there is no `else`;
//  - the first top-level statement that holds a read comes strictly after it,
//    and the guard statement itself holds no read;
//  - no read is a bare reference (`const f = read`, `.then(read)`,
//    `read.call(...)`), an aliased import, or a call outside every function.
// ---------------------------------------------------------------------------

const GATE = "publicReadsEnabled";

function unparenthesize(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isDisabledTest(
  expression: ts.Expression,
  allowArguments: boolean,
): boolean {
  const e = unparenthesize(expression);
  if (
    ts.isPrefixUnaryExpression(e) &&
    e.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const inner = unparenthesize(e.operand);
    return (
      ts.isCallExpression(inner) &&
      ts.isIdentifier(inner.expression) &&
      inner.expression.text === GATE &&
      (allowArguments || inner.arguments.length === 0)
    );
  }
  if (
    ts.isBinaryExpression(e) &&
    e.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return (
      isDisabledTest(e.left, allowArguments) ||
      isDisabledTest(e.right, allowArguments)
    );
  }
  return false;
}

function exits(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
    return true;
  }
  if (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    ts.isIdentifier(statement.expression.expression) &&
    ["notFound", "redirect", "permanentRedirect"].includes(
      statement.expression.expression.text,
    )
  ) {
    return true;
  }
  if (ts.isBlock(statement)) {
    const last = statement.statements[statement.statements.length - 1];
    return last !== undefined && exits(last);
  }
  return false;
}

function isSwitchGuard(
  statement: ts.Statement,
  allowArguments: boolean,
): boolean {
  return (
    ts.isIfStatement(statement) &&
    statement.elseStatement === undefined &&
    isDisabledTest(statement.expression, allowArguments) &&
    exits(statement.thenStatement)
  );
}

/** Whether a statement calls one of the reads, outside nested functions. */
function holdsRead(node: ts.Node, reads: ReadonlySet<string>): boolean {
  let found = false;
  const look = (child: ts.Node) => {
    if (found || isFunctionLike(child)) {
      return;
    }
    if (ts.isCallExpression(child)) {
      const name = calledName(child);
      if (name && reads.has(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(child, look);
  };
  look(node);
  return found;
}

interface GateOptions {
  /** Routing functions pass their `env`, and are checked with it allowed. */
  allowArguments?: boolean;
}

function gateViolations(
  source: ts.SourceFile,
  reads: ReadonlySet<string>,
  { allowArguments = false }: GateOptions = {},
): string[] {
  const found: string[] = [];

  const checkFunction = (fn: FunctionLike) => {
    // A default value runs before the body, so before its guard.
    for (const parameter of fn.parameters) {
      if (parameter.initializer && holdsRead(parameter.initializer, reads)) {
        found.push("reads in a parameter default, before any guard");
      }
    }
    if (!holdsRead(fn.body!, reads)) {
      return;
    }
    const body = fn.body!;
    if (!ts.isBlock(body)) {
      found.push("reads in an expression body, with no statement to guard it");
      return;
    }
    const statements = body.statements;
    const firstRead = statements.findIndex((statement) =>
      holdsRead(statement, reads),
    );
    const guard = statements.findIndex((statement) =>
      isSwitchGuard(statement, allowArguments),
    );
    if (guard === -1) {
      found.push(
        "reads without a top-level `if (!publicReadsEnabled()) <exit>` guard",
      );
    } else if (holdsRead(statements[guard]!, reads)) {
      found.push("reads inside the switch guard itself");
    } else if (guard > firstRead) {
      found.push("reads before the switch guard");
    }
  };

  const visit = (node: ts.Node, insideFunction: boolean) => {
    // The guard and the exits must be the real ones, not a local stand-in that
    // happens to share the name.
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isParameter(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      [GATE, "notFound", "redirect", "permanentRedirect"].includes(
        node.name.text,
      )
    ) {
      found.push(`declares its own ${node.name.text}`);
    }
    if (isFunctionLike(node) && node.body) {
      checkFunction(node);
      ts.forEachChild(node, (child) => visit(child, true));
      return;
    }
    if (ts.isCallExpression(node) && !insideFunction) {
      const name = calledName(node);
      if (name && reads.has(name)) {
        found.push(`calls ${name} outside any function`);
      }
    }
    // A read reached by a computed name is invisible to the call check.
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      (reads.has(node.argumentExpression.text) ||
        node.argumentExpression.text === GATE)
    ) {
      found.push(`reaches ${node.argumentExpression.text} by name`);
    }
    // A bare reference to a read can reach it by a path that the guard check
    // does not see.
    if (
      ts.isIdentifier(node) &&
      reads.has(node.text) &&
      !ts.isImportSpecifier(node.parent) &&
      !ts.isExportSpecifier(node.parent) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      found.push(`refers to ${node.text} without calling it`);
    }
    if (
      ts.isImportSpecifier(node) &&
      node.propertyName &&
      (reads.has(node.propertyName.text) || node.propertyName.text === GATE)
    ) {
      found.push(`imports ${node.propertyName.text} under another name`);
    }
    ts.forEachChild(node, (child) => visit(child, insideFunction));
  };
  visit(source, false);
  return found;
}

// The route-segment settings that could cache, prerender, or keep a page's
// data (the framework reads them from a module's exports by name, however
// they are written: node_modules/next/dist/build/segment-config/app).
// `instant` is allowed only as `false`, the Home's (M3.4): it lets a page
// render on the server before it sends anything.
const CONFIG_EXPORTS = new Set([
  "revalidate",
  "dynamic",
  "fetchCache",
  "ensureStatic",
  "dynamicParams",
  "prefetch",
  "unstable_dynamicStaleTime",
  "unstable_paramMatching",
  "unstable_generateParamMatching",
]);

/** A cache directive, or a route-segment setting that could keep data. */
function configExports(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of node.declarationList.declarations) {
        const name = declaration.name.getText();
        if (CONFIG_EXPORTS.has(name)) {
          found.push(`exports ${name}`);
        }
        if (
          name === "instant" &&
          (declaration.initializer?.getText() !== "false" ||
            (node.declarationList.flags & ts.NodeFlags.Const) === 0)
        ) {
          found.push("exports instant other than const false");
        }
      }
    }
    // `export { revalidate }` and `export { x as revalidate }`.
    if (
      ts.isExportSpecifier(node) &&
      (CONFIG_EXPORTS.has(node.name.text) || node.name.text === "instant")
    ) {
      found.push(`exports ${node.name.text} by name`);
    }
    if (
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      /^use cache/.test(node.expression.text)
    ) {
      found.push('uses "use cache"');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function violations(code: string, file: string): string[] {
  const source = parse(code, file);
  const found: string[] = [];

  const visit = (node: ts.Node) => {
    // Every way a module can be named: `import`, `export ... from`, and
    // `import x = require()`. (`require()` and `import()` are calls, below.)
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference) &&
            ts.isStringLiteralLike(node.moduleReference.expression)
          ? node.moduleReference.expression.text
          : undefined;
    if (
      specifier !== undefined &&
      !ALLOWED_IMPORTS.some((rule) => rule.test(specifier))
    ) {
      found.push(`imports ${specifier}`);
    }
    // `import * as ns` hides which reads are used, so the guard scan cannot see
    // them.
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings &&
      ts.isNamespaceImport(node.importClause.namedBindings)
    ) {
      found.push("imports a namespace");
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      found.push("imports dynamically");
    }
    if (ts.isCallExpression(node)) {
      const name = calledName(node);
      if (name && FORBIDDEN_CALLS.has(name)) {
        found.push(`calls ${name}`);
      }
      // The switch reads the environment of the server and nothing else.
      if (name === "publicReadsEnabled" && node.arguments.length > 0) {
        found.push("passes an environment to publicReadsEnabled");
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText() === "dangerouslySetInnerHTML"
    ) {
      found.push("renders raw HTML");
    }
    if (ts.isIdentifier(node) && node.text === "generateStaticParams") {
      found.push("generates static params");
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  found.push(...configExports(source));

  // Every function that reads public content applies the switch first, as an
  // early exit that dominates the read.
  found.push(...gateViolations(source, CALLER_READS));

  return found;
}

describe("the public surface", () => {
  const files = publicFiles();

  it("finds the public files, so the checks are not vacuous", () => {
    expect(files).toContain("src/proxy.ts");
    expect(files).toContain("src/app/(public)/albums/[slug]/page.tsx");
    expect(files).toContain("src/app/sitemap.xml/route.ts");
    expect(files).toContain("src/app/robots.txt/route.ts");
    expect(files).toContain("src/app/not-found.tsx");
    expect(files).toContain("src/app/page.tsx");
    expect(files).toContain("src/app/(public)/_components/home-view.tsx");
    expect(files).toContain("src/app/(artists)/artists/[slug]/page.tsx");
    expect(files).toContain("src/app/(artists)/artists/[slug]/artist-view.tsx");
    expect(files).toContain("src/app/(memories)/memories/[slug]/page.tsx");
    expect(files).toContain(
      "src/app/(memories)/memories/[slug]/memory-view.tsx",
    );
    for (const archive of ["albums", "artists", "memories"]) {
      expect(files).toContain(`src/app/(archives)/${archive}/page.tsx`);
      expect(files).toContain(
        `src/app/(archives)/${archive}/${archive}-archive.tsx`,
      );
    }
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files)("%s is clean", (file) => {
    expect(violations(readFileSync(file, "utf8"), file)).toEqual([]);
  });

  it("keeps the root layout, which wraps the Home, free of caching and route settings", () => {
    const file = "src/app/layout.tsx";
    expect(configExports(parse(readFileSync(file, "utf8"), file))).toEqual([]);
    expect(
      configExports(parse("export const revalidate = 60;", file)),
    ).toHaveLength(1);
  });

  it("renders the Home, the artist pages, the memory pages, and the archives on the server before sending them, so they need no client JavaScript", () => {
    for (const file of [
      "src/app/page.tsx",
      "src/app/(artists)/artists/[slug]/page.tsx",
      "src/app/(memories)/memories/[slug]/page.tsx",
      "src/app/(archives)/albums/page.tsx",
      "src/app/(archives)/artists/page.tsx",
      "src/app/(archives)/memories/page.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).toMatch(
        /^export const instant = false;$/m,
      );
    }
  });

  it("applies the switch in every route handler and in the page's loader", () => {
    for (const file of [
      "src/app/sitemap.xml/route.ts",
      "src/app/robots.txt/route.ts",
      "src/app/(public)/albums/[slug]/page.tsx",
      "src/app/(artists)/artists/[slug]/page.tsx",
      "src/app/(memories)/memories/[slug]/page.tsx",
      "src/app/page.tsx",
      // M3.8a: each archive's loader and its metadata.
      "src/app/(archives)/albums/page.tsx",
      "src/app/(archives)/artists/page.tsx",
      "src/app/(archives)/memories/page.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).toMatch(
        /publicReadsEnabled\(\)/,
      );
    }
  });

  it("has the proxy ask both routing decisions, with exactly the matcher the routes need", () => {
    const code = readFileSync("src/proxy.ts", "utf8");
    expect(code).toContain("routeAlbumJournalRequest");
    expect(code).toContain("routeArtistRequest");
    expect(code).toContain("routeMemoryRequest");
    expect(code).toContain("routePublicDocumentRequest");
    expect(code).toContain("routePublicArchiveRequest");
    expect(matcherOf(code)).toEqual([
      "/albums/:slug",
      // M3.5: one segment, `/artists/<address>`.
      "/artists/:slug",
      // M3.7: one segment, `/memories/<slug>`.
      "/memories/:slug",
      // M3.8a: the archives (the framework extends each to its transport
      // forms; the HTTP tests hold them).
      "/albums",
      "/artists",
      "/memories",
      "/sitemap.xml",
      "/robots.txt",
      // Trailing-slash addresses, for the no-store 308 (ADR 0006, A2).
      "/:path+/",
    ]);
  });

  it("classifies every route-like file under src/app, so a new public surface cannot be missed", () => {
    const routeLike =
      /(^|\/)(page|route|layout|template|default|not-found|error|global-error|loading|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest|feed)\.(m?[jt]sx?)$/;
    const known = [
      // The Writing Studio and the authentication endpoint: authorized.
      /^src\/app\/studio\//,
      /^src\/app\/api\/auth\/\[\.\.\.all\]\/route\.ts$/,
      // The public surface, scanned above.
      /^src\/app\/\(public\)\//,
      // M3.5: the artist pages and their layout, scanned above.
      /^src\/app\/\(artists\)\//,
      // M3.7: the memory pages and their layout, scanned above.
      /^src\/app\/\(memories\)\//,
      // M3.8a: the archives, scanned above.
      /^src\/app\/\(archives\)\//,
      /^src\/app\/sitemap\.xml\/route\.ts$/,
      /^src\/app\/robots\.txt\/route\.ts$/,
      /^src\/app\/not-found\.tsx$/,
      // The Home (M3.4), scanned above as a public file.
      /^src\/app\/page\.tsx$/,
      // The root layout, which reads nothing.
      /^src\/app\/layout\.tsx$/,
    ];
    const unclassified = walk("src/app").filter(
      (file) => routeLike.test(file) && !known.some((rule) => rule.test(file)),
    );
    expect(unclassified).toEqual([]);
    // The root layout wraps every page, the studio's included: it imports
    // nothing from a module and calls nothing that reads the system.
    expect(readFileSync("src/app/layout.tsx", "utf8")).not.toMatch(
      /from "@\/|import\(/,
    );
  });

  it("would notice an unclassified route file", () => {
    const routeLike = /(^|\/)(page|route|feed)\.(m?[jt]sx?)$/;
    expect(routeLike.test("src/app/feed.xml/route.ts")).toBe(true);
    expect(routeLike.test("src/app/(public)/albums/page.tsx")).toBe(true);
  });

  it("is imported only by the public surface, anywhere in src", () => {
    const importers = walk("src").filter((file) =>
      /@\/modules\/publication\/public["']/.test(readFileSync(file, "utf8")),
    );
    for (const file of importers) {
      expect(
        files.includes(file),
        `${file} imports the public reading entry point but is not a public file`,
      ).toBe(true);
    }
    expect(importers).toContain("src/proxy.ts");
  });

  it("is never imported by the studio", () => {
    for (const file of walk("src/app/studio")) {
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(/@\/modules\/publication\/public/);
      expect(code, file).not.toMatch(/@\/app\/\(public\)/);
    }
  });

  describe("probes: each rule catches what it is meant to", () => {
    const check = (code: string, file = "src/app/(public)/x/page.tsx") =>
      violations(code, file);

    it("a command, the journals module, the database, or a studio file", () => {
      expect(check('import { a } from "@/modules/publication";')).toHaveLength(
        1,
      );
      expect(
        check('import { a } from "@/modules/publication/commands";'),
      ).toHaveLength(1);
      expect(check('import { a } from "@/modules/journals";')).toHaveLength(1);
      expect(check('import { a } from "@/db";')).toHaveLength(1);
      expect(check('import { a } from "@/app/studio/frame";')).toHaveLength(1);
      expect(check('import { a } from "@/testing/fixtures";')).toHaveLength(1);
      expect(
        check('const m = await import("@/modules/journals");'),
      ).toHaveLength(1);
      expect(
        check('import { a } from "@/modules/publication/public";'),
      ).toEqual([]);
    });

    it("a way around the reading entry point", () => {
      for (const specifier of [
        "@/modules/publication/queries",
        "@/modules/publication/predicate",
        "@/modules/publication/public-album-journal",
        "@/modules/publication/public-routing",
        "@/modules/publication/public-reads",
        "@/modules/publication/slug",
        "@/modules/publication/commands",
        "@/modules/publication/index",
        "@/modules/publication/public/",
        "@/modules/publication/public-extra",
        "@/modules/identity",
        "@/modules/catalog",
        "@/db/schema",
        "drizzle-orm",
        "pg",
        "../../../modules/publication/queries",
        "../../../../db",
        "./../../../modules/publication/public",
        "node:fs",
        "child_process",
      ]) {
        expect(
          check(`import { x } from "${specifier}";`),
          `import from ${specifier}`,
        ).not.toEqual([]);
        expect(
          check(`export { x } from "${specifier}";`),
          `export from ${specifier}`,
        ).not.toEqual([]);
      }
      expect(
        check('import * as ns from "@/modules/publication/public";'),
      ).toEqual(["imports a namespace"]);
      expect(
        check('import x = require("@/modules/publication/queries");'),
      ).not.toEqual([]);
      expect(
        check('const x = require("@/modules/publication/queries");'),
      ).not.toEqual([]);
      expect(
        check('const x = await import("@/modules/publication/queries");'),
      ).not.toEqual([]);
      expect(
        check('export * from "@/modules/publication/queries";'),
      ).not.toEqual([]);
      // The facade itself, in every form that names it, is allowed.
      expect(
        check('export { x } from "@/modules/publication/public";'),
      ).toEqual([]);
    });

    it("a read before the switch, and a read after it", () => {
      expect(
        check(
          'async function load(s) { return getPublicAlbumJournal(s, "en"); }',
        ),
      ).toHaveLength(1);
      expect(
        check(
          'async function load(s) { if (!publicReadsEnabled()) return null; return getPublicAlbumJournal(s, "en"); }',
        ),
      ).toEqual([]);
      expect(
        check(
          "async function load(s) { const x = await resolvePublicAlbumJournalSlug(s); if (!publicReadsEnabled()) return null; }",
        ),
      ).toHaveLength(1);
    });

    it("a switch that takes an environment of its own", () => {
      expect(
        check("const on = publicReadsEnabled({ X: 'true' });"),
      ).toHaveLength(1);
    });

    describe("the switch guard must dominate the read", () => {
      const reads = new Set(["getPublicAlbumJournal"]);
      const gates = (code: string, options?: { allowArguments?: boolean }) =>
        gateViolations(parse(code), reads, options);

      it("accepts an early exit at the top of the function", () => {
        for (const code of [
          "async function f(s) { if (!publicReadsEnabled()) { return null; } return getPublicAlbumJournal(s); }",
          "async function f(s) { if (!publicReadsEnabled()) return null; return getPublicAlbumJournal(s); }",
          "async function f(s) { await connection(); if (!publicReadsEnabled()) { throw new Error('x'); } return getPublicAlbumJournal(s); }",
          "async function f(s) { if (!publicReadsEnabled()) { notFound(); } return getPublicAlbumJournal(s); }",
          "async function f(s) { const o = origin(); if (!publicReadsEnabled() || o === null) { return null; } return getPublicAlbumJournal(s); }",
          "const f = cache(async (s) => { if (!publicReadsEnabled()) { return null; } return getPublicAlbumJournal(s); });",
          "function f() { return 1; }",
        ]) {
          expect(gates(code), code).toEqual([]);
        }
        expect(
          gates(
            "async function f(s) { if (!publicReadsEnabled(env)) { return null; } return getPublicAlbumJournal(s); }",
            { allowArguments: true },
          ),
        ).toEqual([]);
      });

      it.each([
        [
          "the guard moved after the read",
          "async function f(s) { const x = await getPublicAlbumJournal(s); if (!publicReadsEnabled()) { return null; } return x; }",
        ],
        [
          "no guard at all",
          "async function f(s) { return getPublicAlbumJournal(s); }",
        ],
        [
          "the result ignored",
          "async function f(s) { publicReadsEnabled(); return getPublicAlbumJournal(s); }",
        ],
        [
          "a guard that only runs sometimes (&&)",
          "async function f(s, x) { if (x && !publicReadsEnabled()) { return null; } return getPublicAlbumJournal(s); }",
        ],
        [
          "a guard that does not exit",
          "async function f(s) { if (!publicReadsEnabled()) { log(); } return getPublicAlbumJournal(s); }",
        ],
        [
          "a guard whose exit is conditional",
          "async function f(s, x) { if (!publicReadsEnabled()) { if (x) { return null; } } return getPublicAlbumJournal(s); }",
        ],
        [
          "a guard with an else branch",
          "async function f(s) { if (!publicReadsEnabled()) { return null; } else { x(); } return getPublicAlbumJournal(s); }",
        ],
        [
          "a guard nested in another condition",
          "async function f(s, x) { if (x) { if (!publicReadsEnabled()) { return null; } } return getPublicAlbumJournal(s); }",
        ],
        [
          "a guard and a read in the same try block",
          "async function f(s) { try { if (!publicReadsEnabled()) { return null; } return await getPublicAlbumJournal(s); } catch { return null; } }",
        ],
        [
          "the read inside the guard's own condition",
          "async function f(s) { if ((await getPublicAlbumJournal(s)) || !publicReadsEnabled()) { return null; } return 1; }",
        ],
        [
          "a guard in a nested function, a read in the outer one",
          "async function f(s) { const g = () => { if (!publicReadsEnabled()) { return null; } return 1; }; g(); return getPublicAlbumJournal(s); }",
        ],
        [
          "the positive form, which has no early exit",
          "async function f(s) { if (publicReadsEnabled()) { return getPublicAlbumJournal(s); } return null; }",
        ],
        ["a concise arrow body", "const f = (s) => getPublicAlbumJournal(s);"],
        [
          "a bare reference",
          "const f = getPublicAlbumJournal; async function g(s) { if (!publicReadsEnabled()) { return null; } return f(s); }",
        ],
        [
          "a read passed as a callback",
          "async function g(p) { if (!publicReadsEnabled()) { return null; } return p.then(getPublicAlbumJournal); }",
        ],
        [
          "a call through .call",
          "async function g(s) { if (!publicReadsEnabled()) { return null; } return getPublicAlbumJournal.call(null, s); }",
        ],
        [
          "a read called at the top of the module",
          "const x = await getPublicAlbumJournal('a');",
        ],
        [
          "an import under another name",
          'import { getPublicAlbumJournal as read } from "@/modules/publication/public";',
        ],
        [
          "the switch imported under another name",
          'import { publicReadsEnabled as on } from "@/modules/publication/public"; const reads = getPublicAlbumJournal;',
        ],
      ])("rejects %s", (_label, code) => {
        expect(gates(code).length).toBeGreaterThan(0);
      });

      it.each([
        [
          "a read in a parameter default",
          "async function f(s, x = getPublicAlbumJournal(s)) { if (!publicReadsEnabled()) { return null; } return x; }",
        ],
        [
          "a read by element access",
          'async function f(s) { if (!publicReadsEnabled()) { return null; } return ns["getPublicAlbumJournal"](s); }',
        ],
        [
          "a local stand-in for the switch",
          "const publicReadsEnabled = () => true; async function f(s) { if (!publicReadsEnabled()) { return null; } return getPublicAlbumJournal(s); }",
        ],
        [
          "a local stand-in for notFound",
          "function notFound() {} async function f(s) { if (!publicReadsEnabled()) { notFound(); } return getPublicAlbumJournal(s); }",
        ],
      ])("also rejects %s", (_label, code) => {
        expect(gates(code).length).toBeGreaterThan(0);
      });

      it("rejects a switch call that passes its own environment, outside the routing functions", () => {
        const code =
          "async function f(s) { if (!publicReadsEnabled(env)) { return null; } return getPublicAlbumJournal(s); }";
        expect(gates(code)).not.toEqual([]);
        expect(
          violations(code, "src/app/(public)/x/page.tsx").length,
        ).toBeGreaterThan(0);
      });
    });

    it("a cache, a static page, a revalidation, raw HTML, or a network call", () => {
      expect(check('"use cache";\nexport const x = 1;')).toHaveLength(1);
      expect(check("export const revalidate = 60;")).toHaveLength(1);
      expect(check('export const dynamic = "force-static";')).toHaveLength(1);
      expect(check("export const ensureStatic = true;")).toHaveLength(1);
      for (const name of [
        "dynamicParams = false",
        'prefetch = "partial"',
        "unstable_dynamicStaleTime = 300",
        "unstable_paramMatching = true",
      ]) {
        expect(check(`export const ${name};`), name).toHaveLength(1);
      }
      // However the export is written.
      expect(
        check("const revalidate = 60;\nexport { revalidate };"),
      ).toHaveLength(1);
      expect(check("const x = 60;\nexport { x as revalidate };")).toHaveLength(
        1,
      );
      expect(check("const instant = false;\nexport { instant };")).toHaveLength(
        1,
      );
      expect(check("export let instant = false;")).toHaveLength(1);
      // The Home's own setting, and nothing else under that name.
      expect(check("export const instant = false;")).toEqual([]);
      expect(check("export const instant = true;")).toHaveLength(1);
      expect(
        check('export const instant = { level: "warning" };'),
      ).toHaveLength(1);
      expect(
        check("export async function generateStaticParams() { return []; }"),
      ).not.toEqual([]);
      expect(check("revalidatePath('/albums/x');")).toHaveLength(1);
      expect(check("cacheLife('hours');")).toHaveLength(1);
      expect(
        check("const r = await fetch('https://example.test');"),
      ).toHaveLength(1);
      expect(
        check("const a = <div dangerouslySetInnerHTML={{ __html: x }} />;"),
      ).toHaveLength(1);
    });
  });
});

describe("where the switch is applied", () => {
  const sourceOf = (file: string) =>
    ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );

  it("the routing functions apply it first, with the environment they were given, before the slug query", () => {
    const file = "src/modules/publication/public-routing.ts";
    expect(
      gateViolations(
        sourceOf(file),
        new Set(["resolvePublicSlug", "resolvePublicArtistAddress"]),
        { allowArguments: true },
      ),
    ).toEqual([]);
    // And all three exist and are guarded: the scan is not vacuous.
    const code = readFileSync(file, "utf8");
    expect(code).toMatch(/function routeAlbumJournalRequest/);
    expect(code).toMatch(/function routeArtistRequest/);
    expect(code).toMatch(/function routeMemoryRequest/);
    expect(code).toMatch(/function routePublicDocumentRequest/);
    expect(code).toMatch(/function routePublicArchiveRequest/);
    // The album journal's and the memory's share `routeEntryRequest`, the one
    // function that resolves an entry's slug, so four guards cover five.
    expect(code.match(/!publicReadsEnabled\(env\)/g)).toHaveLength(4);
    for (const name of ["routeAlbumJournalRequest", "routeMemoryRequest"]) {
      const body = code.slice(code.indexOf(`export async function ${name}`));
      expect(body.slice(0, body.indexOf("\n}\n")), name).toMatch(
        /return routeEntryRequest\(db, "(album_journal|memory)", request, env\);/,
      );
    }
  });

  it("every read of the reading entry point applies it first, so a caller that forgot still discloses nothing", () => {
    const file = "src/modules/publication/public.ts";
    const reads = new Set([
      "getPublicAlbumJournalFrom",
      "getPublicHomeFrom",
      "listPublicAlbumJournalAddressesFrom",
      "resolvePublicSlugFrom",
      "getPublicArtistFrom",
      "listPublicArtistAddressesFrom",
      "resolvePublicArtistAddressFrom",
      // M3.7
      "getPublicMemoryFrom",
      "listPublicMemoryAddressesFrom",
      // M3.8a
      "listPublicAlbumArchiveFrom",
      "listPublicArtistArchiveFrom",
      "listPublicMemoryArchiveFrom",
    ]);
    expect(gateViolations(sourceOf(file), reads)).toEqual([]);
    const code = readFileSync(file, "utf8");
    for (const name of reads) {
      expect(code, name).toContain(name);
    }
  });

  it("the proxy serves only from the routing decision, and decides before it answers", () => {
    const source = sourceOf("src/proxy.ts");
    const nexts: ts.CallExpression[] = [];
    const routings: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText();
        if (text === "NextResponse.next") {
          nexts.push(node);
        }
        if (
          text === "routeAlbumJournalRequest" ||
          text === "routeArtistRequest" ||
          text === "routeMemoryRequest" ||
          text === "routePublicArchiveRequest" ||
          text === "routePublicDocumentRequest"
        ) {
          routings.push(text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(routings.sort()).toEqual([
      "routeAlbumJournalRequest",
      "routeArtistRequest",
      "routeMemoryRequest",
      "routePublicArchiveRequest",
      "routePublicDocumentRequest",
    ]);
    // `NextResponse.next()` appears twice: in the `serve` case of the switch
    // over the decision, and for an address that is not public at all, which
    // goes back to the framework without any public decision. Nothing else
    // passes a request through.
    expect(nexts).toHaveLength(2);
    const [passThrough, serve] = nexts;
    let guard: ts.Node | undefined = passThrough;
    while (guard && !ts.isIfStatement(guard)) {
      guard = guard.parent;
    }
    expect(
      guard &&
        ts.isIfStatement(guard) &&
        guard.expression.getText().replace(/\s+/g, " "),
    ).toBe(
      "!PUBLIC_ADDRESS.test(pathname) && !PUBLIC_ADDRESS.test(decodedOrEmpty(pathname))",
    );
    let clause: ts.Node | undefined = serve;
    while (clause && !ts.isCaseClause(clause)) {
      clause = clause.parent;
    }
    expect(
      clause && ts.isCaseClause(clause) && clause.expression.getText(),
    ).toBe('"serve"');
    const owner = clause!.parent.parent;
    expect(ts.isSwitchStatement(owner) && owner.expression.getText()).toBe(
      "decision.action",
    );
  });

  it("every route handler checks it before it reads, and before it answers with content", () => {
    for (const file of [
      "src/app/sitemap.xml/route.ts",
      "src/app/robots.txt/route.ts",
    ]) {
      const source = sourceOf(file);
      expect(gateViolations(source, CALLER_READS), file).toEqual([]);
      // The guard is the first statement after `connection()` in `GET`.
      const code = readFileSync(file, "utf8");
      const body = code.slice(code.indexOf("export async function GET"));
      expect(body.indexOf("publicReadsEnabled"), file).toBeGreaterThan(-1);
      expect(body.indexOf("publicReadsEnabled"), file).toBeLessThan(
        body.indexOf("new Response("),
      );
    }
  });
});

describe("the Publication reading module", () => {
  // The files that public reads are made of. None may import a command, the
  // token functions, the Journals module, or Identity.
  const reading = [
    "src/modules/publication/public.ts",
    "src/modules/publication/public-reads.ts",
    "src/modules/publication/public-routing.ts",
    "src/modules/publication/public-album-journal.ts",
    "src/modules/publication/public-home.ts",
    // M3.5: the artist pages' read model and their addresses.
    "src/modules/publication/public-artist.ts",
    "src/modules/publication/artist-address.ts",
    // M3.7: the memory pages' read model and its music.
    "src/modules/publication/public-memory.ts",
    "src/modules/publication/memory-music.ts",
    // M3.8a: the archives' read models and the memory excerpt.
    "src/modules/publication/public-archives.ts",
    "src/modules/publication/excerpt.ts",
    "src/modules/publication/text.ts",
    // M3.8b: the read-only snapshot the Home reads in (ADR 0006 A6, item 8),
    // apart from the locks, which no reading file may import.
    "src/modules/publication/snapshot.ts",
    "src/modules/publication/queries.ts",
    "src/modules/publication/predicate.ts",
    "src/modules/publication/slug.ts",
  ];
  const allowed = [
    /^server-only$/,
    /^drizzle-orm$/,
    /^@\/db$/,
    // M3.2: the pure parser of a stored cover, and nothing else from it (the
    // next test). No provider is ever called while reading a public page.
    /^@\/integrations\/cover-art-archive$/,
    // M3.5: the pure parser of a stored photograph and its caption, and
    // nothing else from it (below); and the hash of an artist's address.
    /^@\/integrations\/wikimedia-commons$/,
    /^node:crypto$/,
    /^\.\/(public|public-reads|public-routing|public-album-journal|public-home|public-artist|public-memory|public-archives|excerpt|memory-music|text|artist-address|queries|predicate|slug|snapshot)$/,
  ];

  it("uses only the pure cover parser from the Cover Art Archive integration", () => {
    const imported: string[] = [];
    for (const file of reading) {
      const source = parse(readFileSync(file, "utf8"), file);
      for (const statement of source.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "@/integrations/cover-art-archive"
        ) {
          const bindings = statement.importClause?.namedBindings;
          expect(bindings && ts.isNamedImports(bindings), file).toBe(true);
          if (bindings && ts.isNamedImports(bindings)) {
            imported.push(
              ...bindings.elements.map(
                (element) => `${file}:${element.name.text}`,
              ),
            );
          }
        }
      }
    }
    expect(imported).toEqual([
      "src/modules/publication/public-album-journal.ts:coverArtworkOf",
    ]);
  });

  it("uses only the pure photograph parser and its caption from the Wikimedia integration", () => {
    const imported: string[] = [];
    for (const file of reading) {
      const source = parse(readFileSync(file, "utf8"), file);
      for (const statement of source.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "@/integrations/wikimedia-commons"
        ) {
          const bindings = statement.importClause?.namedBindings;
          expect(bindings && ts.isNamedImports(bindings), file).toBe(true);
          if (bindings && ts.isNamedImports(bindings)) {
            imported.push(
              ...bindings.elements.map(
                (element) => `${file}:${element.name.text}`,
              ),
            );
          }
        }
      }
    }
    expect(imported.sort()).toEqual([
      "src/modules/publication/public-artist.ts:artistPhotoOf",
      "src/modules/publication/public-artist.ts:photoCreditCaption",
    ]);
  });

  // M3.3 kept every photograph off public pages, which is why changing one
  // was not a change to a public page. M3.5 shows the artist's photograph on
  // the artist page, so: only the artist read model reads the photo columns,
  // only the artist page's components show one, and the command that sets a
  // photograph holds the guard that refuses while that page is public (gate
  // G8 not widened; ADR 0006, proposed amendment A5).
  const PHOTO_WORDS =
    /photo_url|photo_credit|photo_license|photo_source_url|photo_file_|photo_chosen_at|photoUrl|photoCredit|photoLicense|photoSourceUrl|photoFile|photoChosenAt|wikimedia/i;
  const PHOTO_READERS = [
    "src/modules/publication/public-artist.ts",
    "src/app/(artists)/artists/[slug]/artist-view.tsx",
    "src/app/(public)/_components/artist-photograph.tsx",
    "src/app/(public)/_components/public-photo-image.tsx",
  ];

  function publicPhotoMentions(files: string[]) {
    return files.filter((file) => PHOTO_WORDS.test(readFileSync(file, "utf8")));
  }

  it("reads an artist photograph only in the artist read model, and shows one only on the artist page", () => {
    const pages = publicFiles().filter((file) => file.startsWith("src/app/"));
    expect(pages.length).toBeGreaterThan(3);
    expect(publicPhotoMentions([...reading, ...pages]).sort()).toEqual(
      [...PHOTO_READERS].sort(),
    );
    // The artist page's components are used only by the artist page.
    for (const file of pages) {
      const code = readFileSync(file, "utf8");
      if (/from "[^"]*artist-photograph"/.test(code)) {
        expect(file, file).toMatch(/^src\/app\/\(artists\)\//);
      }
      if (/from "[^"]*public-photo-image"/.test(code)) {
        expect(file, file).toBe(
          "src/app/(public)/_components/artist-photograph.tsx",
        );
      }
    }
  });

  it("would notice a photo column read by a public file", () => {
    expect(PHOTO_WORDS.test("select a.photo_url from artists a")).toBe(true);
    expect(PHOTO_WORDS.test("artist.photoCredit")).toBe(true);
    expect(PHOTO_WORDS.test('import "@/integrations/wikimedia-commons"')).toBe(
      true,
    );
    expect(PHOTO_WORDS.test("select a.name from artists a")).toBe(false);
  });

  it("has every catalog command that changes who has an artist page, or its name or address, take the entries' locks first", () => {
    const code = readFileSync("src/modules/catalog/commands.ts", "utf8");
    const body = (name: string) => {
      const start = code.indexOf(`export async function ${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      const next = code.indexOf("\nexport ", start + 1);
      return code.slice(start, next === -1 ? undefined : next);
    };
    for (const [name, lock, write] of [
      [
        "updateArtist",
        "lockArtistPublicExposure(tx, id)",
        ".update(schema.artists)",
      ],
      ["archiveArtist", "lockArtistPublicExposure(tx, id)", "update artists"],
      [
        "restoreArtist",
        "lockArtistRestoreExposure(tx, id)",
        ".update(schema.artists)",
      ],
      [
        "updateAlbum",
        "lockAlbumCreditExposure(tx, id, creditedIds)",
        "lockAlbum(tx, id)",
      ],
    ] as const) {
      const text = body(name);
      const locked = text.indexOf(lock);
      expect(locked, `${name} takes ${lock}`).toBeGreaterThan(-1);
      expect(locked, `${name} locks before it writes`).toBeLessThan(
        text.indexOf(write),
      );
    }
    expect(body("updateAlbum")).toContain(
      "artistsNewlyExposedByCredit(tx, id, added)).length > 0",
    );
    expect(body("restoreArtist")).toContain("if (row.archived && wouldShow)");
  });

  it("keeps the guard in the command that sets a photograph, before the artist row", () => {
    const code = readFileSync("src/modules/catalog/photos.ts", "utf8");
    const set = code.slice(
      code.indexOf("export async function setArtistPhoto"),
      code.indexOf("export async function removeArtistPhoto"),
    );
    const guard = set.indexOf("await lockArtistPublicExposure(tx, artistId)");
    expect(guard).toBeGreaterThan(-1);
    expect(set.slice(guard, guard + 160)).toContain(
      'throw new CatalogError("public_page")',
    );
    // The entries are locked before the artist row (ADR 0006 § 7, L3).
    expect(guard).toBeLessThan(set.indexOf("artistRow(tx, artistId, true)"));
    // The lock is a share lock on the entries, in id order.
    const exposure = readFileSync(
      "src/modules/publication/catalog-exposure.ts",
      "utf8",
    );
    const lock = exposure.slice(
      exposure.indexOf("export async function lockArtistPublicExposure"),
    );
    expect(lock).toMatch(/order by e\.id\s+for share of e/);
    // Then the artist row, before the decision: archiving and restoring the
    // artist change the answer too.
    const entries = lock.indexOf("for share of e");
    const artist = lock.indexOf(
      "from artists where id = ${artistId} for no key update",
    );
    const decision = lock.indexOf("return isArtistOnPublicPage(tx, artistId)");
    expect(entries).toBeGreaterThan(-1);
    expect(artist).toBeGreaterThan(entries);
    expect(decision).toBeGreaterThan(artist);
  });

  it.each(reading)("%s imports no command, token, or other module", (file) => {
    const source = parse(readFileSync(file, "utf8"), file);
    const specifiers: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifiers.push(node.moduleSpecifier.text);
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifiers.push(node.moduleSpecifier.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const specifier of specifiers) {
      expect(
        allowed.some((rule) => rule.test(specifier)),
        `${file} imports ${specifier}`,
      ).toBe(true);
    }
  });

  // An unchecked writer: a statement or a call that changes the database. The
  // reading files hold none, and a reading file that gains one fails here.
  const WRITE_SQL =
    /\b(insert\s+into|update\s+["\w.]+\s+set|delete\s+from|truncate|alter\s+table|drop\s+(table|index|column|schema)|create\s+(table|index|schema)|grant\s|revoke\s|copy\s+\S+\s+(from|to))\b/i;
  const WRITE_CALLS = new Set([
    "insert",
    "update",
    "delete",
    "transaction",
    "onConflictDoUpdate",
    "onConflictDoNothing",
    "returning",
  ]);

  // The one transaction a reading file may open (ADR 0006 A6, item 8): in
  // `snapshot.ts` alone, and only with options that are, literally, a
  // read-only REPEATABLE READ transaction. PostgreSQL refuses every write in a
  // read-only transaction, so it cannot become a writer.
  function isReadOnlySnapshot(call: ts.CallExpression): boolean {
    const options = call.arguments[1];
    if (!options || !ts.isObjectLiteralExpression(options)) {
      return false;
    }
    const values = new Map<string, string>();
    for (const property of options.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !ts.isIdentifier(property.name) ||
        !ts.isStringLiteral(property.initializer)
      ) {
        return false;
      }
      values.set(property.name.text, property.initializer.text);
    }
    return (
      values.size === 2 &&
      values.get("isolationLevel") === "repeatable read" &&
      values.get("accessMode") === "read only"
    );
  }

  function writerFindings(
    code: string,
    { snapshotFile = false }: { snapshotFile?: boolean } = {},
  ): string[] {
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        if (WRITE_SQL.test(node.text)) {
          found.push(`writes SQL: ${node.text.trim().slice(0, 40)}`);
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        WRITE_CALLS.has(node.expression.name.text) &&
        !(
          snapshotFile &&
          node.expression.name.text === "transaction" &&
          isReadOnlySnapshot(node)
        )
      ) {
        found.push(`calls .${node.expression.name.text}()`);
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(code, "x.ts"));
    return found;
  }

  it.each(reading)("%s holds no writer", (file) => {
    expect(
      writerFindings(readFileSync(file, "utf8"), {
        snapshotFile: file === "src/modules/publication/snapshot.ts",
      }),
    ).toEqual([]);
  });

  it("allows the snapshot file exactly one kind of transaction: read only, REPEATABLE READ", () => {
    const readOnly =
      'await db.transaction(work, { isolationLevel: "repeatable read", accessMode: "read only" });';
    expect(writerFindings(readOnly, { snapshotFile: true })).toEqual([]);
    // Not in any other reading file.
    expect(writerFindings(readOnly)).not.toEqual([]);
    for (const code of [
      "await db.transaction(work);",
      'await db.transaction(work, { isolationLevel: "repeatable read" });',
      'await db.transaction(work, { isolationLevel: "repeatable read", accessMode: "read write" });',
      'await db.transaction(work, { isolationLevel: "read committed", accessMode: "read only" });',
      'await db.transaction(work, { isolationLevel: "repeatable read", accessMode: "read only", deferrable: true, x: "y" });',
      "await db.transaction(work, options);",
      "await db.transaction(work, { ...readOnly });",
    ]) {
      expect(writerFindings(code, { snapshotFile: true }), code).not.toEqual(
        [],
      );
    }
  });

  it("would notice an unchecked writer added to a reading file", () => {
    for (const code of [
      "await db.execute(sql`update entry_texts set status = 'published'`);",
      "await db.execute(sql`insert into entry_slugs (slug) values (${s})`);",
      "await db.execute(sql`delete from entries where id = ${id}`);",
      "await db.execute(sql`truncate entries`);",
      "await db.update(entries).set({ x: 1 });",
      "await db.insert(entries).values({});",
      "await db.delete(entries);",
      "await db.transaction(async (tx) => {});",
      "await db.insert(a).values(b).onConflictDoUpdate({});",
    ]) {
      expect(writerFindings(code), code).not.toEqual([]);
    }
    // A read, including a row lock's words, is not a writer.
    expect(
      writerFindings(
        "await db.execute(sql`select * from entries e where e.id = ${id} for update`);",
      ),
    ).toEqual([]);
  });

  // The names the facade exports, exactly. A new export is a new capability on
  // the public side, so it fails here until the owner's reviewer adds it.
  function exportedNames(code: string): string[] {
    const names: string[] = [];
    for (const statement of parse(code, "public.ts").statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause) {
        if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            names.push(element.name.text);
          }
        }
      } else if (ts.isExportDeclaration(statement)) {
        names.push("*");
      } else if (
        ts.isFunctionDeclaration(statement) &&
        statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        names.push(statement.name?.text ?? "default");
      } else if (
        ts.isVariableStatement(statement) &&
        statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        for (const declaration of statement.declarationList.declarations) {
          names.push(declaration.name.getText());
        }
      } else if (ts.isExportAssignment(statement)) {
        names.push("default");
      }
    }
    return names.sort();
  }

  const EXPECTED_EXPORTS = [
    // Reads, bound to the application's database, each behind the switch.
    "getPublicAlbumJournal",
    // M3.4: what the Home lists.
    "getPublicHome",
    "listPublicAlbumJournalAddresses",
    "resolvePublicAlbumJournalSlug",
    "routeAlbumJournalRequest",
    "routePublicDocumentRequest",
    // M3.5: the artist pages, each behind the switch.
    "getPublicArtist",
    "listPublicArtistAddresses",
    "resolvePublicArtistAddress",
    "routeArtistRequest",
    "isNormalizedSlug",
    // The switch, and the site's own origin.
    "PUBLIC_READS_VARIABLE",
    "publicReadsEnabled",
    "publicSiteOrigin",
    // Types.
    "AlbumJournalRequest",
    "AlbumJournalRouting",
    "ArtistAddressResolution",
    "PublicAlbumJournal",
    // M3.5: the artist page, with no identifier.
    "PublicArtist",
    "PublicArtistAlbum",
    "PublicArtistPhoto",
    "PublicArtistTrack",
    // M3.2: the cover's image sources (a src and a srcSet), never an address
    // from the database.
    "PublicArtwork",
    "PublicCredit",
    "PublicHome",
    // M3.8b (ADR 0006 A6): the Home's entries, an album journal or a memory.
    "PublicHomeAlbumJournal",
    "PublicHomeEntry",
    "PublicHomeMemory",
    "PublicJournalCard",
    "PublicJournalTrack",
    // M3.7: the memory page, with no identifier, and its reads.
    "getPublicMemory",
    "listPublicMemoryAddresses",
    "resolvePublicMemorySlug",
    "routeMemoryRequest",
    "PublicMemory",
    "PublicMemoryArtist",
    "PublicMemoryMusic",
    // M3.8a: the archives, each behind the switch, and their cards, with no
    // identifier.
    "listPublicAlbumArchive",
    "listPublicArtistArchive",
    "listPublicMemoryArchive",
    "routePublicArchiveRequest",
    "PublicAlbumCard",
    "PublicAlbumJournalLink",
    "PublicArtistCard",
    "PublicMemoryCard",
    "PublicMemorySong",
    "SlugResolution",
  ].sort();

  it("exports exactly the reviewed names, none of them a command", () => {
    expect(
      exportedNames(readFileSync("src/modules/publication/public.ts", "utf8")),
    ).toEqual(EXPECTED_EXPORTS);
  });

  it("would notice a new export, a command, or a wildcard", () => {
    const base = 'export { isNormalizedSlug } from "./slug";';
    expect(exportedNames(base)).toEqual(["isNormalizedSlug"]);
    expect(
      exportedNames(
        `${base}\nexport { publishLanguageVersion } from "./commands";`,
      ),
    ).toContain("publishLanguageVersion");
    expect(exportedNames('export * from "./commands";')).toEqual(["*"]);
    expect(
      exportedNames(`${base}\nexport async function writeThing() {}`),
    ).toContain("writeThing");
    expect(exportedNames(`${base}\nexport const writeThing = 1;`)).toContain(
      "writeThing",
    );
  });

  it("exports reads and the switch only", () => {
    const code = readFileSync("src/modules/publication/public.ts", "utf8");
    for (const name of [
      "publishLanguageVersion",
      "unpublishLanguageVersion",
      "previewPublication",
      "changeEntrySlug",
      "restoreDeletedEntry",
      "reserveInitialSlug",
      "retireEntrySlugs",
    ]) {
      expect(code, name).not.toContain(name);
    }
  });
});

// M3.8b (ADR 0006 A6, item 7): the Home renders its read model only in server
// components, so no read-model object is serialized into the Flight payload
// for a client component. The only client components it renders are the
// framework's `Link` and `Image`, which receive strings and numbers.
describe("the Home's components", () => {
  const resolveApp = (specifier: string): string | null => {
    // Stylesheets hold no component.
    if (!specifier.startsWith("@/app/") || specifier.endsWith(".css")) {
      return null;
    }
    const base = join("src", specifier.slice(2));
    for (const candidate of [`${base}.tsx`, `${base}.ts`]) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        // Try the next extension.
      }
    }
    throw new Error(`cannot resolve ${specifier}`);
  };

  /** Every file under src/app the given one imports, transitively. */
  function appImports(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) {
      return seen;
    }
    seen.add(file);
    const source = parse(readFileSync(file, "utf8"), file);
    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const resolved = resolveApp(statement.moduleSpecifier.text);
        if (resolved) {
          appImports(resolved, seen);
        }
      }
    }
    return seen;
  }

  const isClient = (file: string) =>
    /^\s*["']use client["']/.test(readFileSync(file, "utf8"));

  it("are all server components, down to every component they import", () => {
    const files = [...appImports("src/app/page.tsx")];
    expect(files).toContain("src/app/(public)/_components/home-view.tsx");
    expect(files).toContain("src/app/(public)/_components/arrow-icon.tsx");
    expect(files.filter(isClient)).toEqual([]);
  });

  it("would notice a client component among them", () => {
    // The artist page's photograph is a client component; were the Home to
    // import it, the check above would name it.
    expect(
      isClient("src/app/(public)/_components/public-photo-image.tsx"),
    ).toBe(true);
  });

  it("take the Publication module's values as types only", () => {
    for (const file of [
      "src/app/(public)/_components/home-view.tsx",
      "src/app/(archives)/_components/archive-lines.ts",
    ]) {
      const source = parse(readFileSync(file, "utf8"), file);
      for (const statement of source.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text.startsWith("@/modules/")
        ) {
          expect(statement.importClause?.isTypeOnly, file).toBe(true);
        }
      }
    }
  });
});
