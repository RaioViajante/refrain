import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, schema, type Transaction } from "@/db";
import { CatalogError, setAlbumTracklist } from "@/modules/catalog";
import {
  listPublicTrackReflections,
  previewPublication,
  publishLanguageVersion,
  PublicationError,
} from "@/modules/publication";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestTrackReflection,
  raceAll,
  rowChecksum,
  testAuthor,
  withConnections,
  type TestAlbum,
  setPrivacyForTest,
} from "@/testing";

import {
  deleteAlbumJournal,
  previewAlbumJournalChange,
  restoreAlbumJournal,
  saveAlbumJournal,
} from "./commands";
import { JournalError } from "./errors";
import { getTrackByTrack } from "./queries";

// ADR 0006 § 13, test 6, for reflections, ratings, and the confirmed save:
// concurrent writes over real, separate connections. The rows are committed to
// the disposable test database and removed afterwards; everything is
// synthetic. No test sleeps for a guessed time: the order of events is
// controlled by holding the entry lock in a transaction of the test.

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

async function committedJournal(published = false) {
  return getDb().transaction(async (tx) => {
    const album = await createTestAlbum(tx, {
      title: `[Test] Reflection race ${randomUUID().slice(0, 8)}`,
      trackTitles: ["[Test] A", "[Test] B", "[Test] C"],
    });
    const entryId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      slug: `test-${randomUUID().slice(0, 12)}`,
      versions: [
        {
          locale: "en",
          status: published ? "published" : "private",
          text: "[Test] Words",
        },
        {
          locale: "pt-BR",
          isOriginal: false,
          status: "private",
          text: "[Test] Palavras",
        },
      ],
    });
    // One reflection that is set to show and has English text, and one that
    // is not set to show.
    await createTestTrackReflection(tx, {
      albumJournalId: entryId,
      albumId: album.albumId,
      trackId: album.trackIds[0]!,
      isPublished: true,
      texts: { en: "[Test] Shown once public" },
    });
    await createTestTrackReflection(tx, {
      albumJournalId: entryId,
      albumId: album.albumId,
      trackId: album.trackIds[1]!,
      texts: { en: "[Test] Not set to show" },
    });
    created.albums.push(album);
    created.entries.push(entryId);
    return { entryId, album };
  });
}

async function versionOf(entryId: string): Promise<number> {
  const [row] = await getDb()
    .select({ version: schema.entries.version })
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  return row!.version;
}

async function lockEntryRow(tx: Transaction, entryId: string) {
  await tx.execute(sql`select 1 from entries where id = ${entryId} for update`);
}

// Waits until some connection of these tests is waiting for a lock.
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

function within<Result>(work: Promise<Result>, ms: number, what: string) {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} was blocked.`)), ms),
    ),
  ]);
}

// Failure codes only; a raw database error is a failed test.
function codeOf(settled: PromiseSettledResult<unknown>): string {
  if (settled.status === "fulfilled") {
    return "ok";
  }
  const reason = settled.reason;
  if (reason instanceof JournalError || reason instanceof PublicationError) {
    return reason.failure;
  }
  if (reason instanceof CatalogError) {
    return `catalog:${reason.failure}`;
  }
  return `unexpected:${String((reason as Error)?.message ?? reason)}`;
}

describe("saves of the same version race", () => {
  it("lets exactly one of several different saves win, and loses no update silently", async () => {
    const { entryId, album } = await committedJournal();
    const [a, b, c] = album.trackIds as [string, string, string];
    const start = await versionOf(entryId);
    await withConnections(4, async ([w, x, y, z]) => {
      const save = (db: typeof w, fields: Record<string, unknown>) => () =>
        saveAlbumJournal(db!, author, {
          entryId,
          expectedVersion: start,
          ...fields,
        });
      const settled = await raceAll([
        save(w, { albumRating: 8 }),
        save(x, {
          reflections: [{ trackId: a, texts: { en: "[Test] Text from x" } }],
        }),
        save(y, {
          reflections: [{ trackId: b, isFavourite: true, isPublished: true }],
        }),
        save(z, { reflections: [{ trackId: c, ratingHalfSteps: 3 }] }),
      ]);
      const codes = settled.map(codeOf);
      expect(codes.filter((code) => code === "ok")).toHaveLength(1);
      expect(codes.filter((code) => code === "version_conflict")).toHaveLength(
        3,
      );
    });
    expect(await versionOf(entryId)).toBe(start + 1);

    // Exactly one of the four changes is in the database.
    const view = (await getTrackByTrack(getDb(), author, entryId))!;
    const applied = [
      view.albumRating === 8,
      view.tracks[0]?.reflection?.texts.en === "[Test] Text from x",
      view.tracks[1]?.reflection?.isFavourite === true,
      view.tracks[2]?.reflection?.ratingHalfSteps === 3,
    ].filter(Boolean);
    expect(applied).toHaveLength(1);
  });

  it("serializes eight saves that each re-read the version, with no deadlock and no lost update", async () => {
    const { entryId, album } = await committedJournal();
    const start = await versionOf(entryId);
    const trackId = album.trackIds[2]!;
    await withConnections(8, async (databases) => {
      const settled = await raceAll(
        databases.map((db, index) => async () => {
          // Each caller retries on a conflict with the version it just read,
          // as an editor that reloads would.
          for (let attempt = 0; attempt < 40; attempt++) {
            const [row] = await db
              .select({ version: schema.entries.version })
              .from(schema.entries)
              .where(eq(schema.entries.id, entryId));
            try {
              return await saveAlbumJournal(db, author, {
                entryId,
                expectedVersion: row!.version,
                reflections: [
                  { trackId, texts: { en: `[Test] Writer ${index}` } },
                ],
              });
            } catch (error) {
              if (!(
                error instanceof JournalError &&
                error.failure === "version_conflict"
              )) {
                throw error;
              }
            }
          }
          throw new Error("never succeeded");
        }),
      );
      expect(settled.map(codeOf)).toEqual(Array(8).fill("ok"));
    });
    expect(await versionOf(entryId)).toBe(start + 8);
  });
});

describe("a save races a deletion, a restoration, and a privacy change", () => {
  it("leaves only valid states: a save either lands before the delete or is refused", async () => {
    for (let round = 0; round < 6; round++) {
      const { entryId, album } = await committedJournal();
      const start = await versionOf(entryId);
      await withConnections(2, async ([saver, deleter]) => {
        const settled = await raceAll([
          () =>
            saveAlbumJournal(saver!, author, {
              entryId,
              expectedVersion: start,
              reflections: [{ trackId: album.trackIds[0]!, isFavourite: true }],
            }),
          () => deleteAlbumJournal(deleter!, author, entryId),
        ]);
        const [save, del] = settled.map(codeOf);
        expect(del).toBe("ok");
        expect(["ok", "entry_deleted"]).toContain(save);
      });
      // Deleted either way; the save, if it landed, is intact.
      const [row] = await getDb()
        .select({ deletedAt: schema.entries.deletedAt })
        .from(schema.entries)
        .where(eq(schema.entries.id, entryId));
      expect(row?.deletedAt).not.toBeNull();
      await restoreAlbumJournal(getDb(), author, entryId);
    }
  });

  it("refuses a save against a restore that ran first only by the version rule, never half-applied", async () => {
    const { entryId, album } = await committedJournal();
    await deleteAlbumJournal(getDb(), author, entryId);
    const version = await versionOf(entryId);
    await withConnections(2, async ([saver, restorer]) => {
      const settled = await raceAll([
        () =>
          saveAlbumJournal(saver!, author, {
            entryId,
            expectedVersion: version,
            albumRating: 4,
            reflections: [{ trackId: album.trackIds[0]!, isFavourite: true }],
          }),
        () => restoreAlbumJournal(restorer!, author, entryId),
      ]);
      const [save, restore] = settled.map(codeOf);
      expect(restore).toBe("ok");
      expect(["ok", "entry_deleted"]).toContain(save);
    });
    const view = (await getTrackByTrack(getDb(), author, entryId))!;
    // All of the save or none of it.
    const landed = view.albumRating === 4;
    expect(view.tracks[0]?.reflection?.isFavourite === true).toBe(landed);
  });

  it("does not let a save slip a flag through while the journal is being made public", async () => {
    // The invariant of ADR 0005 § 5, for reflections: whatever the order, a
    // reflection that was not in the disclosure is never public because of a
    // race.
    for (let round = 0; round < 8; round++) {
      const { entryId, album } = await committedJournal();
      const second = album.trackIds[1]!; // has text, is not set to show
      const db = getDb();
      const preview = await previewPublication(db, author, {
        entryId,
        locale: "en",
      });
      const version = preview.disclosure.entryVersion;
      expect(preview.disclosure.reflections.map((r) => r.trackId)).toEqual([
        album.trackIds[0],
      ]);

      await withConnections(2, async ([publisher, flagger]) => {
        const settled = await raceAll([
          () =>
            publishLanguageVersion(publisher!, author, {
              entryId,
              locale: "en",
              expectedVersion: version,
              confirmation: preview.confirmation,
            }),
          () =>
            saveAlbumJournal(flagger!, author, {
              entryId,
              expectedVersion: version,
              reflections: [{ trackId: second, isPublished: true }],
            }),
        ]);
        const [publish, flag] = settled.map(codeOf);
        if (publish === "ok") {
          // Published first: the flag then needs a confirmation it cannot
          // have, so it was refused, or it ran first and the publish was
          // refused. Never both.
          expect(["confirmation_required", "version_conflict"]).toContain(flag);
        } else {
          expect(["version_conflict", "confirmation_invalid"]).toContain(
            publish,
          );
          expect(flag).toBe("ok");
        }
      });

      const shown = (await listPublicTrackReflections(db, entryId, "en")).map(
        (r) => r.trackId,
      );
      // Whatever happened, the second track was never exposed.
      expect(shown).not.toContain(second);
    }
  });
});

describe("a confirmed save against changes that need no new version", () => {
  it("is stale when the other language is published while it waits for the lock", async () => {
    const { entryId } = await committedJournal(true);
    const db = getDb();
    const fields = { body: "[Test] Confirmed words" };
    const version = await versionOf(entryId);
    const shown = await previewAlbumJournalChange(db, author, {
      entryId,
      expectedVersion: version,
      ...fields,
    });
    const portuguese = await previewPublication(db, author, {
      entryId,
      locale: "pt-BR",
    });

    const code = await withConnections(2, async ([holder, saver]) => {
      let pending: Promise<PromiseSettledResult<unknown>> | undefined;
      await holder!.transaction(async (tx) => {
        await lockEntryRow(tx, entryId);
        pending = Promise.allSettled([
          saveAlbumJournal(saver!, author, {
            entryId,
            expectedVersion: version,
            ...fields,
            confirmation: shown.confirmation!,
          }),
        ]).then(([settled]) => settled!);
        await waitUntilBlocked(tx);
        // The Portuguese version becomes public while the save waits. That
        // moves the stamp, not the entry version.
        await publishLanguageVersion(tx, author, {
          entryId,
          locale: "pt-BR",
          expectedVersion: version,
          confirmation: portuguese.confirmation,
        });
      });
      return codeOf((await pending)!);
    });
    expect(code).toBe("confirmation_stale");
    // Nothing of the refused save was written.
    const [row] = await getDb()
      .select({ bodyText: schema.entryTexts.bodyText })
      .from(schema.entryTexts)
      .where(sql`entry_id = ${entryId} and locale = 'en'`);
    expect(row?.bodyText).toBe("[Test] Words");
  });

  it("is refused when another editor saved first, even with a good token", async () => {
    const { entryId, album } = await committedJournal(true);
    const db = getDb();
    const version = await versionOf(entryId);
    const fields = { body: "[Test] Mine" };
    const shown = await previewAlbumJournalChange(db, author, {
      entryId,
      expectedVersion: version,
      ...fields,
    });
    // The other editor's save exposes nothing, so it needs no token.
    await saveAlbumJournal(db, author, {
      entryId,
      expectedVersion: version,
      reflections: [{ trackId: album.trackIds[2]!, isFavourite: true }],
    });
    await expect(
      saveAlbumJournal(db, author, {
        entryId,
        expectedVersion: version,
        ...fields,
        confirmation: shown.confirmation!,
      }),
    ).rejects.toMatchObject({ failure: "version_conflict" });
  });

  it("is applied once when the same confirmed save is sent eight times at once", async () => {
    const { entryId } = await committedJournal(true);
    const db = getDb();
    const version = await versionOf(entryId);
    const fields = { body: "[Test] Sent many times" };
    const shown = await previewAlbumJournalChange(db, author, {
      entryId,
      expectedVersion: version,
      ...fields,
    });
    await withConnections(8, async (databases) => {
      const settled = await raceAll(
        databases.map(
          (connection) => () =>
            saveAlbumJournal(connection, author, {
              entryId,
              expectedVersion: version,
              ...fields,
              confirmation: shown.confirmation!,
            }),
        ),
      );
      const codes = settled.map(codeOf);
      expect(codes.filter((code) => code === "ok")).toHaveLength(1);
      expect(codes.filter((code) => code === "version_conflict")).toHaveLength(
        7,
      );
    });
    expect(await versionOf(entryId)).toBe(version + 1);
  });

  it("stops needing a token once an unpublish wins the race, and applies only what was saved", async () => {
    const { entryId } = await committedJournal(true);
    const db = getDb();
    const version = await versionOf(entryId);
    const fields = { body: "[Test] After the unpublish" };
    const shown = await previewAlbumJournalChange(db, author, {
      entryId,
      expectedVersion: version,
      ...fields,
    });
    await withConnections(2, async ([saver, unpublisher]) => {
      const settled = await raceAll([
        () =>
          saveAlbumJournal(saver!, author, {
            entryId,
            expectedVersion: version,
            ...fields,
            confirmation: shown.confirmation!,
          }),
        () =>
          setPrivacyForTest(unpublisher!, author, {
            entryId,
            locale: "en",
            status: "private",
          }),
      ]);
      const [save, unpublish] = settled.map(codeOf);
      expect(unpublish).toBe("ok");
      // Saved first, then unpublished; or unpublished first, so the same
      // text is now private and needs no confirmation. Never a stale error.
      expect(save).toBe("ok");
    });
    const [row] = await getDb()
      .select({
        status: schema.entryTexts.status,
        bodyText: schema.entryTexts.bodyText,
      })
      .from(schema.entryTexts)
      .where(sql`entry_id = ${entryId} and locale = 'en'`);
    expect(row).toEqual({
      status: "private",
      bodyText: "[Test] After the unpublish",
    });
  });
});

describe("previews take no lock", () => {
  it("answers while another transaction holds the entry lock, and writes nothing", async () => {
    const { entryId } = await committedJournal(true);
    const version = await versionOf(entryId);
    await withConnections(2, async ([holder, reader]) => {
      await holder!.transaction(async (tx) => {
        await lockEntryRow(tx, entryId);
        const before = await rowChecksum(reader!);
        const shown = await within(
          previewAlbumJournalChange(reader!, author, {
            entryId,
            expectedVersion: version,
            body: "[Test] Looked at while locked",
          }),
          5000,
          "The preview",
        );
        expect(shown.confirmation).not.toBeNull();
        expect(await rowChecksum(reader!)).toEqual(before);
      });
    });
  });
});

describe("a catalog tracklist rewrite races a reflection insert", () => {
  it("ends in a valid state with no deadlock and no raw database error", async () => {
    for (let round = 0; round < 12; round++) {
      const { entryId, album } = await committedJournal();
      const target = album.trackIds[2]!; // no reflection yet
      const version = await versionOf(entryId);
      await withConnections(1, async ([writer]) => {
        const settled = await raceAll([
          () =>
            saveAlbumJournal(writer!, author, {
              entryId,
              expectedVersion: version,
              reflections: [
                {
                  trackId: target,
                  texts: { en: "[Test] Racing the tracklist" },
                },
              ],
            }),
          () =>
            setAlbumTracklist(author, album.albumId, {
              tracks: album.trackIds
                .filter((id) => id !== target)
                .map((trackId) => ({ trackId })),
            }),
        ]);
        const [save, rewrite] = settled.map(codeOf);
        // Either the reflection landed and the catalog then refused to drop
        // its recording, or the recording left first and the save said so.
        const outcomes = `${save}|${rewrite}`;
        expect(
          ["ok|catalog:in_use", "track_not_in_album|ok"],
          outcomes,
        ).toContain(outcomes);
      });
      // Consistency: a reflection exists exactly while its recording is on
      // the album.
      const result = await getDb().execute<{ n: number }>(sql`
        select count(*)::int as n
          from track_reflections tr
         where tr.album_journal_id = ${entryId}
           and not exists (select 1 from album_tracks at
                            where at.album_id = tr.album_id and at.track_id = tr.track_id)`);
      expect(result.rows[0]!.n).toBe(0);
    }
  });
});

describe("mixed operations on one journal", () => {
  it("raise no deadlock and no raw error, and lose no version, over many runs", async () => {
    for (let round = 0; round < 5; round++) {
      const { entryId, album } = await committedJournal(true);
      const db = getDb();
      const preview = await previewPublication(db, author, {
        entryId,
        locale: "pt-BR",
      });
      const start = preview.disclosure.entryVersion;
      await withConnections(6, async ([w1, w2, w3, w4, w5, w6]) => {
        const settled = await raceAll([
          () =>
            saveAlbumJournal(w1!, author, {
              entryId,
              expectedVersion: start,
              reflections: [
                { trackId: album.trackIds[0]!, isFavourite: false },
              ],
            }),
          () =>
            saveAlbumJournal(w2!, author, {
              entryId,
              expectedVersion: start,
              albumRating: null,
            }),
          () =>
            publishLanguageVersion(w3!, author, {
              entryId,
              locale: "pt-BR",
              expectedVersion: start,
              confirmation: preview.confirmation,
            }),
          () =>
            setPrivacyForTest(w4!, author, {
              entryId,
              locale: "en",
              status: "private",
            }),
          () => deleteAlbumJournal(w5!, author, entryId),
          () => restoreAlbumJournal(w6!, author, entryId),
        ]);
        const codes = settled.map(codeOf);
        for (const code of codes) {
          expect(code, codes.join(",")).not.toMatch(/^unexpected/);
        }
        // Every save that reported success bumped the version exactly once,
        // and nothing else did.
        const saved = codes.slice(0, 2).filter((code) => code === "ok").length;
        expect(await versionOf(entryId), codes.join(",")).toBe(start + saved);
      });
    }
  });
});
