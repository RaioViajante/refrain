import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// The shape of the route trees (ADR 0008 §§ 2, 3, and 8). Every address the
// application serves is a thin file under `(en)`, or its Portuguese form under
// `pt`, that names one shared implementation and carries the route's literal
// settings: a Studio route re-exports its screen; a public route passes its
// tree's interface language, as a literal, to its screen and to its
// metadata. Authorization and reading stay in the implementations, which the
// other scans check, so a route file that did anything else would be outside
// those scans.

const APP = "src/app";
const ENGLISH = join(APP, "(en)");
const PORTUGUESE = join(APP, "pt");

// Every page address, written out: moving a route must not add or lose one.
const PAGES = [
  "/",
  "/albums",
  "/albums/[slug]",
  "/artists",
  "/artists/[slug]",
  "/memories",
  "/memories/[slug]",
  "/studio",
  "/studio/albums",
  "/studio/albums/[id]",
  "/studio/albums/[id]/artwork",
  "/studio/albums/new",
  "/studio/artists",
  "/studio/artists/[id]",
  "/studio/artists/[id]/photo",
  "/studio/artists/[id]/photo/review",
  "/studio/artists/new",
  "/studio/catalog",
  "/studio/catalog/add",
  "/studio/catalog/add/album/[id]",
  "/studio/catalog/add/artist/[id]",
  "/studio/catalog/add/release/[id]",
  "/studio/journals",
  "/studio/journals/[id]",
  "/studio/journals/[id]/edit",
  "/studio/journals/deleted",
  "/studio/journals/new",
  "/studio/memories",
  "/studio/memories/[id]",
  "/studio/memories/new",
  "/studio/sign-in",
  "/studio/tracks",
  "/studio/tracks/[id]",
  "/studio/tracks/new",
];

// The routes that render in one pass, without client JavaScript.
const ONE_PASS = [
  "/",
  "/albums",
  "/artists",
  "/artists/[slug]",
  "/memories",
  "/memories/[slug]",
];

const SEGMENT_SETTINGS =
  /^export const (instant|dynamic|dynamicParams|revalidate|fetchCache|runtime|preferredRegion|maxDuration|unstable_[a-zA-Z]+)\b/m;

function allFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" }).map(
    (file) => join(directory, file).split("\\").join("/"),
  );
}

const ROUTE_CONVENTION =
  /(^|\/)(page|layout|template|default|not-found|error|global-error|loading)\.(m?[jt]sx?)$/;

const pagesOf = (root: string) =>
  allFiles(root).filter((file) => /\/page\.tsx$/.test(file));
const englishPages = pagesOf(ENGLISH);
const portuguesePages = pagesOf(PORTUGUESE);
const nestedLayouts = allFiles(ENGLISH).filter(
  (file) => /\/layout\.tsx$/.test(file) && file !== `${ENGLISH}/layout.tsx`,
);

/** `src/app/(en)/(public)/albums/[slug]/page.tsx` to `(public)/albums/[slug]`. */
function directoryOf(file: string): string {
  const root = file.startsWith(`${PORTUGUESE}/`) ? PORTUGUESE : ENGLISH;
  return file.slice(root.length + 1).replace(/\/?(page|layout)\.tsx$/, "");
}

function addressOf(file: string): string {
  const address = directoryOf(file)
    .split("/")
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment))
    .join("/");
  return `/${address}`;
}

const isStudio = (file: string) => directoryOf(file).startsWith("studio");

function implementationOf(file: string): string {
  const directory = directoryOf(file);
  if (/\/page\.tsx$/.test(file)) {
    return directory === "" ? "home-screen" : `${directory}/screen`;
  }
  return "studio/studio-layout";
}

const localeOf = (file: string) =>
  file.startsWith(`${PORTUGUESE}/`) ? "pt-BR" : "en";

function isInstantFalse(statement: ts.Statement): boolean {
  return (
    ts.isVariableStatement(statement) &&
    statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) === true &&
    statement.declarationList.declarations.length === 1 &&
    statement.declarationList.declarations[0]!.name.getText() === "instant" &&
    statement.declarationList.declarations[0]!.initializer?.kind ===
      ts.SyntaxKind.FalseKeyword
  );
}

function parse(code: string): ts.SourceFile {
  return ts.createSourceFile(
    "route.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** What makes a Studio route file more than a re-export of its screen. */
function thinViolations(code: string, implementation: string): string[] {
  const found: string[] = [];
  let delegations = 0;
  for (const statement of parse(code).statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      delegations += 1;
      if (statement.moduleSpecifier.text !== `@/app/${implementation}`) {
        found.push(`delegates to ${statement.moduleSpecifier.text}`);
      }
      const names = statement.exportClause.elements.map(
        (element) => element.name.text,
      );
      if (!names.includes("default")) {
        found.push("does not delegate its default export");
      }
      for (const element of statement.exportClause.elements) {
        if (
          element.propertyName !== undefined ||
          !["default", "metadata", "generateMetadata"].includes(
            element.name.text,
          )
        ) {
          found.push(`exports ${element.getText()}`);
        }
      }
      continue;
    }
    if (!isInstantFalse(statement)) {
      found.push(`has the statement: ${statement.getText().slice(0, 60)}`);
    }
  }
  if (delegations !== 1) {
    found.push(`has ${delegations} delegations`);
  }
  return found;
}

/**
 * What makes a public route file more than a delegation of its interface
 * language: one import of a screen and its metadata from the implementation,
 * a page that renders that screen with the language as a literal (and the
 * route's own `params`), a `generateMetadata` that calls the metadata with the
 * same literal, a props type, and the one-pass setting. Nothing else.
 */
function localizedViolations(
  code: string,
  implementation: string,
  locale: string,
): string[] {
  const found: string[] = [];
  const imported = new Set<string>();
  let page = false;
  let metadata = false;
  for (const statement of parse(code).statements) {
    if (ts.isImportDeclaration(statement)) {
      const from = (statement.moduleSpecifier as ts.StringLiteral).text;
      const clause = statement.importClause;
      if (
        from !== `@/app/${implementation}` ||
        !clause ||
        clause.name ||
        !clause.namedBindings ||
        !ts.isNamedImports(clause.namedBindings) ||
        imported.size > 0
      ) {
        found.push(`imports ${statement.getText().slice(0, 60)}`);
        continue;
      }
      for (const element of clause.namedBindings.elements) {
        if (element.propertyName) {
          found.push(`renames ${element.getText()}`);
        }
        imported.add(element.name.text);
      }
      continue;
    }
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === "Props"
    ) {
      continue;
    }
    if (isInstantFalse(statement)) {
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.body &&
      statement.body.statements.length === 1 &&
      ts.isReturnStatement(statement.body.statements[0]!)
    ) {
      const returned = (statement.body.statements[0] as ts.ReturnStatement)
        .expression;
      const modifiers = (statement.modifiers ?? []).map((m) => m.kind);
      const exported = modifiers.includes(ts.SyntaxKind.ExportKeyword);
      const isDefault = modifiers.includes(ts.SyntaxKind.DefaultKeyword);
      if (
        exported &&
        isDefault &&
        statement.name?.text === "Page" &&
        returned &&
        ts.isJsxSelfClosingElement(returned) &&
        imported.has(returned.tagName.getText())
      ) {
        const attributes = returned.attributes.properties.map((property) =>
          property.getText(),
        );
        const allowed = [`locale="${locale}"`, "params={params}"];
        if (
          !attributes.includes(`locale="${locale}"`) ||
          attributes.some((attribute) => !allowed.includes(attribute))
        ) {
          found.push(`renders ${returned.getText()}`);
        }
        page = true;
        continue;
      }
      if (
        exported &&
        !isDefault &&
        statement.name?.text === "generateMetadata" &&
        returned &&
        ts.isCallExpression(returned) &&
        imported.has(returned.expression.getText())
      ) {
        const args = returned.arguments.map((argument) => argument.getText());
        const expected =
          args.length === 2 ? ["params", `"${locale}"`] : [`"${locale}"`];
        if (JSON.stringify(args) !== JSON.stringify(expected)) {
          found.push(`calls ${returned.getText()}`);
        }
        metadata = true;
        continue;
      }
    }
    found.push(`has the statement: ${statement.getText().slice(0, 60)}`);
  }
  if (!page) {
    found.push("renders no screen");
  }
  if (!metadata) {
    found.push("has no metadata");
  }
  return found;
}

describe("the route trees", () => {
  it("serves exactly the English addresses it served before, with none added", () => {
    expect(englishPages.map(addressOf).sort()).toEqual([...PAGES].sort());
  });

  it("serves each public page, and only those, in Portuguese at the same path", () => {
    const publicPages = englishPages.filter((file) => !isStudio(file));
    expect(portuguesePages.map(directoryOf).sort()).toEqual(
      publicPages.map(directoryOf).sort(),
    );
  });

  it("finds the routes, so the checks below are not vacuous", () => {
    expect(englishPages).toHaveLength(34);
    expect(portuguesePages).toHaveLength(7);
    // The Studio's layout; the public pages draw their own frame.
    expect(nestedLayouts).toEqual([`${ENGLISH}/studio/layout.tsx`]);
  });

  it.each([...englishPages.filter(isStudio), ...nestedLayouts])(
    "%s only delegates to its implementation",
    (file) => {
      const implementation = implementationOf(file);
      expect(
        thinViolations(readFileSync(file, "utf8"), implementation),
      ).toEqual([]);
      expect(existsSync(join(APP, `${implementation}.tsx`)), file).toBe(true);
    },
  );

  it.each([
    ...englishPages.filter((file) => !isStudio(file)),
    ...portuguesePages,
  ])("%s only passes its language to its implementation", (file) => {
    const implementation = implementationOf(file);
    expect(
      localizedViolations(
        readFileSync(file, "utf8"),
        implementation,
        localeOf(file),
      ),
    ).toEqual([]);
    expect(existsSync(join(APP, `${implementation}.tsx`)), file).toBe(true);
  });

  it.each(portuguesePages)(
    "%s is its English form with the other language, and nothing else",
    (file) => {
      const english = join(ENGLISH, file.slice(PORTUGUESE.length + 1));
      const neutral = (code: string, locale: string) =>
        code.split(`"${locale}"`).join('"LOCALE"');
      expect(neutral(readFileSync(file, "utf8"), "pt-BR")).toBe(
        neutral(readFileSync(english, "utf8"), "en"),
      );
    },
  );

  it.each([...englishPages, ...portuguesePages])(
    "%s keeps its literal rendering setting",
    (file) => {
      const settings = /^export const instant = false;$/m.test(
        readFileSync(file, "utf8"),
      );
      expect(settings).toBe(ONE_PASS.includes(addressOf(file)));
    },
  );

  it("keeps route settings out of the implementations, where Next.js would not read them", () => {
    const implementations = allFiles(APP).filter((file) =>
      /(^|\/)(screen|home-screen|studio-layout)\.tsx$/.test(file),
    );
    expect(implementations).toHaveLength(35);
    for (const file of implementations) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(SEGMENT_SETTINGS);
    }
  });

  it("has a route file only under (en) and pt, apart from the not-found fallback", () => {
    const outside = allFiles(APP).filter(
      (file) =>
        !file.startsWith(`${ENGLISH}/`) &&
        !file.startsWith(`${PORTUGUESE}/`) &&
        ROUTE_CONVENTION.test(file),
    );
    expect(outside).toEqual([]);
    expect(existsSync(join(APP, "global-not-found.tsx"))).toBe(true);
  });

  it("fixes each document's language in its root, and enables the not-found fallback", () => {
    for (const [file, lang] of [
      [`${ENGLISH}/layout.tsx`, "en"],
      [`${PORTUGUESE}/layout.tsx`, "pt-BR"],
      ["src/app/global-not-found.tsx", "en"],
    ] as const) {
      expect(readFileSync(file, "utf8"), file).toContain(
        `<html lang="${lang}">`,
      );
    }
    expect(readFileSync("next.config.ts", "utf8")).toMatch(
      /experimental: \{ globalNotFound: true \}/,
    );
  });

  it("answers a page's own notFound() with the shared view, in each root's language", () => {
    expect(readFileSync(`${ENGLISH}/not-found.tsx`, "utf8")).toContain(
      '<NotFoundView locale="en" />',
    );
    expect(readFileSync(`${PORTUGUESE}/not-found.tsx`, "utf8")).toContain(
      '<NotFoundView locale="pt-BR" />',
    );
    expect(readFileSync("src/app/global-not-found.tsx", "utf8")).toContain(
      '<NotFoundView locale="en" />',
    );
  });

  it("has no Portuguese Studio yet (PR 3)", () => {
    expect(existsSync(join(PORTUGUESE, "studio"))).toBe(false);
  });

  describe("probes: the delegation rules catch what they are meant to", () => {
    const target = "studio/journals/screen";
    const good = `export { default, metadata } from "@/app/${target}";`;

    it("accepts a delegation, with or without the one-pass setting", () => {
      expect(thinViolations(good, target)).toEqual([]);
      expect(
        thinViolations(`${good}\nexport const instant = false;`, target),
      ).toEqual([]);
    });

    it.each([
      ["a page of its own", "export default function P() { return null; }"],
      ["another target", 'export { default } from "@/app/studio/frame";'],
      ["an import", `import "@/app/studio/frame";\n${good}`],
      ["a second delegation", `${good}\n${good}`],
      ["a renamed default", `export { x as default } from "@/app/${target}";`],
      ["another name", `export { default, y } from "@/app/${target}";`],
      ["another setting", `${good}\nexport const dynamic = "force-static";`],
      ["a true setting", `${good}\nexport const instant = true;`],
      ["a call", `${good}\nconsole.log(1);`],
    ])("refuses %s", (_name, code) => {
      expect(thinViolations(code, target).length).toBeGreaterThan(0);
    });

    const screen = "(public)/albums/[slug]/screen";
    const localized = (locale: string, extra = "", attributes = "") =>
      `import { AlbumJournalScreen, albumJournalMetadata } from "@/app/${screen}";
type Props = Readonly<{ params: Promise<{ slug: string }> }>;
export default function Page({ params }: Props) {
  return <AlbumJournalScreen params={params} locale="${locale}"${attributes} />;
}
export function generateMetadata({ params }: Props) {
  return albumJournalMetadata(params, "${locale}");
}
${extra}`;

    it("accepts a public route that passes its own language", () => {
      expect(localizedViolations(localized("pt-BR"), screen, "pt-BR")).toEqual(
        [],
      );
    });

    it.each([
      ["the other language", localized("en")],
      ["an attribute from the request", localized("pt-BR", "", " slug={x}")],
      [
        "a second import",
        `import { x } from "@/i18n/locales";\n${localized("pt-BR")}`,
      ],
      ["a statement", localized("pt-BR", "console.log(1);")],
      ["another setting", localized("pt-BR", "export const dynamic = 1;")],
    ])("refuses %s", (_name, code) => {
      expect(localizedViolations(code, screen, "pt-BR").length).toBeGreaterThan(
        0,
      );
    });
  });
});
