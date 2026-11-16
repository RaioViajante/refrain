import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, type Database } from "@/db";
// The real catalog commands race the real publication engine. Tests may reach
// a module's internals.
// eslint-disable-next-line no-restricted-imports
import * as catalog from "@/modules/catalog/commands";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestMemory,
  raceAll,
  testAuthor,
  uniqueLabel,
  withConnections,
} from "@/testing";

import { lockAlbumCatalogChange } from "./catalog-exposure";
import { catalogPublicImpact } from "./catalog-impact";
import { lockMemoryCatalog } from "./catalog-locks";
import { unpublishLanguageVersion } from "./commands";
import { previewPublication, publishLanguageVersion } from "./publish";
import { normalizeSlug } from "./slug";

// ADR 0013 § 4 (step 2) on real PostgreSQL 18 transactions, on separate
// connections: catalog commands and publications take their row locks in one
// order (entries, albums, artists, tracks), so a catalog edit and a
// publication serialize, the second one sees the first, and no mix of them
// deadlocks. The rows are committed to the disposable test database and
// removed at the end; everything is synthetic.

const author = testAuthor();
const created = {
  entries: [] as string[],
  albums: [] as string[],
  tracks: [] as string[],
  artists: [] as string[],
};

afterAll(async () => {
  await getDb().transaction(async (tx) => {
    for (const id of created.entries) {
      await tx.execute(sql`delete from entry_slugs where entry_id = ${id}`);
      await tx.execute(sql`delete from entries where id = ${id}`);
    }
    for (const id of created.albums) {
      await tx.execute(sql`delete from albums where id = ${id}`);
    }
    for (const id of created.tracks) {
      await tx.execute(sql`delete from track_artists where track_id = ${id}`);
      await tx.execute(sql`delete from tracks where id = ${id}`);
    }
    for (const id of created.artists) {
      await tx.execute(sql`delete from artists where id = ${id}`);
    }
  });
});

/** A committed, unpublished album journal and a private memory on one album. */
async function committedWorld(label: string) {
  return getDb().transaction(async (tx) => {
    const artistId = await createTestArtist(tx, uniqueLabel(`${label} artist`));
    const album = await createTestAlbum(tx, {
      title: uniqueLabel(`${label} album`),
      artistIds: [artistId],
      firstReleaseYear: 2000,
    });
    for (const trackId of album.trackIds) {
      await tx.execute(sql`
        insert into track_artists (track_id, artist_id, position)
        values (${trackId}, ${artistId}, 1)`);
    }
    const journalId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      slug: normalizeSlug(`t ${uniqueLabel(label)}`),
      versions: [{ locale: "en", status: "private", text: "[Test] Writing" }],
    });
    const memoryId = await createTestMemory(tx, {
      slug: normalizeSlug(`t ${uniqueLabel(`${label} memory`)}`),
      versions: [
        { locale: "en", status: "private", title: uniqueLabel("Memory") },
      ],
      music: [{ trackId: album.trackIds[0]! }],
    });
    created.entries.push(journalId, memoryId);
    created.albums.push(album.albumId);
    created.tracks.push(...album.trackIds);
    created.artists.push(artistId);
    return { artistId, album, journalId, memoryId };
  });
}

async function pidOf(db: Database): Promise<number> {
  const result = await db.execute<{ pid: number }>(
    sql`select pg_backend_pid() as pid`,
  );
  return result.rows[0]!.pid;
}

/** True once `pid` is waiting on a lock (polled for up to 5 s). */
async function waitsOnLock(pid: number): Promise<boolean> {
  for (let tries = 0; tries < 100; tries++) {
    const waiting = await getDb().execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
       where pid = ${pid} and wait_event_type = 'Lock'`);
    if (waiting.rows[0]!.n > 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** Runs `work` in a transaction on `db` and keeps it open until released. */
function holdOpen(
  db: Database,
  work: (
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  ) => Promise<void>,
) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let ready!: () => void;
  const isReady = new Promise<void>((resolve) => (ready = resolve));
  const done = db.transaction(async (tx) => {
    await work(tx);
    ready();
    await held;
  });
  return { ready: Promise.race([isReady, done]), release, done };
}

async function failure(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return (error as { failure?: string }).failure ?? cause ?? String(error);
  }
  return "succeeded";
}

async function statusOf(entryId: string) {
  const result = await getDb().execute<{ status: string }>(sql`
    select status from entry_texts where entry_id = ${entryId}`);
  return result.rows[0]!.status;
}

describe("a catalog edit and a publication serialize", () => {
  it("a publication waits for an uncommitted track rename, then refuses as stale and writes nothing", async () => {
    const world = await committedWorld("Waits");
    const preview = await previewPublication(getDb(), author, {
      entryId: world.journalId,
      locale: "en",
    });
    await withConnections(2, async ([editor, publisher]) => {
      const rename = holdOpen(editor!, async (tx) => {
        await tx.execute(sql`
          update tracks set title = ${uniqueLabel("Renamed")}
           where id = ${world.album.trackIds[1]!}`);
      });
      await rename.ready;
      const pid = await pidOf(publisher!);
      const publishing = failure(
        publishLanguageVersion(publisher!, author, {
          entryId: world.journalId,
          locale: "en",
          expectedVersion: preview.disclosure.entryVersion,
          confirmation: preview.confirmation,
        }),
      );
      let waited = false;
      try {
        waited = await waitsOnLock(pid);
      } finally {
        rename.release();
      }
      await rename.done;
      expect(waited).toBe(true);
      expect(await publishing).toBe("confirmation_stale");
    });
    expect(await statusOf(world.journalId)).toBe("private");
  });

  it("a catalog edit waits for a publication holding the journal, then commits after it", async () => {
    const world = await committedWorld("Held");
    await withConnections(2, async ([publisher, editor]) => {
      // What a publication holds while it decides: its entry FOR UPDATE.
      const publication = holdOpen(publisher!, async (tx) => {
        await tx.execute(sql`
          select id from entries where id = ${world.journalId} for update`);
      });
      await publication.ready;
      const pid = await pidOf(editor!);
      const retitle = failure(
        catalog.updateAlbum(editor!, author, world.album.albumId, {
          title: uniqueLabel("Retitled"),
        }),
      );
      let waited = false;
      try {
        waited = await waitsOnLock(pid);
      } finally {
        publication.release();
      }
      await publication.done;
      expect(waited).toBe(true);
      expect(await retitle).toBe("succeeded");
    });
  });

  it("an artist rename waits for a memory publication's share lock on a linked track", async () => {
    const world = await committedWorld("Memory lock");
    await withConnections(2, async ([publisher, editor]) => {
      const publication = holdOpen(publisher!, async (tx) => {
        await tx.execute(sql`
          select id from entries where id = ${world.memoryId} for update`);
        expect(
          await lockMemoryCatalog(tx, [{ trackId: world.album.trackIds[0]! }]),
        ).toBe(true);
      });
      await publication.ready;
      const pid = await pidOf(editor!);
      const rename = failure(
        catalog.updateTrack(editor!, author, world.album.trackIds[0]!, {
          title: uniqueLabel("Renamed"),
        }),
      );
      let waited = false;
      try {
        waited = await waitsOnLock(pid);
      } finally {
        publication.release();
      }
      await publication.done;
      expect(waited).toBe(true);
      expect(await rename).toBe("succeeded");
    });
  });

  it("a memory's lock notices credits changed while it waited for the track (the re-read)", async () => {
    const world = await committedWorld("Reread");
    const other = await getDb().transaction(async (tx) => {
      const id = await createTestArtist(tx, uniqueLabel("Added credit"));
      created.artists.push(id);
      return id;
    });
    const trackId = world.album.trackIds[0]!;
    await withConnections(2, async ([editor, publisher]) => {
      // A credit change in progress: it holds the track, and has added an
      // artist the memory's lock has not read yet.
      const edit = holdOpen(editor!, async (tx) => {
        await tx.execute(
          sql`select id from tracks where id = ${trackId} for update`,
        );
        await tx.execute(sql`
          insert into track_artists (track_id, artist_id, position)
          values (${trackId}, ${other}, 2)`);
      });
      await edit.ready;
      const pid = await pidOf(publisher!);
      const locked = publisher!.transaction(async (tx) =>
        lockMemoryCatalog(tx, [{ trackId }]),
      );
      let waited = false;
      try {
        waited = await waitsOnLock(pid);
      } finally {
        edit.release();
      }
      await edit.done;
      expect(waited).toBe(true);
      // It read the old credits, locked them, waited for the track, and then
      // found a credit it did not lock: the publication answers stale.
      expect(await locked).toBe(false);
    });
  });
});

describe("step 1's impact inside a command's locks", () => {
  it("runs in a savepoint under the command's locks, and leaves them held", async () => {
    const world = await committedWorld("Impact");
    await withConnections(2, async ([command, other]) => {
      const held = holdOpen(command!, async (tx) => {
        await lockAlbumCatalogChange(tx, world.album.albumId, {});
        const impact = await catalogPublicImpact(tx, [
          {
            op: "update_album",
            albumId: world.album.albumId,
            title: "[Test] Hypothetical",
          },
        ]);
        // Nothing of the album is served: the journal and memory are private.
        expect(impact.pages).toEqual([]);
      });
      await held.ready;
      try {
        // The album row is still locked FOR UPDATE by the command after the
        // impact's savepoint rolled back.
        expect(
          await failure(
            other!.transaction(async (tx) => {
              await tx.execute(sql`
                select id from albums
                 where id = ${world.album.albumId} for share nowait`);
            }),
          ),
        ).toBe("55P03");
      } finally {
        held.release();
      }
      await held.done;
    });
  });
});

describe("no mix of catalog edits and publications deadlocks", () => {
  it("races renames, credit changes, tracklists, and publications on shared rows, with no deadlock", async () => {
    const world = await committedWorld("Race");
    const [first, second, third] = world.album.trackIds as [
      string,
      string,
      string,
    ];
    const outcomes: string[] = [];
    await withConnections(6, async (dbs) => {
      for (let round = 0; round < 8; round++) {
        const preview = await previewPublication(dbs[0]!, author, {
          entryId: world.journalId,
          locale: "en",
        });
        const memoryPreview = await previewPublication(dbs[0]!, author, {
          entryId: world.memoryId,
          locale: "en",
        });
        const results = await raceAll([
          () =>
            failure(
              publishLanguageVersion(dbs[0]!, author, {
                entryId: world.journalId,
                locale: "en",
                expectedVersion: preview.disclosure.entryVersion,
                confirmation: preview.confirmation,
              }),
            ),
          () =>
            failure(
              catalog.updateArtist(dbs[1]!, author, world.artistId, {
                name: uniqueLabel("Race name"),
              }),
            ),
          () =>
            failure(
              catalog.updateTrack(dbs[2]!, author, first, {
                title: uniqueLabel("Race track"),
                artistIds: [world.artistId],
              }),
            ),
          () =>
            failure(
              catalog.setAlbumTracklist(dbs[3]!, author, world.album.albumId, {
                tracks: (round % 2 === 0
                  ? [first, second, third]
                  : [second, first, third]
                ).map((trackId) => ({ trackId })),
              }),
            ),
          () =>
            failure(
              catalog.updateAlbum(dbs[4]!, author, world.album.albumId, {
                title: uniqueLabel("Race album"),
                credits: [{ artistId: world.artistId }],
              }),
            ),
          () =>
            failure(
              publishLanguageVersion(dbs[5]!, author, {
                entryId: world.memoryId,
                locale: "en",
                expectedVersion: memoryPreview.disclosure.entryVersion,
                confirmation: memoryPreview.confirmation,
              }),
            ),
        ]);
        outcomes.push(
          ...results.map((result) =>
            result.status === "fulfilled"
              ? result.value
              : String(result.reason),
          ),
        );
        // Put the journals back, so each round publishes again.
        for (const entryId of [world.journalId, world.memoryId]) {
          if ((await statusOf(entryId)) === "published") {
            await unpublishLanguageVersion(
              dbs[0]!,
              author,
              entryId,
              "en",
              "private",
            );
          }
        }
      }
    });
    // No deadlock (40P01), and every refusal is a known answer: a stale
    // confirmation, because the catalog changed after its preview.
    expect(outcomes.filter((outcome) => outcome.includes("40P01"))).toEqual([]);
    expect(
      outcomes.filter(
        (outcome) =>
          outcome !== "succeeded" && outcome !== "confirmation_stale",
      ),
    ).toEqual([]);
  });
});
