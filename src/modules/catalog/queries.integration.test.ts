import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema } from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestMemory,
  inRollbackTransaction,
  testAuthor,
} from "@/testing";

import { listAlbumsWithArtists, listAlbumUsage } from "./queries";

describe("listAlbumsWithArtists (AC-04, JOIN)", () => {
  it("returns one row per credit, in title and credit order, without archived albums", async () => {
    await inRollbackTransaction(async (tx) => {
      const first = await createTestArtist(tx, "[Test] First Artist");
      const second = await createTestArtist(tx, "[Test] Second Artist");
      const duet = await createTestAlbum(tx, {
        title: "[Test] B Duet",
        artistIds: [second, first],
        firstReleaseYear: 1994,
      });
      const solo = await createTestAlbum(tx, {
        title: "[Test] A Solo",
        artistIds: [first],
      });
      const archived = await createTestAlbum(tx, {
        title: "[Test] C Archived",
        artistIds: [first],
      });
      await tx
        .update(schema.albums)
        .set({ archivedAt: sql`now()` })
        .where(eq(schema.albums.id, archived.albumId));
      // An album without credits has no row in an inner join.
      await createTestAlbum(tx, { title: "[Test] D Uncredited" });

      expect(await listAlbumsWithArtists(tx, testAuthor())).toEqual([
        {
          albumId: solo.albumId,
          title: "[Test] A Solo",
          firstReleaseYear: null,
          artistName: "[Test] First Artist",
          creditPosition: 1,
        },
        {
          albumId: duet.albumId,
          title: "[Test] B Duet",
          firstReleaseYear: 1994,
          artistName: "[Test] Second Artist",
          creditPosition: 1,
        },
        {
          albumId: duet.albumId,
          title: "[Test] B Duet",
          firstReleaseYear: 1994,
          artistName: "[Test] First Artist",
          creditPosition: 2,
        },
      ]);
    });
  });

  it("shows the name an artist is credited as on the album", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, "[Test] Legal Name");
      const { albumId } = await createTestAlbum(tx);
      await tx
        .insert(schema.albumArtists)
        .values({ albumId, artistId, position: 1, creditedAs: "[Test] Alias" });
      const [row] = await listAlbumsWithArtists(tx, testAuthor());
      expect(row?.artistName).toBe("[Test] Alias");
    });
  });
});

describe("listAlbumUsage (AC-05, subquery)", () => {
  it("counts journals and memories that use each album, excluding deleted entries", async () => {
    await inRollbackTransaction(async (tx) => {
      const used = await createTestAlbum(tx, { title: "[Test] A Used" });
      const unused = await createTestAlbum(tx, { title: "[Test] B Unused" });
      await createTestAlbumJournal(tx, { albumId: used.albumId });
      await createTestAlbumJournal(tx, { albumId: used.albumId });
      await createTestMemory(tx, { music: [{ albumId: used.albumId }] });
      await createTestAlbumJournal(tx, {
        albumId: used.albumId,
        deletedAt: new Date(),
      });
      // A memory that links one of the album's tracks, not the album itself.
      await createTestMemory(tx, { music: [{ trackId: used.trackIds[0]! }] });

      expect(await listAlbumUsage(tx, testAuthor())).toEqual([
        { albumId: used.albumId, title: "[Test] A Used", usedIn: 3 },
        { albumId: unused.albumId, title: "[Test] B Unused", usedIn: 0 },
      ]);
    });
  });
});
