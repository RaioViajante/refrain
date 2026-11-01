import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/db";
import {
  createAlbumJournal,
  deleteAlbumJournal,
  getAlbumJournal,
  permanentlyDeleteEntry,
} from "@/modules/journals";
import { raceAll, testAuthor, uniqueLabel, withConnections } from "@/testing";
import { createArtist, createAlbum, deleteAlbum, deleteArtist } from "@/modules/catalog";

import { changeEntrySlug, PublicationError } from "./commands";
import { normalizeSlug } from "./slug";

// Concurrent slug reservation (issue #6): two entries claiming the same slug
// at the same moment, over real, separate database connections. The rows are
// committed and removed at the end. Everything is synthetic.

const author = testAuthor();
const created: { entries: string[]; albums: string[]; artists: string[] } = {
  entries: [],
  albums: [],
  artists: [],
};

afterAll(async () => {
  const db = getDb();
  for (const entryId of created.entries) {
    await deleteAlbumJournal(author, entryId).catch(() => undefined);
    await permanentlyDeleteEntry(db, entryId).catch(() => undefined);
  }
  for (const albumId of created.albums) {
    await deleteAlbum(author, albumId).catch(() => undefined);
  }
  for (const artistId of created.artists) {
    await deleteArtist(author, artistId).catch(() => undefined);
  }
});

async function album(title: string): Promise<string> {
  const artist = await createArtist(author, { name: uniqueLabel("Artist"), kind: "person" });
  created.artists.push(artist.id);
  const { id } = await createAlbum(author, { title, credits: [{ artistId: artist.id }] });
  created.albums.push(id);
  return id;
}

async function journal(albumId: string): Promise<string> {
  const { entryId } = await createAlbumJournal(author, { albumId, locale: "en", body: "[Test] x" });
  created.entries.push(entryId);
  return entryId;
}

describe("concurrent slug reservation", () => {
  it("gives one of two simultaneous claims the slug and refuses the other as slug_taken", async () => {
    const albumId = await album(uniqueLabel("Race"));
    const entries = [await journal(albumId), await journal(albumId)] as const;

    for (let round = 0; round < 10; round++) {
      const target = normalizeSlug(`${uniqueLabel("shared")} round ${round}`);
      const outcomes = await withConnections(2, (dbs) =>
        raceAll(
          entries.map((entryId, index) => () =>
            changeEntrySlug(dbs[index]!, entryId, target),
          ),
        ),
      );

      const refused = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
        `round ${round}`,
      ).toHaveLength(1);
      expect(refused).toHaveLength(1);
      const reason = (refused[0] as PromiseRejectedResult).reason;
      // A domain failure, never a raw unique violation or deadlock.
      expect(reason).toBeInstanceOf(PublicationError);
      expect((reason as PublicationError).failure).toBe("slug_taken");

      const holders = await Promise.all(
        entries.map(async (entryId) => (await getAlbumJournal(author, entryId))?.slug),
      );
      expect(holders.filter((slug) => slug === target)).toHaveLength(1);
    }
  });
});
