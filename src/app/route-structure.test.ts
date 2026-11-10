import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// The shape of the route tree (ADR 0008 §§ 2, 3, and 8). Every address the
// application serves is a thin file under `(en)` that names one shared
// implementation and carries the route's literal settings. Authorization and
// reading stay in the implementations, which the other scans check, so a route
// file that did anything else would be outside those scans.

const APP = "src/app";
const ENGLISH = join(APP, "(en)");

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

const english = allFiles(ENGLISH);
const pageFiles = english.filter((file) => /\/page\.tsx$/.test(file));
const nestedLayouts = english.filter(
  (file) => /\/layout\.tsx$/.test(file) && file !== `${ENGLISH}/layout.tsx`,
);

/** `src/app/(en)/(public)/albums/[slug]/page.tsx` to `(public)/albums/[slug]`. */
function directoryOf(file: string): string {
  return file.slice(ENGLISH.length + 1).replace(/\/?(page|layout)\.tsx$/, "");
}

function addressOf(file: string): string {
  const address = directoryOf(file)
    .split("/")
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment))
    .join("/");
  return `/${address}`;
}

function implementationOf(file: string): string {
  const directory = directoryOf(file);
  if (/\/page\.tsx$/.test(file)) {
    return directory === "" ? "home-screen" : `${directory}/screen`;
  }
  return directory === "studio"
    ? "studio/studio-layout"
    : `${directory}/section-layout`;
}

/** What makes a route file more than a delegation, from its syntax tree. */
function thinViolations(code: string, implementation: string): string[] {
  const source = ts.createSourceFile(
    "route.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  let delegations = 0;
  for (const statement of source.statements) {
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
    const isInstantFalse =
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) === true &&
      statement.declarationList.declarations.length === 1 &&
      statement.declarationList.declarations[0]!.name.getText() === "instant" &&
      statement.declarationList.declarations[0]!.initializer?.kind ===
        ts.SyntaxKind.FalseKeyword;
    if (!isInstantFalse) {
      found.push(`has the statement: ${statement.getText().slice(0, 60)}`);
    }
  }
  if (delegations !== 1) {
    found.push(`has ${delegations} delegations`);
  }
  return found;
}

describe("the English route tree", () => {
  it("serves exactly the addresses it served before the move", () => {
    expect(pageFiles.map(addressOf).sort()).toEqual([...PAGES].sort());
  });

  it("finds the routes, so the checks below are not vacuous", () => {
    expect(pageFiles).toHaveLength(34);
    expect(nestedLayouts).toHaveLength(4);
  });

  it.each([...pageFiles, ...nestedLayouts])(
    "%s only delegates to its implementation",
    (file) => {
      const implementation = implementationOf(file);
      expect(
        thinViolations(readFileSync(file, "utf8"), implementation),
      ).toEqual([]);
      expect(existsSync(join(APP, `${implementation}.tsx`)), file).toBe(true);
    },
  );

  it.each(pageFiles)("%s keeps its literal rendering setting", (file) => {
    const settings = /^export const instant = false;$/m.test(
      readFileSync(file, "utf8"),
    );
    expect(settings).toBe(ONE_PASS.includes(addressOf(file)));
  });

  it("keeps route settings out of the implementations, where Next.js would not read them", () => {
    const implementations = allFiles(APP).filter((file) =>
      /(^|\/)(screen|home-screen|section-layout|studio-layout)\.tsx$/.test(
        file,
      ),
    );
    expect(implementations).toHaveLength(38);
    for (const file of implementations) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(SEGMENT_SETTINGS);
    }
  });

  it("has a route file only under (en), apart from the not-found fallback", () => {
    const outside = allFiles(APP).filter(
      (file) => !file.startsWith(`${ENGLISH}/`) && ROUTE_CONVENTION.test(file),
    );
    expect(outside).toEqual([]);
    expect(existsSync(join(APP, "global-not-found.tsx"))).toBe(true);
  });

  it("marks both English documents, and enables the not-found fallback", () => {
    for (const file of [
      `${ENGLISH}/layout.tsx`,
      "src/app/global-not-found.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).toContain('<html lang="en">');
    }
    expect(readFileSync("next.config.ts", "utf8")).toMatch(
      /experimental: \{ globalNotFound: true \}/,
    );
  });

  it("answers a page's own notFound() with the shared view", () => {
    expect(readFileSync(`${ENGLISH}/not-found.tsx`, "utf8")).toContain(
      "<NotFoundView />",
    );
    expect(readFileSync("src/app/global-not-found.tsx", "utf8")).toContain(
      "<NotFoundView />",
    );
  });

  it("does not start the Portuguese tree in this change", () => {
    expect(existsSync(join(APP, "pt"))).toBe(false);
  });

  describe("probes: the delegation rule catches what it is meant to", () => {
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
  });
});
