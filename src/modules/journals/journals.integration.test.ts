import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Transaction } from "@/db";
import {
  captureFailure,
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestArtistJournal,
  createTestMemory,
  inScratchTransaction,
  rowsAdded,
  type CountedTable,
  testAuthor,
} from "@/testing";
import { listPublicLanguageVersions } from "@/modules/publication";

import { textToDocument } from "./body";
import {
  createAlbumJournal,
  deleteAlbumJournal,
  permanentlyDeleteEntry,
  saveAlbumJournal,
  setAlbumJournalPrivacy,
} from "./commands";
import { JournalError, type JournalFailure } from "./errors";
import {
  getAlbumJournal,
  getJournalStatistics,
  listAlbumJournals,
  listDeletedAlbumJournals,
} from "./queries";

const author = testAuthor();
const MISSING = "00000000-0000-4000-8000-00000000dead";

async function failure(
  tx: Transaction,
  work: (db: Transaction) => Promise<unknown>,
): Promise<JournalFailure | undefined> {
  const error = await captureFailure(tx, work);
  if (error === undefined) {
    return undefined;
  }
  expect(error).toBeInstanceOf(JournalError);
  return (error as JournalError).failure;
}

// Rows a test added to a table, whatever other suites left committed.
const rows = (tx: Transaction, table: CountedTable) => rowsAdded(tx, table);

async function setUp(tx: Transaction, title = "[Test] Grace") {
  const artistId = await createTestArtist(tx, "[Test] Artist");
  const album = await createTestAlbum(tx, { title, artistIds: [artistId] });
  return { ...album, artistId };
}

describe("creating an album journal", () => {
  it("creates one draft entry with its language version, subtype row, and slug", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const created = await createAlbumJournal(tx, author, {
        albumId,
        locale: "pt-BR",
        opening: "  [Test] An opening.  ",
        body: "[Test] First paragraph.\nSecond line.\n\n[Test] Second paragraph.",
      });
      expect(created.version).toBe(1);

      const journal = await getAlbumJournal(tx, author, created.entryId);
      expect(journal).toMatchObject({
        entryId: created.entryId,
        albumId,
        albumTitle: "[Test] Grace",
        artistNames: "[Test] Artist",
        locale: "pt-BR",
        status: "draft",
        opening: "[Test] An opening.",
        body: "[Test] First paragraph.\nSecond line.\n\n[Test] Second paragraph.",
        wordCount: 8,
        version: 1,
        deletedAt: null,
        slug: "test-grace",
        versions: [{ locale: "pt-BR", isOriginal: true, status: "draft" }],
      });

      // The accepted storage format: a document and its plain-text projection.
      const [text] = await tx
        .select()
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, created.entryId));
      expect(text?.body).toEqual(
        textToDocument(
          "[Test] First paragraph.\nSecond line.\n\n[Test] Second paragraph.",
        ),
      );
      expect(text?.bodyText).toBe(
        "[Test] First paragraph.\nSecond line.\n\n[Test] Second paragraph.",
      );
      expect(text).toMatchObject({
        isOriginal: true,
        status: "draft",
        publishedAt: null,
        firstPublishedAt: null,
        title: null,
      });

      const [entry] = await tx
        .select()
        .from(schema.entries)
        .where(eq(schema.entries.id, created.entryId));
      expect(entry).toMatchObject({
        kind: "album_journal",
        deletedAt: null,
        firstPublishedAt: null,
      });
      const slugs = await tx
        .select()
        .from(schema.entrySlugs)
        .where(eq(schema.entrySlugs.entryId, created.entryId));
      expect(slugs).toEqual([
        expect.objectContaining({
          kind: "album_journal",
          slug: "test-grace",
          isCurrent: true,
          wasPublished: false,
        }),
      ]);
    });
  });

  it("is never public: nothing is published, featured, or visible to public queries", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const { entryId } = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "[Test] Secret",
      });
      const [journal] = await tx
        .select()
        .from(schema.albumJournals)
        .where(eq(schema.albumJournals.entryId, entryId));
      expect(journal?.isFeatured).toBe(false);
      expect(await listPublicLanguageVersions(tx, entryId)).toEqual([]);
    });
  });

  it("allows an empty draft and stores no document for it", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const { entryId } = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "  \n\n ",
      });
      const [text] = await tx
        .select()
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, entryId));
      expect(text).toMatchObject({ body: null, bodyText: "", opening: null });
      expect((await getAlbumJournal(tx, author, entryId))?.wordCount).toBe(0);
    });
  });

  it("allows several independent journals for the same album, with distinct slugs", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx, "Grace");
      const slugs: string[] = [];
      for (let index = 0; index < 3; index++) {
        const { entryId } = await createAlbumJournal(tx, author, {
          albumId,
          locale: "en",
          body: `[Test] Journal ${index}`,
        });
        slugs.push((await getAlbumJournal(tx, author, entryId))!.slug!);
      }
      expect(slugs).toEqual(["grace", "grace-2", "grace-3"]);
      expect(await listAlbumJournals(tx, author, { albumId })).toHaveLength(3);
    });
  });

  it("falls back to a generic slug for a title with no usable characters", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx, "日本語");
      const { entryId } = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "x",
      });
      expect((await getAlbumJournal(tx, author, entryId))?.slug).toBe(
        "journal",
      );
    });
  });

  it("refuses an unknown or archived album and writes nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      expect(
        await failure(tx, (db) =>
          createAlbumJournal(db, author, {
            albumId: MISSING,
            locale: "en",
            body: "",
          }),
        ),
      ).toBe("album_not_found");
      await tx.execute(
        sql`update albums set archived_at = now() where id = ${albumId}`,
      );
      expect(
        await failure(tx, (db) =>
          createAlbumJournal(db, author, { albumId, locale: "en", body: "" }),
        ),
      ).toBe("album_archived");
      expect(await rows(tx, "entries")).toBe(0);
      expect(await rows(tx, "entry_slugs")).toBe(0);
    });
  });

  it("rejects invalid input with fixed field codes", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const cases: [Record<string, unknown>, string][] = [
        [{ albumId: "nope", locale: "en" }, "albumId"],
        [{ albumId, locale: "fr" }, "locale"],
        [{ albumId }, "locale"],
        [{ albumId, locale: "en", opening: "x".repeat(301) }, "opening"],
        [{ albumId, locale: "en", body: "x".repeat(100_001) }, "body"],
        [{ albumId, locale: "en", body: 5 }, "body"],
      ];
      for (const [input, field] of cases) {
        const error = await captureFailure(tx, (db) =>
          createAlbumJournal(db, author, input),
        );
        expect(error, JSON.stringify(input).slice(0, 80)).toBeInstanceOf(
          JournalError,
        );
        expect((error as JournalError).failure).toBe("invalid_input");
        expect(
          Object.keys((error as JournalError).details.fields ?? {}),
        ).toContain(field);
      }
      expect(await rows(tx, "entries")).toBe(0);
    });
  });

  it("stores markup as plain text and never as structure", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const hostile =
        "<img src=x onerror=alert(1)>\n\n<script>1</script> \"quoted\" 'single'";
      const { entryId } = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        opening: "<b>opening</b>",
        body: hostile,
      });
      const journal = await getAlbumJournal(tx, author, entryId);
      expect(journal?.body).toBe(hostile);
      expect(journal?.opening).toBe("<b>opening</b>");
    });
  });

  it("rolls back every row when the entry cannot be completed", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      // Fill every slug candidate, so the reservation fails after the entry,
      // its version, and its subtype row were inserted.
      const taken = await createTestAlbumJournal(tx, { albumId });
      await tx.insert(schema.entrySlugs).values(
        Array.from({ length: 100 }, (_, index) => ({
          kind: "album_journal" as const,
          slug: index === 0 ? "test-grace" : `test-grace-${index + 1}`,
          entryId: taken,
          isCurrent: false,
        })),
      );
      const before = {
        entries: await rows(tx, "entries"),
        texts: await rows(tx, "entry_texts"),
        journals: await rows(tx, "album_journals"),
        slugs: await rows(tx, "entry_slugs"),
      };
      expect(
        await failure(tx, (db) =>
          createAlbumJournal(db, author, { albumId, locale: "en", body: "x" }),
        ),
      ).toBe("slug_unavailable");
      expect({
        entries: await rows(tx, "entries"),
        texts: await rows(tx, "entry_texts"),
        journals: await rows(tx, "album_journals"),
        slugs: await rows(tx, "entry_slugs"),
      }).toEqual(before);
    });
  });
});

describe("saving an album journal", () => {
  async function createDraft(tx: Transaction, body = "[Test] Draft") {
    const { albumId } = await setUp(tx);
    const { entryId } = await createAlbumJournal(tx, author, {
      albumId,
      locale: "en",
      opening: "[Test] Opening",
      body,
    });
    return entryId;
  }

  it("edits the draft, bumps the version, and keeps paragraph breaks", async () => {
    await inScratchTransaction(async (tx) => {
      const entryId = await createDraft(tx);
      const text =
        "[Test] One.\nStill one.\n\n[Test] Two.\n\n\n\n[Test] Three.  ";
      const saved = await saveAlbumJournal(tx, author, {
        entryId,
        expectedVersion: 1,
        opening: "[Test] New opening",
        body: text,
      });
      expect(saved.version).toBe(2);

      const journal = await getAlbumJournal(tx, author, entryId);
      expect(journal).toMatchObject({
        version: 2,
        opening: "[Test] New opening",
        body: "[Test] One.\nStill one.\n\n[Test] Two.\n\n[Test] Three.",
        status: "draft",
      });

      // Saving the text the editor shows again changes nothing about it.
      await saveAlbumJournal(tx, author, {
        entryId,
        expectedVersion: 2,
        opening: journal!.opening,
        body: journal!.body,
      });
      expect((await getAlbumJournal(tx, author, entryId))?.body).toBe(
        journal!.body,
      );
    });
  });

  it("can clear the writing", async () => {
    await inScratchTransaction(async (tx) => {
      const entryId = await createDraft(tx);
      await saveAlbumJournal(tx, author, {
        entryId,
        expectedVersion: 1,
        opening: "",
        body: "",
      });
      const [text] = await tx
        .select()
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, entryId));
      expect(text).toMatchObject({ body: null, bodyText: "", opening: null });
    });
  });

  it("refuses a stale save and changes nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const entryId = await createDraft(tx, "[Test] Original");
      await saveAlbumJournal(tx, author, {
        entryId,
        expectedVersion: 1,
        body: "[Test] Written in the first tab",
      });
      expect(
        await failure(tx, (db) =>
          saveAlbumJournal(db, author, {
            entryId,
            expectedVersion: 1,
            body: "[Test] Written in the second tab",
          }),
        ),
      ).toBe("version_conflict");
      expect(
        await failure(tx, (db) =>
          saveAlbumJournal(db, author, {
            entryId,
            expectedVersion: 99,
            body: "x",
          }),
        ),
      ).toBe("version_conflict");
      const journal = await getAlbumJournal(tx, author, entryId);
      expect(journal?.body).toBe("[Test] Written in the first tab");
      expect(journal?.version).toBe(2);
    });
  });

  it("never changes visibility, the slug, or the featured state", async () => {
    await inScratchTransaction(async (tx) => {
      const entryId = await createDraft(tx);
      await setAlbumJournalPrivacy(tx, author, {
        entryId,
        locale: "en",
        status: "private",
      });
      await saveAlbumJournal(tx, author, {
        entryId,
        expectedVersion: 1,
        body: "[Test] x",
      });
      const journal = await getAlbumJournal(tx, author, entryId);
      expect(journal).toMatchObject({ status: "private", slug: "test-grace" });
    });
  });

  it("refuses unknown entries, entries of another kind, and deleted entries", async () => {
    await inScratchTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const artistJournal = await createTestArtistJournal(tx, { artistId });
      const memory = await createTestMemory(tx);
      for (const entryId of [MISSING, artistJournal, memory]) {
        expect(
          await failure(tx, (db) =>
            saveAlbumJournal(db, author, {
              entryId,
              expectedVersion: 1,
              body: "x",
            }),
          ),
        ).toBe("entry_not_found");
      }
      // The other entries were not touched.
      const texts = await tx
        .select({ bodyText: schema.entryTexts.bodyText })
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, memory));
      expect(texts[0]?.bodyText).toBe("[Test] Body");

      const entryId = await createDraft(tx);
      await deleteAlbumJournal(tx, author, entryId);
      expect(
        await failure(tx, (db) =>
          saveAlbumJournal(db, author, {
            entryId,
            expectedVersion: 1,
            body: "x",
          }),
        ),
      ).toBe("entry_deleted");
    });
  });

  it("leaves stored formatting it cannot represent untouched", async () => {
    await inScratchTransaction(async (tx) => {
      const entryId = await createDraft(tx);
      const rich = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "[Test] Heading" }],
          },
        ],
      };
      await tx
        .update(schema.entryTexts)
        .set({ body: rich, bodyText: "[Test] Heading" })
        .where(eq(schema.entryTexts.entryId, entryId));

      expect(
        await failure(tx, (db) =>
          saveAlbumJournal(db, author, {
            entryId,
            expectedVersion: 1,
            body: "flattened",
          }),
        ),
      ).toBe("unsupported_content");
      const [text] = await tx
        .select()
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, entryId));
      expect(text?.body).toEqual(rich);
      // The studio shows it as unavailable rather than as flattened text.
      expect((await getAlbumJournal(tx, author, entryId))?.body).toBeNull();
    });
  });

  it("leaves a stored document untouched unless the plain editor would reproduce it exactly", async () => {
    const p = (value: string) => ({
      type: "paragraph",
      content: [{ type: "text", text: value }],
    });
    const documents = [
      { type: "doc", content: [p("a"), { type: "paragraph" }, p("b")] },
      { type: "doc", content: [p("a\n\nb")] },
      { type: "doc", content: [p("trailing   ")] },
    ];
    for (const document of documents) {
      await inScratchTransaction(async (tx) => {
        const entryId = await createDraft(tx);
        await tx
          .update(schema.entryTexts)
          .set({ body: document, bodyText: "x" })
          .where(eq(schema.entryTexts.entryId, entryId));
        expect((await getAlbumJournal(tx, author, entryId))?.body).toBeNull();
        expect(
          await failure(tx, (db) =>
            saveAlbumJournal(db, author, {
              entryId,
              expectedVersion: 1,
              body: "x",
            }),
          ),
        ).toBe("unsupported_content");
        const [text] = await tx
          .select()
          .from(schema.entryTexts)
          .where(eq(schema.entryTexts.entryId, entryId));
        expect(text?.body).toEqual(document);
        expect((await getAlbumJournal(tx, author, entryId))?.version).toBe(1);
      });
    }
  });

  it("rejects invalid input", async () => {
    await inScratchTransaction(async (tx) => {
      const entryId = await createDraft(tx);
      for (const input of [
        { entryId: "nope", expectedVersion: 1 },
        { entryId, expectedVersion: 0 },
        { entryId, expectedVersion: "1" },
        { entryId, expectedVersion: 1.5 },
        { entryId },
        { entryId, expectedVersion: 1, body: "x".repeat(100_001) },
      ]) {
        expect(
          await failure(tx, (db) => saveAlbumJournal(db, author, input)),
        ).toBe("invalid_input");
      }
    });
  });
});

describe("journal privacy", () => {
  async function draft(tx: Transaction) {
    const { albumId } = await setUp(tx);
    const { entryId } = await createAlbumJournal(tx, author, {
      albumId,
      locale: "en",
      body: "[Test] Private words",
    });
    return entryId;
  }

  it("moves a version between draft and private, and keeps it out of public queries", async () => {
    await inScratchTransaction(async (tx) => {
      const entryId = await draft(tx);
      await setAlbumJournalPrivacy(tx, author, {
        entryId,
        locale: "en",
        status: "private",
      });
      expect((await getAlbumJournal(tx, author, entryId))?.status).toBe(
        "private",
      );
      expect(await listPublicLanguageVersions(tx, entryId)).toEqual([]);
      await setAlbumJournalPrivacy(tx, author, {
        entryId,
        locale: "en",
        status: "draft",
      });
      expect((await getAlbumJournal(tx, author, entryId))?.status).toBe(
        "draft",
      );
    });
  });

  it("cannot publish, whatever the input", async () => {
    await inScratchTransaction(async (tx) => {
      const entryId = await draft(tx);
      for (const status of ["published", "Published", "", null, 1, undefined]) {
        expect(
          await failure(tx, (db) =>
            setAlbumJournalPrivacy(db, author, {
              entryId,
              locale: "en",
              status,
            }),
          ),
        ).toBe("invalid_input");
      }
      expect((await getAlbumJournal(tx, author, entryId))?.status).toBe(
        "draft",
      );
      expect(await listPublicLanguageVersions(tx, entryId)).toEqual([]);
    });
  });

  it("refuses unknown versions, entries of another kind, and deleted entries", async () => {
    await inScratchTransaction(async (tx) => {
      const entryId = await draft(tx);
      expect(
        await failure(tx, (db) =>
          setAlbumJournalPrivacy(db, author, {
            entryId,
            locale: "pt-BR",
            status: "private",
          }),
        ),
      ).toBe("entry_not_found");
      const memory = await createTestMemory(tx, {
        versions: [{ locale: "en", status: "published" }],
        slug: "a-memory",
      });
      expect(
        await failure(tx, (db) =>
          setAlbumJournalPrivacy(db, author, {
            entryId: memory,
            locale: "en",
            status: "private",
          }),
        ),
      ).toBe("entry_not_found");
      const [memoryText] = await tx
        .select({ status: schema.entryTexts.status })
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, memory));
      expect(memoryText?.status).toBe("published");

      await deleteAlbumJournal(tx, author, entryId);
      expect(
        await failure(tx, (db) =>
          setAlbumJournalPrivacy(db, author, {
            entryId,
            locale: "en",
            status: "private",
          }),
        ),
      ).toBe("entry_deleted");
    });
  });
});

describe("deleting an album journal", () => {
  it("moves it to Recently deleted and keeps everything it owns", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const { entryId } = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "[Test] Kept words",
      });
      await setAlbumJournalPrivacy(tx, author, {
        entryId,
        locale: "en",
        status: "private",
      });
      await deleteAlbumJournal(tx, author, entryId);

      expect(await listAlbumJournals(tx, author)).toEqual([]);
      const deleted = (await listDeletedAlbumJournals(tx, author)).filter(
        (journal) => journal.entryId === entryId,
      );
      expect(deleted).toHaveLength(1);
      expect(deleted[0]?.deletedAt).toBeInstanceOf(Date);

      // Soft deletion is separate from visibility: the status is unchanged,
      // and the writing, slug, and subtype row are all still there.
      const journal = await getAlbumJournal(tx, author, entryId);
      expect(journal).toMatchObject({
        status: "private",
        body: "[Test] Kept words",
        slug: "test-grace",
      });
      expect(await rows(tx, "album_journals")).toBe(1);
      expect(await listPublicLanguageVersions(tx, entryId)).toEqual([]);
    });
  });

  it("refuses to delete twice, or an unknown or other-kind entry", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const { entryId } = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "x",
      });
      await deleteAlbumJournal(tx, author, entryId);
      expect(
        await failure(tx, (db) => deleteAlbumJournal(db, author, entryId)),
      ).toBe("entry_deleted");
      expect(
        await failure(tx, (db) => deleteAlbumJournal(db, author, MISSING)),
      ).toBe("entry_not_found");
      expect(
        await failure(tx, (db) => deleteAlbumJournal(db, author, "nope")),
      ).toBe("invalid_input");

      const memory = await createTestMemory(tx);
      expect(
        await failure(tx, (db) => deleteAlbumJournal(db, author, memory)),
      ).toBe("entry_not_found");
      const [entry] = await tx
        .select()
        .from(schema.entries)
        .where(eq(schema.entries.id, memory));
      expect(entry?.deletedAt).toBeNull();
    });
  });

  it("is recoverable data, and permanent deletion stays a separate command", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const { entryId } = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "x",
      });
      // "Delete now" is refused until the journal is in Recently deleted.
      await expect(
        tx.transaction((sp) => permanentlyDeleteEntry(sp, entryId)),
      ).rejects.toMatchObject({ failure: "entry_not_deleted" });
      await deleteAlbumJournal(tx, author, entryId);
      await permanentlyDeleteEntry(tx, entryId);
      expect(await getAlbumJournal(tx, author, entryId)).toBeNull();
      expect(await rows(tx, "entry_slugs")).toBe(0); // never published: released
    });
  });
});

describe("journal queries", () => {
  it("lists journals once each however many credits the album has, newest edit first", async () => {
    await inScratchTransaction(async (tx) => {
      const artists = [
        await createTestArtist(tx, "[Test] A"),
        await createTestArtist(tx, "[Test] B"),
        await createTestArtist(tx, "[Test] C"),
      ];
      const album = await createTestAlbum(tx, {
        title: "[Test] Trio",
        artistIds: artists,
        trackTitles: ["[Test] a", "[Test] b"],
      });
      const first = await createAlbumJournal(tx, author, {
        albumId: album.albumId,
        locale: "en",
        body: "one two three",
      });
      const second = await createAlbumJournal(tx, author, {
        albumId: album.albumId,
        locale: "pt-BR",
        body: "",
      });
      await tx.execute(
        sql`update entries set updated_at = now() + interval '1 minute' where id = ${first.entryId}`,
      );

      const list = await listAlbumJournals(tx, author);
      expect(list.map((j) => j.entryId)).toEqual([
        first.entryId,
        second.entryId,
      ]);
      expect(list[0]).toMatchObject({
        artistNames: "[Test] A, [Test] B, [Test] C",
        wordCount: 3,
      });
      expect(list[1]).toMatchObject({ locale: "pt-BR", wordCount: 0 });
      expect(await listAlbumJournals(tx, author, { albumId: "nope" })).toEqual(
        [],
      );
    });
  });

  it("counts journals by status with SQL aggregates, deleted ones separately", async () => {
    await inScratchTransaction(async (tx) => {
      const before = await getJournalStatistics(tx, author);
      const { albumId } = await setUp(tx);
      const a = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "a",
      });
      const b = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "b",
      });
      const c = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "c",
      });
      await createTestAlbumJournal(tx, {
        albumId,
        versions: [{ locale: "en", status: "published" }],
        slug: "published-one",
      });
      await setAlbumJournalPrivacy(tx, author, {
        entryId: b.entryId,
        locale: "en",
        status: "private",
      });
      await deleteAlbumJournal(tx, author, c.entryId);
      expect(a.entryId).toBeTruthy();

      const after = await getJournalStatistics(tx, author);
      expect(after.total - before.total).toBe(3);
      expect(after.draft - before.draft).toBe(1);
      expect(after.private - before.private).toBe(1);
      expect(after.published - before.published).toBe(1);
      expect(after.deleted - before.deleted).toBe(1);
    });
  });

  it("returns null for an unknown or malformed id", async () => {
    await inScratchTransaction(async (tx) => {
      expect(await getAlbumJournal(tx, author, MISSING)).toBeNull();
      expect(await getAlbumJournal(tx, author, "nope")).toBeNull();
    });
  });
});
