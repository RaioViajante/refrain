import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, type Locale, type Transaction } from "@/db";
import {
  deleteAlbumJournal,
  restoreAlbumJournal,
  saveAlbumJournal,
  setAlbumJournalPrivacy,
} from "@/modules/journals";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestTrackReflection,
  publishForTest,
  raceAll,
  claimsOf,
  reissueTestToken,
  shiftedTestToken,
  testAuthor,
  withConnections,
  type TestAlbum,
} from "@/testing";

import { changeEntrySlug, restoreDeletedEntry } from "./commands";
import { readPublishState } from "./disclosure";
import { PublicationError } from "./errors";
import { previewPublication, publishLanguageVersion } from "./publish";

// ADR 0006 § 13, tests 4 (the stamp), 6 (concurrency), and 12 (previews take
// no lock). Separate transactions on real connections, because inside one
// rolled-back transaction `now()` never moves and no race is possible. The
// rows are committed to the disposable test database and removed at the end;
// everything is synthetic.

const author = testAuthor();
const created: { entries: string[]; albums: TestAlbum[] } = {
  entries: [],
  albums: [],
};

afterAll(async () => {
  await getDb().transaction(async (tx) => {
    for (const entryId of created.entries) {
      await tx.execute(
        sql`delete from entry_slugs where entry_id = ${entryId}`,
      );
      await tx.execute(sql`delete from entries where id = ${entryId}`);
    }
    for (const album of created.albums) {
      await tx.execute(
        sql`delete from edition_tracks where album_id = ${album.albumId}`,
      );
      await tx.execute(
        sql`delete from album_tracks where album_id = ${album.albumId}`,
      );
      await tx.execute(
        sql`delete from album_editions where album_id = ${album.albumId}`,
      );
      for (const trackId of album.trackIds) {
        await tx.execute(sql`delete from tracks where id = ${trackId}`);
      }
      await tx.execute(sql`delete from albums where id = ${album.albumId}`);
    }
  });
});

async function committedJournal() {
  return getDb().transaction(async (tx) => {
    const album = await createTestAlbum(tx, {
      title: `[Test] Publish race ${randomUUID().slice(0, 8)}`,
      trackTitles: ["[Test] A", "[Test] B"],
    });
    const entryId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      slug: `test-${randomUUID().slice(0, 12)}`,
      ratingHalfSteps: 6,
      versions: [
        { locale: "en", text: "[Test] English words" },
        { locale: "pt-BR", isOriginal: false, text: "[Test] Palavras" },
      ],
    });
    const reflectionId = await createTestTrackReflection(tx, {
      albumJournalId: entryId,
      albumId: album.albumId,
      trackId: album.trackIds[0]!,
      isPublished: true,
      texts: { en: "[Test] en", "pt-BR": "[Test] pt" },
    });
    created.albums.push(album);
    created.entries.push(entryId);
    return { entryId, reflectionId };
  });
}

function request(
  entryId: string,
  confirmation: string,
  entryVersion: number,
  locale: Locale = "en",
) {
  return { entryId, locale, expectedVersion: entryVersion, confirmation };
}

async function stampOf(entryId: string, locale: Locale = "en") {
  const state = await readPublishState(getDb(), entryId, locale);
  return {
    entry: state.entryUpdatedAt,
    version: state.versionUpdatedAt,
    status: state.status,
  };
}

async function statusOf(entryId: string, locale: Locale) {
  const result = await getDb().execute<{ status: string }>(
    sql`select status from entry_texts where entry_id = ${entryId} and locale = ${locale}`,
  );
  return result.rows[0]?.status;
}

// Waits until some connection of these tests is waiting for a lock, so the
// order of events is controlled and no test sleeps for a guessed time.
async function waitUntilBlocked(tx: Transaction): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const result = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
       where datname = current_database()
         and wait_event_type = 'Lock'
         and application_name = 'refrain-concurrency-tests'`);
    if (result.rows[0]!.n > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The call was never blocked behind the entry lock.");
}

async function lockEntryRow(tx: Transaction, entryId: string) {
  await tx.execute(sql`select 1 from entries where id = ${entryId} for update`);
}

function within<Result>(work: Promise<Result>, ms: number, what: string) {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} was blocked.`)), ms),
    ),
  ]);
}

type Outcome =
  | { ok: true; changed: boolean }
  | { ok: false; failure: string; other?: unknown };

function describeOutcome(
  settled: PromiseSettledResult<{ changed: boolean }>,
): Outcome {
  if (settled.status === "fulfilled") {
    return { ok: true, changed: settled.value.changed };
  }
  const reason = settled.reason;
  return reason instanceof PublicationError
    ? { ok: false, failure: reason.failure }
    : { ok: false, failure: "unexpected", other: reason };
}

// Holds the entry lock in one transaction, applies `mutate` in it, starts a
// publication with `token` on another connection (which must then wait for
// the lock), and commits. Returns what the publication did.
async function publishBlockedBehind(
  entryId: string,
  token: { confirmation: string; entryVersion: number },
  mutate: (tx: Transaction) => Promise<void>,
  afterBlocked: (tx: Transaction) => Promise<void> = async () => {},
): Promise<Outcome> {
  return withConnections(2, async ([a, b]) => {
    let pending:
      Promise<PromiseSettledResult<{ changed: boolean }>> | undefined;
    try {
      await a!.transaction(async (tx) => {
        await lockEntryRow(tx, entryId);
        await mutate(tx);
        pending = Promise.allSettled([
          publishLanguageVersion(
            b!,
            author,
            request(entryId, token.confirmation, token.entryVersion),
          ),
        ]).then(([settled]) => settled!);
        await waitUntilBlocked(tx);
        await afterBlocked(tx);
      });
    } finally {
      await pending;
    }
    return describeOutcome((await pending)!);
  });
}

describe("every command that changes what is public moves the state stamp (test 4)", () => {
  it("save, publish, unpublish, delete, and restore each move it", async () => {
    const { entryId } = await committedJournal();
    const steps: [string, () => Promise<unknown>][] = [
      [
        "save",
        () =>
          saveAlbumJournal(author, {
            entryId,
            expectedVersion: 1,
            opening: "[Test] An opening",
          }),
      ],
      ["publish", () => publishForTest(getDb(), entryId, "en")],
      [
        "unpublish",
        () =>
          setAlbumJournalPrivacy(author, {
            entryId,
            locale: "en",
            status: "private",
          }),
      ],
      ["delete", () => deleteAlbumJournal(author, entryId)],
      ["restore", () => restoreAlbumJournal(author, entryId)],
    ];
    for (const [name, step] of steps) {
      const before = await stampOf(entryId);
      await step();
      const after = await stampOf(entryId);
      expect(after, name).not.toEqual(before);
    }
  });

  it("an address change does not move it, and is bound as an atom instead", async () => {
    const { entryId } = await committedJournal();
    const before = await stampOf(entryId);
    const first = await previewPublication(getDb(), author, {
      entryId,
      locale: "en",
    });
    await changeEntrySlug(
      getDb(),
      entryId,
      `moved-${randomUUID().slice(0, 8)}`,
    );
    expect(await stampOf(entryId)).toEqual(before);

    const second = await previewPublication(getDb(), author, {
      entryId,
      locale: "en",
    });
    expect(second.disclosure.address.slug).not.toBe(
      first.disclosure.address.slug,
    );
    const error = await publishLanguageVersion(
      getDb(),
      author,
      request(entryId, first.confirmation, 1),
    ).catch((caught: unknown) => caught);
    expect((error as PublicationError).failure).toBe("confirmation_stale");
    expect(await statusOf(entryId, "en")).toBe("draft");
  });
});

describe("a token from before a deletion cannot republish a restored journal (ADR 0006 § 8)", () => {
  it("fails on the stamp, although the version and the text never changed", async () => {
    const { entryId } = await committedJournal();
    const before = await previewPublication(getDb(), author, {
      entryId,
      locale: "en",
    });
    await deleteAlbumJournal(author, entryId);
    await restoreAlbumJournal(author, entryId);

    // Nothing the token describes differs except when it was last touched.
    const after = await previewPublication(getDb(), author, {
      entryId,
      locale: "en",
    });
    expect(after.disclosure).toEqual(before.disclosure);

    const error = await publishLanguageVersion(
      getDb(),
      author,
      request(entryId, before.confirmation, 1),
    ).catch((caught: unknown) => caught);
    expect((error as PublicationError).failure).toBe("confirmation_stale");
    expect(await statusOf(entryId, "en")).toBe("draft");

    await expect(
      publishLanguageVersion(
        getDb(),
        author,
        request(entryId, after.confirmation, 1),
      ),
    ).resolves.toEqual({ changed: true });
  });
});

describe("previews and refusals before the lock take no lock (test 12)", () => {
  it("a preview completes while another transaction holds the entry lock", async () => {
    const { entryId } = await committedJournal();
    await withConnections(2, async ([a, b]) => {
      await a!.transaction(async (tx) => {
        await lockEntryRow(tx, entryId);
        const preview = await within(
          previewPublication(b!, author, { entryId, locale: "en" }),
          4000,
          "The preview",
        );
        expect(preview.disclosure.entryId).toBe(entryId);
      });
    });
  });

  it("a forged token is refused without waiting for the lock", async () => {
    const { entryId } = await committedJournal();
    const real = await previewPublication(getDb(), author, {
      entryId,
      locale: "en",
    });
    const forged = `${real.confirmation.slice(0, -3)}AAA`;
    await withConnections(2, async ([a, b]) => {
      await a!.transaction(async (tx) => {
        await lockEntryRow(tx, entryId);
        const error = await within(
          publishLanguageVersion(b!, author, request(entryId, forged, 1)).catch(
            (caught: unknown) => caught,
          ),
          4000,
          "The forged publication",
        );
        expect((error as PublicationError).failure).toBe(
          "confirmation_invalid",
        );
      });
    });
  });
});

describe("publication against concurrent changes (test 6)", () => {
  async function fresh() {
    const ids = await committedJournal();
    const preview = await previewPublication(getDb(), author, {
      entryId: ids.entryId,
      locale: "en",
    });
    return {
      ...ids,
      token: {
        confirmation: preview.confirmation,
        entryVersion: preview.disclosure.entryVersion,
      },
    };
  }

  it("waits for the lock, and then publishes if nothing changed", async () => {
    const { entryId, token } = await fresh();
    const outcome = await publishBlockedBehind(entryId, token, async () => {});
    expect(outcome).toEqual({ ok: true, changed: true });
    expect(await statusOf(entryId, "en")).toBe("published");
  });

  const changes: [
    string,
    string,
    (
      tx: Transaction,
      ids: { entryId: string; reflectionId: string },
    ) => Promise<void>,
  ][] = [
    [
      "a flag flipped",
      "confirmation_stale",
      async (tx, ids) => {
        await tx.execute(
          sql`update track_reflections set is_published = false where id = ${ids.reflectionId}`,
        );
      },
    ],
    [
      "a reflection's rating changed",
      "confirmation_stale",
      async (tx, ids) => {
        await tx.execute(
          sql`update track_reflections set rating_half_steps = 3 where id = ${ids.reflectionId}`,
        );
      },
    ],
    [
      "the album rating changed",
      "confirmation_stale",
      async (tx, ids) => {
        await tx.execute(
          sql`update album_journals set rating_half_steps = 9 where entry_id = ${ids.entryId}`,
        );
      },
    ],
    [
      "a text saved (the version moves on)",
      "version_conflict",
      async (tx, ids) => {
        await tx.execute(
          sql`update entry_texts set opening = '[Test] Saved', updated_at = now() where entry_id = ${ids.entryId} and locale = 'en'`,
        );
        await tx.execute(
          sql`update entries set version = version + 1, updated_at = now() where id = ${ids.entryId}`,
        );
      },
    ],
    [
      "the entry deleted",
      "entry_deleted",
      async (tx, ids) => {
        await tx.execute(
          sql`update entries set deleted_at = now(), updated_at = now() where id = ${ids.entryId}`,
        );
      },
    ],
    [
      "the entry deleted and restored",
      "confirmation_stale",
      async (tx, ids) => {
        await tx.execute(
          sql`update entries set deleted_at = clock_timestamp() where id = ${ids.entryId}`,
        );
        await restoreDeletedEntry(tx, ids.entryId);
        await tx.execute(
          sql`update entries set updated_at = clock_timestamp() where id = ${ids.entryId}`,
        );
      },
    ],
    [
      "the address changed",
      "confirmation_stale",
      async (tx, ids) => {
        await changeEntrySlug(
          tx,
          ids.entryId,
          `moved-${randomUUID().slice(0, 8)}`,
        );
      },
    ],
  ];

  it.each(changes)(
    "refuses a token when %s while it waited, and writes nothing",
    async (_name, expected, mutate) => {
      const ids = await fresh();
      const outcome = await publishBlockedBehind(ids.entryId, ids.token, (tx) =>
        mutate(tx, ids),
      );
      expect(outcome).toEqual({ ok: false, failure: expected });
      expect(await statusOf(ids.entryId, "en")).toBe("draft");
      const history = await getDb().execute<{ first: string | null }>(
        sql`select first_published_at::text as first from entries where id = ${ids.entryId}`,
      );
      expect(history.rows[0]!.first).toBeNull();
    },
  );

  it("reads the expiry after the lock was granted, not when the transaction began (ADR 0006 L6)", async () => {
    const ids = await fresh();
    // The same token, valid for only about two and a half seconds more.
    const short = shiftedTestToken(
      ids.token.confirmation,
      -(15 * 60 * 1000 - 2500),
    );
    const expiresAtMs = claimsOf(short).x;
    const outcome = await publishBlockedBehind(
      ids.entryId,
      { confirmation: short, entryVersion: ids.token.entryVersion },
      async () => {},
      // The publication is now waiting for the lock, and its transaction has
      // already begun. Hold the lock until the database clock is past the
      // expiry: only a clock read after the lock was granted notices.
      async (tx) => {
        // The test proves something only if the waiting transaction began
        // before the token expired; on a runner too slow for that it fails
        // loudly instead of quietly checking nothing.
        const waiting = await tx.execute<{ started: string }>(sql`
          select floor(extract(epoch from xact_start) * 1000)::bigint::text
                   as started
            from pg_stat_activity
           where wait_event_type = 'Lock'
             and application_name = 'refrain-concurrency-tests'
             and datname = current_database()
           limit 1`);
        expect(Number(waiting.rows[0]!.started)).toBeLessThan(expiresAtMs);
        for (let attempt = 0; attempt < 200; attempt++) {
          const clock = await tx.execute<{ past: boolean }>(sql`
            select floor(extract(epoch from clock_timestamp()) * 1000)
                   >= ${expiresAtMs} as past`);
          if (clock.rows[0]!.past) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("The database clock never passed the expiry.");
      },
    );
    expect(outcome).toEqual({ ok: false, failure: "confirmation_expired" });
    expect(await statusOf(ids.entryId, "en")).toBe("draft");
  });

  it("refuses a token when another publication won while it waited", async () => {
    const ids = await fresh();
    const outcome = await publishBlockedBehind(
      ids.entryId,
      ids.token,
      async (tx) => {
        // A complete, real publication inside the lock holder.
        const preview = await previewPublication(tx, author, {
          entryId: ids.entryId,
          locale: "en",
        });
        await publishLanguageVersion(
          tx,
          author,
          request(
            ids.entryId,
            preview.confirmation,
            preview.disclosure.entryVersion,
          ),
        );
      },
    );
    expect(outcome).toEqual({ ok: false, failure: "confirmation_stale" });
    expect(await statusOf(ids.entryId, "en")).toBe("published");
  });

  it("lets exactly one of eight simultaneous publications win, with no deadlock and no raw error", async () => {
    for (let round = 0; round < 5; round++) {
      const { entryId } = await committedJournal();
      const outcomes = await withConnections(8, async (dbs) => {
        const previews = await Promise.all(
          dbs.map((db) =>
            previewPublication(db, author, { entryId, locale: "en" }),
          ),
        );
        return raceAll(
          dbs.map(
            (db, index) => () =>
              publishLanguageVersion(
                db,
                author,
                request(
                  entryId,
                  previews[index]!.confirmation,
                  previews[index]!.disclosure.entryVersion,
                ),
              ),
          ),
        );
      });
      const results = outcomes.map(describeOutcome);
      expect(results.filter((r) => r.ok && r.changed)).toHaveLength(1);
      for (const result of results.filter((r) => !r.ok)) {
        // Only domain failures: never `deadlock_detected` or a raw SQL error.
        expect(result).toEqual({ ok: false, failure: "confirmation_stale" });
      }
      expect(await statusOf(entryId, "en")).toBe("published");
    }
  });

  it("publishes two languages at once without a deadlock; any refusal is a domain refusal", async () => {
    for (let round = 0; round < 3; round++) {
      const { entryId } = await committedJournal();
      const outcomes = await withConnections(2, async ([a, b]) => {
        const english = await previewPublication(a!, author, {
          entryId,
          locale: "en",
        });
        const portuguese = await previewPublication(b!, author, {
          entryId,
          locale: "pt-BR",
        });
        return raceAll([
          () =>
            publishLanguageVersion(
              a!,
              author,
              request(entryId, english.confirmation, 1, "en"),
            ),
          () =>
            publishLanguageVersion(
              b!,
              author,
              request(entryId, portuguese.confirmation, 1, "pt-BR"),
            ),
        ]);
      });
      const results = outcomes.map(describeOutcome);
      expect(results.some((r) => r.ok)).toBe(true);
      for (const result of results.filter((r) => !r.ok)) {
        // The album rating becomes "already public" when the other language
        // wins, which changes the disclosure: the loser must preview again.
        expect(result).toEqual({ ok: false, failure: "confirmation_stale" });
      }
    }
  });

  it("a restore racing a publication leaves a valid state", async () => {
    for (let round = 0; round < 4; round++) {
      const { entryId } = await committedJournal();
      await deleteAlbumJournal(author, entryId);
      const outcomes = await withConnections(1, async ([b]) =>
        raceAll([
          () => restoreAlbumJournal(author, entryId),
          () => publishForTest(b!, entryId, "en"),
        ]),
      );
      const [restored, published] = outcomes;
      expect(restored?.status).toBe("fulfilled");
      const deleted = await getDb().execute<{ deleted: boolean }>(
        sql`select deleted_at is not null as deleted from entries where id = ${entryId}`,
      );
      expect(deleted.rows[0]!.deleted).toBe(false);
      if (published?.status === "rejected") {
        expect(published.reason).toBeInstanceOf(PublicationError);
        expect(await statusOf(entryId, "en")).toBe("draft");
      }
    }
  });

  it("reissuing a token cannot make a stale disclosure current", async () => {
    // A token re-signed with a later time is still bound to its fingerprint.
    const ids = await fresh();
    await getDb().execute(
      sql`update track_reflections set is_published = false where id = ${ids.reflectionId}`,
    );
    const later = reissueTestToken(ids.token.confirmation, {});
    const error = await publishLanguageVersion(
      getDb(),
      author,
      request(ids.entryId, later, ids.token.entryVersion),
    ).catch((caught: unknown) => caught);
    expect((error as PublicationError).failure).toBe("confirmation_stale");
  });
});
