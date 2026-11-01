import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, schema } from "@/db";
import { raceAll, testAuthor, uniqueLabel, withConnections } from "@/testing";

import {
  addTrackToAlbum,
  createAlbum,
  createArtist,
  createTrack,
  deleteAlbum,
  deleteArtist,
  deleteTrack,
  setAlbumTracklist,
} from "./commands";
import { CatalogError } from "./errors";
import { getAlbum } from "./queries";

// Concurrent catalog writes over real, separate database connections. Rows
// are committed and removed at the end; everything is synthetic.

const author = testAuthor();
const created = {
  albums: [] as string[],
  artists: [] as string[],
  tracks: [] as string[],
};

afterAll(async () => {
  const db = getDb();
  for (const albumId of created.albums) {
    await deleteAlbum(db, author, albumId).catch(() => undefined);
  }
  for (const trackId of created.tracks) {
    await deleteTrack(db, author, trackId).catch(() => undefined);
  }
  for (const artistId of created.artists) {
    await deleteArtist(db, author, artistId).catch(() => undefined);
  }
});

async function artist(): Promise<string> {
  const { id } = await createArtist(getDb(), author, {
    name: uniqueLabel("Artist"),
    kind: "group",
  });
  created.artists.push(id);
  return id;
}

async function album(trackCount: number) {
  const artistId = await artist();
  const { id: albumId } = await createAlbum(getDb(), author, {
    title: uniqueLabel("Album"),
    credits: [{ artistId }],
  });
  created.albums.push(albumId);
  const trackIds: string[] = [];
  for (let index = 0; index < trackCount; index++) {
    const { id } = await createTrack(getDb(), author, {
      title: uniqueLabel(`Track ${index}`),
    });
    created.tracks.push(id);
    trackIds.push(id);
  }
  return { albumId, trackIds };
}

function reasons(outcomes: PromiseSettledResult<unknown>[]): unknown[] {
  return outcomes.flatMap((o) => (o.status === "rejected" ? [o.reason] : []));
}

async function storedOrder(albumId: string): Promise<string[]> {
  const rows = await getDb()
    .select({
      trackId: schema.editionTracks.trackId,
      position: schema.editionTracks.position,
    })
    .from(schema.editionTracks)
    .where(eq(schema.editionTracks.albumId, albumId));
  return rows.sort((a, b) => a.position - b.position).map((row) => row.trackId);
}

describe("concurrent tracklist edits", () => {
  it("serializes simultaneous reorderings: the result is exactly one of them", async () => {
    const { albumId, trackIds } = await album(5);
    await setAlbumTracklist(getDb(), author, albumId, {
      tracks: trackIds.map((trackId) => ({ trackId })),
    });

    const orders = [
      [...trackIds].reverse(),
      [trackIds[2]!, trackIds[0]!, trackIds[4]!, trackIds[1]!, trackIds[3]!],
      [trackIds[4]!, trackIds[3]!, trackIds[2]!, trackIds[1]!, trackIds[0]!],
      [trackIds[1]!, trackIds[0]!, trackIds[3]!, trackIds[2]!, trackIds[4]!],
      trackIds,
      [trackIds[3]!, trackIds[1]!, trackIds[4]!, trackIds[0]!, trackIds[2]!],
    ];
    const outcomes = await withConnections(orders.length, (dbs) =>
      raceAll(
        orders.map(
          (order, index) => () =>
            setAlbumTracklist(dbs[index]!, author, albumId, {
              tracks: order.map((trackId) => ({ trackId })),
            }),
        ),
      ),
    );
    expect(reasons(outcomes)).toEqual([]);

    const final = await storedOrder(albumId);
    expect(orders.map((order) => order.join())).toContain(final.join());
    // Membership and order agree, with contiguous positions and no duplicates.
    const detail = await getAlbum(getDb(), author, albumId);
    expect(detail?.tracklist.map((t) => t.trackId)).toEqual(final);
    expect(detail?.tracklist.map((t) => t.position)).toEqual([1, 2, 3, 4, 5]);
    const members = await getDb()
      .select()
      .from(schema.albumTracks)
      .where(eq(schema.albumTracks.albumId, albumId));
    expect(members).toHaveLength(5);
  });

  it("keeps every track when several are added at the same moment", async () => {
    const { albumId, trackIds } = await album(6);
    const outcomes = await withConnections(trackIds.length, (dbs) =>
      raceAll(
        trackIds.map(
          (trackId, index) => () =>
            addTrackToAlbum(dbs[index]!, author, albumId, trackId),
        ),
      ),
    );
    expect(reasons(outcomes)).toEqual([]);
    const detail = await getAlbum(getDb(), author, albumId);
    expect(detail?.tracklist).toHaveLength(6);
    expect(new Set(detail?.tracklist.map((t) => t.trackId))).toEqual(
      new Set(trackIds),
    );
    expect(detail?.tracklist.map((t) => t.position)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe("concurrent identifiers", () => {
  it("lets one of several simultaneous artists with the same MusicBrainz id in", async () => {
    const mbArtistId = crypto.randomUUID();
    const outcomes = await withConnections(4, (dbs) =>
      raceAll(
        dbs.map(
          (db, index) => () =>
            createArtist(db, author, {
              name: uniqueLabel(`Same id ${index}`),
              kind: "person",
              mbArtistId,
            }),
        ),
      ),
    );
    const winners = outcomes.flatMap((o) =>
      o.status === "fulfilled" ? [o.value.id] : [],
    );
    created.artists.push(...winners);
    expect(winners).toHaveLength(1);
    for (const reason of reasons(outcomes)) {
      // A domain failure, never a raw unique violation.
      expect(reason).toBeInstanceOf(CatalogError);
      expect((reason as CatalogError).failure).toBe("duplicate_identifier");
    }
  });

  it("creates no partial album when simultaneous albums share a release-group id", async () => {
    const artistId = await artist();
    const mbReleaseGroupId = crypto.randomUUID();
    const outcomes = await withConnections(4, (dbs) =>
      raceAll(
        dbs.map(
          (db, index) => () =>
            createAlbum(db, author, {
              title: uniqueLabel(`Same group ${index}`),
              mbReleaseGroupId,
              credits: [{ artistId }],
            }),
        ),
      ),
    );
    const winners = outcomes.flatMap((o) =>
      o.status === "fulfilled" ? [o.value.id] : [],
    );
    created.albums.push(...winners);
    expect(winners).toHaveLength(1);
    for (const reason of reasons(outcomes)) {
      expect((reason as CatalogError).failure).toBe("duplicate_identifier");
    }
    // The winner is complete; the losers left no edition or credit behind.
    const detail = await getAlbum(getDb(), author, winners[0]!);
    expect(detail?.edition).not.toBeNull();
    expect(detail?.credits).toHaveLength(1);
    const withGroup = await getDb()
      .select({ id: schema.albums.id })
      .from(schema.albums)
      .where(eq(schema.albums.mbReleaseGroupId, mbReleaseGroupId));
    expect(withGroup).toHaveLength(1);
  });
});
