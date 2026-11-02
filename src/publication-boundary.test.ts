import { describe, expect, it } from "vitest";

import {
  dialogViolations,
  exportSurfaceViolations,
  gateCallViolations,
  isProductionPath,
  mintConsumeViolations,
  productionSources,
  writerViolations,
  type SourceText,
} from "@/testing/publication-scans";

// ADR 0006 § 9 and § 13 (test 14): the static scans, run on the real
// production source, and probes showing that each catches each form it is
// meant to catch. A scan that cannot fail proves nothing.

const production = productionSources();

const journals = "src/modules/journals/commands.ts";
const elsewhere = "src/modules/journals/other.ts";

function file(path: string, text: string): SourceText {
  return { path, text };
}

function writers(path: string, text: string) {
  return writerViolations([file(path, text)]).map(
    (write) => `${write.fn}: ${write.reason}`,
  );
}

describe("the production source is clean", () => {
  it("includes the files that matter, and no test support", () => {
    const paths = production.map((source) => source.path);
    expect(paths).toContain("src/modules/publication/publish.ts");
    expect(paths).toContain("src/modules/journals/commands.ts");
    expect(paths.some((path) => path.startsWith("src/testing/"))).toBe(false);
    expect(paths.some((path) => /\.test\./.test(path))).toBe(false);
    expect(paths.some((path) => path.includes("migrations"))).toBe(false);
    expect(production.length).toBeGreaterThan(50);
  });

  it("has exactly the allowlisted writers of what the public sees", () => {
    expect(writerViolations(production)).toEqual([]);
  });

  it("exports no way to publish without a token", () => {
    expect(exportSurfaceViolations(production)).toEqual([]);
  });

  it("never mints a token and consumes it in one operation", () => {
    expect(mintConsumeViolations(production)).toEqual([]);
  });

  it("lets only the save call the confirmation gate and the reflection writer, in order", () => {
    expect(gateCallViolations(production)).toEqual([]);
  });

  it("keeps the confirmation dialogs to their own handlers", () => {
    expect(dialogViolations(production)).toEqual([]);
  });

  it("classifies test files and test support as not production", () => {
    for (const path of [
      "src/testing/publishing.ts",
      "src/x/y.test.ts",
      "src/x/y.integration.test.ts",
      "src/db/migrations/0001.sql",
      "src/app/x.spec.tsx",
    ]) {
      expect(isProductionPath(path)).toBe(false);
    }
    expect(isProductionPath("src/modules/a/b.ts")).toBe(true);
    expect(isProductionPath("src/app/studio/page.tsx")).toBe(true);
  });
});

describe("the writer scan catches each way of writing what the public sees", () => {
  it("catches a status written in SQL text", () => {
    expect(
      writers(
        elsewhere,
        "export async function evil(tx) { await tx.execute(sql`update entry_texts set status = 'published' where entry_id = ${id}`); }",
      ),
    ).not.toEqual([]);
  });

  it("catches a status written through Drizzle", () => {
    expect(
      writers(
        elsewhere,
        'export async function evil(tx) { await tx.update(schema.entryTexts).set({ status: "published" }); }',
      ),
    ).not.toEqual([]);
  });

  it("catches a status written through a variable, even in an allowlisted function", () => {
    expect(
      writers(
        journals,
        'export async function saveAlbumJournal(tx) { const changes = { status: "published" }; await tx.update(schema.entryTexts).set(changes); }',
      ),
    ).not.toEqual([]);
    expect(
      writers(
        journals,
        "export async function saveAlbumJournal(tx) { const changes: { status?: string } = {}; await tx.update(schema.entryTexts).set(changes); }",
      ),
    ).not.toEqual([]);
    expect(
      writers(
        journals,
        "export async function saveAlbumJournal(tx, changes) { await tx.update(schema.entryTexts).set(changes); }",
      ),
    ).not.toEqual([]);
  });

  it("catches a publication time written by an allowlisted function that is not a Publication command", () => {
    expect(
      writers(
        journals,
        "export async function saveAlbumJournal(tx) { await tx.update(schema.entryTexts).set({ publishedAt: new Date() }); }",
      ),
    ).not.toEqual([]);
  });

  it("catches raw SQL, a dynamic table name, and an identifier-built table", () => {
    expect(
      writers(elsewhere, "export function evil() { return sql.raw(text); }"),
    ).not.toEqual([]);
    expect(
      writers(
        elsewhere,
        "export async function evil(tx, table) { await tx.execute(sql`update ${table} set x = 1`); }",
      ),
    ).not.toEqual([]);
    expect(
      writers(
        elsewhere,
        'export async function evil(tx) { await tx.execute(sql`update ${sql.identifier("entry_texts")} set x = 1`); }',
      ),
    ).not.toEqual([]);
    expect(
      writers(
        elsewhere,
        "export async function evil(tx) { await tx.execute(sql`delete from entry_texts`); }",
      ),
    ).not.toEqual([]);
    expect(
      writers(
        elsewhere,
        "export async function evil(tx) { await tx.execute(sql`insert into entry_texts (entry_id) values (1) on conflict do update set status = 'published'`); }",
      ),
    ).not.toEqual([]);
  });

  it("catches an un-delete, in Drizzle and in SQL", () => {
    expect(
      writers(
        elsewhere,
        "export async function evil(tx) { await tx.update(schema.entries).set({ deletedAt: null }); }",
      ),
    ).not.toEqual([]);
    expect(
      writers(
        elsewhere,
        "export async function evil(tx) { await tx.execute(sql`update entries set deleted_at = null where id = ${id}`); }",
      ),
    ).not.toEqual([]);
  });

  it("catches a write of the rest of the public surface", () => {
    for (const body of [
      "tx.insert(schema.trackReflections).values(x)",
      "tx.update(schema.trackReflectionTexts).set(x)",
      "tx.delete(schema.memoryMusic)",
      "tx.update(schema.memories).set(x)",
      "tx.update(schema.entrySlugs).set(x)",
      "tx.update(schema.albumJournals).set({ ratingHalfSteps: 3 })",
      "tx.execute(sql`update album_journals set rating_half_steps = 3`)",
      "tx.execute(sql`update entry_slugs set was_published = true`)",
      "tx.execute(sql`delete from track_reflections`)",
    ]) {
      expect(
        writers(elsewhere, `export async function evil(tx) { await ${body}; }`),
        body,
      ).not.toEqual([]);
    }
  });

  it("allows the draft a new journal starts as, and nothing else from that function", () => {
    expect(
      writers(
        journals,
        'export async function createAlbumJournal(tx) { await tx.insert(schema.entryTexts).values({ entryId: 1, status: "draft", body: x }); }',
      ),
    ).toEqual([]);
    expect(
      writers(
        journals,
        'export async function createAlbumJournal(tx) { await tx.insert(schema.entryTexts).values({ entryId: 1, status: "private" }); }',
      ),
    ).not.toEqual([]);
    expect(
      writers(
        journals,
        'export async function saveAlbumJournal(tx) { await tx.update(schema.entryTexts).set({ status: "draft" }); }',
      ),
    ).not.toEqual([]);
  });

  it("allows the save to write text through a typed variable without a status", () => {
    expect(
      writers(
        journals,
        "export async function saveAlbumJournal(tx) { const changes: { opening?: string; body?: unknown; bodyText?: string } = {}; await tx.update(schema.entryTexts).set(changes); }",
      ),
    ).toEqual([]);
  });

  it("allows reading, and prose that mentions a verb", () => {
    expect(
      writers(
        elsewhere,
        'export async function ok(tx) { await tx.execute(sql`select * from entry_texts`); await tx.select().from(schema.entryTexts); const message = "Could not update entries"; return message; }',
      ),
    ).toEqual([]);
  });

  it("holds the Publication commands to the same list", () => {
    const wrong = "src/modules/publication/other.ts";
    expect(
      writers(
        wrong,
        "export async function sneaky(tx) { await tx.execute(sql`update entry_texts set status = 'published'`); }",
      ),
    ).not.toEqual([]);
    expect(
      writers(
        "src/modules/publication/publish.ts",
        "async function markVersionPublished(tx) { await tx.execute(sql`update entry_texts set status = 'published'`); }",
      ),
    ).toEqual([]);
  });
});

describe("the scans resist the evasions an independent review found", () => {
  it.each([
    [
      "a table aliased to a variable",
      "const t = schema.entryTexts; await tx.update(t).set(x);",
    ],
    [
      "a table destructured from the schema",
      "const { entryTexts: t } = schema; await tx.update(t).set(x);",
    ],
    [
      "a table named by element access",
      "await tx.update(schema['entryTexts']).set(x);",
    ],
    [
      "sql imported under another name",
      "await tx.execute(q`update entry_texts set status = 'published'`);",
    ],
    [
      "a plain string handed to query",
      "await pool.query(\"update entry_texts set status = 'published'\");",
    ],
    [
      "a plain string handed to execute",
      'await tx.execute("delete from entry_texts");',
    ],
    [
      "a table name built around a substitution",
      "await tx.execute(sql`update entry_${part} set x = 1`);",
    ],
    [
      "an upsert whose update half sets a status",
      'await tx.insert(schema.entryTexts).values({ status: "draft" }).onConflictDoUpdate({ target: x, set: { status: "published" } });',
    ],
    [
      "an upsert whose update half cannot be read",
      "await tx.insert(schema.entryTexts).values({}).onConflictDoUpdate(config);",
    ],
  ])("catches %s", (_name, body) => {
    const source = body.includes("q`")
      ? `import { sql as q } from "drizzle-orm";\n`
      : "";
    expect(
      writers(elsewhere, `${source}export async function evil(tx) { ${body} }`),
      body,
    ).not.toEqual([]);
  });

  it("catches an upsert inside the allowlisted create, which may insert only a draft", () => {
    expect(
      writers(
        journals,
        'export async function createAlbumJournal(tx) { await tx.insert(schema.entryTexts).values({ status: "draft" }).onConflictDoUpdate({ target: x, set: { status: s } }); }',
      ),
    ).not.toEqual([]);
  });

  it("holds the other Publication commands to not writing language versions at all", () => {
    expect(
      writers(
        "src/modules/publication/commands.ts",
        "export async function changeEntrySlug(tx, s) { await tx.execute(sql`update entry_texts set status = ${s}`); }",
      ),
    ).not.toEqual([]);
    expect(
      writers(
        "src/modules/publication/commands.ts",
        "export async function restoreDeletedEntry(tx, s) { await tx.execute(sql`update entry_texts set status = 'private'`); }",
      ),
    ).toEqual([]);
    expect(
      writers(
        "src/modules/publication/commands.ts",
        "export async function restoreDeletedEntry(tx, s) { await tx.execute(sql`update entry_texts set status = 'published'`); }",
      ),
    ).not.toEqual([]);
  });

  describe("in the mint-and-consume scan", () => {
    const wrapper = "src/modules/journals/wrapper.ts";

    it("sees through renamed imports", () => {
      expect(
        mintConsumeViolations([
          file(
            wrapper,
            'import { previewPublication as pp, publishLanguageVersion as pl } from "@/modules/publication";\nexport async function f(db, a, i) { const p = await pp(db, a, i); return pl(db, a, p); }',
          ),
        ]),
      ).not.toEqual([]);
      expect(
        mintConsumeViolations([
          file(
            "src/modules/publication/publish.ts",
            'import { signConfirmation as sign } from "@/modules/identity";\nexport async function sneaky() { return sign(a, b); }',
          ),
        ]),
      ).not.toEqual([]);
    });

    it("follows helpers more than one level deep", () => {
      expect(
        mintConsumeViolations([
          file(
            wrapper,
            "async function one(db, a, i) { return previewPublication(db, a, i); }\nasync function two(db, a, i) { return one(db, a, i); }\nexport async function f(db, a, i) { await two(db, a, i); return publishLanguageVersion(db, a, i); }",
          ),
        ]),
      ).not.toEqual([]);
    });
  });
});

describe("the mint-and-consume scan covers the studio's wrappers (M2.3)", () => {
  const action = "src/app/studio/journals/some-action.ts";
  const previewAction = "src/app/studio/journals/preview-publication-action.ts";
  const imports = (...names: string[]) =>
    `import { ${names.join(", ")} } from "@/modules/journals";\n`;

  it("catches an action that previews and publishes in one operation", () => {
    expect(
      mintConsumeViolations([
        file(
          previewAction,
          imports(
            "previewAlbumJournalPublication",
            "publishAlbumJournalVersion",
          ) +
            "export async function both(a, i) { const p = await previewAlbumJournalPublication(a, i); return publishAlbumJournalVersion(a, { ...i, confirmation: p.confirmation }); }",
        ),
      ]),
    ).not.toEqual([]);
  });

  it("catches a save that previews its own change and saves it", () => {
    expect(
      mintConsumeViolations([
        file(
          "src/app/studio/journals/preview-change-action.ts",
          imports("previewAlbumJournalPublicChange", "saveAlbumJournal") +
            "export async function both(a, i) { const p = await previewAlbumJournalPublicChange(a, i); return saveAlbumJournal(a, { ...i, confirmation: p.confirmation }); }",
        ),
      ]),
    ).not.toEqual([]);
  });

  it("catches a publish action that catches a refusal and tries again", () => {
    expect(
      mintConsumeViolations([
        file(
          action,
          imports("publishAlbumJournalVersion") +
            "export async function again(a, i) { try { return await publishAlbumJournalVersion(a, i); } catch { return publishAlbumJournalVersion(a, i); } }",
        ),
      ]),
    ).not.toEqual([]);
  });

  it("lets only the two preview actions import a preview wrapper", () => {
    for (const name of [
      "previewAlbumJournalPublication",
      "previewAlbumJournalPublicChange",
    ]) {
      expect(
        mintConsumeViolations([file(action, imports(name))]),
        name,
      ).not.toEqual([]);
      expect(
        mintConsumeViolations([file(previewAction, imports(name))]),
        name,
      ).toEqual([]);
    }
  });

  it("keeps a plain consumer in its own file without complaint", () => {
    expect(
      mintConsumeViolations([
        file(
          "src/app/studio/journals/actions.ts",
          imports("publishAlbumJournalVersion") +
            "export async function publish(a, i) { return publishAlbumJournalVersion(a, i); }",
        ),
      ]),
    ).toEqual([]);
  });
});

describe("the export-surface scan catches each way of reaching the write", () => {
  const publish = "src/modules/publication/publish.ts";
  const index = "src/modules/publication/index.ts";
  const writer =
    "async function markVersionPublished(tx) { await tx.execute(sql`update entry_texts set status = 'published'`); }\n";

  it("accepts the writer kept private behind the checked command", () => {
    expect(
      exportSurfaceViolations([
        file(
          publish,
          `${writer}export async function publishLanguageVersion(tx) { await markVersionPublished(tx); }`,
        ),
      ]),
    ).toEqual([]);
  });

  it("catches the writer exported, directly or by a re-export", () => {
    expect(
      exportSurfaceViolations([file(publish, `export ${writer}`)]),
    ).not.toEqual([]);
    expect(
      exportSurfaceViolations([
        file(publish, `${writer}export { markVersionPublished };`),
      ]),
    ).not.toEqual([]);
    expect(
      exportSurfaceViolations([
        file(index, 'export { markVersionPublished } from "./publish";'),
      ]),
    ).not.toEqual([]);
  });

  it("catches a writer under another name, found by what it contains", () => {
    expect(
      exportSurfaceViolations([
        file(
          publish,
          "export async function quietlyPublish(tx) { await tx.execute(sql`update entry_texts set status = 'published'`); }",
        ),
      ]),
    ).not.toEqual([]);
  });

  it("catches another exported function that can reach the writer", () => {
    expect(
      exportSurfaceViolations([
        file(
          publish,
          `${writer}export async function sneaky(tx) { await markVersionPublished(tx); }`,
        ),
      ]),
    ).not.toEqual([]);
    expect(
      exportSurfaceViolations([
        file(
          publish,
          `${writer}async function helper(tx) { await markVersionPublished(tx); }\nexport async function sneaky(tx) { await helper(tx); }`,
        ),
      ]),
    ).not.toEqual([]);
  });

  it("catches `export *`, a default export, and an export nobody reviewed", () => {
    expect(
      exportSurfaceViolations([file(index, 'export * from "./publish";')]),
    ).not.toEqual([]);
    expect(
      exportSurfaceViolations([file(publish, "export default function () {}")]),
    ).not.toEqual([]);
    expect(
      exportSurfaceViolations([
        file(index, 'export { somethingNew } from "./publish";'),
      ]),
    ).not.toEqual([]);
  });
});

describe("the mint-and-consume scan catches each way of simulating an acknowledgement", () => {
  const wrapper = "src/modules/journals/wrapper.ts";

  it("accepts a preview alone, and the command alone", () => {
    expect(
      mintConsumeViolations([
        file(
          "src/modules/publication/publish.ts",
          "export async function previewPublication() { return signConfirmation(a, b); }\nexport async function publishLanguageVersion() {}",
        ),
      ]),
    ).toEqual([]);
    expect(
      mintConsumeViolations([
        file(
          wrapper,
          'import { publishLanguageVersion } from "@/modules/publication";\nexport async function publishWrapper(db, author, input) { return publishLanguageVersion(db, author, input); }',
        ),
      ]),
    ).toEqual([]);
  });

  it("catches a function that previews and then publishes", () => {
    expect(
      mintConsumeViolations([
        file(
          wrapper,
          "export async function publishWrapper(db, a, i) { const p = await previewPublication(db, a, i); return publishLanguageVersion(db, a, { ...i, confirmation: p.confirmation }); }",
        ),
      ]),
    ).not.toEqual([]);
  });

  it("catches it through a local helper, and as a method or an arrow", () => {
    expect(
      mintConsumeViolations([
        file(
          wrapper,
          "async function ask(db, a, i) { return previewPublication(db, a, i); }\nexport async function publishWrapper(db, a, i) { const p = await ask(db, a, i); return publishLanguageVersion(db, a, p); }",
        ),
      ]),
    ).not.toEqual([]);
    expect(
      mintConsumeViolations([
        file(
          wrapper,
          "export const both = async (db, a, i) => { await publication.previewPublication(db, a, i); await publication.publishLanguageVersion(db, a, i); };",
        ),
      ]),
    ).not.toEqual([]);
  });

  it("catches a catch that retries the command, and one that mints and retries", () => {
    expect(
      mintConsumeViolations([
        file(
          wrapper,
          "export async function retry(db, a, i) { try { return await publishLanguageVersion(db, a, i); } catch (e) { return publishLanguageVersion(db, a, i); } }",
        ),
      ]),
    ).not.toEqual([]);
    expect(
      mintConsumeViolations([
        file(
          wrapper,
          "export async function retry(db, a, i) { try { return await publishLanguageVersion(db, a, i); } catch (e) { const p = await previewPublication(db, a, i); return p; } }",
        ),
      ]),
    ).not.toEqual([]);
    expect(
      mintConsumeViolations([
        file(
          wrapper,
          "export async function retry(db, a, i) { return publishLanguageVersion(db, a, i).catch(() => publishLanguageVersion(db, a, i)); }",
        ),
      ]),
    ).not.toEqual([]);
  });

  it("catches signing outside a preview, and outside the Publication module", () => {
    expect(
      mintConsumeViolations([
        file(
          "src/modules/publication/publish.ts",
          "export async function mintOnTheSide() { return signConfirmation(a, b); }",
        ),
      ]),
    ).not.toEqual([]);
    expect(
      mintConsumeViolations([
        file(
          wrapper,
          'import { signConfirmation } from "@/modules/identity";\nexport function f() { return signConfirmation(a, b); }',
        ),
      ]),
    ).not.toEqual([]);
  });

  it("catches production code importing test support, and a preview imported where it must not be", () => {
    expect(
      mintConsumeViolations([
        file(wrapper, 'import { publishForTest } from "@/testing";'),
      ]),
    ).not.toEqual([]);
    expect(
      mintConsumeViolations([
        file(
          "src/app/studio/x.ts",
          'import { mintTestToken } from "@/testing/confirmation";',
        ),
      ]),
    ).not.toEqual([]);
    expect(
      mintConsumeViolations([
        file(
          wrapper,
          'import { previewPublication } from "@/modules/publication";',
        ),
      ]),
    ).not.toEqual([]);
  });
});

describe("the scans catch mutations of the real source", () => {
  // The probes above use small snippets. These change the real files, the way
  // a careless edit would, and require the right scan to notice.
  function changed(path: string, change: (text: string) => string) {
    const target = production.find((source) => source.path === path);
    expect(target, path).toBeDefined();
    const text = change(target!.text);
    expect(text).not.toBe(target!.text);
    return production.map((source) =>
      source.path === path ? { path, text } : source,
    );
  }

  it("catches the write of published being exported", () => {
    const files = changed("src/modules/publication/publish.ts", (text) =>
      text.replace(
        "async function markVersionPublished(",
        "export async function markVersionPublished(",
      ),
    );
    expect(exportSurfaceViolations(files)).not.toEqual([]);
  });

  it("catches the write of published being re-exported from the index", () => {
    const files = changed("src/modules/publication/index.ts", (text) =>
      text.replace(
        "export {\n  previewPublication,",
        'export { markVersionPublished } from "./publish";\nexport {\n  previewPublication,',
      ),
    );
    expect(exportSurfaceViolations(files)).not.toEqual([]);
  });

  it("catches a wrapper that previews and then publishes", () => {
    const files = changed(
      "src/modules/journals/commands.ts",
      (text) =>
        `${text}\nexport async function publishAlbumJournal(db: never, author: never, input: never) {\n  const preview = await previewPublication(db, author, input);\n  return publishLanguageVersion(db, author, { confirmation: preview.confirmation });\n}\n`,
    );
    expect(mintConsumeViolations(files)).not.toEqual([]);
  });

  it("catches an action that catches confirmation_required and retries with a token it obtained", () => {
    const files = changed(
      "src/modules/journals/commands.ts",
      (text) =>
        `${text}\nexport async function saveAndPublish(db: never, author: never, input: never) {\n  try {\n    return await publishLanguageVersion(db, author, input);\n  } catch {\n    const preview = await previewPublication(db, author, input);\n    return publishLanguageVersion(db, author, { confirmation: preview.confirmation });\n  }\n}\n`,
    );
    expect(mintConsumeViolations(files)).not.toEqual([]);
  });

  it("catches the save writing a status, directly or through a spread", () => {
    for (const replacement of [
      '.set({ status: "published" })',
      ".set({ ...changes, status: draftOrPublished })",
    ]) {
      const files = changed("src/modules/journals/commands.ts", (text) =>
        text.replace(".set(changes)", replacement),
      );
      expect(writerViolations(files), replacement).not.toEqual([]);
    }
  });

  it("catches a new writer of reflections in the Journals module", () => {
    const files = changed(
      "src/modules/journals/commands.ts",
      (text) =>
        `${text}\nexport async function flagReflection(tx: never) {\n  await (tx as never as { update: (t: unknown) => { set: (v: unknown) => unknown } }).update(schema.trackReflections).set({ isPublished: true });\n}\n`,
    );
    expect(writerViolations(files)).not.toEqual([]);
  });

  it("catches the checked publish previewing its own token", () => {
    const files = changed("src/modules/publication/publish.ts", (text) =>
      text.replace(
        "  const data = parse(publishInput, input);\n  if (!confirmationAvailable()) {",
        "  const data = parse(publishInput, input);\n  await previewPublication(db, author, data);\n  if (!confirmationAvailable()) {",
      ),
    );
    expect(mintConsumeViolations(files)).not.toEqual([]);
  });

  it("catches the confirmed save previewing its own token", () => {
    const files = changed("src/modules/journals/commands.ts", (text) =>
      text.replace(
        "const change = await prepareChange(tx, data, journal);",
        "const change = await prepareChange(tx, data, journal);\n      await previewPublicChange(tx, author, { entryId: data.entryId, expectedVersion: data.expectedVersion, change });",
      ),
    );
    expect(mintConsumeViolations(files)).not.toEqual([]);
  });

  it("catches a studio action that retries a refused save with a token it previewed", () => {
    const files = changed(
      "src/app/studio/journals/actions.ts",
      (text) =>
        `${text}\nexport async function saveAndConfirm(author: never, input: never) {\n  try {\n    return await saveAlbumJournal(author, input);\n  } catch {\n    const preview = await previewAlbumJournalChange(author, input);\n    return saveAlbumJournal(author, { ...(input as object), confirmation: preview.confirmation } as never);\n  }\n}\n`,
    );
    expect(mintConsumeViolations(files)).not.toEqual([]);
  });

  it("catches a studio file importing the wrapper of a preview", () => {
    expect(
      mintConsumeViolations([
        file(
          "src/app/studio/journals/actions.ts",
          'import { previewAlbumJournalChange } from "@/modules/journals";',
        ),
      ]),
    ).not.toEqual([]);
  });

  it("catches a second writer of the track reflections, and a reflection write outside its one writer", () => {
    for (const text of [
      "export async function sneaky(tx) { await tx.insert(schema.trackReflectionTexts).values({}); }",
      "export async function sneaky(tx) { await tx.execute(sql`update track_reflections set is_published = true`); }",
      "export async function sneaky(tx) { await tx.delete(schema.trackReflectionTexts); }",
    ]) {
      expect(writers("src/modules/journals/other.ts", text), text).not.toEqual(
        [],
      );
    }
    // The one writer is the named function in its own file, and nothing else.
    const write =
      "export async function writeReflection(tx) { await tx.insert(schema.trackReflectionTexts).values({}); }";
    expect(writers("src/modules/journals/reflections.ts", write)).toEqual([]);
    expect(writers("src/modules/journals/commands.ts", write)).not.toEqual([]);
  });

  it("catches a second caller of the reflection writer, and a write before the gate", () => {
    const second = changed(
      "src/modules/journals/commands.ts",
      (text) =>
        `${text}\nexport async function flagEverything(tx: never, id: string) {\n  await writeReflection(tx, id, id, { trackId: id, isPublished: true });\n}\n`,
    );
    expect(gateCallViolations(second)).not.toEqual([]);
    const early = changed("src/modules/journals/commands.ts", (text) =>
      text.replace(
        "const change = await prepareChange(tx, data, journal);",
        "const change = await prepareChange(tx, data, journal);\n      await writeReflection(tx, data.entryId, journal.albumId, change.reflections![0]!);",
      ),
    );
    expect(gateCallViolations(early)).not.toEqual([]);
  });

  it("catches the gate called from somewhere else, such as a studio action", () => {
    const files = changed(
      "src/app/studio/journals/actions.ts",
      (text) =>
        `${text}\nexport async function sneak(tx: never, a: never) {\n  await requirePublicChangeConfirmation(tx, a, {} as never);\n}\n`,
    );
    expect(gateCallViolations(files)).not.toEqual([]);
  });

  it("catches an un-delete or a rating written through a variable, a spread, or SQL with a placeholder", () => {
    for (const text of [
      "export async function evil(tx, v) { await tx.update(schema.entries).set({ deletedAt: v }); }",
      "export async function evil(tx, base) { await tx.update(schema.entries).set({ ...base }); }",
      "export async function evil(tx, patch) { await tx.update(schema.albumJournals).set({ ...patch }); }",
      "export async function evil(tx, v) { await tx.execute(sql`update entries set deleted_at = ${v} where id = 1`); }",
    ]) {
      expect(writers("src/modules/journals/other.ts", text), text).not.toEqual(
        [],
      );
    }
    // Setting it to now() is a deletion, not an un-delete.
    expect(
      writers(
        "src/modules/journals/other.ts",
        "export async function ok(tx) { await tx.update(schema.entries).set({ deletedAt: sql`now()` }); }",
      ),
    ).toEqual([]);
  });

  it("catches signing a token anywhere but a preview", () => {
    const files = changed("src/modules/publication/publish.ts", (text) =>
      text.replace(
        "export async function publishLanguageVersion(",
        "const sneakySign = () => signConfirmation;\nexport async function publishLanguageVersion(",
      ),
    );
    // A reference is not a call; calling it is what the scan forbids.
    const called = changed("src/modules/publication/publish.ts", (text) =>
      text.replace(
        "  const data = parse(publishInput, input);",
        "  signConfirmation(author, {} as never);\n  const data = parse(publishInput, input);",
      ),
    );
    expect(files).toBeDefined();
    expect(mintConsumeViolations(called)).not.toEqual([]);
  });

  it("lets only the backup tool import the disposable-database check", () => {
    expect(
      mintConsumeViolations([
        file(
          "src/ops/backup.ts",
          'import { x } from "@/testing/test-database";',
        ),
      ]),
    ).toEqual([]);
    expect(
      mintConsumeViolations([
        file(
          "src/modules/journals/commands.ts",
          'import { x } from "@/testing/test-database";',
        ),
      ]),
    ).not.toEqual([]);
  });
});

describe("the dialog scan catches each way a dialog could send a token wrongly", () => {
  const dialog = "src/app/studio/journals/publish-dialog.tsx";
  const wrap = (body: string) =>
    `import { publishJournalVersionAction, saveJournalAction } from "@/app/studio/journals/actions";\nimport { previewPublicationAction } from "@/app/studio/journals/preview-publication-action";\nexport function D() {\n${body}\n return <B onConfirm={confirm} />; }`;
  const check = (body: string) => dialogViolations([file(dialog, wrap(body))]);

  it("accepts the shape the dialog has", () => {
    expect(
      check(
        "async function fetchPreview() { return previewPublicationAction({}); }\nasync function confirm() { return publishJournalVersionAction({ confirmation: t }); }\nasync function stopShowing() { return saveJournalAction({}); }",
      ),
    ).toEqual([]);
  });

  it("catches a confirm that previews, directly or through the helper", () => {
    expect(
      check(
        "async function fetchPreview() { return previewPublicationAction({}); }\nasync function confirm() { const p = await previewPublicationAction({}); return publishJournalVersionAction({ confirmation: p.confirmation }); }",
      ),
    ).not.toEqual([]);
    expect(
      check(
        "async function fetchPreview() { return previewPublicationAction({}); }\nasync function confirm() { const p = await fetchPreview(); return publishJournalVersionAction({ confirmation: p }); }",
      ),
    ).not.toEqual([]);
  });

  it("catches a retry in a catch handler, and a send from an effect or a timer", () => {
    expect(
      check(
        "async function confirm() { try { await publishJournalVersionAction({}); } catch { await publishJournalVersionAction({}); } }",
      ),
    ).not.toEqual([]);
    expect(
      check(
        "useEffect(() => { void publishJournalVersionAction({}); }, []);\nasync function confirm() {}",
      ),
    ).not.toEqual([]);
    expect(
      check(
        "async function confirm() { setTimeout(() => publishJournalVersionAction({}), 10); }",
      ),
    ).not.toEqual([]);
    expect(
      check(
        "async function confirm() { publishJournalVersionAction({}).catch(() => publishJournalVersionAction({})); }",
      ),
    ).not.toEqual([]);
  });

  it("catches a preview or a consumer in a handler that is not its own", () => {
    expect(
      check(
        "async function other() { return publishJournalVersionAction({}); }\nasync function confirm() {}",
      ),
    ).not.toEqual([]);
    expect(
      check(
        "async function other() { return previewPublicationAction({}); }\nasync function confirm() {}",
      ),
    ).not.toEqual([]);
  });

  it("catches a removal that sends a confirmation, and a confirm handed to anything but the confirm control", () => {
    expect(
      check(
        "async function stopShowing() { return saveJournalAction({ confirmation: t }); }\nasync function confirm() {}",
      ),
    ).not.toEqual([]);
    expect(
      check(
        "async function confirm() {}\nuseEffect(() => { void confirm(); }, []);",
      ),
    ).not.toEqual([]);
  });

  it("catches an action named in a file that is not allowed to", () => {
    expect(
      dialogViolations([
        file(
          "src/app/studio/journals/page-thing.tsx",
          'import { publishJournalVersionAction } from "@/app/studio/journals/actions";\nexport const x = publishJournalVersionAction;',
        ),
      ]),
    ).not.toEqual([]);
  });
});
