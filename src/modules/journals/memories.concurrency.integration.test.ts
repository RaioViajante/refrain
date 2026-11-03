import { inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, schema } from "@/db";
import { raceAll, testAuthor, uniqueLabel, withConnections } from "@/testing";

import { permanentlyDeleteEntry } from "./commands";
import { JournalError } from "./errors";
import {
  createMemory,
  deleteMemory,
  restoreMemory,
  saveMemory,
} from "./memories";
import { getMemory } from "./memory-queries";

// Concurrent memory commands over real, separate database connections. The
// rows are committed and removed at the end; everything is synthetic.

const author = testAuthor();
const created: { entries: string[]; tracks: string[] } = {
  entries: [],
  tracks: [],
};

afterAll(async () => {
  const db = getDb();
  for (const entryId of created.entries) {
    await deleteMemory(db, author, entryId).catch(() => undefined);
    await permanentlyDeleteEntry(db, entryId).catch(() => undefined);
  }
  if (created.tracks.length > 0) {
    await db
      .delete(schema.tracks)
      .where(inArray(schema.tracks.id, created.tracks))
      .catch(() => undefined);
  }
});

async function newTracks(count: number): Promise<string[]> {
  const rows = await getDb()
    .insert(schema.tracks)
    .values(
      Array.from({ length: count }, () => ({ title: uniqueLabel("Track") })),
    )
    .returning({ id: schema.tracks.id });
  const ids = rows.map((row) => row.id);
  created.tracks.push(...ids);
  return ids;
}

async function newMemory(trackIds: string[] = []): Promise<string> {
  const { entryId } = await createMemory(getDb(), author, {
    title: uniqueLabel("Memory"),
    body: "[Test] Words.",
    trackIds,
  });
  created.entries.push(entryId);
  return entryId;
}

function failureOf(result: PromiseSettledResult<unknown>): string | undefined {
  if (result.status === "fulfilled") {
    return undefined;
  }
  expect(result.reason).toBeInstanceOf(JournalError);
  return (result.reason as JournalError).failure;
}

async function positions(memoryId: string) {
  const result = await getDb().execute<{ track_id: string; position: number }>(
    sql`select track_id, position from memory_music
         where memory_id = ${memoryId} order by position`,
  );
  return result.rows;
}

describe("concurrent memory commands", () => {
  it("lets exactly one of two saves from the same version through, with its whole list", async () => {
    const [a, b, c] = await newTracks(3);
    const memoryId = await newMemory([a!, b!]);
    const results = await withConnections(2, ([one, two]) =>
      raceAll([
        () =>
          saveMemory(one!, author, {
            entryId: memoryId,
            expectedVersion: 1,
            title: "[Test] Tab one",
            trackIds: [b!, a!],
          }),
        () =>
          saveMemory(two!, author, {
            entryId: memoryId,
            expectedVersion: 1,
            title: "[Test] Tab two",
            trackIds: [a!, c!],
          }),
      ]),
    );
    const failures = results.map(failureOf);
    expect(failures.filter((code) => code === undefined)).toHaveLength(1);
    expect(failures).toContain("version_conflict");

    const memory = await getMemory(getDb(), author, memoryId);
    expect(memory!.version).toBe(2);
    const won = failures[0] === undefined ? 0 : 1;
    expect(memory!.title).toBe(won === 0 ? "[Test] Tab one" : "[Test] Tab two");
    // The winner's list, whole, numbered 1..n: never a mix of both.
    expect(await positions(memoryId)).toEqual(
      (won === 0 ? [b!, a!] : [a!, c!]).map((trackId, index) => ({
        track_id: trackId,
        position: index + 1,
      })),
    );
  });

  it("serializes a save and a deletion: the save lands first, or is refused", async () => {
    const memoryId = await newMemory();
    const results = await withConnections(2, ([one, two]) =>
      raceAll([
        () =>
          saveMemory(one!, author, {
            entryId: memoryId,
            expectedVersion: 1,
            body: "[Test] Raced words.",
          }),
        () => deleteMemory(two!, author, memoryId),
      ]),
    );
    expect(results[1]!.status).toBe("fulfilled");
    const saved = failureOf(results[0]!);
    expect([undefined, "entry_deleted"]).toContain(saved);
    const memory = await getMemory(getDb(), author, memoryId);
    expect(memory!.deletedAt).not.toBeNull();
    expect(memory!.body).toBe(
      saved === undefined ? "[Test] Raced words." : "[Test] Words.",
    );
  });

  it("restores once when two restores race", async () => {
    const memoryId = await newMemory();
    await deleteMemory(getDb(), author, memoryId);
    const results = await withConnections(2, ([one, two]) =>
      raceAll([
        () => restoreMemory(one!, author, memoryId),
        () => restoreMemory(two!, author, memoryId),
      ]),
    );
    expect(results.map(failureOf).sort()).toEqual([
      "entry_not_deleted",
      undefined,
    ]);
    expect((await getMemory(getDb(), author, memoryId))!.deletedAt).toBeNull();
  });

  it("gives two memories with the same title two addresses", async () => {
    const title = uniqueLabel("Same title");
    const results = await withConnections(2, ([one, two]) =>
      raceAll([
        () => createMemory(one!, author, { title }),
        () => createMemory(two!, author, { title }),
      ]),
    );
    const ids = results.map((result) => {
      expect(result.status).toBe("fulfilled");
      return (result as PromiseFulfilledResult<{ entryId: string }>).value
        .entryId;
    });
    created.entries.push(...ids);
    const slugs = await Promise.all(
      ids.map(async (id) => (await getMemory(getDb(), author, id))!.slug),
    );
    expect(new Set(slugs).size).toBe(2);
  });

  it("refuses a link to a recording deleted between its check and its insert, with a domain failure", async () => {
    const [kept, doomed] = await newTracks(2);
    const memoryId = await newMemory([kept!]);
    const refused = await withConnections(2, async ([one, two]) => {
      let release!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      let deleted!: () => void;
      const deletedYet = new Promise<void>((resolve) => (deleted = resolve));
      // An uncommitted catalog deletion: the save's check still sees the
      // recording, and the link's foreign-key check then waits for it.
      const deleting = one!.transaction(async (tx) => {
        await tx
          .delete(schema.tracks)
          .where(inArray(schema.tracks.id, [doomed!]));
        deleted();
        await hold;
      });
      await deletedYet;
      const saving = saveMemory(two!, author, {
        entryId: memoryId,
        expectedVersion: 1,
        trackIds: [kept!, doomed!],
      }).then(
        () => undefined,
        (error: unknown) =>
          error instanceof JournalError ? error.failure : error,
      );
      for (let attempt = 0; attempt < 200; attempt++) {
        const waiting = await getDb().execute<{ n: number }>(sql`
          select count(*)::int as n from pg_stat_activity
           where application_name = 'refrain-concurrency-tests'
             and wait_event_type = 'Lock'`);
        if (waiting.rows[0]!.n > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      release();
      await deleting;
      return saving;
    });
    created.tracks.splice(created.tracks.indexOf(doomed!), 1);
    expect(refused).toBe("track_not_found");
    // Nothing of the save was written.
    expect(await positions(memoryId)).toEqual([
      { track_id: kept!, position: 1 },
    ]);
    expect((await getMemory(getDb(), author, memoryId))!.version).toBe(1);
  });
});
