import { describe, expect, it } from "vitest";

import {
  exportSurfaceViolations,
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
