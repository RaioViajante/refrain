import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestArtistJournal,
  createTestMemory,
  createTestTrackReflection,
  expectRejected,
  inRollbackTransaction,
  SqlState,
  testDocument,
} from "@/testing";

import type { Transaction } from "./client";
import * as schema from "./schema";

const { checkViolation, foreignKeyViolation, uniqueViolation } = SqlState;

async function countRows(tx: Transaction, table: string, entryId: string) {
  const column =
    table === "track_reflections" ? "album_journal_id" : "entry_id";
  const result = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}
         where ${sql.identifier(column)} = ${entryId}`,
  );
  return result.rows[0]!.n;
}

describe("entries and subtypes", () => {
  it("rejects an unknown kind and a subtype row on an entry of another kind", async () => {
    await inRollbackTransaction(async (tx) => {
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "entries_kind_check" },
        (sp) => sp.execute(sql`insert into entries (kind) values ('review')`),
      );

      const memoryId = await createTestMemory(tx);
      const { albumId } = await createTestAlbum(tx);
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "album_journals_entry_fk" },
        (sp) =>
          sp
            .insert(schema.albumJournals)
            .values({ entryId: memoryId, albumId }),
      );
    });
  });
});

describe("remaining authored-content checks", () => {
  it("pins every subtype to its own kind", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const artistId = await createTestArtist(tx);
      const albumJournalId = await createTestAlbumJournal(tx, { albumId });

      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "artist_journals_entry_fk" },
        (sp) =>
          sp
            .insert(schema.artistJournals)
            .values({ entryId: albumJournalId, artistId }),
      );
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "memories_entry_fk" },
        (sp) => sp.insert(schema.memories).values({ entryId: albumJournalId }),
      );
      const artistJournalId = await createTestArtistJournal(tx, { artistId });
      const memoryId = await createTestMemory(tx);
      for (const [table, constraint, entryId] of [
        ["album_journals", "album_journals_kind_check", albumJournalId],
        ["artist_journals", "artist_journals_kind_check", artistJournalId],
        ["memories", "memories_kind_check", memoryId],
      ] as const) {
        await expectRejected(tx, { code: checkViolation, constraint }, (sp) =>
          sp.execute(
            sql`update ${sql.identifier(table)} set kind = 'other' where entry_id = ${entryId}`,
          ),
        );
      }
      // An entry's kind cannot change under its subtype row.
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "album_journals_entry_fk" },
        (sp) =>
          sp
            .update(schema.entries)
            .set({ kind: "memory" })
            .where(eq(schema.entries.id, albumJournalId)),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "entries_version_check" },
        (sp) =>
          sp
            .update(schema.entries)
            .set({ version: 0 })
            .where(eq(schema.entries.id, albumJournalId)),
      );
    });
  });

  it("applies the locale and rich-text checks to track reflection texts", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId, trackIds } = await createTestAlbum(tx);
      const journalId = await createTestAlbumJournal(tx, { albumId });
      const reflectionId = await createTestTrackReflection(tx, {
        albumJournalId: journalId,
        albumId,
        trackId: trackIds[0]!,
      });
      const cases = [
        [
          "track_reflection_texts_locale_check",
          sql`insert into track_reflection_texts (track_reflection_id, locale) values (${reflectionId}, 'es')`,
        ],
        [
          "track_reflection_texts_body_is_document_check",
          sql`insert into track_reflection_texts (track_reflection_id, locale, body) values (${reflectionId}, 'en', '"text"')`,
        ],
        [
          "track_reflection_texts_body_text_requires_body_check",
          sql`insert into track_reflection_texts (track_reflection_id, locale, body_text) values (${reflectionId}, 'en', '[Test] orphan')`,
        ],
        [
          "track_reflection_texts_body_format_version_check",
          sql`insert into track_reflection_texts (track_reflection_id, locale, body_format_version) values (${reflectionId}, 'en', 0)`,
        ],
        [
          "entry_texts_body_format_version_check",
          sql`update entry_texts set body_format_version = 0 where entry_id = ${journalId}`,
        ],
      ] as const;
      for (const [constraint, statement] of cases) {
        await expectRejected(tx, { code: checkViolation, constraint }, (sp) =>
          sp.execute(statement),
        );
      }
    });
  });
});

describe("language versions (ADR 0002, D3)", () => {
  it("keeps independent visibility per language version", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const journalId = await createTestAlbumJournal(tx, {
        albumId,
        versions: [
          { locale: "en", status: "published" },
          { locale: "pt-BR", status: "draft", isOriginal: false },
        ],
      });
      const versions = await tx
        .select({
          locale: schema.entryTexts.locale,
          isOriginal: schema.entryTexts.isOriginal,
          status: schema.entryTexts.status,
        })
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, journalId))
        .orderBy(schema.entryTexts.locale);
      expect(versions).toEqual([
        { locale: "en", isOriginal: true, status: "published" },
        { locale: "pt-BR", isOriginal: false, status: "draft" },
      ]);
    });
  });

  it("allows one original, one version per language, and only en or pt-BR", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx);
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "entry_texts_one_original_idx" },
        (sp) =>
          sp
            .insert(schema.entryTexts)
            .values({ entryId: memoryId, locale: "pt-BR", isOriginal: true }),
      );
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "entry_texts_pkey" },
        (sp) =>
          sp
            .insert(schema.entryTexts)
            .values({ entryId: memoryId, locale: "en", isOriginal: false }),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "entry_texts_locale_check" },
        (sp) =>
          sp.execute(
            sql`insert into entry_texts (entry_id, locale, is_original)
                values (${memoryId}, 'fr', false)`,
          ),
      );
    });
  });

  it("ties published_at to the published status", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx);
      const version = and(
        eq(schema.entryTexts.entryId, memoryId),
        eq(schema.entryTexts.locale, "en"),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "entry_texts_published_at_check" },
        (sp) =>
          sp
            .update(schema.entryTexts)
            .set({ status: "published" })
            .where(version),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "entry_texts_published_at_check" },
        (sp) =>
          sp
            .update(schema.entryTexts)
            .set({ status: "private", publishedAt: new Date() })
            .where(version),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "entry_texts_status_check" },
        (sp) =>
          sp.execute(
            sql`update entry_texts set status = 'hidden' where entry_id = ${memoryId}`,
          ),
      );
      // A valid publish and unpublish.
      await tx
        .update(schema.entryTexts)
        .set({ status: "published", publishedAt: sql`now()` })
        .where(version);
      await tx
        .update(schema.entryTexts)
        .set({ status: "private", publishedAt: null })
        .where(version);
    });
  });

  it("stores rich text as a Tiptap document with a plain-text projection", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx);
      const version = and(
        eq(schema.entryTexts.entryId, memoryId),
        eq(schema.entryTexts.locale, "en"),
      );
      await expectRejected(
        tx,
        {
          code: checkViolation,
          constraint: "entry_texts_body_is_document_check",
        },
        (sp) =>
          sp
            .update(schema.entryTexts)
            .set({ body: [{ type: "paragraph" }] })
            .where(version),
      );
      await expectRejected(
        tx,
        {
          code: checkViolation,
          constraint: "entry_texts_body_text_requires_body_check",
        },
        (sp) =>
          sp
            .update(schema.entryTexts)
            .set({ body: null, bodyText: "[Test] orphan text" })
            .where(version),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "entry_texts_title_check" },
        (sp) => sp.update(schema.entryTexts).set({ title: " " }).where(version),
      );

      const document = testDocument("[Test] Saved exactly as written");
      await tx
        .update(schema.entryTexts)
        .set({ body: document, bodyText: "[Test] Saved exactly as written" })
        .where(version);
      const [saved] = await tx
        .select({ body: schema.entryTexts.body })
        .from(schema.entryTexts)
        .where(version);
      expect(saved!.body).toEqual(document);
    });
  });
});

describe("journals and featured selection (ADR 0002, D1; INV-1)", () => {
  it("allows several journals about the same album and artist", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const { albumId } = await createTestAlbum(tx);
      await createTestAlbumJournal(tx, { albumId });
      await createTestAlbumJournal(tx, { albumId });
      await createTestArtistJournal(tx, { artistId });
      await createTestArtistJournal(tx, { artistId });

      const albumJournals = await tx
        .select()
        .from(schema.albumJournals)
        .where(eq(schema.albumJournals.albumId, albumId));
      const artistJournals = await tx
        .select()
        .from(schema.artistJournals)
        .where(eq(schema.artistJournals.artistId, artistId));
      expect(albumJournals).toHaveLength(2);
      expect(artistJournals).toHaveLength(2);
    });
  });

  it("allows at most one featured journal per album and per artist", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const { albumId } = await createTestAlbum(tx);
      await createTestAlbumJournal(tx, { albumId, isFeatured: true });
      await createTestArtistJournal(tx, { artistId, isFeatured: true });

      await expectRejected(
        tx,
        {
          code: uniqueViolation,
          constraint: "album_journals_one_featured_idx",
        },
        (sp) => createTestAlbumJournal(sp, { albumId, isFeatured: true }),
      );
      await expectRejected(
        tx,
        {
          code: uniqueViolation,
          constraint: "artist_journals_one_featured_idx",
        },
        (sp) => createTestArtistJournal(sp, { artistId, isFeatured: true }),
      );
    });
  });

  it("moves the feature in one transaction and rolls back a failed move", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const older = await createTestAlbumJournal(tx, {
        albumId,
        isFeatured: true,
      });
      const newer = await createTestAlbumJournal(tx, { albumId });

      const featured = async () =>
        (
          await tx
            .select({ entryId: schema.albumJournals.entryId })
            .from(schema.albumJournals)
            .where(
              and(
                eq(schema.albumJournals.albumId, albumId),
                eq(schema.albumJournals.isFeatured, true),
              ),
            )
        ).map((row) => row.entryId);

      // Wrong order: setting the new one first violates the index, and the
      // whole move is rolled back.
      await expectRejected(
        tx,
        {
          code: uniqueViolation,
          constraint: "album_journals_one_featured_idx",
        },
        async (sp) => {
          await sp
            .update(schema.albumJournals)
            .set({ isFeatured: true })
            .where(eq(schema.albumJournals.entryId, newer));
          await sp
            .update(schema.albumJournals)
            .set({ isFeatured: false })
            .where(eq(schema.albumJournals.entryId, older));
        },
      );
      expect(await featured()).toEqual([older]);

      // Transaction boundary 5: clear the previous one, then set the new one.
      await tx.transaction(async (sp) => {
        await sp
          .update(schema.albumJournals)
          .set({ isFeatured: false })
          .where(eq(schema.albumJournals.entryId, older));
        await sp
          .update(schema.albumJournals)
          .set({ isFeatured: true })
          .where(eq(schema.albumJournals.entryId, newer));
      });
      expect(await featured()).toEqual([newer]);
    });
  });
});

describe("ratings and favourites (ADR 0002, D5.3)", () => {
  it("accepts 1 to 10 half steps or no rating, and rejects anything else", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId, trackIds } = await createTestAlbum(tx);
      for (const ratingHalfSteps of [1, 10, null]) {
        await createTestAlbumJournal(tx, { albumId, ratingHalfSteps });
      }
      for (const ratingHalfSteps of [0, 11, -1]) {
        await expectRejected(
          tx,
          {
            code: checkViolation,
            constraint: "album_journals_rating_half_steps_check",
          },
          (sp) => createTestAlbumJournal(sp, { albumId, ratingHalfSteps }),
        );
      }

      const journalId = await createTestAlbumJournal(tx, { albumId });
      for (const ratingHalfSteps of [0, 11]) {
        await expectRejected(
          tx,
          {
            code: checkViolation,
            constraint: "track_reflections_rating_half_steps_check",
          },
          (sp) =>
            createTestTrackReflection(sp, {
              albumJournalId: journalId,
              albumId,
              trackId: trackIds[0]!,
              ratingHalfSteps,
            }),
        );
      }
    });
  });

  it("keeps the favourite mark, track ratings, and album rating independent", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId, trackIds } = await createTestAlbum(tx);
      const journalId = await createTestAlbumJournal(tx, {
        albumId,
        ratingHalfSteps: 3,
      });
      await createTestTrackReflection(tx, {
        albumJournalId: journalId,
        albumId,
        trackId: trackIds[0]!,
        isFavourite: true,
      });
      await createTestTrackReflection(tx, {
        albumJournalId: journalId,
        albumId,
        trackId: trackIds[1]!,
        ratingHalfSteps: 10,
      });

      const reflections = await tx
        .select({
          isFavourite: schema.trackReflections.isFavourite,
          ratingHalfSteps: schema.trackReflections.ratingHalfSteps,
        })
        .from(schema.trackReflections)
        .where(eq(schema.trackReflections.albumJournalId, journalId))
        .orderBy(schema.trackReflections.isFavourite);
      expect(reflections).toEqual([
        { isFavourite: false, ratingHalfSteps: 10 },
        { isFavourite: true, ratingHalfSteps: null },
      ]);
      const [journal] = await tx
        .select({ rating: schema.albumJournals.ratingHalfSteps })
        .from(schema.albumJournals)
        .where(eq(schema.albumJournals.entryId, journalId));
      expect(journal!.rating).toBe(3);
    });
  });
});

describe("track reflections (ADR 0002, D2.3 and D5)", () => {
  it("accepts reflections only on the journal's album and its recordings, once each", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx);
      const other = await createTestAlbum(tx, { title: "[Test] Other" });
      const journalId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
      });

      // A recording of another album.
      await expectRejected(
        tx,
        {
          code: foreignKeyViolation,
          constraint: "track_reflections_album_track_fk",
        },
        (sp) =>
          createTestTrackReflection(sp, {
            albumJournalId: journalId,
            albumId: album.albumId,
            trackId: other.trackIds[0]!,
          }),
      );
      // An album that is not the journal's album.
      await expectRejected(
        tx,
        {
          code: foreignKeyViolation,
          constraint: "track_reflections_journal_fk",
        },
        (sp) =>
          createTestTrackReflection(sp, {
            albumJournalId: journalId,
            albumId: other.albumId,
            trackId: other.trackIds[0]!,
          }),
      );
      // A second reflection on the same recording in the same journal.
      await createTestTrackReflection(tx, {
        albumJournalId: journalId,
        albumId: album.albumId,
        trackId: album.trackIds[0]!,
      });
      await expectRejected(
        tx,
        {
          code: uniqueViolation,
          constraint: "track_reflections_journal_track_unique",
        },
        (sp) =>
          createTestTrackReflection(sp, {
            albumJournalId: journalId,
            albumId: album.albumId,
            trackId: album.trackIds[0]!,
          }),
      );
    });
  });

  it("defaults to unpublished, not still writing, not favourite, unrated", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId, trackIds } = await createTestAlbum(tx);
      const journalId = await createTestAlbumJournal(tx, { albumId });
      const [reflection] = await tx
        .insert(schema.trackReflections)
        .values({ albumJournalId: journalId, albumId, trackId: trackIds[0]! })
        .returning();
      expect(reflection).toMatchObject({
        isPublished: false,
        isStillWriting: false,
        isFavourite: false,
        ratingHalfSteps: null,
      });
    });
  });
});

describe("memory music", () => {
  it("links exactly one track or album per item", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId, trackIds } = await createTestAlbum(tx);
      const memoryId = await createTestMemory(tx);
      for (const item of [{}, { albumId, trackId: trackIds[0]! }]) {
        await expectRejected(
          tx,
          { code: checkViolation, constraint: "memory_music_one_item_check" },
          (sp) =>
            sp
              .insert(schema.memoryMusic)
              .values({ memoryId, position: 1, ...item }),
        );
      }
      await tx
        .insert(schema.memoryMusic)
        .values({ memoryId, position: 1, trackId: trackIds[0]! });
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "memory_music_track_unique" },
        (sp) =>
          sp
            .insert(schema.memoryMusic)
            .values({ memoryId, position: 2, trackId: trackIds[0]! }),
      );
      await tx
        .insert(schema.memoryMusic)
        .values({ memoryId, position: 2, albumId });
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "memory_music_album_unique" },
        (sp) =>
          sp
            .insert(schema.memoryMusic)
            .values({ memoryId, position: 3, albumId }),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "memory_music_position_check" },
        (sp) =>
          sp
            .insert(schema.memoryMusic)
            .values({ memoryId, position: 0, trackId: trackIds[1]! }),
      );
    });
  });

  it("reorders in one transaction and checks positions at commit", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId, trackIds } = await createTestAlbum(tx);
      const memoryId = await createTestMemory(tx, {
        music: [{ trackId: trackIds[0]! }, { albumId }],
      });
      const order = async () =>
        (
          await tx
            .select({
              trackId: schema.memoryMusic.trackId,
              albumId: schema.memoryMusic.albumId,
            })
            .from(schema.memoryMusic)
            .where(eq(schema.memoryMusic.memoryId, memoryId))
            .orderBy(schema.memoryMusic.position)
        ).map((row) => row.trackId ?? row.albumId);

      // Swap positions 1 and 2 with ordinary UPDATEs; the deferred unique
      // constraint is checked only at the end.
      await tx.transaction(async (sp) => {
        await sp.execute(sql`update memory_music set position = 2
                              where memory_id = ${memoryId} and track_id is not null`);
        await sp.execute(sql`update memory_music set position = 1
                              where memory_id = ${memoryId} and album_id is not null`);
        await sp.execute(
          sql`set constraints memory_music_position_unique immediate`,
        );
      });
      expect(await order()).toEqual([albumId, trackIds[0]]);

      // A duplicate position fails once the constraint is checked.
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "memory_music_position_unique" },
        async (sp) => {
          await sp.execute(sql`update memory_music set position = 1
                                where memory_id = ${memoryId}`);
          await sp.execute(
            sql`set constraints memory_music_position_unique immediate`,
          );
        },
      );
      await tx.execute(
        sql`set constraints memory_music_position_unique deferred`,
      );
    });
  });

  it("removing music from a memory deletes only the link", async () => {
    await inRollbackTransaction(async (tx) => {
      const { trackIds } = await createTestAlbum(tx);
      const memoryId = await createTestMemory(tx, {
        music: [{ trackId: trackIds[0]! }],
      });
      await tx
        .delete(schema.memoryMusic)
        .where(eq(schema.memoryMusic.memoryId, memoryId));
      const tracks = await tx
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.id, trackIds[0]!));
      expect(tracks).toHaveLength(1);
    });
  });
});

describe("slugs (ADR 0002, D7)", () => {
  it.each([
    "",
    "Grace",
    "-grace",
    "grace-",
    "gr--ace",
    "março",
    "a b",
    "a".repeat(81),
  ])("rejects the non-normalized slug %j", async (slug) => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx);
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "entry_slugs_slug_format_check" },
        (sp) =>
          sp.insert(schema.entrySlugs).values({
            kind: "memory",
            slug,
            entryId: memoryId,
            isCurrent: true,
          }),
      );
    });
  });

  it("reserves current and previous slugs per kind", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const first = await createTestMemory(tx, { slug: "test-first" });
      const second = await createTestMemory(tx, { slug: "test-second" });

      // Transaction boundary 6: change the first memory's slug.
      await tx.transaction(async (sp) => {
        await sp
          .update(schema.entrySlugs)
          .set({ isCurrent: false })
          .where(eq(schema.entrySlugs.entryId, first));
        await sp.insert(schema.entrySlugs).values({
          kind: "memory",
          slug: "test-first-renamed",
          entryId: first,
          isCurrent: true,
        });
      });

      // The previous slug cannot be taken by another memory...
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "entry_slugs_pkey" },
        (sp) =>
          sp.insert(schema.entrySlugs).values({
            kind: "memory",
            slug: "test-first",
            entryId: second,
            isCurrent: false,
          }),
      );
      // ...nor can a current one.
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "entry_slugs_pkey" },
        (sp) => createTestMemory(sp, { slug: "test-first-renamed" }),
      );
      // The same slug is free for another kind of entry.
      await createTestAlbumJournal(tx, { albumId, slug: "test-first" });
      // An entry has one current slug.
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "entry_slugs_one_current_idx" },
        (sp) =>
          sp.insert(schema.entrySlugs).values({
            kind: "memory",
            slug: "test-second-again",
            entryId: second,
            isCurrent: true,
          }),
      );
      // A slug row must match its entry's kind.
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "entry_slugs_entry_fk" },
        (sp) =>
          sp.insert(schema.entrySlugs).values({
            kind: "album_journal",
            slug: "test-wrong-kind",
            entryId: second,
            isCurrent: false,
          }),
      );
    });
  });
});

describe("deletion and recovery (ADR 0002, D4; INV-4)", () => {
  it("soft-deletes and restores an entry with its versions unchanged", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const journalId = await createTestAlbumJournal(tx, {
        albumId,
        versions: [{ locale: "en", status: "published" }],
      });
      const versionsBefore = await tx
        .select()
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, journalId));

      await tx
        .update(schema.entries)
        .set({ deletedAt: sql`now()` })
        .where(eq(schema.entries.id, journalId));
      await tx
        .update(schema.entries)
        .set({ deletedAt: null })
        .where(eq(schema.entries.id, journalId));

      const [entry] = await tx
        .select({ deletedAt: schema.entries.deletedAt })
        .from(schema.entries)
        .where(eq(schema.entries.id, journalId));
      expect(entry!.deletedAt).toBeNull();
      const versionsAfter = await tx
        .select()
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, journalId));
      expect(versionsAfter).toEqual(versionsBefore);
    });
  });

  it("keeps deleted entries indefinitely: nothing purges them", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx, {
        deletedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
      });
      const [entry] = await tx
        .select()
        .from(schema.entries)
        .where(eq(schema.entries.id, memoryId));
      expect(entry).toBeDefined();

      // No trigger, event trigger, or rule in the database could remove
      // deleted writing. (No purge job exists in the codebase either.)
      const triggers = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_trigger where not tgisinternal`,
      );
      expect(triggers.rows[0]!.n).toBe(0);
      const eventTriggers = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_event_trigger`,
      );
      expect(eventTriggers.rows[0]!.n).toBe(0);
      const rules = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_rules where schemaname = 'public'`,
      );
      expect(rules.rows[0]!.n).toBe(0);
    });
  });

  it("permanently deletes an entry with only the rows it owns", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx);
      const journalId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        versions: [
          { locale: "en", status: "published" },
          { locale: "pt-BR", isOriginal: false },
        ],
        slug: "test-to-delete",
      });
      await createTestTrackReflection(tx, {
        albumJournalId: journalId,
        albumId: album.albumId,
        trackId: album.trackIds[0]!,
        texts: { en: "[Test] Reflection", "pt-BR": "[Test] Reflexão" },
      });

      await tx.delete(schema.entries).where(eq(schema.entries.id, journalId));

      for (const table of [
        "entry_texts",
        "album_journals",
        "track_reflections",
        "entry_slugs",
      ]) {
        expect(await countRows(tx, table, journalId), table).toBe(0);
      }
      const texts = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from track_reflection_texts`,
      );
      expect(texts.rows[0]!.n).toBe(0);

      // The catalog is untouched.
      const albums = await tx
        .select()
        .from(schema.albums)
        .where(eq(schema.albums.id, album.albumId));
      expect(albums).toHaveLength(1);
      const memberships = await tx
        .select()
        .from(schema.albumTracks)
        .where(eq(schema.albumTracks.albumId, album.albumId));
      expect(memberships).toHaveLength(album.trackIds.length);

      // ADR 0003: the slug is released by the permanent deletion.
      await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        slug: "test-to-delete",
      });
    });
  });
});

describe("permanent deletion of memories and artist journals", () => {
  it("removes a memory with its links and versions, leaving the music", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId, trackIds } = await createTestAlbum(tx);
      const memoryId = await createTestMemory(tx, {
        versions: [{ locale: "en" }, { locale: "pt-BR", isOriginal: false }],
        slug: "test-memory-to-delete",
        music: [{ trackId: trackIds[0]! }, { albumId }],
      });

      await tx.delete(schema.entries).where(eq(schema.entries.id, memoryId));

      for (const table of ["entry_texts", "memories", "entry_slugs"]) {
        expect(await countRows(tx, table, memoryId), table).toBe(0);
      }
      expect(
        await tx.$count(
          schema.memoryMusic,
          eq(schema.memoryMusic.memoryId, memoryId),
        ),
      ).toBe(0);
      expect(
        await tx.$count(schema.tracks, eq(schema.tracks.id, trackIds[0]!)),
      ).toBe(1);
      expect(
        await tx.$count(schema.albums, eq(schema.albums.id, albumId)),
      ).toBe(1);
    });
  });

  it("removes an artist journal with its versions, leaving the artist", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const journalId = await createTestArtistJournal(tx, {
        artistId,
        isFeatured: true,
        versions: [{ locale: "pt-BR", status: "published" }],
        slug: "test-artist-journal-to-delete",
      });

      await tx.delete(schema.entries).where(eq(schema.entries.id, journalId));

      for (const table of ["entry_texts", "artist_journals", "entry_slugs"]) {
        expect(await countRows(tx, table, journalId), table).toBe(0);
      }
      expect(
        await tx.$count(schema.artists, eq(schema.artists.id, artistId)),
      ).toBe(1);
    });
  });
});

describe("transactions (data model, transaction boundaries)", () => {
  it("rolls back a whole entry creation when one row is invalid", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      await createTestAlbumJournal(tx, { albumId, slug: "test-taken" });
      const entriesBefore = await tx.$count(schema.entries);
      const textsBefore = await tx.$count(schema.entryTexts);

      // Transaction boundary 2: entry, original version, slug, and subtype.
      // The slug insert fails because the slug is taken, so the entry and
      // version inserted before it may not remain.
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "entry_slugs_pkey" },
        (sp) => createTestAlbumJournal(sp, { albumId, slug: "test-taken" }),
      );

      expect(await tx.$count(schema.entries)).toBe(entriesBefore);
      expect(await tx.$count(schema.entryTexts)).toBe(textsBefore);
      expect(
        await tx.$count(
          schema.albumJournals,
          eq(schema.albumJournals.albumId, albumId),
        ),
      ).toBe(1);
    });
  });

  it("commits a valid multi-row creation atomically", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const journalId = await tx.transaction((sp) =>
        createTestAlbumJournal(sp, {
          albumId,
          versions: [{ locale: "en" }],
          slug: "test-created",
        }),
      );
      expect(await countRows(tx, "entry_texts", journalId)).toBe(1);
      expect(await countRows(tx, "album_journals", journalId)).toBe(1);
      expect(await countRows(tx, "entry_slugs", journalId)).toBe(1);
    });
  });
});
