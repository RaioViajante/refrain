import { and, eq, inArray, sql } from "drizzle-orm";
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
} from "@/testing";

import * as schema from "./schema";

const { checkViolation, foreignKeyViolation, uniqueViolation } = SqlState;
const missingId = "00000000-0000-4000-8000-000000000000";

describe("catalog constraints", () => {
  it("rejects blank names, unknown artist kinds, and uncredited photos", async () => {
    await inRollbackTransaction(async (tx) => {
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "artists_name_check" },
        (sp) =>
          sp.insert(schema.artists).values({ name: "  ", kind: "person" }),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "artists_kind_check" },
        (sp) =>
          sp.execute(
            sql`insert into artists (name, kind) values ('[Test] Artist', 'robot')`,
          ),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "artists_photo_attribution_check" },
        (sp) =>
          sp.insert(schema.artists).values({
            name: "[Test] Artist",
            kind: "group",
            photoUrl: "https://commons.wikimedia.org/[test].jpg",
          }),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "albums_first_release_year_check" },
        (sp) =>
          sp
            .insert(schema.albums)
            .values({ title: "[Test] Album", firstReleaseYear: 1700 }),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "albums_cover_source_check" },
        (sp) =>
          sp.insert(schema.albums).values({
            title: "[Test] Album",
            coverUrl: "https://coverartarchive.org/[test]",
          }),
      );
    });
  });

  it("keeps provider identifiers unique but optional", async () => {
    await inRollbackTransaction(async (tx) => {
      const mbReleaseGroupId = "11111111-1111-4111-8111-111111111111";
      await tx
        .insert(schema.albums)
        .values([
          { title: "[Test] Album", mbReleaseGroupId },
          { title: "[Test] Album without provider" },
          { title: "[Test] Another album without provider" },
        ]);
      await expectRejected(
        tx,
        {
          code: uniqueViolation,
          constraint: "albums_mb_release_group_id_unique",
        },
        (sp) =>
          sp
            .insert(schema.albums)
            .values({ title: "[Test] Duplicate", mbReleaseGroupId }),
      );
    });
  });

  it("allows albums with the same title", async () => {
    await inRollbackTransaction(async (tx) => {
      await createTestAlbum(tx, { title: "[Test] Same Title" });
      await createTestAlbum(tx, { title: "[Test] Same Title" });
      const rows = await tx
        .select()
        .from(schema.albums)
        .where(eq(schema.albums.title, "[Test] Same Title"));
      expect(rows).toHaveLength(2);
    });
  });

  it("lets a recording exist alone or belong to several albums", async () => {
    await inRollbackTransaction(async (tx) => {
      const [single] = await tx
        .insert(schema.tracks)
        .values({ title: "[Test] Single" })
        .returning();
      const first = await createTestAlbum(tx, { trackTitles: [] });
      const second = await createTestAlbum(tx, { trackTitles: [] });

      await tx.insert(schema.albumTracks).values([
        { albumId: first.albumId, trackId: single!.id },
        { albumId: second.albumId, trackId: single!.id },
      ]);

      const memberships = await tx
        .select()
        .from(schema.albumTracks)
        .where(eq(schema.albumTracks.trackId, single!.id));
      expect(memberships).toHaveLength(2);
    });
  });

  it("rejects references to catalog records that do not exist", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "album_artists_artist_fk" },
        (sp) =>
          sp
            .insert(schema.albumArtists)
            .values({ albumId, artistId: missingId, position: 1 }),
      );
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "album_tracks_track_fk" },
        (sp) =>
          sp.insert(schema.albumTracks).values({ albumId, trackId: missingId }),
      );
    });
  });

  it("allows at most one reference edition per album", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      await tx.insert(schema.albumEditions).values({ albumId });
      await expectRejected(
        tx,
        {
          code: uniqueViolation,
          constraint: "album_editions_one_reference_idx",
        },
        (sp) =>
          sp
            .insert(schema.albumEditions)
            .values({ albumId, isReference: true }),
      );
    });
  });

  it("orders only the album's own recordings, once per position", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx);
      const other = await createTestAlbum(tx, { title: "[Test] Other" });
      const [loose] = await tx
        .insert(schema.tracks)
        .values({ title: "[Test] Not on the album" })
        .returning();

      // A recording that is not a member of the album.
      await expectRejected(
        tx,
        {
          code: foreignKeyViolation,
          constraint: "edition_tracks_album_track_fk",
        },
        (sp) =>
          sp.insert(schema.editionTracks).values({
            editionId: album.editionId,
            albumId: album.albumId,
            trackId: loose!.id,
            position: 9,
          }),
      );
      // An edition of a different album.
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "edition_tracks_edition_fk" },
        (sp) =>
          sp.insert(schema.editionTracks).values({
            editionId: other.editionId,
            albumId: album.albumId,
            trackId: album.trackIds[0]!,
            position: 9,
          }),
      );
      // Two recordings at the same disc position.
      await tx
        .insert(schema.albumTracks)
        .values({ albumId: album.albumId, trackId: loose!.id });
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "edition_tracks_position_unique" },
        (sp) =>
          sp.insert(schema.editionTracks).values({
            editionId: album.editionId,
            albumId: album.albumId,
            trackId: loose!.id,
            position: 1,
          }),
      );
    });
  });
});

describe("remaining catalog checks", () => {
  // Each statement violates exactly one named constraint.
  it.each([
    ["albums_title_check", sql`insert into albums (title) values (' ')`],
    ["tracks_title_check", sql`insert into tracks (title) values ('')`],
    [
      "tracks_length_ms_check",
      sql`insert into tracks (title, length_ms) values ('[Test] Track', 0)`,
    ],
  ])("rejects a write that violates %s", async (constraint, statement) => {
    await inRollbackTransaction(async (tx) => {
      await expectRejected(tx, { code: checkViolation, constraint }, (sp) =>
        sp.execute(statement),
      );
    });
  });

  it("checks edition country, positions, and disc numbers", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx);
      const artistId = await createTestArtist(tx);
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "album_editions_country_check" },
        (sp) =>
          sp
            .insert(schema.albumEditions)
            .values({ albumId: album.albumId, country: "bra" }),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "album_artists_position_check" },
        (sp) =>
          sp
            .insert(schema.albumArtists)
            .values({ albumId: album.albumId, artistId, position: 0 }),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "track_artists_position_check" },
        (sp) =>
          sp
            .insert(schema.trackArtists)
            .values({ trackId: album.trackIds[0]!, artistId, position: 0 }),
      );
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "edition_tracks_position_check" },
        (sp) =>
          sp
            .update(schema.editionTracks)
            .set({ position: 0 })
            .where(eq(schema.editionTracks.trackId, album.trackIds[0]!)),
      );
      await expectRejected(
        tx,
        {
          code: checkViolation,
          constraint: "edition_tracks_disc_number_check",
        },
        (sp) =>
          sp
            .update(schema.editionTracks)
            .set({ discNumber: 0 })
            .where(eq(schema.editionTracks.trackId, album.trackIds[0]!)),
      );
    });
  });

  it("keeps credits unique and ordered, and protects credited artists", async () => {
    await inRollbackTransaction(async (tx) => {
      const first = await createTestArtist(tx, "[Test] First");
      const second = await createTestArtist(tx, "[Test] Second");
      const album = await createTestAlbum(tx, { artistIds: [first] });
      const trackId = album.trackIds[0]!;
      await tx
        .insert(schema.trackArtists)
        .values({ trackId, artistId: first, position: 1 });

      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "album_artists_pkey" },
        (sp) =>
          sp
            .insert(schema.albumArtists)
            .values({ albumId: album.albumId, artistId: first, position: 2 }),
      );
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "album_artists_position_unique" },
        (sp) =>
          sp
            .insert(schema.albumArtists)
            .values({ albumId: album.albumId, artistId: second, position: 1 }),
      );
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "track_artists_position_unique" },
        (sp) =>
          sp
            .insert(schema.trackArtists)
            .values({ trackId, artistId: second, position: 1 }),
      );
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "track_artists_artist_fk" },
        (sp) =>
          sp
            .delete(schema.albumArtists)
            .where(eq(schema.albumArtists.artistId, first))
            .then(() =>
              sp.delete(schema.artists).where(eq(schema.artists.id, first)),
            ),
      );

      const mbReleaseId = "33333333-3333-4333-8333-333333333333";
      await tx
        .update(schema.albumEditions)
        .set({ mbReleaseId })
        .where(eq(schema.albumEditions.id, album.editionId));
      await expectRejected(
        tx,
        {
          code: uniqueViolation,
          constraint: "album_editions_mb_release_id_unique",
        },
        (sp) =>
          sp
            .insert(schema.albumEditions)
            .values({ albumId: album.albumId, mbReleaseId }),
      );
    });
  });

  it("keeps artist and recording provider identifiers unique", async () => {
    await inRollbackTransaction(async (tx) => {
      const mbId = "22222222-2222-4222-8222-222222222222";
      await tx
        .insert(schema.artists)
        .values({ name: "[Test] Artist", kind: "person", mbArtistId: mbId });
      await tx
        .insert(schema.tracks)
        .values({ title: "[Test] Track", mbRecordingId: mbId });
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "artists_mb_artist_id_unique" },
        (sp) =>
          sp
            .insert(schema.artists)
            .values({ name: "[Test] Other", kind: "group", mbArtistId: mbId }),
      );
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "tracks_mb_recording_id_unique" },
        (sp) =>
          sp
            .insert(schema.tracks)
            .values({ title: "[Test] Other", mbRecordingId: mbId }),
      );
    });
  });
});

describe("archive versus delete (ADR 0002, D4.5)", () => {
  it("refuses to delete catalog records that writing references", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const album = await createTestAlbum(tx, { artistIds: [artistId] });
      const journalId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
      });
      await createTestTrackReflection(tx, {
        albumJournalId: journalId,
        albumId: album.albumId,
        trackId: album.trackIds[0]!,
        texts: { en: "[Test] Reflection" },
      });
      const [single] = await tx
        .insert(schema.tracks)
        .values({ title: "[Test] Single" })
        .returning();
      await createTestMemory(tx, { music: [{ trackId: single!.id }] });

      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "album_journals_album_fk" },
        (sp) =>
          sp.delete(schema.albums).where(eq(schema.albums.id, album.albumId)),
      );
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "album_artists_artist_fk" },
        (sp) =>
          sp.delete(schema.artists).where(eq(schema.artists.id, artistId)),
      );
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "memory_music_track_fk" },
        (sp) =>
          sp.delete(schema.tracks).where(eq(schema.tracks.id, single!.id)),
      );
      // Removing a reflected recording from the album is refused too.
      await expectRejected(
        tx,
        {
          code: foreignKeyViolation,
          constraint: "track_reflections_album_track_fk",
        },
        (sp) =>
          sp
            .delete(schema.albumTracks)
            .where(
              and(
                eq(schema.albumTracks.albumId, album.albumId),
                eq(schema.albumTracks.trackId, album.trackIds[0]!),
              ),
            ),
      );
    });
  });

  it("refuses to delete an artist that only an artist journal references", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      await createTestArtistJournal(tx, { artistId });
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "artist_journals_artist_fk" },
        (sp) =>
          sp.delete(schema.artists).where(eq(schema.artists.id, artistId)),
      );
    });
  });

  it("refuses to delete an album that only a memory references", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      await createTestMemory(tx, { music: [{ albumId }] });
      await expectRejected(
        tx,
        { code: foreignKeyViolation, constraint: "memory_music_album_fk" },
        (sp) => sp.delete(schema.albums).where(eq(schema.albums.id, albumId)),
      );
    });
  });

  it("archives a referenced album and keeps the writing attached", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx);
      const journalId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
      });

      await tx
        .update(schema.albums)
        .set({ archivedAt: sql`now()` })
        .where(eq(schema.albums.id, album.albumId));

      const rows = await tx
        .select({
          journal: schema.albumJournals.entryId,
          archivedAt: schema.albums.archivedAt,
        })
        .from(schema.albumJournals)
        .innerJoin(
          schema.albums,
          eq(schema.albums.id, schema.albumJournals.albumId),
        )
        .where(eq(schema.albumJournals.entryId, journalId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.archivedAt).toBeInstanceOf(Date);
    });
  });

  it("hard-deletes an unreferenced album with only its own catalog rows", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const album = await createTestAlbum(tx, { artistIds: [artistId] });

      await tx.delete(schema.albums).where(eq(schema.albums.id, album.albumId));

      const count = async (table: string) => {
        const result = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(table)} where album_id = ${album.albumId}`,
        );
        return result.rows[0]!.n;
      };
      expect(await count("album_editions")).toBe(0);
      expect(await count("album_tracks")).toBe(0);
      expect(await count("edition_tracks")).toBe(0);
      expect(await count("album_artists")).toBe(0);

      // The artist and the recordings are catalog records of their own.
      const artists = await tx
        .select()
        .from(schema.artists)
        .where(eq(schema.artists.id, artistId));
      expect(artists).toHaveLength(1);
      const tracks = await tx
        .select()
        .from(schema.tracks)
        .where(inArray(schema.tracks.id, album.trackIds));
      expect(tracks).toHaveLength(album.trackIds.length);
    });
  });
});

describe("editions (ADR 0002, D2)", () => {
  it("adds an edition and changes the reference edition without touching reflections", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        trackTitles: ["[Test] A", "[Test] B"],
      });
      const journalId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
      });
      const reflectionIds = [];
      for (const trackId of album.trackIds) {
        reflectionIds.push(
          await createTestTrackReflection(tx, {
            albumJournalId: journalId,
            albumId: album.albumId,
            trackId,
            texts: { en: "[Test] Reflection" },
          }),
        );
      }
      const before = await tx
        .select()
        .from(schema.trackReflections)
        .where(eq(schema.trackReflections.albumJournalId, journalId))
        .orderBy(schema.trackReflections.id);

      // A deluxe edition in a different order, with a bonus recording, as
      // one transaction.
      const deluxeEditionId = await tx.transaction(async (sp) => {
        const [bonus] = await sp
          .insert(schema.tracks)
          .values({ title: "[Test] Bonus" })
          .returning();
        await sp
          .insert(schema.albumTracks)
          .values({ albumId: album.albumId, trackId: bonus!.id });
        const [deluxe] = await sp
          .insert(schema.albumEditions)
          .values({ albumId: album.albumId, label: "[Test] Deluxe" })
          .returning();
        await sp.insert(schema.editionTracks).values([
          {
            editionId: deluxe!.id,
            albumId: album.albumId,
            trackId: album.trackIds[1]!,
            position: 1,
          },
          {
            editionId: deluxe!.id,
            albumId: album.albumId,
            trackId: album.trackIds[0]!,
            position: 2,
          },
          {
            editionId: deluxe!.id,
            albumId: album.albumId,
            trackId: bonus!.id,
            discNumber: 2,
            position: 1,
          },
        ]);
        return deluxe!.id;
      });

      // Setting the new reference before clearing the old one is refused...
      await expectRejected(
        tx,
        {
          code: uniqueViolation,
          constraint: "album_editions_one_reference_idx",
        },
        (sp) =>
          sp
            .update(schema.albumEditions)
            .set({ isReference: true })
            .where(eq(schema.albumEditions.id, deluxeEditionId)),
      );
      // ...and switching in one transaction, old first, succeeds.
      await tx.transaction(async (sp) => {
        await sp
          .update(schema.albumEditions)
          .set({ isReference: false })
          .where(eq(schema.albumEditions.id, album.editionId));
        await sp
          .update(schema.albumEditions)
          .set({ isReference: true })
          .where(eq(schema.albumEditions.id, deluxeEditionId));
      });

      const after = await tx
        .select()
        .from(schema.trackReflections)
        .where(eq(schema.trackReflections.albumJournalId, journalId))
        .orderBy(schema.trackReflections.id);
      expect(after).toEqual(before);
    });
  });
});
