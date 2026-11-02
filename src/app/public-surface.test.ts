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
  "listPublicAlbumJournalAddresses",
  "resolvePublicAlbumJournalSlug",
  "routeAlbumJournalRequest",
  "routePublicDocumentRequest",
]);

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
      file === "src/app/not-found.tsx" ||
      file === "src/app/public-fonts.ts" ||
      file === "src/app/sitemap.xml/route.ts" ||
      file === "src/app/robots.txt/route.ts",
  );
  return ["src/proxy.ts", ...inApp];
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
]);

function violations(code: string, file: string): string[] {
  const source = parse(code, file);
  const found: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (!ALLOWED_IMPORTS.some((rule) => rule.test(specifier))) {
        found.push(`imports ${specifier}`);
      }
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
    // A cache or a static page of journal data: `export const revalidate`,
    // `dynamic = "force-static"`, `"use cache"`.
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of node.declarationList.declarations) {
        const name = declaration.name.getText();
        if (
          name === "revalidate" ||
          name === "dynamic" ||
          name === "fetchCache"
        ) {
          found.push(`exports ${name}`);
        }
      }
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

  // Every function that reads public content applies the switch first.
  const checkFunction = (fn: FunctionLike) => {
    const gate: number[] = [];
    const reads: { position: number; name: string }[] = [];
    const look = (node: ts.Node, nested: boolean) => {
      if (node !== fn && isFunctionLike(node)) {
        // A nested function is checked on its own.
        return;
      }
      if (ts.isCallExpression(node)) {
        const name = calledName(node);
        if (name === "publicReadsEnabled") {
          gate.push(node.getStart());
        }
        if (name && READS.has(name)) {
          reads.push({ position: node.getStart(), name });
        }
      }
      ts.forEachChild(node, (child) => look(child, nested));
    };
    look(fn, false);
    for (const read of reads) {
      // The routing functions apply the switch themselves, as their first step
      // (tested against the database); a caller need not repeat it.
      if (read.name.startsWith("route")) {
        continue;
      }
      if (!gate.some((position) => position < read.position)) {
        found.push(`reads with ${read.name} before applying the switch`);
      }
    }
  };
  const visitFunctions = (node: ts.Node) => {
    if (isFunctionLike(node)) {
      checkFunction(node);
    }
    ts.forEachChild(node, visitFunctions);
  };
  visitFunctions(source);

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
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files)("%s is clean", (file) => {
    expect(violations(readFileSync(file, "utf8"), file)).toEqual([]);
  });

  it("applies the switch in every route handler and in the page's loader", () => {
    for (const file of [
      "src/app/sitemap.xml/route.ts",
      "src/app/robots.txt/route.ts",
      "src/app/(public)/albums/[slug]/page.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).toMatch(
        /publicReadsEnabled\(\)/,
      );
    }
  });

  it("has the proxy ask both routing decisions, with exactly the matcher the routes need", () => {
    const code = readFileSync("src/proxy.ts", "utf8");
    expect(code).toContain("routeAlbumJournalRequest");
    expect(code).toContain("routePublicDocumentRequest");
    expect(matcherOf(code)).toEqual([
      "/albums/:slug",
      "/sitemap.xml",
      "/robots.txt",
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
      /^src\/app\/sitemap\.xml\/route\.ts$/,
      /^src\/app\/robots\.txt\/route\.ts$/,
      /^src\/app\/not-found\.tsx$/,
      // The root layout and the homepage placeholder, which reads nothing.
      /^src\/app\/layout\.tsx$/,
      /^src\/app\/page\.tsx$/,
    ];
    const unclassified = walk("src/app").filter(
      (file) => routeLike.test(file) && !known.some((rule) => rule.test(file)),
    );
    expect(unclassified).toEqual([]);
    // The placeholder homepage is public and anonymous: it imports nothing from
    // a module and calls nothing that reads the system.
    expect(readFileSync("src/app/page.tsx", "utf8")).not.toMatch(
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

    it("a cache, a static page, a revalidation, raw HTML, or a network call", () => {
      expect(check('"use cache";\nexport const x = 1;')).toHaveLength(1);
      expect(check("export const revalidate = 60;")).toHaveLength(1);
      expect(check('export const dynamic = "force-static";')).toHaveLength(1);
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

describe("the Publication reading module", () => {
  // The files that public reads are made of. None may import a command, the
  // token functions, the Journals module, or Identity.
  const reading = [
    "src/modules/publication/public.ts",
    "src/modules/publication/public-reads.ts",
    "src/modules/publication/public-routing.ts",
    "src/modules/publication/public-album-journal.ts",
    "src/modules/publication/queries.ts",
    "src/modules/publication/predicate.ts",
    "src/modules/publication/slug.ts",
  ];
  const allowed = [
    /^server-only$/,
    /^drizzle-orm$/,
    /^@\/db$/,
    /^\.\/(public|public-reads|public-routing|public-album-journal|queries|predicate|slug)$/,
  ];

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
