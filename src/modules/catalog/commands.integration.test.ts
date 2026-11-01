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
  createTestTrackReflection,
  inRollbackTransaction,
  testAuthor,
} from "@/testing";

import {
  addTrackToAlbum,
  archiveAlbum,
  archiveArtist,
  archiveTrack,
  createAlbum,
  createArtist,
  createTrack,
  deleteAlbum,
  deleteArtist,
  deleteTrack,
  moveTrackInAlbum,
  removeTrackFromAlbum,
  restoreAlbum,
  restoreArtist,
  restoreTrack,
  setAlbumTracklist,
  updateAlbum,
  updateArtist,
  updateTrack,
} from "./commands";
import { CatalogError } from "./errors";
import {
  getAlbum,
  getArtist,
  getCatalogStatistics,
  getTrack,
  listAlbumTrackCounts,
  listArtists,
  listTracks,
} from "./queries";

const author = testAuthor();
const MISSING = "00000000-0000-4000-8000-00000000dead";
const MB_ID = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";
const OTHER_MB_ID = "e134b52f-7aee-4f07-aaa8-d5c8d4a4b7a4";

// The domain failure a command raised, or `undefined` if it succeeded.
async function failure(
  tx: Transaction,
  work: (db: Transaction) => Promise<unknown>,
) {
  const error = await captureFailure(tx, work);
  if (error === undefined) {
    return undefined;
  }
  expect(error).toBeInstanceOf(CatalogError);
  return error as CatalogError;
}

async function count(tx: Transaction, table: string): Promise<number> {
  const result = await tx.execute<{ n: number }>(
    sql.raw(`select count(*)::int as n from ${table}`),
  );
  return result.rows[0]!.n;
}

describe("artists", () => {
  it("creates, reads, updates, and trims an artist", async () => {
    await inRollbackTransaction(async (tx) => {
      const { id } = await createArtist(tx, author, {
        name: "  [Test] Band   ",
        sortName: "",
        kind: "group",
        mbArtistId: MB_ID.toUpperCase(),
      });
      expect(await getArtist(tx, author, id)).toMatchObject({
        id,
        name: "[Test] Band",
        sortName: null,
        kind: "group",
        mbArtistId: MB_ID,
        archived: false,
        albumCount: 0,
        trackCount: 0,
        journalCount: 0,
      });

      await updateArtist(tx, author, id, {
        name: "[Test] Renamed",
        sortName: "Renamed, [Test]",
        kind: "person",
        mbArtistId: null,
      });
      expect(await getArtist(tx, author, id)).toMatchObject({
        name: "[Test] Renamed",
        sortName: "Renamed, [Test]",
        kind: "person",
        mbArtistId: null,
      });
    });
  });

  it("never lets input reach a column the schema does not name", async () => {
    await inRollbackTransaction(async (tx) => {
      const { id } = await createArtist(tx, author, {
        name: "[Test] Artist",
        kind: "person",
        archivedAt: "2020-01-01T00:00:00Z",
        id: MISSING,
        createdAt: "1999-01-01T00:00:00Z",
      });
      expect(id).not.toBe(MISSING);
      const artist = await getArtist(tx, author, id);
      expect(artist?.archived).toBe(false);
    });
  });

  it("rejects invalid input with fixed field codes and writes nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const cases: [unknown, Record<string, string>][] = [
        [{ name: "", kind: "person" }, { name: "required" }],
        [{ name: "   ", kind: "person" }, { name: "required" }],
        [{ name: "x".repeat(201), kind: "person" }, { name: "too_long" }],
        [{ name: "[Test] A", kind: "robot" }, { kind: "invalid" }],
        [{ name: "[Test] A", kind: "person", mbArtistId: "nope" }, { mbArtistId: "invalid" }],
        [{ kind: "person" }, { name: "invalid" }],
        ["not an object", { _: "invalid" }],
        [null, { _: "invalid" }],
      ];
      for (const [input, fields] of cases) {
        const error = await failure(tx, (db) => createArtist(db, author, input));
        expect(error?.failure).toBe("invalid_input");
        expect(error?.details.fields).toEqual(fields);
        // The submitted value is never echoed.
        expect(JSON.stringify(error?.details)).not.toContain("nope");
      }
      expect(await count(tx, "artists")).toBe(0);
    });
  });

  it("strips control characters the database cannot store", async () => {
    await inRollbackTransaction(async (tx) => {
      const { id } = await createArtist(tx, author, {
        name: "[Test] Nul\u0000 Band\ud800",
        kind: "group",
      });
      const artist = await getArtist(tx, author, id);
      expect(artist?.name).toBe("[Test] Nul Band�");
    });
  });

  it("reports a duplicate MusicBrainz identifier without a database error", async () => {
    await inRollbackTransaction(async (tx) => {
      await createArtist(tx, author, {
        name: "[Test] One",
        kind: "person",
        mbArtistId: MB_ID,
      });
      const duplicate = await failure(tx, (db) =>
        createArtist(db, author, {
          name: "[Test] Two",
          kind: "person",
          mbArtistId: MB_ID,
        }),
      );
      expect(duplicate?.failure).toBe("duplicate_identifier");
      expect(duplicate?.message).not.toContain(MB_ID);

      const other = await createArtist(tx, author, {
        name: "[Test] Three",
        kind: "person",
        mbArtistId: OTHER_MB_ID,
      });
      const update = await failure(tx, (db) =>
        updateArtist(db, author, other.id, {
          name: "[Test] Three",
          kind: "person",
          mbArtistId: MB_ID,
        }),
      );
      expect(update?.failure).toBe("duplicate_identifier");
    });
  });

  it("reports missing records and malformed ids as such", async () => {
    await inRollbackTransaction(async (tx) => {
      const input = { name: "[Test] A", kind: "person" };
      for (const run of [
        (db: Transaction) => updateArtist(db, author, MISSING, input),
        (db: Transaction) => archiveArtist(db, author, MISSING),
        (db: Transaction) => restoreArtist(db, author, MISSING),
        (db: Transaction) => deleteArtist(db, author, MISSING),
      ]) {
        expect((await failure(tx, run))?.failure).toBe("not_found");
      }
      expect(
        (await failure(tx, (db) => deleteArtist(db, author, "not-a-uuid")))
          ?.failure,
      ).toBe("invalid_input");
      expect(await getArtist(tx, author, "not-a-uuid")).toBeNull();
      expect(await getArtist(tx, author, MISSING)).toBeNull();
    });
  });

  it("archives and restores without deleting, and keeps credits", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, "[Test] Archived");
      const album = await createTestAlbum(tx, { artistIds: [artistId] });

      await archiveArtist(tx, author, artistId);
      await archiveArtist(tx, author, artistId); // idempotent
      const archived = await getArtist(tx, author, artistId);
      expect(archived).toMatchObject({ archived: true, albumCount: 1 });
      expect(archived?.albums.map((a) => a.id)).toEqual([album.albumId]);

      await restoreArtist(tx, author, artistId);
      expect((await getArtist(tx, author, artistId))?.archived).toBe(false);
    });
  });

  it("deletes an unreferenced artist and refuses a referenced one", async () => {
    await inRollbackTransaction(async (tx) => {
      const free = await createTestArtist(tx, "[Test] Free");
      await deleteArtist(tx, author, free);
      expect(await getArtist(tx, author, free)).toBeNull();

      const credited = await createTestArtist(tx, "[Test] Credited");
      await createTestAlbum(tx, { artistIds: [credited] });
      const onAlbum = await failure(tx, (db) =>
        deleteArtist(db, author, credited),
      );
      expect(onAlbum).toMatchObject({
        failure: "in_use",
        details: { blockedBy: "album_credits" },
      });

      const journaled = await createTestArtist(tx, "[Test] Journaled");
      await createTestArtistJournal(tx, { artistId: journaled });
      const withJournal = await failure(tx, (db) =>
        deleteArtist(db, author, journaled),
      );
      expect(withJournal).toMatchObject({
        failure: "in_use",
        details: { blockedBy: "journals" },
      });
      // Nothing was deleted.
      expect(await getArtist(tx, author, credited)).not.toBeNull();
      expect(await getArtist(tx, author, journaled)).not.toBeNull();
    });
  });

  it("counts albums, tracks, and journals without multiplying them", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, "[Test] Counted");
      await createTestAlbum(tx, {
        title: "[Test] One",
        artistIds: [artistId],
        trackTitles: ["[Test] a", "[Test] b", "[Test] c"],
      });
      await createTestAlbum(tx, { title: "[Test] Two", artistIds: [artistId] });
      const { id: trackId } = await createTrack(tx, author, {
        title: "[Test] Credited track",
        artistIds: [artistId],
      });
      await createTestArtistJournal(tx, { artistId });
      await createTestArtistJournal(tx, {
        artistId,
        deletedAt: new Date("2026-01-01T00:00:00Z"),
      });

      const summary = (await listArtists(tx, author)).find(
        (artist) => artist.id === artistId,
      );
      expect(trackId).toBeTruthy();
      expect(summary).toMatchObject({
        albumCount: 2,
        trackCount: 1,
        journalCount: 1, // the deleted journal is not counted
      });
    });
  });
});

describe("albums", () => {
  it("creates an album with its reference edition and ordered credits", async () => {
    await inRollbackTransaction(async (tx) => {
      const first = await createTestArtist(tx, "[Test] First");
      const second = await createTestArtist(tx, "[Test] Second");
      const { id } = await createAlbum(tx, author, {
        title: "  [Test] Grace  ",
        firstReleaseYear: 1994,
        mbReleaseGroupId: MB_ID,
        credits: [
          { artistId: second },
          { artistId: first, creditedAs: "  The First  " },
        ],
        edition: { label: "[Test] Label", releaseDate: "1994-08-23", country: "us" },
      });

      expect(await getAlbum(tx, author, id)).toEqual({
        id,
        title: "[Test] Grace",
        firstReleaseYear: 1994,
        mbReleaseGroupId: MB_ID,
        archived: false,
        credits: [
          { artistId: second, artistName: "[Test] Second", creditedAs: null, archived: false },
          { artistId: first, artistName: "[Test] First", creditedAs: "The First", archived: false },
        ],
        edition: { label: "[Test] Label", releaseDate: "1994-08-23", country: "US" },
        tracklist: [],
      });

      const editions = await tx
        .select()
        .from(schema.albumEditions)
        .where(eq(schema.albumEditions.albumId, id));
      expect(editions).toHaveLength(1);
      expect(editions[0]?.isReference).toBe(true);
    });
  });

  it("does not assume titles are unique", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const input = { title: "[Test] Same Title", credits: [{ artistId }] };
      const a = await createAlbum(tx, author, input);
      const b = await createAlbum(tx, author, input);
      expect(a.id).not.toBe(b.id);
    });
  });

  it("validates credits, year, date, and country", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const credits = [{ artistId }];
      const cases: [Record<string, unknown>, string][] = [
        [{ title: "[Test] A", credits: [] }, "credits"],
        [{ title: "[Test] A", credits: [{ artistId }, { artistId }] }, "credits"],
        [{ title: "[Test] A", credits: [{ artistId: "nope" }] }, "credits.0.artistId"],
        [{ title: "[Test] A", credits, firstReleaseYear: 1799 }, "firstReleaseYear"],
        [{ title: "[Test] A", credits, firstReleaseYear: 2101 }, "firstReleaseYear"],
        [{ title: "[Test] A", credits, firstReleaseYear: 1994.5 }, "firstReleaseYear"],
        [{ title: "[Test] A", credits, edition: { releaseDate: "1994-02-30" } }, "edition.releaseDate"],
        [{ title: "[Test] A", credits, edition: { releaseDate: "yesterday" } }, "edition.releaseDate"],
        [{ title: "[Test] A", credits, edition: { country: "USA" } }, "edition.country"],
        [{ title: "", credits }, "title"],
      ];
      for (const [input, field] of cases) {
        const error = await failure(tx, (db) => createAlbum(db, author, input));
        expect(error?.failure, JSON.stringify(input)).toBe("invalid_input");
        expect(Object.keys(error?.details.fields ?? {}), field).toContain(field);
      }
      expect(await count(tx, "albums")).toBe(0);
    });
  });

  it("rolls back the whole album when a credit cannot be written", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const missing = await failure(tx, (db) =>
        createAlbum(db, author, {
          title: "[Test] Partial",
          credits: [{ artistId }, { artistId: MISSING }],
        }),
      );
      expect(missing?.failure).toBe("not_found");

      await createAlbum(tx, author, {
        title: "[Test] First",
        mbReleaseGroupId: MB_ID,
        credits: [{ artistId }],
      });
      const duplicate = await failure(tx, (db) =>
        createAlbum(db, author, {
          title: "[Test] Second",
          mbReleaseGroupId: MB_ID,
          credits: [{ artistId }],
        }),
      );
      expect(duplicate?.failure).toBe("duplicate_identifier");

      // Only the first album exists, with its one edition and one credit.
      expect(await count(tx, "albums")).toBe(1);
      expect(await count(tx, "album_editions")).toBe(1);
      expect(await count(tx, "album_artists")).toBe(1);
    });
  });

  it("refuses to credit an archived artist, but keeps an existing credit", async () => {
    await inRollbackTransaction(async (tx) => {
      const live = await createTestArtist(tx, "[Test] Live");
      const archived = await createTestArtist(tx, "[Test] Archived");
      await archiveArtist(tx, author, archived);

      const refused = await failure(tx, (db) =>
        createAlbum(db, author, {
          title: "[Test] A",
          credits: [{ artistId: archived }],
        }),
      );
      expect(refused?.failure).toBe("archived_reference");

      const { id } = await createAlbum(tx, author, {
        title: "[Test] A",
        credits: [{ artistId: live }],
      });
      // Credit the artist, then archive it: editing the album keeps the credit.
      await updateAlbum(tx, author, id, {
        title: "[Test] A",
        credits: [{ artistId: live }],
      });
      await tx.insert(schema.albumArtists).values({
        albumId: id,
        artistId: archived,
        position: 2,
      });
      await updateAlbum(tx, author, id, {
        title: "[Test] A2",
        credits: [{ artistId: live }, { artistId: archived }],
      });
      expect((await getAlbum(tx, author, id))?.credits).toHaveLength(2);
    });
  });

  it("edits metadata, edition, and the order of credits in one step", async () => {
    await inRollbackTransaction(async (tx) => {
      const a = await createTestArtist(tx, "[Test] A");
      const b = await createTestArtist(tx, "[Test] B");
      const { id } = await createAlbum(tx, author, {
        title: "[Test] Before",
        credits: [{ artistId: a }, { artistId: b }],
        edition: { label: "[Test] Old" },
      });
      await updateAlbum(tx, author, id, {
        title: "[Test] After",
        firstReleaseYear: 2001,
        credits: [{ artistId: b, creditedAs: "[Test] Bee" }, { artistId: a }],
        edition: { label: "[Test] New", country: "BR" },
      });
      const album = await getAlbum(tx, author, id);
      expect(album).toMatchObject({
        title: "[Test] After",
        firstReleaseYear: 2001,
        edition: { label: "[Test] New", releaseDate: null, country: "BR" },
      });
      expect(album?.credits.map((c) => [c.artistId, c.creditedAs])).toEqual([
        [b, "[Test] Bee"],
        [a, null],
      ]);
      expect(await count(tx, "album_editions")).toBe(1);
    });
  });

  it("rolls back an edit that fails after the metadata changed", async () => {
    await inRollbackTransaction(async (tx) => {
      const a = await createTestArtist(tx, "[Test] A");
      const { id } = await createAlbum(tx, author, {
        title: "[Test] Original",
        credits: [{ artistId: a }],
      });
      const refused = await failure(tx, (db) =>
        updateAlbum(db, author, id, {
          title: "[Test] Changed",
          credits: [{ artistId: a }, { artistId: MISSING }],
        }),
      );
      expect(refused?.failure).toBe("not_found");
      expect((await getAlbum(tx, author, id))?.title).toBe("[Test] Original");
    });
  });

  it("reports missing albums", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const input = { title: "[Test] A", credits: [{ artistId }] };
      for (const run of [
        (db: Transaction) => updateAlbum(db, author, MISSING, input),
        (db: Transaction) => archiveAlbum(db, author, MISSING),
        (db: Transaction) => restoreAlbum(db, author, MISSING),
        (db: Transaction) => deleteAlbum(db, author, MISSING),
        (db: Transaction) => setAlbumTracklist(db, author, MISSING, { tracks: [] }),
        (db: Transaction) => addTrackToAlbum(db, author, MISSING, MISSING),
      ]) {
        expect((await failure(tx, run))?.failure).toBe("not_found");
      }
      expect(await getAlbum(tx, author, MISSING)).toBeNull();
    });
  });

  it("archives and restores an album that writing still references", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const album = await createTestAlbum(tx, { artistIds: [artistId] });
      const journalId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
      });

      await archiveAlbum(tx, author, album.albumId);
      expect((await getAlbum(tx, author, album.albumId))?.archived).toBe(true);
      const journals = await tx
        .select()
        .from(schema.albumJournals)
        .where(eq(schema.albumJournals.entryId, journalId));
      expect(journals).toHaveLength(1);

      await restoreAlbum(tx, author, album.albumId);
      expect((await getAlbum(tx, author, album.albumId))?.archived).toBe(false);
    });
  });

  it("deletes an unreferenced album with its credits and edition, keeping its tracks", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const album = await createTestAlbum(tx, { artistIds: [artistId] });
      await deleteAlbum(tx, author, album.albumId);

      expect(await getAlbum(tx, author, album.albumId)).toBeNull();
      expect(await count(tx, "album_artists")).toBe(0);
      expect(await count(tx, "album_editions")).toBe(0);
      expect(await count(tx, "album_tracks")).toBe(0);
      expect(await count(tx, "edition_tracks")).toBe(0);
      // The recordings and the artist are catalog records of their own.
      expect(await count(tx, "tracks")).toBe(3);
      expect(await count(tx, "artists")).toBe(1);
    });
  });

  it("refuses to delete an album with writing, and changes nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const withJournal = await createTestAlbum(tx, { title: "[Test] Journal" });
      const deletedJournal = await createTestAlbumJournal(tx, {
        albumId: withJournal.albumId,
        deletedAt: new Date("2026-01-01T00:00:00Z"),
      });
      const withMemory = await createTestAlbum(tx, { title: "[Test] Memory" });
      await createTestMemory(tx, { music: [{ albumId: withMemory.albumId }] });

      // Recoverable writing still counts: an entry in Recently deleted is kept.
      expect(
        await failure(tx, (db) => deleteAlbum(db, author, withJournal.albumId)),
      ).toMatchObject({ failure: "in_use", details: { blockedBy: "journals" } });
      expect(
        await failure(tx, (db) => deleteAlbum(db, author, withMemory.albumId)),
      ).toMatchObject({ failure: "in_use", details: { blockedBy: "memories" } });

      expect(await getAlbum(tx, author, withJournal.albumId)).not.toBeNull();
      expect(await getAlbum(tx, author, withMemory.albumId)).not.toBeNull();
      expect(
        await tx
          .select()
          .from(schema.entries)
          .where(eq(schema.entries.id, deletedJournal)),
      ).toHaveLength(1);
    });
  });
});

describe("tracks", () => {
  it("creates, reads, and updates a track with credits", async () => {
    await inRollbackTransaction(async (tx) => {
      const a = await createTestArtist(tx, "[Test] A");
      const b = await createTestArtist(tx, "[Test] B");
      const { id } = await createTrack(tx, author, {
        title: "  [Test] Song ",
        lengthMs: 222_000,
        credit: " feat. [Test] ",
        mbRecordingId: MB_ID,
        artistIds: [b, a],
      });
      expect(await getTrack(tx, author, id)).toMatchObject({
        id,
        title: "[Test] Song",
        lengthMs: 222_000,
        credit: "feat. [Test]",
        mbRecordingId: MB_ID,
        archived: false,
        albums: [],
        credits: [
          { artistId: b, artistName: "[Test] B" },
          { artistId: a, artistName: "[Test] A" },
        ],
      });

      await updateTrack(tx, author, id, {
        title: "[Test] Song (reprise)",
        lengthMs: null,
        artistIds: [a],
      });
      expect(await getTrack(tx, author, id)).toMatchObject({
        title: "[Test] Song (reprise)",
        lengthMs: null,
        credit: null,
        mbRecordingId: null,
        credits: [{ artistId: a }],
      });
    });
  });

  it("validates length, credits, and identifiers", async () => {
    await inRollbackTransaction(async (tx) => {
      const a = await createTestArtist(tx);
      const cases: [Record<string, unknown>, string][] = [
        [{ title: "" }, "title"],
        [{ title: "[Test] x", lengthMs: 0 }, "lengthMs"],
        [{ title: "[Test] x", lengthMs: -5 }, "lengthMs"],
        [{ title: "[Test] x", lengthMs: 1.5 }, "lengthMs"],
        [{ title: "[Test] x", artistIds: [a, a] }, "artistIds"],
        [{ title: "[Test] x", artistIds: ["nope"] }, "artistIds.0"],
        [{ title: "[Test] x", albumId: "nope" }, "albumId"],
      ];
      for (const [input, field] of cases) {
        const error = await failure(tx, (db) => createTrack(db, author, input));
        expect(error?.failure, JSON.stringify(input)).toBe("invalid_input");
        expect(Object.keys(error?.details.fields ?? {}), field).toContain(field);
      }
      expect(await count(tx, "tracks")).toBe(0);
    });
  });

  it("creates a track and appends it to an album in one transaction", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, { trackTitles: ["[Test] One"] });
      const { id } = await createTrack(tx, author, {
        title: "[Test] Two",
        albumId: album.albumId,
      });
      const detail = await getAlbum(tx, author, album.albumId);
      expect(detail?.tracklist.map((t) => [t.title, t.position])).toEqual([
        ["[Test] One", 1],
        ["[Test] Two", 2],
      ]);
      expect((await getTrack(tx, author, id))?.albums).toHaveLength(1);

      // A missing album rolls the new track back with it.
      const before = await count(tx, "tracks");
      const refused = await failure(tx, (db) =>
        createTrack(db, author, { title: "[Test] Orphan", albumId: MISSING }),
      );
      expect(refused?.failure).toBe("not_found");
      expect(await count(tx, "tracks")).toBe(before);
    });
  });

  it("reuses one recording on several albums without duplicating it", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const first = await createTestAlbum(tx, {
        title: "[Test] Studio",
        artistIds: [artistId],
        trackTitles: ["[Test] Shared"],
      });
      const live = await createTestAlbum(tx, {
        title: "[Test] Live",
        artistIds: [artistId],
        trackTitles: [],
      });
      const sharedId = first.trackIds[0]!;
      await addTrackToAlbum(tx, author, live.albumId, sharedId);

      expect(await count(tx, "tracks")).toBe(1);
      const track = await getTrack(tx, author, sharedId);
      expect(track?.albums.map((a) => a.title)).toEqual([
        "[Test] Live",
        "[Test] Studio",
      ]);
      const listed = (await listTracks(tx, author)).find((t) => t.id === sharedId);
      // Two albums, not two times however many credits the track has.
      expect(listed?.albumCount).toBe(2);
    });
  });

  it("allows a track that belongs to no album", async () => {
    await inRollbackTransaction(async (tx) => {
      const { id } = await createTrack(tx, author, { title: "[Test] Single" });
      expect((await getTrack(tx, author, id))?.albums).toEqual([]);
      const stats = await getCatalogStatistics(tx, author);
      expect(stats.tracksWithoutAlbum).toBe(1);
    });
  });

  it("archives and restores, and keeps an archived track off new albums", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, { trackTitles: [] });
      const { id } = await createTrack(tx, author, { title: "[Test] Old" });
      await archiveTrack(tx, author, id);
      expect((await getTrack(tx, author, id))?.archived).toBe(true);
      expect(
        (await failure(tx, (db) => addTrackToAlbum(db, author, album.albumId, id)))
          ?.failure,
      ).toBe("archived_reference");
      await restoreTrack(tx, author, id);
      await addTrackToAlbum(tx, author, album.albumId, id);
      expect((await getAlbum(tx, author, album.albumId))?.tracklist).toHaveLength(1);
    });
  });

  it("deletes a free track and refuses one that is on an album", async () => {
    await inRollbackTransaction(async (tx) => {
      const free = await createTrack(tx, author, { title: "[Test] Free" });
      await deleteTrack(tx, author, free.id);
      expect(await getTrack(tx, author, free.id)).toBeNull();

      const album = await createTestAlbum(tx, { trackTitles: ["[Test] Kept"] });
      expect(
        await failure(tx, (db) => deleteTrack(db, author, album.trackIds[0]!)),
      ).toMatchObject({ failure: "in_use", details: { blockedBy: "albums" } });

      const inMemory = await createTrack(tx, author, { title: "[Test] Memory" });
      await createTestMemory(tx, { music: [{ trackId: inMemory.id }] });
      expect(
        await failure(tx, (db) => deleteTrack(db, author, inMemory.id)),
      ).toMatchObject({ failure: "in_use", details: { blockedBy: "memories" } });
      expect((await getTrack(tx, author, inMemory.id))?.title).toBe("[Test] Memory");
    });
  });

  it("reports missing tracks", async () => {
    await inRollbackTransaction(async (tx) => {
      for (const run of [
        (db: Transaction) => updateTrack(db, author, MISSING, { title: "[Test] x" }),
        (db: Transaction) => archiveTrack(db, author, MISSING),
        (db: Transaction) => restoreTrack(db, author, MISSING),
        (db: Transaction) => deleteTrack(db, author, MISSING),
      ]) {
        expect((await failure(tx, run))?.failure).toBe("not_found");
      }
    });
  });
});

describe("album tracklists", () => {
  const titles = (detail: Awaited<ReturnType<typeof getAlbum>>) =>
    detail?.tracklist.map((track) => track.title);

  it("orders, adds, removes, and moves tracks with contiguous positions", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        trackTitles: ["[Test] A", "[Test] B", "[Test] C"],
      });
      const [a, b, c] = album.trackIds as [string, string, string];

      await setAlbumTracklist(tx, author, album.albumId, {
        tracks: [{ trackId: c }, { trackId: a }, { trackId: b }],
      });
      let detail = await getAlbum(tx, author, album.albumId);
      expect(titles(detail)).toEqual(["[Test] C", "[Test] A", "[Test] B"]);
      expect(detail?.tracklist.map((t) => t.position)).toEqual([1, 2, 3]);

      await moveTrackInAlbum(tx, author, album.albumId, b, "up");
      expect(titles(await getAlbum(tx, author, album.albumId))).toEqual([
        "[Test] C",
        "[Test] B",
        "[Test] A",
      ]);
      // Moving past an end changes nothing and is not an error.
      await moveTrackInAlbum(tx, author, album.albumId, c, "up");
      await moveTrackInAlbum(tx, author, album.albumId, a, "down");
      expect(titles(await getAlbum(tx, author, album.albumId))).toEqual([
        "[Test] C",
        "[Test] B",
        "[Test] A",
      ]);

      const { id: d } = await createTrack(tx, author, { title: "[Test] D" });
      await addTrackToAlbum(tx, author, album.albumId, d);
      await addTrackToAlbum(tx, author, album.albumId, d); // idempotent
      await removeTrackFromAlbum(tx, author, album.albumId, c);
      detail = await getAlbum(tx, author, album.albumId);
      expect(titles(detail)).toEqual(["[Test] B", "[Test] A", "[Test] D"]);
      expect(detail?.tracklist.map((t) => t.position)).toEqual([1, 2, 3]);

      // The removed recording still exists in the catalog.
      expect((await getTrack(tx, author, c))?.albums).toEqual([]);
      // Membership and order agree: one edition row per member, no more.
      expect(await count(tx, "edition_tracks")).toBe(3);
      expect(await count(tx, "album_tracks")).toBe(3);
    });
  });

  it("rejects a tracklist with unknown, duplicate, or archived tracks and keeps the old order", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        trackTitles: ["[Test] A", "[Test] B"],
      });
      const [a, b] = album.trackIds as [string, string];
      const archived = await createTrack(tx, author, { title: "[Test] Old" });
      await archiveTrack(tx, author, archived.id);

      const attempts: [unknown, string][] = [
        [{ tracks: [{ trackId: b }, { trackId: MISSING }] }, "not_found"],
        [{ tracks: [{ trackId: b }, { trackId: archived.id }] }, "archived_reference"],
        [{ tracks: [{ trackId: a }, { trackId: a }] }, "invalid_input"],
        [{ tracks: [{ trackId: "nope" }] }, "invalid_input"],
        [{ tracks: [{ trackId: a, discNumber: 0 }] }, "invalid_input"],
        [{}, "invalid_input"],
      ];
      for (const [input, expected] of attempts) {
        const error = await failure(tx, (db) =>
          setAlbumTracklist(db, author, album.albumId, input),
        );
        expect(error?.failure, JSON.stringify(input)).toBe(expected);
      }
      expect(titles(await getAlbum(tx, author, album.albumId))).toEqual([
        "[Test] A",
        "[Test] B",
      ]);
      expect(await count(tx, "edition_tracks")).toBe(2);
    });
  });

  it("refuses to remove a track that a reflection refers to", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        trackTitles: ["[Test] A", "[Test] B"],
      });
      const [a, b] = album.trackIds as [string, string];
      const journalId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
      });
      await createTestTrackReflection(tx, {
        albumJournalId: journalId,
        albumId: album.albumId,
        trackId: a,
        texts: { en: "[Test] Reflection" },
      });

      expect(
        await failure(tx, (db) => removeTrackFromAlbum(db, author, album.albumId, a)),
      ).toMatchObject({ failure: "in_use", details: { blockedBy: "reflections" } });
      expect(
        await failure(tx, (db) =>
          setAlbumTracklist(db, author, album.albumId, { tracks: [{ trackId: b }] }),
        ),
      ).toMatchObject({ failure: "in_use", details: { blockedBy: "reflections" } });
      expect((await getAlbum(tx, author, album.albumId))?.tracklist).toHaveLength(2);
      expect(
        (await getAlbum(tx, author, album.albumId))?.tracklist.find((t) => t.trackId === a)
          ?.hasReflection,
      ).toBe(true);

      // Reordering is fine: the reflection refers to the album and recording,
      // never to a position (ADR 0002, D2.3).
      await moveTrackInAlbum(tx, author, album.albumId, a, "down");
      expect(await count(tx, "track_reflections")).toBe(1);
      // Removing the other track is allowed.
      await removeTrackFromAlbum(tx, author, album.albumId, b);
    });
  });

  it("keeps disc numbers and numbers positions within each disc", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, { trackTitles: [] });
      const ids: string[] = [];
      for (const title of ["[Test] 1", "[Test] 2", "[Test] 3"]) {
        ids.push((await createTrack(tx, author, { title })).id);
      }
      await setAlbumTracklist(tx, author, album.albumId, {
        tracks: [
          { trackId: ids[0]!, discNumber: 1 },
          { trackId: ids[1]!, discNumber: 1 },
          { trackId: ids[2]!, discNumber: 2 },
        ],
      });
      const detail = await getAlbum(tx, author, album.albumId);
      expect(detail?.tracklist.map((t) => [t.discNumber, t.position])).toEqual([
        [1, 1],
        [1, 2],
        [2, 1],
      ]);
    });
  });

  it("never touches another album's tracklist", async () => {
    await inRollbackTransaction(async (tx) => {
      const one = await createTestAlbum(tx, { title: "[Test] One", trackTitles: ["[Test] a", "[Test] b"] });
      const two = await createTestAlbum(tx, { title: "[Test] Two", trackTitles: ["[Test] c"] });
      await removeTrackFromAlbum(tx, author, one.albumId, one.trackIds[0]!);
      expect(titles(await getAlbum(tx, author, two.albumId))).toEqual(["[Test] c"]);
      // A track that is not on the album cannot be removed from it.
      expect(
        (await failure(tx, (db) => removeTrackFromAlbum(db, author, one.albumId, two.trackIds[0]!)))
          ?.failure,
      ).toBe("not_found");
    });
  });
});

describe("catalog queries", () => {
  it("counts tracks per album once, however many credits the album has", async () => {
    await inRollbackTransaction(async (tx) => {
      const artists = [
        await createTestArtist(tx, "[Test] 1"),
        await createTestArtist(tx, "[Test] 2"),
        await createTestArtist(tx, "[Test] 3"),
      ];
      const credited = await createTestAlbum(tx, {
        title: "[Test] Many credits",
        artistIds: artists,
        trackTitles: ["[Test] a", "[Test] b", "[Test] c", "[Test] d"],
      });
      const empty = await createTestAlbum(tx, { title: "[Test] Empty", trackTitles: [] });

      const rows = await listAlbumTrackCounts(tx, author);
      expect(rows.find((r) => r.albumId === credited.albumId)?.trackCount).toBe(4);
      expect(rows.find((r) => r.albumId === empty.albumId)?.trackCount).toBe(0);
    });
  });

  it("includes archived albums in the counts, flagged as archived", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, { trackTitles: ["[Test] a"] });
      await archiveAlbum(tx, author, album.albumId);
      const row = (await listAlbumTrackCounts(tx, author)).find(
        (r) => r.albumId === album.albumId,
      );
      expect(row).toMatchObject({ archived: true, trackCount: 1 });
    });
  });

  it("computes catalog statistics from SQL aggregates", async () => {
    await inRollbackTransaction(async (tx) => {
      const before = await getCatalogStatistics(tx, author);
      const artistId = await createTestArtist(tx);
      await createTestAlbum(tx, { artistIds: [artistId], trackTitles: ["[Test] a", "[Test] b"] });
      await createTestAlbum(tx, { trackTitles: [] });
      await createTrack(tx, author, { title: "[Test] loose" });
      const archived = await createTestAlbum(tx, { trackTitles: [] });
      await archiveAlbum(tx, author, archived.albumId);

      const after = await getCatalogStatistics(tx, author);
      expect(after.artists - before.artists).toBe(1);
      expect(after.albums - before.albums).toBe(2);
      expect(after.tracks - before.tracks).toBe(3);
      expect(after.archivedRecords - before.archivedRecords).toBe(1);
      expect(after.albumsWithoutTracks - before.albumsWithoutTracks).toBe(1);
      expect(after.tracksWithoutAlbum - before.tracksWithoutAlbum).toBe(1);
    });
  });
});
