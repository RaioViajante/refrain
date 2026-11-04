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
  // Memories (M3.6). Added on the M3.6 branch and approved by the owner on
  // 2026-11-03 under this review requirement (no ADR amendment). The create
  // writes a new draft entry that no other transaction can see (L1), like
  // createAlbumJournal. The save writes the title, the body, `memories`, and
  // `memory_music` under the entry lock, and refuses (`memory_published`)
  // before any write when a version is published: no public memory can
  // change without the confirmed save that M3.7 builds, which is the same
  // position saveAlbumJournal held before M2.2 (ADR 0006 § 9). Neither writes
  // a status other than the literal draft of the create.
  "src/modules/journals/memories.ts#createMemory",
  "src/modules/journals/memories.ts#saveMemory",
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

/** An object literal with a spread, whose keys cannot be read. */
function hasSpread(node: ts.ObjectLiteralExpression): boolean {
  return node.properties.some((property) => ts.isSpreadAssignment(property));
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
        // `deleted_at = null`, or a value the scan cannot read (`${x}`).
        if (
          table === "entries" &&
          !/deleted_at\s*=\s*(?:null|\0)/i.test(statement)
        ) {
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
              } else if (hasSpread(value)) {
                reason ??=
                  "writes entries through a spread, which cannot be read";
              } else {
                const deletedAt = objectKeys(value).get("deletedAt");
                // NULL un-deletes. A variable may hold NULL, so it is no better.
                if (
                  deletedAt &&
                  (deletedAt.kind === ts.SyntaxKind.NullKeyword ||
                    ts.isIdentifier(deletedAt))
                ) {
                  reason ??=
                    "sets deleted_at to NULL, or to a value that may be";
                }
              }
            }
          }
          if (table === "album_journals" && !listed) {
            for (const value of args) {
              if (!ts.isObjectLiteralExpression(value)) {
                reason ??=
                  "writes album_journals with a value that cannot be read";
              } else if (
                hasSpread(value) ||
                objectKeys(value).has("ratingHalfSteps")
              ) {
                reason ??= "writes the album rating, or a spread that may";
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
  // M3.2: reads of the predicate for the catalog's artwork guard (gate G8).
  // They write nothing; the second only adds a FOR SHARE lock.
  "isAlbumOnPublicPage",
  "lockAlbumPublicExposure",
  // M3.5: the same for an artist's page, for the photograph guard. They write
  // nothing; the second only adds FOR SHARE locks on the album-journal entries.
  "isArtistOnPublicPage",
  "lockArtistPublicExposure",
  "lockArtistRestoreExposure",
  // The owner's review of PR #46: credits that would expose an artist.
  "lockAlbumCreditExposure",
  "artistsNewlyExposedByCredit",
  // M3.7: types only. A memory's music as the page and the review name it,
  // and the key of one music link in an exposure delta.
  "PublicMemoryArtist",
  "PublicMemoryMusic",
  "MusicLinkKey",
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
  // The Journals wrappers (ADR 0006 § 9: a wrapper of a preview is a preview
  // too). Only the two preview actions reach them (M2.3).
  "previewAlbumJournalChange",
  "previewAlbumJournalPublicChange",
  "previewAlbumJournalPublication",
  // M3.7: the memory wrappers. Only the two memory preview actions reach them.
  "previewMemoryChange",
  "previewMemoryPublicChange",
  "previewMemoryPublication",
];
const CONSUMERS = [
  "publishLanguageVersion",
  "publishAlbumJournalVersion",
  "saveAlbumJournal",
  "requirePublicChangeConfirmation",
  // M3.7
  "publishMemoryVersion",
  "saveMemory",
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
 * `previewPublicChange` in `previewAlbumJournalChange`, and `publishing.ts`
 * wraps the two previews for the studio; no function there calls a preview
 * together with a consumer. Each Server Action that mints a token is alone in
 * its own file (M2.3), so nothing else in a "use server" file can reach it.
 * Adding a file needs review.
 */
export const PREVIEW_IMPORTERS: ReadonlySet<string> = new Set<string>([
  "src/modules/journals/commands.ts",
  "src/modules/journals/publishing.ts",
  "src/modules/journals/studio.ts",
  "src/modules/journals/index.ts",
  "src/app/studio/journals/preview-publication-action.ts",
  "src/app/studio/journals/preview-change-action.ts",
  // M3.7: memories. `memories.ts` wraps `previewPublicChange` in
  // `previewMemoryChange` beside `saveMemory`, as `commands.ts` does for
  // album journals; `memory-publishing.ts` wraps the previews for the studio.
  // Each memory preview action is alone in its own file.
  "src/modules/journals/memories.ts",
  "src/modules/journals/memory-publishing.ts",
  "src/app/studio/memories/preview-publication-action.ts",
  "src/app/studio/memories/preview-change-action.ts",
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

// ---------------------------------------------------------------------------
// Scan 5: who calls the gate, and in what order (ADR 0006 § 9).

const GATE_NAMES = [
  "requirePublicChangeConfirmation",
  "verifyChangeConfirmation",
  "assertWrittenAsPredicted",
];
const GATE_CALLERS: ReadonlySet<string> = new Set([
  "src/modules/journals/commands.ts#saveAlbumJournal",
  // M3.7: the confirmed save of a memory. Already on the writer allowlist
  // (approved by the owner for M3.6); this lets it call the gate it needs.
  "src/modules/journals/memories.ts#saveMemory",
]);
const REFLECTION_WRITERS = ["writeReflection"];

/**
 * Problems with who calls the Publication module's confirmation gate and the
 * one writer of track reflections. Outside the Publication module only
 * `saveAlbumJournal` may call the gate, and it may call `writeReflection`
 * only after `requirePublicChangeConfirmation` appears in it. A new function
 * that writes reflections without the gate is therefore a visible failure,
 * even though the writer scan sees only the writes.
 */
export function gateCallViolations(files: SourceText[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    if (file.path.startsWith("src/modules/publication/")) {
      continue;
    }
    const source = parse(file);
    prepare(source);
    const calls: { name: string; fn: string; at: number }[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        if (
          name &&
          (GATE_NAMES.includes(name) || REFLECTION_WRITERS.includes(name))
        ) {
          calls.push({
            name,
            fn: enclosingFunction(node),
            at: node.getStart(),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    for (const call of calls) {
      const where = `${file.path}#${call.fn}`;
      const allowed = GATE_CALLERS.has(where);
      const definesWriter =
        file.path === "src/modules/journals/reflections.ts" &&
        REFLECTION_WRITERS.includes(call.name);
      if (!allowed && !definesWriter) {
        problems.push(`${where} calls ${call.name}, which only the save may`);
      }
    }
    for (const call of calls.filter((c) =>
      REFLECTION_WRITERS.includes(c.name),
    )) {
      const gate = calls.find(
        (c) =>
          c.fn === call.fn &&
          c.name === "requirePublicChangeConfirmation" &&
          c.at < call.at,
      );
      if (!gate && GATE_CALLERS.has(`${file.path}#${call.fn}`)) {
        problems.push(
          `${file.path}#${call.fn} writes a reflection before the confirmation gate`,
        );
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Scan 6: the confirmation dialogs (ADR 0006 §§ 5 and 9). A dialog holds a
// token and may send it only from its confirm control. The generic scan above
// cannot tell two handlers of one component apart, so this one reads the
// dialogs' own functions by name:
//
//   previewPublicationAction, previewPublicChangeAction   only in fetchPreview
//   publishJournalVersionAction                           only in confirm
//   saveJournalAction                                     only in confirm of the
//                                                         change dialog. The
//                                                         publish dialog saves
//                                                         nothing, so closing
//                                                         a review never
//                                                         leaves a change.
//
// `confirm` never reaches a preview, so nothing previews and consumes in one
// operation; nothing inside a catch handler or an effect,
// timer, or microtask calls any of them; and `confirm` is attached only to
// the confirm control (`onConfirm`).

const DIALOG_FILE = /^src\/app\/studio\/.*-dialog\.tsx$/;
const PREVIEW_ACTIONS = [
  "previewPublicationAction",
  "previewPublicChangeAction",
  // M3.7: memories.
  "previewMemoryPublicationAction",
  "previewMemoryChangeAction",
];
const CONSUMER_ACTIONS = [
  "publishJournalVersionAction",
  "saveJournalAction",
  // M3.7: memories.
  "publishMemoryVersionAction",
  "saveMemoryAction",
];
const ACTION_SITES: Record<string, string[]> = {
  previewPublicationAction: ["fetchPreview"],
  previewPublicChangeAction: ["fetchPreview"],
  publishJournalVersionAction: ["confirm"],
  saveJournalAction: ["confirm"],
  previewMemoryPublicationAction: ["fetchPreview"],
  previewMemoryChangeAction: ["fetchPreview"],
  publishMemoryVersionAction: ["confirm"],
  saveMemoryAction: ["confirm"],
};
// The one file that defines each action.
const ACTION_DEFINITIONS: Record<string, string> = {
  previewPublicationAction:
    "src/app/studio/journals/preview-publication-action.ts",
  previewPublicChangeAction: "src/app/studio/journals/preview-change-action.ts",
  publishJournalVersionAction: "src/app/studio/journals/actions.ts",
  saveJournalAction: "src/app/studio/journals/actions.ts",
  previewMemoryPublicationAction:
    "src/app/studio/memories/preview-publication-action.ts",
  previewMemoryChangeAction: "src/app/studio/memories/preview-change-action.ts",
  publishMemoryVersionAction: "src/app/studio/memories/actions.ts",
  saveMemoryAction: "src/app/studio/memories/actions.ts",
};
// Files that may name each action at all (outside its own definition).
const ACTION_FILES: Record<string, string[]> = {
  previewPublicationAction: ["src/app/studio/journals/publish-dialog.tsx"],
  previewPublicChangeAction: ["src/app/studio/journals/change-dialog.tsx"],
  publishJournalVersionAction: ["src/app/studio/journals/publish-dialog.tsx"],
  saveJournalAction: [
    "src/app/studio/journals/change-dialog.tsx",
    "src/app/studio/journals/journal-editor.tsx",
  ],
  previewMemoryPublicationAction: [
    "src/app/studio/memories/memory-publish-dialog.tsx",
  ],
  previewMemoryChangeAction: [
    "src/app/studio/memories/memory-change-dialog.tsx",
  ],
  publishMemoryVersionAction: [
    "src/app/studio/memories/memory-publish-dialog.tsx",
  ],
  // The ordinary save is the editor's; with a token, only the change dialog's
  // confirm control sends it.
  saveMemoryAction: [
    "src/app/studio/memories/memory-change-dialog.tsx",
    "src/app/studio/memories/memory-editor.tsx",
  ],
};
const DEFERRED = new Set([
  "useEffect",
  "useLayoutEffect",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "requestAnimationFrame",
]);

// Each dialog may import exactly these studio actions and no others, so it
// cannot gain a write (delete, restore, create, privacy, catalog) by an import
// the call-site rules above do not know by name.
const DIALOG_ACTION_IMPORTS: Record<string, string[]> = {
  "src/app/studio/journals/publish-dialog.tsx": [
    "publishJournalVersionAction",
    "previewPublicationAction",
  ],
  "src/app/studio/journals/change-dialog.tsx": [
    "saveJournalAction",
    "previewPublicChangeAction",
  ],
  "src/app/studio/memories/memory-publish-dialog.tsx": [
    "publishMemoryVersionAction",
    "previewMemoryPublicationAction",
  ],
  "src/app/studio/memories/memory-change-dialog.tsx": [
    "saveMemoryAction",
    "previewMemoryChangeAction",
  ],
};
const ACTION_MODULE = /^@\/app\/studio\/.*(actions?|-action)$/;

export function dialogViolations(files: SourceText[]): string[] {
  const problems: string[] = [];
  const guarded = [...PREVIEW_ACTIONS, ...CONSUMER_ACTIONS];
  for (const file of files) {
    if (!file.path.startsWith("src/app/")) {
      continue;
    }
    const source = parse(file);
    prepare(source);
    const isDialog = DIALOG_FILE.test(file.path);

    const visit = (node: ts.Node) => {
      // A dialog imports only its own actions; any other studio action module
      // or name is a way to write that nothing here has reviewed.
      const allowedImports = DIALOG_ACTION_IMPORTS[file.path];
      if (
        allowedImports &&
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        ACTION_MODULE.test(node.moduleSpecifier.text)
      ) {
        const bindings = node.importClause?.namedBindings;
        const names =
          bindings && ts.isNamedImports(bindings)
            ? bindings.elements.map(
                (element) => (element.propertyName ?? element.name).text,
              )
            : ["*"];
        for (const name of names) {
          if (!allowedImports.includes(name)) {
            problems.push(`${file.path} imports ${name}`);
          }
        }
      }
      // A guarded action is only ever called, never aliased or passed on.
      if (
        isDialog &&
        ts.isIdentifier(node) &&
        guarded.includes(node.text) &&
        !ts.isImportSpecifier(node.parent) &&
        !(ts.isCallExpression(node.parent) && node.parent.expression === node)
      ) {
        problems.push(
          `${file.path}: ${node.text} is used without being called`,
        );
      }
      // Where each action may be named at all.
      if (ts.isIdentifier(node) && guarded.includes(node.text)) {
        const defining = file.path === ACTION_DEFINITIONS[node.text];
        if (!defining && !ACTION_FILES[node.text]!.includes(file.path)) {
          problems.push(`${file.path} names ${node.text}`);
        }
      }
      if (isDialog && ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        const fn = handlerOf(node);
        if (name && guarded.includes(name)) {
          if (!ACTION_SITES[name]!.includes(fn)) {
            problems.push(`${file.path}: ${name} is called in ${fn}`);
          }
          for (let up: ts.Node | undefined = node.parent; up; up = up.parent) {
            if (ts.isCatchClause(up)) {
              problems.push(`${file.path}: ${name} is called in a catch`);
            }
            if (ts.isCallExpression(up)) {
              const outer = calleeName(up.expression);
              if (outer && DEFERRED.has(outer)) {
                problems.push(`${file.path}: ${name} is called from ${outer}`);
              }
              if (
                ts.isPropertyAccessExpression(up.expression) &&
                up.expression.name.text === "catch"
              ) {
                problems.push(`${file.path}: ${name} is called in .catch`);
              }
            }
          }
        }
        // The handler that sends anything may not reach a preview.
        if (
          fn === "confirm" &&
          name &&
          (name === "fetchPreview" || PREVIEW_ACTIONS.includes(name))
        ) {
          problems.push(`${file.path}: ${fn} calls ${name}`);
        }
        // Nothing previews from inside a catch handler either.
        if (name === "fetchPreview") {
          for (let up: ts.Node | undefined = node.parent; up; up = up.parent) {
            if (ts.isCatchClause(up)) {
              problems.push(`${file.path}: fetchPreview is called in a catch`);
            }
          }
        }
      }
      // `confirm` is attached only to the confirm control.
      if (
        isDialog &&
        ts.isIdentifier(node) &&
        node.text === "confirm" &&
        !(
          (ts.isFunctionDeclaration(node.parent) &&
            node.parent.name === node) ||
          (ts.isJsxExpression(node.parent) &&
            ts.isJsxAttribute(node.parent.parent) &&
            node.parent.parent.name.getText() === "onConfirm")
        )
      ) {
        problems.push(`${file.path}: confirm is used outside onConfirm`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return problems;
}

// The handler a call belongs to: a function declaration, or a variable such as
// `const fetchPreview = useCallback(async () => …)`, by name. Anything else is
// the component itself, which the rules above do not allow.
function handlerOf(node: ts.Node): string {
  for (let up: ts.Node | undefined = node.parent; up; up = up.parent) {
    if (ts.isFunctionDeclaration(up) && up.name) {
      return up.name.text;
    }
    if (
      ts.isVariableDeclaration(up) &&
      ts.isIdentifier(up.name) &&
      up.initializer !== undefined &&
      (ts.isArrowFunction(up.initializer) ||
        ts.isFunctionExpression(up.initializer) ||
        (ts.isCallExpression(up.initializer) &&
          calleeName(up.initializer.expression) === "useCallback"))
    ) {
      return up.name.text;
    }
  }
  return "<module>";
}
