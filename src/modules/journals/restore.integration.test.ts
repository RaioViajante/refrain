import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Transaction } from "@/db";
import {
  changeEntrySlug,
  publishLanguageVersion,
  resolvePublicSlug,
  restoreDeletedEntry,
  PublicationError,
  listPublicLanguageVersions,
  listPublicTrackReflections,
} from "@/modules/publication";
import {
  captureFailure,
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestArtistJournal,
  createTestMemory,
  createTestTrackReflection,
  inScratchTransaction,
  testAuthor,
  type TestVersion,
} from "@/testing";

import {
  createAlbumJournal,
  deleteAlbumJournal,
  restoreAlbumJournal,
  saveAlbumJournal,
} from "./commands";
import { JournalError, type JournalFailure } from "./errors";
import {
  getAlbumJournal,
  getJournalStatistics,
  listAlbumJournals,
  listDeletedAlbumJournals,
} from "./queries";

// Restoring an album journal from Recently deleted, under the owner-accepted
// restoration policy (docs/roadmap.md § Follow-ups from the M1.3B review).
// Everything runs against real PostgreSQL inside a rolled-back transaction;
// the concurrent cases are in concurrency.integration.test.ts.

const author = testAuthor();
const MISSING = "00000000-0000-4000-8000-00000000dead";
const longAgo = new Date("2026-01-01T00:00:00Z");
const later = new Date("2026-03-01T00:00:00Z");

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

async function setUp(tx: Transaction, title = "[Test] Grace") {
  const artistId = await createTestArtist(tx, "[Test] Artist");
  const album = await createTestAlbum(tx, { title, artistIds: [artistId] });
  return { ...album, artistId };
}

// Every stored byte of an entry that a restore must not change, as text:
// the writing and the publication history of each language version, the
// entry's own history and version, and every slug row.
async function preserved(tx: Transaction, entryId: string): Promise<string> {
  const result = await tx.execute<{ snapshot: string }>(sql`
    select jsonb_build_object(
      'entry', (select jsonb_build_object(
                  'kind', kind, 'version', version,
                  'first_published_at', first_published_at,
                  'created_at', created_at)
                  from entries where id = ${entryId}),
      'texts', (select jsonb_agg(jsonb_build_object(
                  'locale', locale, 'is_original', is_original,
                  'first_published_at', first_published_at,
                  'opening', opening, 'body', body, 'body_text', body_text,
                  'margin_note', margin_note, 'title', title)
                  order by locale)
                  from entry_texts where entry_id = ${entryId}),
      'slugs', (select jsonb_agg(to_jsonb(s) order by slug)
                  from entry_slugs s where entry_id = ${entryId}),
      'journal', (select to_jsonb(j) from album_journals j
                   where entry_id = ${entryId})
    )::text as snapshot`);
  return result.rows[0]!.snapshot;
}

async function statuses(
  tx: Transaction,
  entryId: string,
): Promise<Record<string, string>> {
  const rows = await tx
    .select({
      locale: schema.entryTexts.locale,
      status: schema.entryTexts.status,
    })
    .from(schema.entryTexts)
    .where(eq(schema.entryTexts.entryId, entryId));
  return Object.fromEntries(rows.map((row) => [row.locale, row.status]));
}

async function deletedAt(tx: Transaction, entryId: string) {
  const [row] = await tx
    .select({ deletedAt: schema.entries.deletedAt })
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  return row!.deletedAt;
}

async function publishedCount(
  tx: Transaction,
  entryId: string,
): Promise<number> {
  const result = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from entry_texts
     where entry_id = ${entryId}
       and (status = 'published' or published_at is not null)`);
  return result.rows[0]!.n;
}

describe("restoring an album journal", () => {
  it("returns a draft as a draft, with its writing and history untouched", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const { entryId } = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        opening: "[Test] An opening.",
        body: "[Test] First paragraph.\nSecond line.\n\n[Test] Second paragraph.\n\n[Test] Third.",
      });
      const before = await preserved(tx, entryId);
      await deleteAlbumJournal(tx, author, entryId);
      expect(await listAlbumJournals(tx, author)).toEqual([]);

      expect(await restoreAlbumJournal(tx, author, entryId)).toEqual({
        madePrivate: [],
      });

      expect(await deletedAt(tx, entryId)).toBeNull();
      expect(await statuses(tx, entryId)).toEqual({ en: "draft" });
      expect(await preserved(tx, entryId)).toBe(before);
      const journal = await getAlbumJournal(tx, author, entryId);
      expect(journal).toMatchObject({
        status: "draft",
        deletedAt: null,
        opening: "[Test] An opening.",
        body: "[Test] First paragraph.\nSecond line.\n\n[Test] Second paragraph.\n\n[Test] Third.",
        version: 1,
      });
      // Back among the live journals, out of Recently deleted.
      expect(
        (await listAlbumJournals(tx, author)).map((j) => j.entryId),
      ).toEqual([entryId]);
      expect(await listDeletedAlbumJournals(tx, author)).toEqual([]);
      expect(await getJournalStatistics(tx, author)).toMatchObject({
        total: 1,
        draft: 1,
        deleted: 0,
      });
    });
  });

  it("returns a private journal as private", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [{ locale: "en", status: "private", text: "[Test] Mine" }],
        deletedAt: later,
      });
      expect(await restoreAlbumJournal(tx, author, entryId)).toEqual({
        madePrivate: [],
      });
      expect(await statuses(tx, entryId)).toEqual({ en: "private" });
      expect(await deletedAt(tx, entryId)).toBeNull();
    });
  });

  it("returns a previously published journal as private, and keeps its publication history", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [
          {
            locale: "en",
            status: "published",
            publishedAt: longAgo,
            text: "[Test] Once published",
          },
        ],
      });
      await deleteAlbumJournal(tx, author, entryId);
      const before = await preserved(tx, entryId);

      expect(await restoreAlbumJournal(tx, author, entryId)).toEqual({
        madePrivate: ["en"],
      });

      const [version] = await tx
        .select()
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, entryId));
      expect(version).toMatchObject({
        status: "private",
        publishedAt: null,
        bodyText: "[Test] Once published",
      });
      // The history is what it was: when it was first published.
      expect(version?.firstPublishedAt).toEqual(longAgo);
      const [entry] = await tx
        .select()
        .from(schema.entries)
        .where(eq(schema.entries.id, entryId));
      expect(entry?.firstPublishedAt).toEqual(longAgo);
      expect(entry?.deletedAt).toBeNull();
      expect(await preserved(tx, entryId)).toBe(before);
      expect(await publishedCount(tx, entryId)).toBe(0);
    });
  });

  it("handles language versions with different prior statuses, each by its own", async () => {
    // Every combination of the two versions' statuses: published ones return
    // as private, the others keep their status, and none is ever published.
    const all = ["draft", "private", "published"] as const;
    for (const original of all) {
      for (const translation of all) {
        await inScratchTransaction(async (tx) => {
          const { albumId } = await setUp(tx);
          const versions: TestVersion[] = [
            {
              locale: "pt-BR",
              status: original,
              publishedAt: longAgo,
              text: "[Test] Original",
            },
            {
              locale: "en",
              isOriginal: false,
              status: translation,
              publishedAt: later,
              text: "[Test] Translation",
            },
          ];
          const entryId = await createTestAlbumJournal(tx, {
            albumId,
            slug: "test-grace",
            versions,
          });
          await deleteAlbumJournal(tx, author, entryId);
          const before = await preserved(tx, entryId);

          const { madePrivate } = await restoreAlbumJournal(
            tx,
            author,
            entryId,
          );

          const label = `${original}/${translation}`;
          expect(await statuses(tx, entryId), label).toEqual({
            "pt-BR": original === "published" ? "private" : original,
            en: translation === "published" ? "private" : translation,
          });
          expect(madePrivate, label).toEqual(
            [
              ...(translation === "published" ? ["en"] : []),
              ...(original === "published" ? ["pt-BR"] : []),
            ].sort(),
          );
          expect(await publishedCount(tx, entryId), label).toBe(0);
          expect(await preserved(tx, entryId), label).toBe(before);
          expect(await listPublicLanguageVersions(tx, entryId), label).toEqual(
            [],
          );
        });
      }
    }
  });

  it("keeps the first publication of a version that was unpublished earlier", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [{ locale: "en", status: "private" }],
      });
      // It was published once, then unpublished, then deleted.
      await tx
        .update(schema.entryTexts)
        .set({ firstPublishedAt: longAgo })
        .where(eq(schema.entryTexts.entryId, entryId));
      await tx
        .update(schema.entries)
        .set({ firstPublishedAt: longAgo })
        .where(eq(schema.entries.id, entryId));
      await deleteAlbumJournal(tx, author, entryId);

      await restoreAlbumJournal(tx, author, entryId);

      const [version] = await tx
        .select()
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, entryId));
      expect(version).toMatchObject({ status: "private", publishedAt: null });
      expect(version?.firstPublishedAt).toEqual(longAgo);
    });
  });

  it("never changes the entry's version, so an open editor still saves", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const { entryId } = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "[Test] Before",
      });
      const saved = await saveAlbumJournal(tx, author, {
        entryId,
        expectedVersion: 1,
        body: "[Test] Edited",
      });
      expect(saved.version).toBe(2);
      await deleteAlbumJournal(tx, author, entryId);
      await restoreAlbumJournal(tx, author, entryId);

      const journal = await getAlbumJournal(tx, author, entryId);
      expect(journal).toMatchObject({ version: 2, body: "[Test] Edited" });
      // The journal can be edited and deleted again after a restore.
      expect(
        await saveAlbumJournal(tx, author, {
          entryId,
          expectedVersion: 2,
          body: "[Test] Edited again",
        }),
      ).toEqual({ version: 3 });
      await deleteAlbumJournal(tx, author, entryId);
      expect(await deletedAt(tx, entryId)).toBeInstanceOf(Date);
    });
  });

  it("restores a journal about an archived album", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const { entryId } = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "[Test] Kept",
      });
      await deleteAlbumJournal(tx, author, entryId);
      await tx
        .update(schema.albums)
        .set({ archivedAt: new Date() })
        .where(eq(schema.albums.id, albumId));
      await restoreAlbumJournal(tx, author, entryId);
      expect(await deletedAt(tx, entryId)).toBeNull();
    });
  });

  it("does not touch track reflections, which stay behind the journal's own publication", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId, trackIds } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [{ locale: "en", status: "published", publishedAt: longAgo }],
      });
      await createTestTrackReflection(tx, {
        albumJournalId: entryId,
        albumId,
        trackId: trackIds[0]!,
        isPublished: true,
        isFavourite: true,
        ratingHalfSteps: 9,
        texts: { en: "[Test] A published reflection" },
      });
      expect(await listPublicTrackReflections(tx, entryId, "en")).toHaveLength(
        1,
      );
      const flags = async () =>
        (
          await tx.execute(sql`
            select r.is_published, r.is_favourite, r.is_still_writing,
                   r.rating_half_steps, t.body_text
              from track_reflections r
              join track_reflection_texts t on t.track_reflection_id = r.id
             where r.album_journal_id = ${entryId}`)
        ).rows;

      const reflectionsBefore = await flags();
      await deleteAlbumJournal(tx, author, entryId);
      expect(await listPublicTrackReflections(tx, entryId, "en")).toEqual([]);
      await restoreAlbumJournal(tx, author, entryId);

      expect(await flags()).toEqual(reflectionsBefore);
      // The reflection's flag is unchanged, but its parent version is private
      // now, so the predicate keeps it out of every public read (INV-3).
      expect(await listPublicTrackReflections(tx, entryId, "en")).toEqual([]);
    });
  });
});

describe("a restore and the lists that show it", () => {
  it("leaves a deleted journal that has no original language version out of the list, instead of failing", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [{ locale: "en", status: "private" }],
        deletedAt: later,
      });
      await tx
        .delete(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, entryId));
      // The summary joins the original version, so such a journal has no
      // summary row; the version list of a journal that has one is empty
      // rather than null.
      expect(await listDeletedAlbumJournals(tx, author)).toEqual([]);
    });
  });

  it("keeps a journal's versions listed with their statuses while it is deleted", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [
          { locale: "en", status: "published", publishedAt: longAgo },
          { locale: "pt-BR", isOriginal: false, status: "draft" },
        ],
        deletedAt: later,
      });
      const [listed] = (await listDeletedAlbumJournals(tx, author)).filter(
        (journal) => journal.entryId === entryId,
      );
      expect(listed?.versions).toEqual([
        { locale: "en", isOriginal: true, status: "published" },
        { locale: "pt-BR", isOriginal: false, status: "draft" },
      ]);
    });
  });
});

describe("what the public can see around a restore", () => {
  it("lets a reflection that was flagged for publication go public with its version when the author publishes it again", async () => {
    // Documented in ADR 0005: a restore leaves the reflection's own flag, and
    // the flag only ever matters while its version is public.
    await inScratchTransaction(async (tx) => {
      const { albumId, trackIds } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [{ locale: "en", status: "published", publishedAt: longAgo }],
      });
      await createTestTrackReflection(tx, {
        albumJournalId: entryId,
        albumId,
        trackId: trackIds[0]!,
        isPublished: true,
        texts: { en: "[Test] Flagged" },
      });
      await deleteAlbumJournal(tx, author, entryId);
      await restoreAlbumJournal(tx, author, entryId);
      expect(await listPublicTrackReflections(tx, entryId, "en")).toEqual([]);
      await publishLanguageVersion(tx, entryId, "en");
      expect(await listPublicTrackReflections(tx, entryId, "en")).toHaveLength(
        1,
      );
    });
  });

  it("shows nothing while deleted, nothing after the restore, and the writing again only when the author publishes it", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [
          { locale: "en", status: "published", publishedAt: longAgo },
          {
            locale: "pt-BR",
            isOriginal: false,
            status: "published",
            publishedAt: later,
          },
        ],
      });
      expect(await listPublicLanguageVersions(tx, entryId)).toHaveLength(2);
      expect(
        await resolvePublicSlug(tx, "album_journal", "test-grace"),
      ).toEqual({ outcome: "found", entryId });

      await deleteAlbumJournal(tx, author, entryId);
      expect(await listPublicLanguageVersions(tx, entryId)).toEqual([]);
      expect(
        await resolvePublicSlug(tx, "album_journal", "test-grace"),
      ).toEqual({ outcome: "not_found" });

      await restoreAlbumJournal(tx, author, entryId);
      // Restored, live, and still not public: no version, no address.
      expect(await listPublicLanguageVersions(tx, entryId)).toEqual([]);
      expect(
        await resolvePublicSlug(tx, "album_journal", "test-grace"),
      ).toEqual({ outcome: "not_found" });

      // Only an explicit publication makes it public again, per language.
      await publishLanguageVersion(tx, entryId, "en");
      expect(
        (await listPublicLanguageVersions(tx, entryId)).map((v) => v.locale),
      ).toEqual(["en"]);
      expect(
        await resolvePublicSlug(tx, "album_journal", "test-grace"),
      ).toEqual({ outcome: "found", entryId });
    });
  });

  it("keeps slug reservations: a published slug stays reserved and current, a previous slug redirects only once it is public again", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [{ locale: "en", status: "published", publishedAt: longAgo }],
      });
      await changeEntrySlug(tx, entryId, "test-grace-renamed");
      const slugRows = async () =>
        (
          await tx.execute(sql`
            select slug, is_current, was_published from entry_slugs
             where entry_id = ${entryId} order by slug`)
        ).rows;
      const before = await slugRows();
      expect(before).toEqual([
        { slug: "test-grace", is_current: false, was_published: true },
        { slug: "test-grace-renamed", is_current: true, was_published: true },
      ]);

      await deleteAlbumJournal(tx, author, entryId);
      await restoreAlbumJournal(tx, author, entryId);
      expect(await slugRows()).toEqual(before);

      // INV-5: while the entry is not public, the old address is a 404 that
      // reveals nothing, exactly like an unknown one.
      expect(
        await resolvePublicSlug(tx, "album_journal", "test-grace"),
      ).toEqual({ outcome: "not_found" });
      expect(
        await resolvePublicSlug(tx, "album_journal", "test-grace-renamed"),
      ).toEqual({ outcome: "not_found" });
      expect(await resolvePublicSlug(tx, "album_journal", "unknown")).toEqual({
        outcome: "not_found",
      });

      await publishLanguageVersion(tx, entryId, "en");
      expect(
        await resolvePublicSlug(tx, "album_journal", "test-grace"),
      ).toEqual({ outcome: "redirect", currentSlug: "test-grace-renamed" });
    });
  });

  it("does not release a slug: a new journal about the same album still gets a different address", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const first = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "[Test] One",
      });
      await deleteAlbumJournal(tx, author, first.entryId);
      const second = await createAlbumJournal(tx, author, {
        albumId,
        locale: "en",
        body: "[Test] Two",
      });
      await restoreAlbumJournal(tx, author, first.entryId);

      const slugs = async (entryId: string) =>
        (await getAlbumJournal(tx, author, entryId))?.slug;
      expect(await slugs(first.entryId)).toBe("test-grace");
      expect(await slugs(second.entryId)).toBe("test-grace-2");
    });
  });
});

describe("what a restore refuses", () => {
  it("refuses a journal that is not in Recently deleted, and changes nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [{ locale: "en", status: "published", publishedAt: longAgo }],
      });
      const before = await preserved(tx, entryId);
      expect(
        await failure(tx, (db) => restoreAlbumJournal(db, author, entryId)),
      ).toBe("entry_not_deleted");
      // A live published journal is still published: restore is not a way to
      // unpublish.
      expect(await statuses(tx, entryId)).toEqual({ en: "published" });
      expect(await preserved(tx, entryId)).toBe(before);
      expect(await listPublicLanguageVersions(tx, entryId)).toHaveLength(1);
    });
  });

  it("answers a repeated restore with the same refusal and changes nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [{ locale: "en", status: "published", publishedAt: longAgo }],
      });
      await deleteAlbumJournal(tx, author, entryId);
      await restoreAlbumJournal(tx, author, entryId);
      const stored = async () =>
        (
          await tx.execute<{ row: string }>(sql`
            select (select to_jsonb(e) from entries e where id = ${entryId})::text
                || (select jsonb_agg(to_jsonb(t))::text
                      from entry_texts t where entry_id = ${entryId}) as row`)
        ).rows[0]!.row;
      const afterFirst = await stored();

      expect(
        await failure(tx, (db) => restoreAlbumJournal(db, author, entryId)),
      ).toBe("entry_not_deleted");
      expect(await stored()).toBe(afterFirst);
    });
  });

  it("refuses a malformed or unknown id", async () => {
    await inScratchTransaction(async (tx) => {
      for (const bad of ["", "nope", "not-a-uuid", 42, null, undefined, {}]) {
        expect(
          await failure(tx, (db) => restoreAlbumJournal(db, author, bad)),
          String(bad),
        ).toBe("invalid_input");
      }
      expect(
        await failure(tx, (db) => restoreAlbumJournal(db, author, MISSING)),
      ).toBe("entry_not_found");
    });
  });

  it("refuses an entry of another kind, even a deleted one", async () => {
    await inScratchTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, "[Test] Other");
      const memory = await createTestMemory(tx, {
        deletedAt: later,
        versions: [{ locale: "en", status: "published", publishedAt: longAgo }],
      });
      const artistJournal = await createTestArtistJournal(tx, {
        artistId,
        deletedAt: later,
        versions: [{ locale: "en", status: "published", publishedAt: longAgo }],
      });
      for (const entryId of [memory, artistJournal]) {
        expect(
          await failure(tx, (db) => restoreAlbumJournal(db, author, entryId)),
        ).toBe("entry_not_found");
        // Still deleted, still published: nothing was changed.
        expect(await deletedAt(tx, entryId)).toBeInstanceOf(Date);
        expect(await statuses(tx, entryId)).toEqual({ en: "published" });
      }
    });
  });
});

describe("restoreDeletedEntry, the Publication module's part", () => {
  it("applies the same policy to any kind of entry, in the caller's transaction", async () => {
    await inScratchTransaction(async (tx) => {
      const memory = await createTestMemory(tx, {
        deletedAt: later,
        slug: "test-memory",
        versions: [
          { locale: "en", status: "published", publishedAt: longAgo },
          { locale: "pt-BR", isOriginal: false, status: "draft" },
        ],
      });
      const result = await tx.transaction((sp) =>
        restoreDeletedEntry(sp, memory),
      );
      expect(result).toEqual({ madePrivate: ["en"] });
      expect(await statuses(tx, memory)).toEqual({
        en: "private",
        "pt-BR": "draft",
      });
      expect(await deletedAt(tx, memory)).toBeNull();
    });
  });

  it("refuses a live or unknown entry", async () => {
    await inScratchTransaction(async (tx) => {
      const live = await createTestMemory(tx, {
        versions: [{ locale: "en", status: "published", publishedAt: longAgo }],
      });
      for (const [id, expected] of [
        [live, "entry_not_deleted"],
        [MISSING, "entry_not_found"],
      ] as const) {
        const error = await captureFailure(tx, (sp) =>
          restoreDeletedEntry(sp, id),
        );
        expect(error).toBeInstanceOf(PublicationError);
        expect((error as PublicationError).failure).toBe(expected);
      }
      expect(await statuses(tx, live)).toEqual({ en: "published" });
    });
  });
});

describe("a restore is atomic", () => {
  it("rolls back the demotion when the undelete fails", async () => {
    await inScratchTransaction(async (tx) => {
      const { albumId } = await setUp(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-grace",
        versions: [
          { locale: "en", status: "published", publishedAt: longAgo },
          { locale: "pt-BR", isOriginal: false, status: "published" },
        ],
      });
      await deleteAlbumJournal(tx, author, entryId);
      const before = await preserved(tx, entryId);
      const statusesBefore = await statuses(tx, entryId);

      // The demotion runs first. A trigger that refuses the undelete makes
      // the second statement fail, which must undo the first (all or
      // nothing). The trigger is DDL inside this rolled-back transaction.
      await tx.execute(sql`
        create function pg_temp.refuse_undelete() returns trigger
        language plpgsql as $$
        begin
          if old.deleted_at is not null and new.deleted_at is null then
            raise exception 'refused for the test' using errcode = 'P0001';
          end if;
          return new;
        end $$`);
      await tx.execute(sql`
        create trigger refuse_undelete before update on entries
        for each row execute function pg_temp.refuse_undelete()`);

      const error = await captureFailure(tx, (db) =>
        restoreAlbumJournal(db, author, entryId),
      );
      expect(error).toBeDefined();
      expect(error).not.toBeInstanceOf(JournalError);

      expect(await deletedAt(tx, entryId)).toBeInstanceOf(Date);
      expect(await statuses(tx, entryId)).toEqual(statusesBefore);
      expect(await statuses(tx, entryId)).toEqual({
        en: "published",
        "pt-BR": "published",
      });
      expect(await preserved(tx, entryId)).toBe(before);
      // Deleted and published together is the stored state, never the live,
      // published one that a half-done restore would have left.
      expect(await listPublicLanguageVersions(tx, entryId)).toEqual([]);
    });
  });
});
