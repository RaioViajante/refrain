import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Transaction } from "@/db";
import {
  captureFailure,
  createTestAlbum,
  createTestArtist,
  createTestMemory,
  createTestTrackReflection,
  inScratchTransaction,
  publishForTest,
  rowChecksum,
  testAuthor,
} from "@/testing";

import {
  createAlbumJournal,
  deleteAlbumJournal,
  restoreAlbumJournal,
  saveAlbumJournal,
  setAlbumJournalPrivacy,
} from "./commands";
import { JournalError, type JournalFailure } from "./errors";
import {
  createMemory,
  deleteMemory,
  restoreMemory,
  saveMemory,
  setMemoryPrivacy,
} from "./memories";
import {
  getMemory,
  getMemoryStatistics,
  listDeletedMemories,
  listMemories,
  listMemoriesOfRecording,
} from "./memory-queries";
import {
  previewAlbumJournalPublication,
  publishAlbumJournalVersion,
} from "./publishing";

// Memories in the private studio (M3.6), against real PostgreSQL in a
// rolled-back transaction. Every title and text is synthetic and labelled.

const author = testAuthor();
const MISSING = "00000000-0000-4000-8000-00000000dead";

async function failure(
  tx: Transaction,
  work: (db: Transaction) => Promise<unknown>,
): Promise<{ failure: JournalFailure; fields?: Record<string, string> }> {
  const error = await captureFailure(tx, work);
  expect(error, "the command should have been refused").toBeInstanceOf(
    JournalError,
  );
  const refused = error as JournalError;
  return { failure: refused.failure, fields: refused.details.fields };
}

/** Refused, and every table a reader could see is exactly as it was. */
async function refusedWithoutWriting(
  tx: Transaction,
  work: (db: Transaction) => Promise<unknown>,
): Promise<JournalFailure> {
  const before = await rowChecksum(tx);
  const refused = await failure(tx, work);
  expect(await rowChecksum(tx)).toEqual(before);
  return refused.failure;
}

// Recordings with credited artists, on an album, for the picker and the
// derived artists. Two recordings share a title on purpose.
async function setUp(tx: Transaction) {
  const first = await createTestArtist(tx, "[Test] First Artist");
  const second = await createTestArtist(tx, "[Test] Second Artist");
  const album = await createTestAlbum(tx, {
    title: "[Test] Memory Album",
    trackTitles: ["[Test] Song A", "[Test] Song B", "[Test] Same Name"],
    artistIds: [first],
  });
  const [a, b, same] = album.trackIds as [string, string, string];
  const [single] = await tx
    .insert(schema.tracks)
    .values({ title: "[Test] Same Name", lengthMs: 201_000 })
    .returning({ id: schema.tracks.id });
  await tx.insert(schema.trackArtists).values([
    { trackId: a, artistId: first, position: 1 },
    { trackId: a, artistId: second, position: 2 },
    { trackId: b, artistId: second, position: 1 },
    { trackId: single!.id, artistId: second, position: 1 },
  ]);
  return { ...album, first, second, a, b, same, single: single!.id };
}

async function links(tx: Transaction, memoryId: string) {
  // The rolled-back test transaction never reaches the commit, where
  // UNIQUE (memory_id, position) is checked; check it now, as a commit would.
  await tx.execute(sql`set constraints memory_music_position_unique immediate`);
  await tx.execute(sql`set constraints memory_music_position_unique deferred`);
  const result = await tx.execute<{
    id: string;
    track_id: string;
    position: number;
  }>(sql`
    select id, track_id, position from memory_music
     where memory_id = ${memoryId} order by position`);
  // Numbered 1..n, with no gap.
  expect(result.rows.map((row) => row.position)).toEqual(
    result.rows.map((_, index) => index + 1),
  );
  return result.rows;
}

async function archive(tx: Transaction, trackId: string) {
  await tx
    .update(schema.tracks)
    .set({ archivedAt: sql`now()` })
    .where(eq(schema.tracks.id, trackId));
}

describe("creating a memory", () => {
  it("creates one private draft with its title, when, writing, ordered recordings, and slug", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const created = await createMemory(tx, author, {
        title: "  [Test] Summer\nnights  ",
        rememberedWhen: " [Test] August, years ago ",
        body: "[Test] First paragraph.\n\n[Test] Second paragraph.",
        trackIds: [music.b, music.a],
      });
      expect(created.version).toBe(1);

      const memory = await getMemory(tx, author, created.entryId);
      expect(memory).toMatchObject({
        entryId: created.entryId,
        title: "[Test] Summer nights",
        rememberedWhen: "[Test] August, years ago",
        locale: "en",
        status: "draft",
        body: "[Test] First paragraph.\n\n[Test] Second paragraph.",
        wordCount: 6,
        version: 1,
        deletedAt: null,
        slug: "test-summer-nights",
        versions: [{ locale: "en", isOriginal: true, status: "draft" }],
        recordingTitles: ["[Test] Song B", "[Test] Song A"],
        albumLinks: [],
      });
      expect(memory!.recordings.map((r) => r.trackId)).toEqual([
        music.b,
        music.a,
      ]);
      expect(memory!.recordings[1]).toMatchObject({
        title: "[Test] Song A",
        artists: [
          { id: music.first, name: "[Test] First Artist" },
          { id: music.second, name: "[Test] Second Artist" },
        ],
        albums: ["[Test] Memory Album"],
        archived: false,
      });

      // The storage format, and a slug that was never public.
      const [text] = await tx
        .select()
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, created.entryId));
      expect(text).toMatchObject({
        status: "draft",
        publishedAt: null,
        firstPublishedAt: null,
        opening: null,
        marginNote: null,
        bodyText: "[Test] First paragraph.\n\n[Test] Second paragraph.",
      });
      const [slug] = await tx
        .select()
        .from(schema.entrySlugs)
        .where(eq(schema.entrySlugs.entryId, created.entryId));
      expect(slug).toMatchObject({
        kind: "memory",
        isCurrent: true,
        wasPublished: false,
      });
      const [entry] = await tx
        .select()
        .from(schema.entries)
        .where(eq(schema.entries.id, created.entryId));
      expect(entry).toMatchObject({ kind: "memory", firstPublishedAt: null });
    });
  });

  it("allows no recordings, no when, and no writing yet", async () => {
    await inScratchTransaction(async (tx) => {
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Only a title",
      });
      const memory = await getMemory(tx, author, entryId);
      expect(memory).toMatchObject({
        rememberedWhen: null,
        body: "",
        wordCount: 0,
        recordings: [],
        excerpt: "",
      });
      const [text] = await tx
        .select({ body: schema.entryTexts.body })
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, entryId));
      expect(text!.body).toBeNull();
    });
  });

  it("ignores anything a client adds: no status, rating, favourite, or other language", async () => {
    await inScratchTransaction(async (tx) => {
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Injected",
        status: "published",
        isFavourite: true,
        ratingHalfSteps: 10,
        kind: "album_journal",
        version: 99,
      });
      const memory = await getMemory(tx, author, entryId);
      expect(memory).toMatchObject({ status: "draft", version: 1 });
      const [entry] = await tx
        .select({ kind: schema.entries.kind })
        .from(schema.entries)
        .where(eq(schema.entries.id, entryId));
      expect(entry!.kind).toBe("memory");
    });
  });

  it("refuses a blank title, another language, a duplicated or unknown recording, and an archived one, writing nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      await archive(tx, music.same);

      const blank = await failure(tx, (db) =>
        createMemory(db, author, { title: " \n " }),
      );
      expect(blank).toEqual({
        failure: "invalid_input",
        fields: { title: "required" },
      });
      expect(
        (
          await failure(tx, (db) =>
            createMemory(db, author, { title: "[Test] x", locale: "pt-BR" }),
          )
        ).fields,
      ).toEqual({ locale: "invalid" });
      expect(
        (
          await failure(tx, (db) =>
            createMemory(db, author, {
              title: "[Test] x",
              trackIds: [music.a, music.a],
            }),
          )
        ).fields,
      ).toEqual({ trackIds: "invalid" });
      expect(
        (
          await failure(tx, (db) =>
            createMemory(db, author, {
              title: "[Test] x".repeat(40),
            }),
          )
        ).fields,
      ).toEqual({ title: "too_long" });

      expect(
        await refusedWithoutWriting(tx, (db) =>
          createMemory(db, author, {
            title: "[Test] x",
            trackIds: [music.a, MISSING],
          }),
        ),
      ).toBe("track_not_found");
      expect(
        await refusedWithoutWriting(tx, (db) =>
          createMemory(db, author, {
            title: "[Test] x",
            trackIds: [music.same],
          }),
        ),
      ).toBe("track_archived");
    });
  });

  it("falls back to a neutral address and never shares one", async () => {
    await inScratchTransaction(async (tx) => {
      const symbols = await createMemory(tx, author, { title: "★ ★ ★" });
      const again = await createMemory(tx, author, { title: "★" });
      expect((await getMemory(tx, author, symbols.entryId))!.slug).toMatch(
        /^memory(-\d+)?$/,
      );
      expect((await getMemory(tx, author, again.entryId))!.slug).not.toBe(
        (await getMemory(tx, author, symbols.entryId))!.slug,
      );
    });
  });
});

describe("saving a memory", () => {
  it("saves the title, when, and writing as a patch, and bumps the version each time", async () => {
    await inScratchTransaction(async (tx) => {
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Before",
        rememberedWhen: "[Test] Spring",
        body: "[Test] Kept words.",
      });

      expect(
        await saveMemory(tx, author, {
          entryId,
          expectedVersion: 1,
          title: "[Test] After",
        }),
      ).toEqual({ version: 2 });
      expect(await getMemory(tx, author, entryId)).toMatchObject({
        title: "[Test] After",
        rememberedWhen: "[Test] Spring",
        body: "[Test] Kept words.",
        version: 2,
      });

      await saveMemory(tx, author, {
        entryId,
        expectedVersion: 2,
        rememberedWhen: "  ",
        body: "[Test] New words.\nA line.",
      });
      expect(await getMemory(tx, author, entryId)).toMatchObject({
        title: "[Test] After",
        rememberedWhen: null,
        body: "[Test] New words.\nA line.",
        version: 3,
      });

      await saveMemory(tx, author, { entryId, expectedVersion: 3, body: "" });
      const [text] = await tx
        .select({
          body: schema.entryTexts.body,
          bodyText: schema.entryTexts.bodyText,
        })
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, entryId));
      expect(text).toEqual({ body: null, bodyText: "" });
    });
  });

  it("refuses an empty save, a blank title, and a stale version, writing nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Stable",
      });
      expect(
        (
          await failure(tx, (db) =>
            saveMemory(db, author, { entryId, expectedVersion: 1 }),
          )
        ).failure,
      ).toBe("invalid_input");
      expect(
        (
          await failure(tx, (db) =>
            saveMemory(db, author, { entryId, expectedVersion: 1, title: "" }),
          )
        ).fields,
      ).toEqual({ title: "required" });
      expect(
        (
          await failure(tx, (db) =>
            saveMemory(db, author, {
              entryId,
              expectedVersion: 1,
              title: null,
            }),
          )
        ).failure,
      ).toBe("invalid_input");

      await saveMemory(tx, author, {
        entryId,
        expectedVersion: 1,
        title: "[Test] Saved once",
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            entryId,
            expectedVersion: 1,
            title: "[Test] From a stale tab",
            trackIds: [],
          }),
        ),
      ).toBe("version_conflict");
      expect((await getMemory(tx, author, entryId))!.title).toBe(
        "[Test] Saved once",
      );
    });
  });

  it("reorders, adds, and removes recordings, keeping each kept link and never the catalog", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Ordered",
        trackIds: [music.a, music.b],
      });
      const original = await links(tx, entryId);
      const tracksBefore = await tx.execute(
        sql`select * from tracks order by id`,
      );

      // A swap: both links keep their row, and take each other's place.
      await saveMemory(tx, author, {
        entryId,
        expectedVersion: 1,
        trackIds: [music.b, music.a],
      });
      const swapped = await links(tx, entryId);
      expect(swapped.map((link) => link.track_id)).toEqual([music.b, music.a]);
      expect(new Set(swapped.map((link) => link.id))).toEqual(
        new Set(original.map((link) => link.id)),
      );

      // Remove one, add one in the middle.
      await saveMemory(tx, author, {
        entryId,
        expectedVersion: 2,
        trackIds: [music.a, music.single],
      });
      expect((await links(tx, entryId)).map((link) => link.track_id)).toEqual([
        music.a,
        music.single,
      ]);

      // Unlink everything.
      await saveMemory(tx, author, {
        entryId,
        expectedVersion: 3,
        trackIds: [],
      });
      expect(await links(tx, entryId)).toEqual([]);
      expect((await getMemory(tx, author, entryId))!.version).toBe(4);

      // The recordings are exactly as they were.
      expect(
        (await tx.execute(sql`select * from tracks order by id`)).rows,
      ).toEqual(tracksBefore.rows);
    });
  });

  it("keeps a link to a recording archived since, and refuses a new one to it", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Archived later",
        trackIds: [music.a, music.b],
      });
      await archive(tx, music.a);

      // Still linked, shown as archived, and it can move.
      const memory = await getMemory(tx, author, entryId);
      expect(memory!.recordings[0]).toMatchObject({
        trackId: music.a,
        archived: true,
      });
      await saveMemory(tx, author, {
        entryId,
        expectedVersion: 1,
        trackIds: [music.b, music.a],
      });

      // Removed, it cannot come back while it is archived.
      await saveMemory(tx, author, {
        entryId,
        expectedVersion: 2,
        trackIds: [music.b],
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            entryId,
            expectedVersion: 3,
            trackIds: [music.b, music.a],
          }),
        ),
      ).toBe("track_archived");
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            entryId,
            expectedVersion: 3,
            title: "[Test] Not with this",
            trackIds: [MISSING],
          }),
        ),
      ).toBe("track_not_found");
      expect(
        (
          await failure(tx, (db) =>
            saveMemory(db, author, {
              entryId,
              expectedVersion: 3,
              trackIds: [music.b, music.b],
            }),
          )
        ).fields,
      ).toEqual({ trackIds: "invalid" });
    });
  });

  it("refuses a memory in Recently deleted, another kind of entry, and an unknown one", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Deleted",
      });
      await deleteMemory(tx, author, entryId);
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            entryId,
            expectedVersion: 1,
            title: "[Test] x",
          }),
        ),
      ).toBe("entry_deleted");

      const journal = await createAlbumJournal(tx, author, {
        albumId: music.albumId,
        locale: "en",
        body: "[Test] A journal.",
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            entryId: journal.entryId,
            expectedVersion: 1,
            title: "[Test] Into a journal",
            trackIds: [music.a],
          }),
        ),
      ).toBe("entry_not_found");
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            entryId: MISSING,
            expectedVersion: 1,
            title: "[Test] x",
          }),
        ),
      ).toBe("entry_not_found");
    });
  });

  it("refuses to save a memory with a published version (the confirmed save is M3.7), writing nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Published elsewhere",
        body: "[Test] Words.",
        trackIds: [music.a],
      });
      // No studio path can publish a memory. The engine can, so this stands
      // in for a write from outside the application.
      await publishForTest(tx, entryId, "en");
      const version = (await getMemory(tx, author, entryId))!.version;

      for (const change of [
        { title: "[Test] Changed" },
        { body: "" },
        { rememberedWhen: "[Test] Now" },
        { trackIds: [] },
        { trackIds: [music.a, music.b] },
      ]) {
        expect(
          await refusedWithoutWriting(tx, (db) =>
            saveMemory(db, author, {
              entryId,
              expectedVersion: version,
              ...change,
            }),
          ),
        ).toBe("memory_published");
      }

      // Unpublishing only reduces what readers see, and is allowed; then the
      // memory saves again.
      await setMemoryPrivacy(tx, author, {
        entryId,
        locale: "en",
        status: "private",
        expectedStatus: "published",
      });
      await saveMemory(tx, author, {
        entryId,
        expectedVersion: version,
        title: "[Test] Private again",
      });
    });
  });

  it("refuses writing the plain editor cannot reproduce, and an album link it cannot show, leaving both untouched", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const withAlbum = await createTestMemory(tx, {
        music: [{ trackId: music.a }, { albumId: music.albumId }],
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            entryId: withAlbum,
            expectedVersion: 1,
            trackIds: [music.a],
          }),
        ),
      ).toBe("unsupported_content");
      expect((await getMemory(tx, author, withAlbum))!.albumLinks).toEqual([
        "[Test] Memory Album",
      ]);
      // Its other fields still save.
      await saveMemory(tx, author, {
        entryId: withAlbum,
        expectedVersion: 1,
        title: "[Test] Titled",
      });

      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Formatted",
      });
      await tx
        .update(schema.entryTexts)
        .set({
          body: {
            type: "doc",
            content: [
              {
                type: "heading",
                content: [{ type: "text", text: "[Test] Heading" }],
              },
            ],
          },
          bodyText: "[Test] Heading",
        })
        .where(eq(schema.entryTexts.entryId, entryId));
      expect((await getMemory(tx, author, entryId))!.body).toBeNull();
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            entryId,
            expectedVersion: 1,
            title: "[Test] With it",
            body: "[Test] Flattened",
          }),
        ),
      ).toBe("unsupported_content");
      await saveMemory(tx, author, {
        entryId,
        expectedVersion: 1,
        title: "[Test] Title only",
      });
    });
  });
});

describe("memories and album journals stay apart", () => {
  it("never reads or writes an album journal or a track reflection", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const journal = await createAlbumJournal(tx, author, {
        albumId: music.albumId,
        locale: "en",
        body: "[Test] Journal words.",
      });
      await createTestTrackReflection(tx, {
        albumJournalId: journal.entryId,
        albumId: music.albumId,
        trackId: music.a,
        texts: { en: "[Test] A reflection." },
        isFavourite: true,
        ratingHalfSteps: 8,
      });
      const journalRows = async () =>
        (
          await tx.execute(sql`
            select
              (select json_agg(x order by x::text) from album_journals x) as journals,
              (select json_agg(x order by x::text) from track_reflections x) as reflections,
              (select json_agg(x order by x::text) from track_reflection_texts x) as texts,
              (select json_agg(x order by x::text) from entry_texts x
                where x.entry_id = ${journal.entryId}) as journal_text,
              (select json_agg(x order by x::text) from entries x
                where x.id = ${journal.entryId}) as journal_entry`)
        ).rows[0];
      const before = await journalRows();

      // The same recording the reflection is about, linked from a memory.
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Same song",
        trackIds: [music.a],
      });
      await saveMemory(tx, author, {
        entryId,
        expectedVersion: 1,
        trackIds: [music.b, music.a],
        body: "[Test] Memory words.",
      });
      await setMemoryPrivacy(tx, author, {
        entryId,
        locale: "en",
        status: "private",
        expectedStatus: "draft",
      });
      await deleteMemory(tx, author, entryId);
      await restoreMemory(tx, author, entryId);

      expect(await journalRows()).toEqual(before);
    });
  });

  it("refuses each memory command for an album journal, and each journal command for a memory", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const journal = await createAlbumJournal(tx, author, {
        albumId: music.albumId,
        locale: "en",
        body: "[Test] Journal.",
      });
      const memory = await createMemory(tx, author, {
        title: "[Test] Memory",
        body: "[Test] Memory words.",
      });

      for (const work of [
        (db: Transaction) => deleteMemory(db, author, journal.entryId),
        (db: Transaction) => restoreMemory(db, author, journal.entryId),
        (db: Transaction) =>
          setMemoryPrivacy(db, author, {
            entryId: journal.entryId,
            locale: "en",
            status: "private",
            expectedStatus: "draft",
          }),
        (db: Transaction) => deleteAlbumJournal(db, author, memory.entryId),
        (db: Transaction) => restoreAlbumJournal(db, author, memory.entryId),
        (db: Transaction) =>
          setAlbumJournalPrivacy(db, author, {
            entryId: memory.entryId,
            locale: "en",
            status: "private",
            expectedStatus: "draft",
          }),
        (db: Transaction) =>
          saveAlbumJournal(db, author, {
            entryId: memory.entryId,
            expectedVersion: 1,
            body: "[Test] Into a memory",
          }),
      ]) {
        expect(await refusedWithoutWriting(tx, work)).toBe("entry_not_found");
      }
      expect(await getMemory(tx, author, journal.entryId)).toBeNull();
    });
  });
});

describe("publication stays closed for memories (M3.7)", () => {
  it("cannot be previewed or published through the studio's only publish path", async () => {
    await inScratchTransaction(async (tx) => {
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Not publishable here",
        body: "[Test] Words that stay private.",
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          previewAlbumJournalPublication(db, author, { entryId, locale: "en" }),
        ),
      ).toBe("entry_not_found");
      expect(
        await refusedWithoutWriting(tx, (db) =>
          publishAlbumJournalVersion(db, author, {
            entryId,
            locale: "en",
            expectedVersion: 1,
            confirmation: "ct1.AAAA.BBBB",
          }),
        ),
      ).toBe("entry_not_found");
    });
  });

  it("cannot reach published through privacy", async () => {
    await inScratchTransaction(async (tx) => {
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Private only",
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          setMemoryPrivacy(db, author, {
            entryId,
            locale: "en",
            status: "published",
            expectedStatus: "draft",
          }),
        ),
      ).toBe("invalid_input");
      await setMemoryPrivacy(tx, author, {
        entryId,
        locale: "en",
        status: "private",
        expectedStatus: "draft",
      });
      expect((await getMemory(tx, author, entryId))!.status).toBe("private");
      expect(
        await refusedWithoutWriting(tx, (db) =>
          setMemoryPrivacy(db, author, {
            entryId,
            locale: "en",
            status: "draft",
            expectedStatus: "draft",
          }),
        ),
      ).toBe("status_changed");
    });
  });
});

describe("deleting and restoring a memory", () => {
  it("moves it to Recently deleted with everything kept, and restores it whole", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Coming back",
        rememberedWhen: "[Test] Winter",
        body: "[Test] Every word.\n\n[Test] Every paragraph.",
        trackIds: [music.b, music.a],
      });
      const before = await getMemory(tx, author, entryId);

      await deleteMemory(tx, author, entryId);
      expect(await listMemories(tx, author)).not.toContainEqual(
        expect.objectContaining({ entryId }),
      );
      expect(await listDeletedMemories(tx, author)).toContainEqual(
        expect.objectContaining({
          entryId,
          title: "[Test] Coming back",
          versions: [{ locale: "en", isOriginal: true, status: "draft" }],
        }),
      );
      expect((await getMemory(tx, author, entryId))!.deletedAt).not.toBeNull();
      expect(
        await refusedWithoutWriting(tx, (db) =>
          deleteMemory(db, author, entryId),
        ),
      ).toBe("entry_deleted");

      expect(await restoreMemory(tx, author, entryId)).toEqual({
        madePrivate: [],
      });
      const after = await getMemory(tx, author, entryId);
      expect(after).toMatchObject({
        title: before!.title,
        rememberedWhen: before!.rememberedWhen,
        body: before!.body,
        recordings: before!.recordings,
        slug: before!.slug,
        version: before!.version,
        status: "draft",
        deletedAt: null,
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          restoreMemory(db, author, entryId),
        ),
      ).toBe("entry_not_deleted");
    });
  });

  it("returns a memory that was published as private, publishing nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const { entryId } = await createMemory(tx, author, {
        title: "[Test] Was public",
        body: "[Test] Words.",
      });
      await publishForTest(tx, entryId, "en");
      await deleteMemory(tx, author, entryId);
      expect(await restoreMemory(tx, author, entryId)).toEqual({
        madePrivate: ["en"],
      });
      const [text] = await tx
        .select()
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, entryId));
      expect(text).toMatchObject({ status: "private", publishedAt: null });
      expect(text!.firstPublishedAt).not.toBeNull();
    });
  });

  it("refuses malformed and unknown ids with fixed codes", async () => {
    await inScratchTransaction(async (tx) => {
      expect(
        (await failure(tx, (db) => deleteMemory(db, author, "not-an-id")))
          .failure,
      ).toBe("invalid_input");
      expect(
        (await failure(tx, (db) => restoreMemory(db, author, MISSING))).failure,
      ).toBe("entry_not_found");
    });
  });
});

describe("the studio's memory queries", () => {
  it("lists memories newest first, counts them by status, and finds them from a recording", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const before = await getMemoryStatistics(tx, author);
      const first = await createMemory(tx, author, {
        title: "[Test] First",
        trackIds: [music.a],
      });
      const second = await createMemory(tx, author, {
        title: "[Test] Second",
        trackIds: [music.b, music.a],
      });
      await setMemoryPrivacy(tx, author, {
        entryId: second.entryId,
        locale: "en",
        status: "private",
        expectedStatus: "draft",
      });
      const gone = await createMemory(tx, author, {
        title: "[Test] Gone",
        trackIds: [music.a],
      });
      await deleteMemory(tx, author, gone.entryId);

      const listed = (await listMemories(tx, author)).filter((memory) =>
        [first.entryId, second.entryId, gone.entryId].includes(memory.entryId),
      );
      expect(listed.map((memory) => memory.title).sort()).toEqual([
        "[Test] First",
        "[Test] Second",
      ]);
      expect(
        listed.find((memory) => memory.entryId === second.entryId),
      ).toMatchObject({
        status: "private",
        recordingTitles: ["[Test] Song B", "[Test] Song A"],
      });

      const after = await getMemoryStatistics(tx, author);
      expect({
        total: after.total - before.total,
        draft: after.draft - before.draft,
        private: after.private - before.private,
        published: after.published - before.published,
        deleted: after.deleted - before.deleted,
      }).toEqual({ total: 2, draft: 1, private: 1, published: 0, deleted: 1 });

      const ofA = await listMemoriesOfRecording(tx, author, music.a);
      expect(ofA.map((memory) => memory.entryId).sort()).toEqual(
        [first.entryId, second.entryId].sort(),
      );
      expect(await listMemoriesOfRecording(tx, author, "nope")).toEqual([]);
      expect(await getMemory(tx, author, "nope")).toBeNull();
    });
  });

  it("lists a memory written outside the commands under a neutral title", async () => {
    await inScratchTransaction(async (tx) => {
      const entryId = await createTestMemory(tx, {
        versions: [{ locale: "en", text: "[Test] Words" }],
      });
      await tx
        .update(schema.entryTexts)
        .set({ title: null })
        .where(eq(schema.entryTexts.entryId, entryId));
      expect((await getMemory(tx, author, entryId))!.title).toBe(
        "Untitled memory",
      );
    });
  });
});
