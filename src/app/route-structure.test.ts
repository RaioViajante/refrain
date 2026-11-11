import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// The shape of the route trees (ADR 0008 §§ 2, 3, and 8). Every address the
// application serves is a thin file under `(en)`, and its Portuguese form under
// `pt`, that names one shared implementation and carries the route's literal
// settings: it passes its tree's interface language, as a literal, to its
// screen and to its metadata, with nothing from the request but the route's
// own `params` and `searchParams`. The Studio's layout passes the language to
// the Studio layout the same way. Authorization and reading stay in the
// implementations, which the other scans check, so a route file that did
// anything else would be outside those scans.

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
const nestedLayoutsOf = (root: string) =>
  allFiles(root).filter(
    (file) => /\/layout\.tsx$/.test(file) && file !== `${root}/layout.tsx`,
  );
const nestedLayouts = [
  ...nestedLayoutsOf(ENGLISH),
  ...nestedLayoutsOf(PORTUGUESE),
];

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

/**
 * What makes a route file more than a delegation of its interface language:
 * one import of a screen and its metadata from the implementation, a page
 * that renders that screen with the language as a literal (and the route's
 * own `params` and `searchParams`), a `generateMetadata` that calls the
 * metadata with the same literal, a props type, and the one-pass setting. A
 * layout renders the implementation's layout with the literal around its
 * `children`. Nothing else.
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
  const allowed = [
    `locale="${locale}"`,
    "params={params}",
    "searchParams={searchParams}",
  ];
  const languageOnly = (attributes: string[]) =>
    attributes.includes(`locale="${locale}"`) &&
    attributes.every((attribute) => allowed.includes(attribute));
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
    // A Studio route's metadata is static: `export const metadata =
    // xMetadata("<locale>")`, a call of the imported metadata with the literal
    // and nothing else. It is no function, so there is nothing to authorize.
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) === true &&
      statement.declarationList.declarations.length === 1 &&
      statement.declarationList.declarations[0]!.name.getText() === "metadata"
    ) {
      const value = statement.declarationList.declarations[0]!.initializer;
      if (
        !value ||
        !ts.isCallExpression(value) ||
        !imported.has(value.expression.getText()) ||
        JSON.stringify(value.arguments.map((a) => a.getText())) !==
          JSON.stringify([`"${locale}"`])
      ) {
        found.push(`has the statement: ${statement.getText().slice(0, 60)}`);
      }
      metadata = true;
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.body &&
      statement.body.statements.length === 1 &&
      ts.isReturnStatement(statement.body.statements[0]!)
    ) {
      // A formatter may wrap a long element in parentheses; they change
      // nothing.
      let returned = (statement.body.statements[0] as ts.ReturnStatement)
        .expression;
      while (returned && ts.isParenthesizedExpression(returned)) {
        returned = returned.expression;
      }
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
        if (!languageOnly(attributes)) {
          found.push(`renders ${returned.getText()}`);
        }
        page = true;
        continue;
      }
      const inner = returned;
      if (
        exported &&
        isDefault &&
        statement.name?.text === "Layout" &&
        inner &&
        ts.isJsxElement(inner) &&
        imported.has(inner.openingElement.tagName.getText())
      ) {
        const attributes = inner.openingElement.attributes.properties.map(
          (property) => property.getText(),
        );
        const children = inner.children.filter(
          (child) => !(ts.isJsxText(child) && child.text.trim() === ""),
        );
        if (
          attributes.join(" ") !== `locale="${locale}"` ||
          children.length !== 1 ||
          children[0]!.getText() !== "{children}"
        ) {
          found.push(`renders ${inner.getText().slice(0, 60)}`);
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

  it("serves every page, public and Studio, in Portuguese at the same path", () => {
    expect(portuguesePages.map(directoryOf).sort()).toEqual(
      englishPages.map(directoryOf).sort(),
    );
  });

  it("finds the routes, so the checks below are not vacuous", () => {
    expect(englishPages).toHaveLength(34);
    expect(portuguesePages).toHaveLength(34);
    expect(englishPages.filter(isStudio)).toHaveLength(27);
    expect(portuguesePages.filter(isStudio)).toHaveLength(27);
    // The Studio's layout in each tree; the public pages draw their own frame.
    expect(nestedLayouts).toEqual([
      `${ENGLISH}/studio/layout.tsx`,
      `${PORTUGUESE}/studio/layout.tsx`,
    ]);
  });

  it.each([...englishPages, ...portuguesePages, ...nestedLayouts])(
    "%s only passes its language to its implementation",
    (file) => {
      const implementation = implementationOf(file);
      expect(
        localizedViolations(
          readFileSync(file, "utf8"),
          implementation,
          localeOf(file),
        ),
      ).toEqual([]);
      expect(existsSync(join(APP, `${implementation}.tsx`)), file).toBe(true);
    },
  );

  it.each([...portuguesePages, ...nestedLayoutsOf(PORTUGUESE)])(
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

  it("has the Portuguese Studio (PR 3), in its own tree, with its own layout", () => {
    expect(existsSync(join(PORTUGUESE, "studio", "layout.tsx"))).toBe(true);
    expect(existsSync(join(PORTUGUESE, "studio", "page.tsx"))).toBe(true);
  });

  describe("probes: the delegation rules catch what they are meant to", () => {
    const target = "studio/journals/[id]/screen";
    const studioPage = (locale: string, extra = "", attributes = "") =>
      `import { JournalScreen, journalMetadata } from "@/app/${target}";
type Props = Readonly<{ params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }>;
export default function Page({ params, searchParams }: Props) {
  return <JournalScreen params={params} searchParams={searchParams} locale="${locale}"${attributes} />;
}
export const metadata = journalMetadata("${locale}");
${extra}`;
    const layoutTarget = "studio/studio-layout";
    const studioLayout = (locale: string, children = "{children}") =>
      `import { StudioLayout, studioLayoutMetadata } from "@/app/${layoutTarget}";
type Props = Readonly<{ children: React.ReactNode }>;
export default function Layout({ children }: Props) {
  return <StudioLayout locale="${locale}">${children}</StudioLayout>;
}
export const metadata = studioLayoutMetadata("${locale}");
`;

    it("accepts a Studio page and the Studio layout that pass their own language", () => {
      expect(localizedViolations(studioPage("pt-BR"), target, "pt-BR")).toEqual(
        [],
      );
      expect(
        localizedViolations(studioLayout("en"), layoutTarget, "en"),
      ).toEqual([]);
    });

    it.each([
      ["a page of its own", "export default function P() { return null; }"],
      ["another target", studioPage("en").replace(target, "studio/frame")],
      ["an import", `import "@/app/studio/frame";\n${studioPage("en")}`],
      ["a re-export", `export { default } from "@/app/${target}";`],
      ["another name", studioPage("en", "export const y = 1;")],
      [
        "another setting",
        studioPage("en", 'export const dynamic = "force-static";'),
      ],
      ["a true setting", studioPage("en", "export const instant = true;")],
      ["a call", studioPage("en", "console.log(1);")],
      ["the other language", studioPage("pt-BR")],
      ["an attribute from the request", studioPage("en", "", " id={x}")],
      [
        "metadata from elsewhere",
        studioPage("en").replace(
          'journalMetadata("en")',
          "journalMetadata(params)",
        ),
      ],
      [
        "metadata that is not a call",
        studioPage("en").replace('journalMetadata("en")', "{}"),
      ],
    ])("refuses a Studio page with %s", (_name, code) => {
      expect(localizedViolations(code, target, "en").length).toBeGreaterThan(0);
    });

    it.each([
      ["the other language", studioLayout("pt-BR")],
      ["more children", studioLayout("en", "{children}{children}")],
      ["something else as its child", studioLayout("en", "<p />")],
    ])("refuses a Studio layout with %s", (_name, code) => {
      expect(
        localizedViolations(code, layoutTarget, "en").length,
      ).toBeGreaterThan(0);
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
