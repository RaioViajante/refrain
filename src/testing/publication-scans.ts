import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

// Static scans for the publication boundary (ADR 0006 § 9 and § 13, test 14).
// They read production source with the TypeScript syntax tree, never a regular
// expression over whole files, and decide by CALL TARGET: which function
// writes which table, not which key a literal happens to contain (a write may
// be built in a variable). They are tripwires, not proofs: they follow one
// level of indirection, and the behavioral tests are the proof. Every scan has
// probes in publication-boundary.test.ts showing that it catches each form it
// is meant to catch.
//
// "Production code" means everything under src/ except src/testing/, test
// files (*.test.ts, *.spec.ts), and migrations.

export interface SourceText {
  path: string;
  text: string;
}

export function isProductionPath(path: string): boolean {
  return (
    /\.(ts|tsx)$/.test(path) &&
    !/\.(test|spec)\.(ts|tsx)$/.test(path) &&
    !path.startsWith("src/testing/") &&
    !path.startsWith("src/db/migrations/") &&
    !path.endsWith(".d.ts")
  );
}

/** The production files under src/, read from disk. */
export function productionSources(root = "src"): SourceText[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((file) => join(root, file))
    .filter((path) => isProductionPath(path.replaceAll("\\", "/")))
    .map((path) => ({
      path: path.replaceAll("\\", "/"),
      text: readFileSync(path, "utf8"),
    }));
}

function parse(file: SourceText): ts.SourceFile {
  return ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** The name of the nearest named function around `node`, or `<module>`. */
function enclosingFunction(node: ts.Node): string {
  for (let current = node.parent; current; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText();
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent
    ) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
      if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
    }
  }
  return "<module>";
}

// ---------------------------------------------------------------------------
// Scan 1 and 2: who writes what the public sees.

/** Protected tables, by Drizzle name and by SQL name. */
const TABLES: Record<string, string> = {
  entryTexts: "entry_texts",
  entries: "entries",
  albumJournals: "album_journals",
  trackReflections: "track_reflections",
  trackReflectionTexts: "track_reflection_texts",
  memories: "memories",
  memoryMusic: "memory_music",
  entrySlugs: "entry_slugs",
};
const SQL_TABLES = new Set(Object.values(TABLES));

/**
 * The functions allowed to write the public surface (ADR 0006 § 9, "The
 * allowlist is explicit"). Adding a name needs review. Each key is
 * `path#function`.
 */
export const WRITER_ALLOWLIST: ReadonlySet<string> = new Set([
  // The Publication commands.
  "src/modules/publication/publish.ts#markVersionPublished",
  "src/modules/publication/commands.ts#unpublishLanguageVersion",
  "src/modules/publication/commands.ts#restoreDeletedEntry",
  "src/modules/publication/commands.ts#changeEntrySlug",
  "src/modules/publication/commands.ts#reserveInitialSlug",
  "src/modules/publication/commands.ts#retireEntrySlugs",
  // Writes a new draft entry that no other transaction can see (L1).
  "src/modules/journals/commands.ts#createAlbumJournal",
  // The confirmed save (ADR 0006 § 5): it writes the text columns, the album
  // rating, and (through writeReflection) the track reflections, only after
  // the Publication module's gate.
  "src/modules/journals/commands.ts#saveAlbumJournal",
  // The one writer of track_reflections and track_reflection_texts. Called
  // only by saveAlbumJournal, under the entry lock, after the gate.
  "src/modules/journals/reflections.ts#writeReflection",
  // An explicit, author-only deletion that cascades through foreign keys.
  "src/modules/journals/commands.ts#permanentlyDeleteEntry",
]);

/**
 * The only functions that may write language versions in SQL: the three
 * Publication commands that change a status. (Not every Publication
 * command: `changeEntrySlug` has no business writing `entry_texts`.)
 */
const STATUS_WRITERS: ReadonlySet<string> = new Set([
  "src/modules/publication/publish.ts#markVersionPublished",
  "src/modules/publication/commands.ts#unpublishLanguageVersion",
  "src/modules/publication/commands.ts#restoreDeletedEntry",
]);

/** The only function that may set a version to `published`. */
const PUBLISH_WRITERS: ReadonlySet<string> = new Set([
  "src/modules/publication/publish.ts#markVersionPublished",
]);

// Names bound in the file being scanned: `import { sql as q }`, `const t =
// schema.entryTexts`, `const { entryTexts: t } = schema`, and aliases of any
// imported function. Set by `prepare` before each file is scanned.
interface FileContext {
  sqlNames: Set<string>;
  tables: Map<string, string>;
  aliases: Map<string, string>;
}
let ctx: FileContext = {
  sqlNames: new Set(["sql"]),
  tables: new Map(),
  aliases: new Map(),
};

function prepare(source: ts.SourceFile): void {
  const next: FileContext = {
    sqlNames: new Set(["sql"]),
    tables: new Map(),
    aliases: new Map(),
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportSpecifier(node) && node.propertyName) {
      next.aliases.set(node.name.text, node.propertyName.text);
      if (node.propertyName.text === "sql") {
        next.sqlNames.add(node.name.text);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        const table = referencedTable(node.initializer);
        if (table) {
          next.tables.set(node.name.text, table);
        }
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const original = (element.propertyName ?? element.name).getText();
          if (original in TABLES && ts.isIdentifier(element.name)) {
            next.tables.set(element.name.text, TABLES[original]!);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  ctx = next;
}

/** What a call's callee is named, with import aliases resolved. */
function calleeName(callee: ts.Expression): string | null {
  if (ts.isIdentifier(callee)) {
    return ctx.aliases.get(callee.text) ?? callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  return null;
}

/** `sql.raw` builds constants for table definitions here, and nowhere else. */
const SQL_RAW_ALLOWED_FILES: ReadonlySet<string> = new Set([
  "src/db/schema.ts",
]);

export interface Write {
  path: string;
  fn: string;
  table: string;
  form: "drizzle" | "sql" | "dynamic-sql" | "identifier-sql";
  /** Why it is a violation when it is one. */
  reason?: string;
}

const WRITE_VERB =
  /\b(?:update\s+(?:only\s+)?|insert\s+into\s+|delete\s+from\s+)(?:"?public"?\.)?"?([a-z_]+)"?/gi;

function referencedTable(node: ts.Expression): string | null {
  const name = ts.isIdentifier(node)
    ? node.text
    : ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) &&
          ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
  return name && name in TABLES ? TABLES[name]! : null;
}

function tableOfReference(node: ts.Expression | undefined): string | null {
  if (!node) {
    return null;
  }
  if (ts.isIdentifier(node) && ctx.tables.has(node.text)) {
    return ctx.tables.get(node.text)!;
  }
  return referencedTable(node);
}

function isSqlTag(node: ts.Expression): boolean {
  return ts.isIdentifier(node) && ctx.sqlNames.has(node.text);
}

// The text of an SQL template, with each substitution replaced by `\0` so a
// verb followed by a substitution (a dynamic table name) is visible.
function sqlTextOf(node: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return (
    node.head.text +
    node.templateSpans.map((s) => `\0${s.literal.text}`).join("")
  );
}

function objectKeys(
  node: ts.ObjectLiteralExpression,
): Map<string, ts.Expression> {
  const keys = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && property.name) {
      keys.set(
        property.name.getText().replace(/^["']|["']$/g, ""),
        property.initializer,
      );
    } else if (ts.isShorthandPropertyAssignment(property)) {
      keys.set(property.name.text, property.name);
    }
  }
  return keys;
}

// The value passed to `.set(...)` or `.values(...)` in the chain that starts
// at `.update/.insert(table)`.
function chainArguments(call: ts.CallExpression): ts.Expression[] {
  const found: ts.Expression[] = [];
  let node: ts.Node = call;
  while (node.parent) {
    const parent: ts.Node = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      const outer = parent.parent;
      if (ts.isCallExpression(outer) && outer.expression === parent) {
        if (
          ["set", "values"].includes(parent.name.text) &&
          outer.arguments[0]
        ) {
          found.push(outer.arguments[0]);
        }
        if (parent.name.text === "onConflictDoUpdate" && outer.arguments[0]) {
          // The update half of an upsert: its `set`, or the whole argument
          // when it cannot be read.
          const argument = outer.arguments[0];
          const set = ts.isObjectLiteralExpression(argument)
            ? objectKeys(argument).get("set")
            : undefined;
          found.push(set ?? argument);
        }
        node = outer;
        continue;
      }
    }
    break;
  }
  return found;
}

// A variable's declared type, if it is written out as an object type: the
// names of its properties.
function declaredPropertyNames(
  identifier: ts.Identifier,
  scope: ts.Node,
): string[] | null {
  let names: string[] | null = null;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === identifier.text &&
      node.type &&
      ts.isTypeLiteralNode(node.type)
    ) {
      names = node.type.members.flatMap((member) =>
        member.name ? [member.name.getText()] : [],
      );
    }
    ts.forEachChild(node, visit);
  };
  let outer: ts.Node = scope;
  while (outer.parent && !ts.isSourceFile(outer)) {
    outer = outer.parent;
  }
  visit(outer);
  return names;
}

const FORBIDDEN_STATUS_KEYS = new Set([
  "status",
  "publishedAt",
  "firstPublishedAt",
]);

// What a write of `entry_texts` by a function that is not a Publication
// command may contain: an object literal, or a variable whose declared type
// has no status or publication time; and a status only as the literal "draft"
// of an insert.
function checkEntryTextValue(
  value: ts.Expression,
  verb: string,
  scope: ts.Node,
): string | null {
  if (ts.isObjectLiteralExpression(value)) {
    // A spread or a computed key can carry a status that no reading finds.
    const opaque = value.properties.find(
      (property) =>
        ts.isSpreadAssignment(property) ||
        (property.name !== undefined &&
          ts.isComputedPropertyName(property.name)),
    );
    if (opaque) {
      return "writes an object with a spread or computed key, which cannot be checked";
    }
    for (const [key, initializer] of objectKeys(value)) {
      if (!FORBIDDEN_STATUS_KEYS.has(key)) {
        continue;
      }
      const isDraft =
        key === "status" &&
        verb === "insert" &&
        ts.isStringLiteralLike(initializer) &&
        initializer.text === "draft";
      if (!isDraft) {
        return `writes ${key} outside the Publication commands`;
      }
    }
    return null;
  }
  if (ts.isIdentifier(value)) {
    const names = declaredPropertyNames(value, scope);
    if (names === null) {
      return `writes a value (${value.text}) whose type is not declared, so it cannot be checked`;
    }
    const bad = names.find((name) => FORBIDDEN_STATUS_KEYS.has(name));
    return bad ? `writes a value whose declared type has ${bad}` : null;
  }
  return "writes a value that is neither an object literal nor a typed variable";
}

/** Finds every write to a protected table, and says which are violations. */
export function writerViolations(files: SourceText[]): Write[] {
  const violations: Write[] = [];

  for (const file of files) {
    const source = parse(file);
    prepare(source);
    const record = (node: ts.Node, write: Omit<Write, "path" | "fn">) => {
      const fn = enclosingFunction(node);
      const allowed = WRITER_ALLOWLIST.has(`${file.path}#${fn}`);
      const full: Write = { path: file.path, fn, ...write };
      if (!allowed) {
        violations.push({
          ...full,
          reason: full.reason ?? "is not on the writer allowlist",
        });
      } else if (full.reason) {
        violations.push(full);
      }
    };

    const checkSqlText = (node: ts.Node, text: string) => {
      for (const match of text.matchAll(WRITE_VERB)) {
        const table = match[1]!.toLowerCase();
        if (!SQL_TABLES.has(table)) {
          continue;
        }
        const statement = text.slice(match.index);
        if (table === "entries" && !/deleted_at\s*=\s*null/i.test(statement)) {
          continue;
        }
        if (
          table === "album_journals" &&
          !/rating_half_steps/i.test(statement)
        ) {
          continue;
        }
        let reason: string | undefined;
        const fn = enclosingFunction(node);
        if (
          table === "entry_texts" &&
          !STATUS_WRITERS.has(`${file.path}#${fn}`)
        ) {
          reason =
            "writes language versions in SQL outside the Publication commands";
        }
        record(node, { table, form: "sql", reason });
      }
      // `update ${table}` or `update entry_${part}`: a dynamic table name
      // cannot be resolved by reading.
      if (
        /(?:update|insert\s+into|delete\s+from)\s+(?:only\s+)?[a-z_"]*\0/i.test(
          text,
        )
      ) {
        record(node, {
          table: "?",
          form: "dynamic-sql",
          reason: "writes to a table named by a substitution",
        });
      }
      // A status assigned to 'published' in SQL anywhere else.
      if (
        /(?:\bset|,)\s+status\s*=\s*'published'/i.test(text) &&
        !PUBLISH_WRITERS.has(`${file.path}#${enclosingFunction(node)}`)
      ) {
        record(node, {
          table: "entry_texts",
          form: "sql",
          reason: "sets a version to published outside markVersionPublished",
        });
      }
    };

    const visit = (node: ts.Node) => {
      // Drizzle: db.update(schema.table).set(...), .insert, .delete.
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ["update", "insert", "delete"].includes(node.expression.name.text)
      ) {
        const table = tableOfReference(node.arguments[0]);
        if (table) {
          const verb = node.expression.name.text;
          const fn = enclosingFunction(node);
          let reason: string | undefined;
          const args = chainArguments(node);

          if (
            table === "entry_texts" &&
            !STATUS_WRITERS.has(`${file.path}#${fn}`)
          ) {
            for (const value of args) {
              reason ??= checkEntryTextValue(value, verb, node) ?? undefined;
            }
            if (verb === "delete") {
              reason ??=
                "deletes language versions outside the Publication commands";
            }
          }
          // Writes of `entries` and `album_journals` are violations only when
          // they un-delete or touch the rating; the allowlisted functions
          // that do so on purpose (restoring, creating) are exempt.
          const listed = WRITER_ALLOWLIST.has(`${file.path}#${fn}`);
          const narrow = table === "entries" || table === "album_journals";
          if (table === "entries" && !listed) {
            for (const value of args) {
              if (!ts.isObjectLiteralExpression(value)) {
                reason ??= "writes entries with a value that cannot be read";
              } else if (
                objectKeys(value).get("deletedAt")?.kind ===
                ts.SyntaxKind.NullKeyword
              ) {
                reason ??= "sets deleted_at to NULL";
              }
            }
          }
          if (table === "album_journals" && !listed) {
            for (const value of args) {
              if (!ts.isObjectLiteralExpression(value)) {
                reason ??=
                  "writes album_journals with a value that cannot be read";
              } else if (objectKeys(value).has("ratingHalfSteps")) {
                reason ??= "writes the album rating";
              }
            }
          }
          if (!narrow || reason) {
            record(node, { table, form: "drizzle", reason });
          }
        }
      }

      // SQL text in a template tagged `sql`, or a plain string handed to
      // `.query`, `.execute`, or `.raw`.
      if (ts.isTaggedTemplateExpression(node) && isSqlTag(node.tag)) {
        checkSqlText(node, sqlTextOf(node.template));
        // `update ${sql.identifier("entry_texts")}`.
        if (ts.isTemplateExpression(node.template)) {
          const spans = node.template.templateSpans;
          const heads = [
            node.template.head.text,
            ...spans.map((s) => s.literal.text),
          ];
          spans.forEach((span, index) => {
            const call = span.expression;
            if (
              ts.isCallExpression(call) &&
              ts.isPropertyAccessExpression(call.expression) &&
              call.expression.name.text === "identifier" &&
              call.arguments[0] !== undefined &&
              ts.isStringLiteralLike(call.arguments[0]) &&
              SQL_TABLES.has(call.arguments[0].text) &&
              /(?:update|insert\s+into|delete\s+from)\s*$/i.test(heads[index]!)
            ) {
              record(node, {
                table: call.arguments[0].text,
                form: "identifier-sql",
              });
            }
          });
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ["query", "execute", "raw"].includes(node.expression.name.text)
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) {
          checkSqlText(node, argument.text);
        } else if (argument && ts.isTemplateExpression(argument)) {
          checkSqlText(node, sqlTextOf(argument));
        }
      }

      // sql.raw(...) builds SQL from a string that no scan can resolve.
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        isSqlTag(node.expression.expression) &&
        node.expression.name.text === "raw" &&
        !SQL_RAW_ALLOWED_FILES.has(file.path)
      ) {
        record(node, {
          table: "?",
          form: "dynamic-sql",
          reason: "uses sql.raw, whose text cannot be resolved by reading",
        });
      }

      // A status of "published" in an object literal, in any form.
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText().replace(/^["']|["']$/g, "") === "status" &&
        ts.isStringLiteralLike(node.initializer) &&
        node.initializer.text === "published" &&
        !PUBLISH_WRITERS.has(`${file.path}#${enclosingFunction(node)}`)
      ) {
        record(node, {
          table: "entry_texts",
          form: "drizzle",
          reason: 'builds a value with status: "published"',
        });
      }

      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Scan 3: the export surface of the Publication module.

/** The functions that make a version published. Never exported. */
const PUBLISHING_WRITERS = ["markVersionPublished"];

/** What `src/modules/publication/index.ts` may export, by name. */
export const PUBLICATION_INDEX_EXPORTS: ReadonlySet<string> = new Set([
  "changeEntrySlug",
  "PublicationError",
  "reserveInitialSlug",
  "restoreDeletedEntry",
  "retireEntrySlugs",
  "unpublishLanguageVersion",
  "PublicationFailure",
  "DisclosedMusicLink",
  "DisclosedReflection",
  "PublishDisclosure",
  "previewPublication",
  "publishLanguageVersion",
  "PublishPreview",
  "assertWrittenAsPredicted",
  "previewPublicChange",
  "requirePublicChangeConfirmation",
  "verifyChangeConfirmation",
  "PublicChangePreview",
  "ExposureChange",
  "ExposureSubject",
  "ProposedChange",
  "ProposedReflection",
  "ProposedText",
  "PublicChangeDelta",
  "getPublicLanguageVersion",
  "listPublicLanguageVersions",
  "listPublicTrackReflections",
  "resolvePresentedJournal",
  "resolvePublicSlug",
  "JournalSubject",
  "PresentedJournal",
  "PublicLanguageVersion",
  "PublicLanguageVersionSummary",
  "PublicTrackReflection",
  "SlugResolution",
  "isNormalizedSlug",
  "MAX_SLUG_LENGTH",
  "normalizeSlug",
  "suffixSlug",
]);

function localCalls(body: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name) {
        names.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return names;
}

function topLevelFunctions(source: ts.SourceFile): Map<string, ts.Node> {
  const functions = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        ) {
          functions.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }
  return functions;
}

function isExported(statement: ts.Node): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

/** Problems with what the Publication module exports. */
export function exportSurfaceViolations(files: SourceText[]): string[] {
  const problems: string[] = [];
  const moduleFiles = files.filter((file) =>
    file.path.startsWith("src/modules/publication/"),
  );

  for (const file of moduleFiles) {
    const source = parse(file);
    prepare(source);
    const functions = topLevelFunctions(source);

    const exported = new Set<string>();
    for (const statement of source.statements) {
      if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isVariableStatement(statement)) &&
        isExported(statement)
      ) {
        if (ts.isFunctionDeclaration(statement) && statement.name) {
          exported.add(statement.name.text);
        } else if (ts.isVariableStatement(statement)) {
          statement.declarationList.declarations.forEach((d) =>
            exported.add(d.name.getText()),
          );
        }
      }
      if (ts.isExportDeclaration(statement)) {
        if (!statement.exportClause) {
          problems.push(
            `${file.path} uses "export *", which hides what it exports`,
          );
        } else if (ts.isNamedExports(statement.exportClause)) {
          statement.exportClause.elements.forEach((element) =>
            exported.add((element.propertyName ?? element.name).text),
          );
        }
      }
      if (
        ts.isExportAssignment(statement) ||
        (ts.canHaveModifiers(statement) &&
          (ts.getModifiers(statement) ?? []).some(
            (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
          ))
      ) {
        problems.push(`${file.path} has a default export`);
      }
    }

    for (const writer of PUBLISHING_WRITERS) {
      if (exported.has(writer)) {
        problems.push(`${file.path} exports ${writer}, the write of published`);
      }
    }

    // Every function that writes status = 'published' is a publishing writer,
    // by what it contains and not by its name.
    const writers = new Set(PUBLISHING_WRITERS);
    for (const [name, node] of functions) {
      let writes = false;
      const visit = (child: ts.Node) => {
        if (ts.isTaggedTemplateExpression(child) && isSqlTag(child.tag)) {
          if (
            /(?:\bset|,)\s+status\s*=\s*'published'/i.test(
              sqlTextOf(child.template),
            )
          ) {
            writes = true;
          }
        }
        ts.forEachChild(child, visit);
      };
      visit(node);
      if (writes) {
        writers.add(name);
        if (exported.has(name)) {
          problems.push(
            `${file.path} exports ${name}, which sets a version to published`,
          );
        }
      }
    }

    // No exported function other than the checked command can reach a writer.
    const reaches = (start: string, seen = new Set<string>()): boolean => {
      if (seen.has(start)) {
        return false;
      }
      seen.add(start);
      const node = functions.get(start);
      if (!node) {
        return false;
      }
      for (const called of localCalls(node)) {
        if (writers.has(called) || reaches(called, seen)) {
          return true;
        }
      }
      return false;
    };
    for (const name of exported) {
      if (name !== "publishLanguageVersion" && reaches(name)) {
        problems.push(
          `${file.path} exports ${name}, which can reach a write of published`,
        );
      }
    }
  }

  const index = moduleFiles.find(
    (file) => file.path === "src/modules/publication/index.ts",
  );
  if (index) {
    const source = parse(index);
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause) {
        if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            if (!PUBLICATION_INDEX_EXPORTS.has(element.name.text)) {
              problems.push(
                `src/modules/publication/index.ts exports ${element.name.text}, which is not on the reviewed list`,
              );
            }
          }
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Scan 4: no application code mints a token and consumes it in one operation.

const MINTING_PREVIEWS = [
  "previewPublication",
  "previewPublicChange",
  // The Journals wrapper of previewPublicChange (ADR 0006 § 9: the wrapper
  // is a preview too, and no action reaches it until M2.3).
  "previewAlbumJournalChange",
];
const CONSUMERS = [
  "publishLanguageVersion",
  "saveAlbumJournal",
  "requirePublicChangeConfirmation",
];
const SIGNING = "signConfirmation";

/**
 * Production files that import from src/testing/ on purpose, with the one
 * module each may import. The backup tool refuses to run against anything but
 * a disposable database by reusing the test database's safety check; it
 * touches no token helper. Adding a pair needs review.
 */
export const TESTING_IMPORT_ALLOWLIST: Readonly<Record<string, string>> = {
  "src/ops/backup.ts": "@/testing/test-database",
};

/**
 * Files allowed to import a preview. The Journals commands wrap
 * `previewPublicChange` in `previewAlbumJournalChange`, which no function
 * there calls together with the save, and which no Server Action reaches
 * until M2.3 adds the actions. Adding a file needs review.
 */
export const PREVIEW_IMPORTERS: ReadonlySet<string> = new Set<string>([
  "src/modules/journals/commands.ts",
]);

function importsOf(
  source: ts.SourceFile,
): { specifier: string; names: string[] }[] {
  const found: { specifier: string; names: string[] }[] = [];
  for (const statement of source.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const names: string[] = [];
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.name) {
          names.push(clause.name.text);
        }
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          clause.namedBindings.elements.forEach((e) =>
            names.push((e.propertyName ?? e.name).text),
          );
        }
        if (
          clause?.namedBindings &&
          ts.isNamespaceImport(clause.namedBindings)
        ) {
          names.push("*");
        }
      } else if (
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        statement.exportClause.elements.forEach((e) =>
          names.push((e.propertyName ?? e.name).text),
        );
      } else {
        names.push("*");
      }
      found.push({ specifier: statement.moduleSpecifier.text, names });
    }
  }
  return found;
}

/** Every function in a file, with what it calls directly and through local helpers. */
function functionCalls(source: ts.SourceFile) {
  const direct = new Map<string, Set<string>>();
  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      const name =
        ts.isArrowFunction(node) || ts.isFunctionExpression(node)
          ? enclosingFunctionOfFunction(node)
          : (node.name?.getText() ?? "<anonymous>");
      const calls = direct.get(name) ?? new Set<string>();
      localCalls(node).forEach((called) => calls.add(called));
      direct.set(name, calls);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return direct;
}

function enclosingFunctionOfFunction(node: ts.Node): string {
  const parent = node.parent;
  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text;
  }
  return enclosingFunction(node);
}

/** Problems with how previews, tokens, and their consumers are used. */
export function mintConsumeViolations(files: SourceText[]): string[] {
  const problems: string[] = [];

  for (const file of files) {
    const inPublication = file.path.startsWith("src/modules/publication/");
    const inIdentity = file.path.startsWith("src/modules/identity/");
    const source = parse(file);
    prepare(source);

    // Only the Publication module signs a token, and only in a preview.
    const visitSign = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        calleeName(node.expression) === SIGNING
      ) {
        const fn = enclosingFunction(node);
        if (!inPublication || !MINTING_PREVIEWS.includes(fn)) {
          problems.push(
            `${file.path} calls ${SIGNING} in ${fn}, which is not a preview`,
          );
        }
      }
      ts.forEachChild(node, visitSign);
    };
    if (!inIdentity) {
      visitSign(source);
    }

    // Nothing in production imports the test helpers that mint tokens.
    for (const imported of importsOf(source)) {
      if (
        (/^@\/testing(\/|$)/.test(imported.specifier) ||
          /(^|\/)testing(\/|$)/.test(imported.specifier)) &&
        TESTING_IMPORT_ALLOWLIST[file.path] !== imported.specifier
      ) {
        problems.push(
          `${file.path} imports ${imported.specifier}, which is test support`,
        );
      }
      if (
        imported.specifier.startsWith("@/modules/identity") &&
        imported.names.includes(SIGNING) &&
        !inPublication
      ) {
        problems.push(
          `${file.path} imports ${SIGNING} outside the Publication module`,
        );
      }
      if (
        !inPublication &&
        !PREVIEW_IMPORTERS.has(file.path) &&
        imported.names.some((name) => MINTING_PREVIEWS.includes(name)) &&
        /^@\/modules\/(publication|journals)/.test(imported.specifier)
      ) {
        problems.push(
          `${file.path} imports a preview, which only its own action may`,
        );
      }
    }

    if (inIdentity) {
      continue;
    }

    // No function previews and consumes: directly, or through a local helper.
    const direct = functionCalls(source);
    for (const [name, calls] of direct) {
      // Everything it can reach through helpers defined in the same file.
      const reachable = new Set(calls);
      const queue = [...calls];
      while (queue.length > 0) {
        for (const inner of direct.get(queue.pop()!) ?? []) {
          if (!reachable.has(inner)) {
            reachable.add(inner);
            queue.push(inner);
          }
        }
      }
      const minted = MINTING_PREVIEWS.filter((preview) =>
        reachable.has(preview),
      );
      // A consumer that itself previews is a mint-and-consume too: it never
      // appears among its own callees, so it counts as reaching itself.
      const consumed = CONSUMERS.filter(
        (consumer) => reachable.has(consumer) || consumer === name,
      );
      if (minted.length > 0 && consumed.length > 0) {
        problems.push(
          `${file.path}: ${name} calls ${minted.join(", ")} and ${consumed.join(", ")}`,
        );
      }
    }

    // No function catches a refusal and calls the same command again, or
    // mints a token in the handler.
    const visitRetry = (node: ts.Node) => {
      if (ts.isTryStatement(node) && node.catchClause) {
        const tried = localCalls(node.tryBlock);
        const handled = localCalls(node.catchClause.block);
        const again = [...CONSUMERS, ...MINTING_PREVIEWS].filter(
          (name) =>
            handled.has(name) &&
            (tried.has(name) || CONSUMERS.some((c) => tried.has(c))),
        );
        if (again.length > 0) {
          problems.push(
            `${file.path}: ${enclosingFunction(node)} catches a refusal and calls ${again.join(", ")} again`,
          );
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "catch" &&
        node.arguments[0]
      ) {
        const handled = localCalls(node.arguments[0]);
        const tried = localCalls(node.expression.expression);
        const again = [...CONSUMERS, ...MINTING_PREVIEWS].filter(
          (name) =>
            handled.has(name) &&
            (tried.has(name) || CONSUMERS.some((c) => tried.has(c))),
        );
        if (again.length > 0) {
          problems.push(
            `${file.path}: ${enclosingFunction(node)} catches a refusal with .catch and calls ${again.join(", ")} again`,
          );
        }
      }
      ts.forEachChild(node, visitRetry);
    };
    visitRetry(source);
  }
  return problems;
}
