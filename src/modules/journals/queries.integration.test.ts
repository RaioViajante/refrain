import { describe, expect, it } from "vitest";

import { schema } from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestTrackReflection,
  inRollbackTransaction,
  testAuthor,
} from "@/testing";

import { listAlbumJournalProgress } from "./queries";

describe("listAlbumJournalProgress (AC-05, COUNT of written tracks)", () => {
  it("counts only tracks with original-language text that are not still being written", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: "[Test] Ten Tracks",
        trackTitles: Array.from(
          { length: 10 },
          (_, i) => `[Test] Track ${i + 1}`,
        ),
      });
      const journalId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        versions: [{ locale: "pt-BR" }, { locale: "en", isOriginal: false }],
      });
      const reflect = (
        index: number,
        options: Partial<Parameters<typeof createTestTrackReflection>[1]>,
      ) =>
        createTestTrackReflection(tx, {
          albumJournalId: journalId,
          albumId: album.albumId,
          trackId: album.trackIds[index]!,
          ...options,
        });

      // Written: text in the original language (pt-BR).
      await reflect(0, { texts: { "pt-BR": "[Test] Escrito" } });
      await reflect(1, {
        texts: { "pt-BR": "[Test] Escrito", en: "[Test] Written" },
        isPublished: true,
      });
      await reflect(2, {
        texts: { "pt-BR": "[Test] Escrito" },
        isFavourite: true,
      });
      await reflect(3, {
        texts: { "pt-BR": "[Test] Escrito" },
        ratingHalfSteps: 4,
      });
      // Not written:
      await reflect(4, {
        texts: { "pt-BR": "[Test] Em andamento" },
        isStillWriting: true,
      }); // still writing
      await reflect(5, { texts: { en: "[Test] Translation only" } }); // not the original language
      await reflect(6, { texts: { "pt-BR": "" } }); // empty text
      await reflect(7, { ratingHalfSteps: 8, isFavourite: true }); // no text at all

      expect(await listAlbumJournalProgress(tx, testAuthor())).toEqual([
        {
          entryId: journalId,
          albumTitle: "[Test] Ten Tracks",
          tracksWritten: 4,
          trackCount: 10,
        },
      ]);
    });
  });

  it("counts only tracks of the reference edition, so it never exceeds the track count", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, { trackTitles: ["[Test] Only"] });
      const [outside] = await tx
        .insert(schema.tracks)
        .values({ title: "[Test] Outside the reference edition" })
        .returning();
      await tx
        .insert(schema.albumTracks)
        .values({ albumId: album.albumId, trackId: outside!.id });
      const journalId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
      });
      for (const trackId of [album.trackIds[0]!, outside!.id]) {
        await createTestTrackReflection(tx, {
          albumJournalId: journalId,
          albumId: album.albumId,
          trackId,
          texts: { en: "[Test] Written" },
        });
      }

      expect(await listAlbumJournalProgress(tx, testAuthor())).toEqual([
        expect.objectContaining({ tracksWritten: 1, trackCount: 1 }),
      ]);
    });
  });

  it("lists every journal of an album separately and skips deleted ones", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, { trackTitles: ["[Test] Only"] });
      const kept = await createTestAlbumJournal(tx, { albumId: album.albumId });
      const empty = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
      });
      const deleted = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        deletedAt: new Date(),
      });
      for (const journalId of [kept, deleted]) {
        await createTestTrackReflection(tx, {
          albumJournalId: journalId,
          albumId: album.albumId,
          trackId: album.trackIds[0]!,
          texts: { en: "[Test] Written" },
        });
      }

      const progress = await listAlbumJournalProgress(tx, testAuthor());
      expect(progress).toHaveLength(2);
      expect(progress).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entryId: kept,
            tracksWritten: 1,
            trackCount: 1,
          }),
          expect.objectContaining({
            entryId: empty,
            tracksWritten: 0,
            trackCount: 1,
          }),
        ]),
      );
    });
  });
});
