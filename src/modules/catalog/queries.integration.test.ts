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
import { setTestArtistPhoto } from "@/testing/public-artists";
import { commonsThumbnail, PHOTO } from "@/testing/wikimedia-fixtures";

import {
  getAlbumCover,
  listAlbumCovers,
  listArtistPhotos,
  listAlbumsWithArtists,
  listAlbumUsage,
  listRecordingChoices,
} from "./queries";

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

describe("listRecordingChoices (M3.6, the memory picker)", () => {
  it("lists each recording that is not archived, with the facts that tell same-named ones apart", async () => {
    await inRollbackTransaction(async (tx) => {
      const author = testAuthor();
      const singer = await createTestArtist(tx, "[Test] Singer");
      const band = await createTestArtist(tx, "[Test] Band");
      const album = await createTestAlbum(tx, {
        title: "[Test] Choice Album",
        trackTitles: ["[Test] Twin Title", "[Test] Archived Choice"],
      });
      const [onAlbum, archived] = album.trackIds as [string, string];
      const [single] = await tx
        .insert(schema.tracks)
        .values({ title: "[Test] Twin Title", lengthMs: 185_000 })
        .returning({ id: schema.tracks.id });
      await tx.insert(schema.trackArtists).values([
        { trackId: onAlbum, artistId: band, position: 1 },
        { trackId: onAlbum, artistId: singer, position: 2 },
        { trackId: single!.id, artistId: singer, position: 1 },
      ]);
      await tx
        .update(schema.tracks)
        .set({ archivedAt: sql`now()` })
        .where(eq(schema.tracks.id, archived));

      const choices = (await listRecordingChoices(tx, author)).filter(
        (choice) => choice.title.startsWith("[Test] "),
      );
      const twins = choices.filter(
        (choice) => choice.title === "[Test] Twin Title",
      );
      // Two recordings, never merged, each with only what the catalog says.
      expect(twins).toHaveLength(2);
      expect(twins).toContainEqual({
        trackId: onAlbum,
        title: "[Test] Twin Title",
        artists: [
          { id: band, name: "[Test] Band" },
          { id: singer, name: "[Test] Singer" },
        ],
        albums: ["[Test] Choice Album"],
        lengthMs: null,
        archived: false,
      });
      expect(twins).toContainEqual({
        trackId: single!.id,
        title: "[Test] Twin Title",
        artists: [{ id: singer, name: "[Test] Singer" }],
        albums: [],
        lengthMs: 185_000,
        archived: false,
      });
      expect(choices.map((choice) => choice.trackId)).not.toContain(archived);
    });
  });
});

describe("listAlbumCovers and getAlbumCover", () => {
  const release = "3f8c4f8e-0000-4000-8000-000000000123";
  const stored = `https://coverartarchive.org/release/${release}/1000000001`;

  it("returns the addresses built from a valid stored cover, and nothing for an album without one", async () => {
    await inRollbackTransaction(async (tx) => {
      const covered = await createTestAlbum(tx, { title: "[Test] Covered" });
      const bare = await createTestAlbum(tx, { title: "[Test] Bare" });
      await tx
        .update(schema.albums)
        .set({ coverUrl: stored, coverSource: "Cover Art Archive" })
        .where(eq(schema.albums.id, covered.albumId));

      const covers = await listAlbumCovers(tx, testAuthor());
      expect(covers.get(covered.albumId)).toEqual({
        src: `${stored}-500.jpg`,
        srcSet: `${stored}-250.jpg 250w, ${stored}-500.jpg 500w, ${stored}-1200.jpg 1200w`,
      });
      expect(covers.has(bare.albumId)).toBe(false);
      expect(await getAlbumCover(tx, testAuthor(), covered.albumId)).toEqual(
        covers.get(covered.albumId),
      );
      expect(await getAlbumCover(tx, testAuthor(), bare.albumId)).toBeNull();
    });
  });

  it("leaves out a stored value that does not parse, so no stored address reaches a page", async () => {
    await inRollbackTransaction(async (tx) => {
      const tampered = await createTestAlbum(tx, { title: "[Test] Tampered" });
      const foreign = await createTestAlbum(tx, { title: "[Test] Foreign" });
      await tx
        .update(schema.albums)
        .set({
          coverUrl: "https://example.org/cover.jpg",
          coverSource: "Cover Art Archive",
        })
        .where(eq(schema.albums.id, tampered.albumId));
      await tx
        .update(schema.albums)
        .set({ coverUrl: stored, coverSource: "Another Source" })
        .where(eq(schema.albums.id, foreign.albumId));

      const covers = await listAlbumCovers(tx, testAuthor());
      expect(covers.has(tampered.albumId)).toBe(false);
      expect(covers.has(foreign.albumId)).toBe(false);
      expect(
        await getAlbumCover(tx, testAuthor(), tampered.albumId),
      ).toBeNull();
    });
  });
});

describe("listArtistPhotos", () => {
  const testPhoto = {
    fileName: PHOTO.onStage,
    credit: "[Test] Photographer One",
    license: "CC BY-SA 4.0",
  };

  it("returns the addresses rebuilt from a valid photograph, and nothing for an artist without one", async () => {
    await inRollbackTransaction(async (tx) => {
      const pictured = await createTestArtist(tx, "[Test] Pictured");
      const bare = await createTestArtist(tx, "[Test] No Picture");
      await setTestArtistPhoto(tx, pictured, testPhoto);

      const photos = await listArtistPhotos(tx, testAuthor());
      expect(photos.get(pictured)?.src).toBe(
        commonsThumbnail(PHOTO.onStage, 330),
      );
      expect(photos.get(pictured)?.srcSet).toContain("330w");
      expect(photos.has(bare)).toBe(false);
    });
  });

  it("leaves out a row whose columns are not exactly what Refrain writes", async () => {
    await inRollbackTransaction(async (tx) => {
      const foreign = await createTestArtist(tx, "[Test] Foreign Address");
      const unlicensed = await createTestArtist(tx, "[Test] Unknown License");
      const foreignSource = await createTestArtist(tx, "[Test] Foreign Source");
      for (const artist of [foreign, unlicensed, foreignSource]) {
        await setTestArtistPhoto(tx, artist, testPhoto);
      }
      await tx
        .update(schema.artists)
        .set({ photoUrl: "https://example.org/photo.jpg" })
        .where(eq(schema.artists.id, foreign));
      await tx
        .update(schema.artists)
        .set({ photoLicense: "All rights reserved" })
        .where(eq(schema.artists.id, unlicensed));
      await tx
        .update(schema.artists)
        .set({ photoSourceUrl: "https://example.org/wiki/File:Other.jpg" })
        .where(eq(schema.artists.id, foreignSource));

      const photos = await listArtistPhotos(tx, testAuthor());
      expect(photos.has(foreign)).toBe(false);
      expect(photos.has(unlicensed)).toBe(false);
      expect(photos.has(foreignSource)).toBe(false);
    });
  });
});
