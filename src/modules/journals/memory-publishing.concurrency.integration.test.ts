import { inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, schema, type Database, type Transaction } from "@/db";
import { raceAll, testAuthor, uniqueLabel, withConnections } from "@/testing";

import { permanentlyDeleteEntry } from "./commands";
import { JournalError } from "./errors";
import {
  createMemory,
  deleteMemory,
  saveMemory,
  setMemoryPrivacy,
} from "./memories";
import {
  previewMemoryPublicChange,
  previewMemoryPublication,
  publishMemoryVersion,
} from "./memory-publishing";
import { getMemory } from "./memory-queries";

// Publishing and confirmed saves of memories (M3.7) over real, separate
// database connections, with committed rows that are removed at the end. The
// entry lock decides every race (ADR 0006 § 7, L1 and L6): a transaction that
// holds it stands in for the other request, and the test checks that the
// waiting command was seen waiting, so the race is real. Everything is
// synthetic.

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

async function newMemory(trackIds: string[]): Promise<string> {
  const { entryId } = await createMemory(getDb(), author, {
    title: uniqueLabel("Memory"),
    body: "[Test] Words.",
    trackIds,
  });
  created.entries.push(entryId);
  return entryId;
}

async function publishNow(entryId: string) {
  const { review, confirmation } = await previewMemoryPublication(
    getDb(),
    author,
    { entryId, locale: "en" },
  );
  await publishMemoryVersion(getDb(), author, {
    entryId,
    locale: "en",
    expectedVersion: review.entryVersion,
    confirmation,
  });
}

/** Whether a test connection is waiting for a lock, within two seconds. */
async function sawLockWait(): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const waiting = await getDb().execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
       where application_name = 'refrain-concurrency-tests'
         and wait_event_type = 'Lock'`);
    if (waiting.rows[0]!.n > 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

function outcome(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "ok",
    (error: unknown) =>
      error instanceof JournalError ? error.failure : String(error),
  );
}

async function statusOf(entryId: string) {
  const result = await getDb().execute<{ status: string }>(sql`
    select status from entry_texts where entry_id = ${entryId}`);
  return result.rows[0]!.status;
}

/**
 * Holds the memory's entry lock on connection `one`, runs `change` there and
 * commits it only after `waiter` (on connection `two`) is seen waiting for
 * the lock. Returns what the waiter ended with.
 */
async function whileLocked(
  entryId: string,
  change: (tx: Transaction) => Promise<unknown>,
  waiter: (db: Database) => Promise<unknown>,
): Promise<string> {
  return withConnections(2, async ([one, two]) => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let lockedYet!: () => void;
    const locked = new Promise<void>((resolve) => (lockedYet = resolve));
    const holding = one!.transaction(async (tx) => {
      await tx.execute(
        sql`select id from entries where id = ${entryId} for update`,
      );
      await change(tx);
      lockedYet();
      await hold;
    });
    await locked;
    const waiting = outcome(waiter(two!));
    expect(await sawLockWait()).toBe(true);
    release();
    await holding;
    return waiting;
  });
}

describe("publishing a memory, against concurrent changes", () => {
  it("refuses a publication whose song list changed while it waited for the lock", async () => {
    const [a, b] = await newTracks(2);
    const entryId = await newMemory([a!]);
    const { confirmation } = await previewMemoryPublication(getDb(), author, {
      entryId,
      locale: "en",
    });
    const result = await whileLocked(
      entryId,
      (tx) =>
        tx.execute(sql`insert into memory_music (memory_id, position, track_id)
                        values (${entryId}, 2, ${b!})`),
      (db) =>
        publishMemoryVersion(db, author, {
          entryId,
          locale: "en",
          expectedVersion: 1,
          confirmation,
        }),
    );
    expect(result).toBe("confirmation_stale");
    expect(await statusOf(entryId)).toBe("draft");
  });

  it("refuses a publication of a memory deleted while it waited", async () => {
    const [a] = await newTracks(1);
    const entryId = await newMemory([a!]);
    const { confirmation } = await previewMemoryPublication(getDb(), author, {
      entryId,
      locale: "en",
    });
    const result = await whileLocked(
      entryId,
      (tx) =>
        tx.execute(
          sql`update entries set deleted_at = now() where id = ${entryId}`,
        ),
      (db) =>
        publishMemoryVersion(db, author, {
          entryId,
          locale: "en",
          expectedVersion: 1,
          confirmation,
        }),
    );
    expect(result).toBe("entry_deleted");
    expect(await statusOf(entryId)).toBe("draft");
  });

  it("publishes once when eight requests send the same token at once", async () => {
    const [a] = await newTracks(1);
    const entryId = await newMemory([a!]);
    const { confirmation } = await previewMemoryPublication(getDb(), author, {
      entryId,
      locale: "en",
    });
    const results = await withConnections(8, (databases) =>
      raceAll(
        databases.map(
          (db) => () =>
            publishMemoryVersion(db, author, {
              entryId,
              locale: "en",
              expectedVersion: 1,
              confirmation,
            }),
        ),
      ),
    );
    const published = results.filter(
      (result) =>
        result.status === "fulfilled" &&
        (result.value as { changed: boolean }).changed,
    );
    expect(published).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(JournalError);
        expect((result.reason as JournalError).failure).toBe(
          "confirmation_stale",
        );
      }
    }
    expect(await statusOf(entryId)).toBe("published");
  });
});

describe("the confirmed save of a published memory, against concurrent changes", () => {
  it("refuses a confirmed save whose memory changed while it waited, writing nothing", async () => {
    const [a, b] = await newTracks(2);
    const entryId = await newMemory([a!, b!]);
    await publishNow(entryId);
    const input = {
      entryId,
      expectedVersion: 1,
      title: "[Test] A confirmed title",
    };
    const { confirmation } = await previewMemoryPublicChange(
      getDb(),
      author,
      input,
    );
    const result = await whileLocked(
      entryId,
      // Another tab's removal (no token needed), and its version bump.
      (tx) =>
        tx.execute(sql`
          with removed as (
            delete from memory_music
             where memory_id = ${entryId} and track_id = ${b!})
          update entries set version = 2 where id = ${entryId}`),
      (db) => saveMemory(db, author, { ...input, confirmation: confirmation! }),
    );
    expect(result).toBe("version_conflict");
    const memory = await getMemory(getDb(), author, entryId);
    expect(memory!.title).not.toBe("[Test] A confirmed title");
  });

  it("refuses a confirmed save when the stamp moved while it waited, even at the same version", async () => {
    const [a] = await newTracks(1);
    const entryId = await newMemory([a!]);
    await publishNow(entryId);
    const input = {
      entryId,
      expectedVersion: 1,
      rememberedWhen: "[Test] A confirmed when",
    };
    const { confirmation } = await previewMemoryPublicChange(
      getDb(),
      author,
      input,
    );
    const result = await whileLocked(
      entryId,
      // Something that moves the state stamp and not the version: an
      // unpublication and republication would do; this touches the version
      // row's `updated_at` directly.
      (tx) =>
        tx.execute(sql`update entry_texts set updated_at = clock_timestamp()
                        where entry_id = ${entryId}`),
      (db) => saveMemory(db, author, { ...input, confirmation: confirmation! }),
    );
    expect(result).toBe("confirmation_stale");
    expect((await getMemory(getDb(), author, entryId))!.rememberedWhen).toBe(
      null,
    );
  });

  it("saves without its token when the memory was unpublished while it waited", async () => {
    const [a] = await newTracks(1);
    const entryId = await newMemory([a!]);
    await publishNow(entryId);
    const result = await whileLocked(
      entryId,
      (tx) =>
        tx.execute(sql`update entry_texts
                          set status = 'private', published_at = null,
                              updated_at = clock_timestamp()
                        where entry_id = ${entryId}`),
      // No token: once it is not public, the save changes nothing a reader
      // sees, so it needs none.
      (db) =>
        saveMemory(db, author, {
          entryId,
          expectedVersion: 1,
          title: "[Test] Saved after the unpublication",
        }),
    );
    expect(result).toBe("ok");
    expect((await getMemory(getDb(), author, entryId))!.title).toBe(
      "[Test] Saved after the unpublication",
    );
  });

  it("lets exactly one of two confirmed saves from the same version through", async () => {
    const [a, b] = await newTracks(2);
    const entryId = await newMemory([a!, b!]);
    await publishNow(entryId);
    const first = { entryId, expectedVersion: 1, trackIds: [b!, a!] };
    const second = { entryId, expectedVersion: 1, title: "[Test] Tab two" };
    const one = await previewMemoryPublicChange(getDb(), author, first);
    const two = await previewMemoryPublicChange(getDb(), author, second);
    const results = await withConnections(2, ([x, y]) =>
      raceAll([
        () =>
          saveMemory(x!, author, { ...first, confirmation: one.confirmation! }),
        () =>
          saveMemory(y!, author, {
            ...second,
            confirmation: two.confirmation!,
          }),
      ]),
    );
    const failures = results
      .filter((result) => result.status === "rejected")
      .map(
        (result) =>
          ((result as PromiseRejectedResult).reason as JournalError).failure,
      );
    expect(failures).toEqual(["version_conflict"]);
    expect((await getMemory(getDb(), author, entryId))!.version).toBe(2);
  });

  it("an unpublication waits for a confirmed save, then takes the memory away", async () => {
    const [a] = await newTracks(1);
    const entryId = await newMemory([a!]);
    await publishNow(entryId);
    const result = await whileLocked(
      entryId,
      (tx) =>
        tx.execute(
          sql`update entries set version = version + 1 where id = ${entryId}`,
        ),
      (db) =>
        setMemoryPrivacy(db, author, {
          entryId,
          locale: "en",
          status: "private",
          expectedStatus: "published",
        }),
    );
    expect(result).toBe("ok");
    expect(await statusOf(entryId)).toBe("private");
  });
});
