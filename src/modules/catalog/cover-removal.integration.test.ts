// Removing an album's cover, the cover takedown (ADR 0006 A8), on real
// PostgreSQL: always allowed (a private album, a published journal or only
// its translation, an archived album, the cover display switch on or off),
// repeatable, never removing a cover the author did not see, and writing the
// album's two cover columns and nothing else. Choosing a cover keeps A3's
// guard. The real-connection tests show that a removal waits for no journal
// entry, and that it serializes with a choice of cover on the album row.
// Everything is synthetic: rolled back, or committed and removed afterwards.
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { getDb, schema, type Transaction } from "@/db";
import {
  captureFailure,
  createTestAlbum,
  createTestAlbumJournal,
  createTestMemory,
  createTestTrackReflection,
  inRollbackTransaction,
  testAuthor,
  uniqueLabel,
  withConnections,
} from "@/testing";
import { FIXTURE } from "@/testing/provider-fixtures";
import { fixtureProviders } from "@/testing/provider-runtime";

import { CatalogError } from "./errors";
import {
  coverStateOf,
  listAlbumArtworkChoices,
  removeAlbumArtwork,
  setAlbumArtwork,
} from "./music";

const author = testAuthor();
const VARIABLE = "REFRAIN_COVER_DISPLAY_ENABLED";
const FRONT = `https://coverartarchive.org/release/${FIXTURE.firstPressing}/${FIXTURE.frontImage}`;
const LEGACY = `https://coverartarchive.org/release/${FIXTURE.legacyEdition}/${FIXTURE.legacyFrontImage}`;
const FRONT_STATE = coverStateOf(FRONT);
/** The switch unset, several values that leave it off, and on. */
const SWITCH = [undefined, "", "false", "TRUE", "true"];

afterEach(() => {
  vi.unstubAllEnvs();
});

async function refusal(
  tx: Transaction,
  work: (tx: Transaction) => Promise<unknown>,
) {
  const error = await captureFailure(tx, work);
  return error instanceof CatalogError ? error.failure : error;
}

async function storedCover(db: Pick<Transaction, "select">, albumId: string) {
  const [row] = await db
    .select({
      coverUrl: schema.albums.coverUrl,
      coverSource: schema.albums.coverSource,
    })
    .from(schema.albums)
    .where(eq(schema.albums.id, albumId));
  return row;
}

/** The physical row version: any write to the row changes it. */
async function rowVersion(tx: Transaction, albumId: string) {
  const result = await tx.execute<{ ctid: string }>(
    sql`select ctid::text as ctid from albums where id = ${albumId}`,
  );
  return result.rows[0]!.ctid;
}

/**
 * Every row of every table in the application's schema, as text, with the
 * named album's two cover columns left out: what a removal may not change.
 */
async function everythingBut(tx: Transaction, albumId: string) {
  const tables = await tx.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`);
  const state: Record<string, string[]> = {};
  for (const { table_name } of tables.rows) {
    const rows = await tx.execute<{ row: Record<string, unknown> }>(
      sql`select to_jsonb(t) as row from ${sql.identifier(table_name)} t`,
    );
    state[table_name] = rows.rows
      .map(({ row }) => {
        if (table_name === "albums" && row.id === albumId) {
          const rest = { ...row };
          delete rest.cover_url;
          delete rest.cover_source;
          return JSON.stringify(rest);
        }
        return JSON.stringify(row);
      })
      .sort();
  }
  return state;
}

/**
 * An album linked to the fixtures' release group, with the fixtures' front
 * cover stored, a reflection, a memory about it, and a second album with its
 * own cover: everything a removal must leave as it was.
 */
async function coveredAlbum(tx: Transaction) {
  const album = await createTestAlbum(tx, { title: "[Test] Covered" });
  await tx
    .update(schema.albums)
    .set({
      mbReleaseGroupId: FIXTURE.paperMoon,
      coverUrl: FRONT,
      coverSource: "Cover Art Archive",
    })
    .where(eq(schema.albums.id, album.albumId));
  const other = await createTestAlbum(tx, { title: "[Test] Other" });
  await tx
    .update(schema.albums)
    .set({ coverUrl: LEGACY, coverSource: "Cover Art Archive" })
    .where(eq(schema.albums.id, other.albumId));
  await createTestMemory(tx, {
    versions: [{ locale: "en", status: "published" }],
    music: [{ albumId: album.albumId }, { trackId: album.trackIds[0]! }],
  });
  return { ...album, otherAlbumId: other.albumId };
}

async function publishedJournal(
  tx: Transaction,
  album: { albumId: string; trackIds: string[] },
  versions: Parameters<typeof createTestAlbumJournal>[1]["versions"],
) {
  const entryId = await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    versions,
    ratingHalfSteps: 7,
  });
  await createTestTrackReflection(tx, {
    albumJournalId: entryId,
    albumId: album.albumId,
    trackId: album.trackIds[1]!,
    isPublished: true,
    isFavourite: true,
    ratingHalfSteps: 9,
    texts: { en: "[Test] A reflection", "pt-BR": "[Test] Uma reflexão" },
  });
  return entryId;
}

async function onPublicPage(tx: Transaction, albumId: string) {
  const { providers } = fixtureProviders();
  return (await listAlbumArtworkChoices(tx, author, albumId, providers))!
    .onPublicPage;
}

describe("removing an album's cover (ADR 0006 A8)", () => {
  it("is allowed for a private album, and changes nothing but its two cover columns", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await coveredAlbum(tx);
      await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        versions: [{ locale: "en", status: "private" }],
      });
      expect(await onPublicPage(tx, album.albumId)).toBe(false);
      const before = await everythingBut(tx, album.albumId);

      await removeAlbumArtwork(tx, author, {
        albumId: album.albumId,
        expectedCover: FRONT_STATE,
      });
      expect(await storedCover(tx, album.albumId)).toEqual({
        coverUrl: null,
        coverSource: null,
      });
      expect(await everythingBut(tx, album.albumId)).toEqual(before);
      expect((await storedCover(tx, album.otherAlbumId))!.coverUrl).toBe(
        LEGACY,
      );
    });
  });

  it("is allowed while a published journal shows the album, and unpublishes nothing", async () => {
    for (const [label, versions] of [
      ["the original published", [{ locale: "en", status: "published" }]],
      [
        "only a translation published",
        [
          { locale: "en", status: "draft" },
          { locale: "pt-BR", status: "published", isOriginal: false },
        ],
      ],
      [
        "both published",
        [
          { locale: "en", status: "published" },
          { locale: "pt-BR", status: "published", isOriginal: false },
        ],
      ],
    ] as const) {
      await inRollbackTransaction(async (tx) => {
        const album = await coveredAlbum(tx);
        await publishedJournal(tx, album, [...versions]);
        expect(await onPublicPage(tx, album.albumId), label).toBe(true);
        const before = await everythingBut(tx, album.albumId);

        await removeAlbumArtwork(tx, author, {
          albumId: album.albumId,
          expectedCover: FRONT_STATE,
        });
        expect(await storedCover(tx, album.albumId), label).toEqual({
          coverUrl: null,
          coverSource: null,
        });
        // Every entry, version, status, reflection, rating, favourite, and
        // memory is as it was, and the journal is still public.
        expect(await everythingBut(tx, album.albumId), label).toEqual(before);
        expect(await onPublicPage(tx, album.albumId), label).toBe(true);

        // Choosing a cover keeps A3's guard: still refused.
        vi.stubEnv(VARIABLE, "true");
        const { providers } = fixtureProviders();
        expect(
          await refusal(tx, (tx) =>
            setAlbumArtwork(
              tx,
              author,
              {
                albumId: album.albumId,
                releaseId: FIXTURE.firstPressing,
                imageId: FIXTURE.frontImage,
                expectedCover: null,
              },
              providers,
            ),
          ),
          label,
        ).toBe("public_page");
        expect((await storedCover(tx, album.albumId))!.coverUrl, label).toBe(
          null,
        );
        vi.unstubAllEnvs();
      });
    }
  });

  it("is allowed for an archived album, which stays archived", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await coveredAlbum(tx);
      await publishedJournal(tx, album, [
        { locale: "en", status: "published" },
      ]);
      await tx.execute(
        sql`update albums set archived_at = now() where id = ${album.albumId}`,
      );
      const before = await everythingBut(tx, album.albumId);

      await removeAlbumArtwork(tx, author, {
        albumId: album.albumId,
        expectedCover: FRONT_STATE,
      });
      expect(await storedCover(tx, album.albumId)).toEqual({
        coverUrl: null,
        coverSource: null,
      });
      expect(await everythingBut(tx, album.albumId)).toEqual(before);

      // Archiving does not hide a served journal's page, and choosing a cover
      // is still refused for it.
      expect(await onPublicPage(tx, album.albumId)).toBe(true);
      vi.stubEnv(VARIABLE, "true");
      const { providers } = fixtureProviders();
      const choose = (tx: Transaction) =>
        setAlbumArtwork(
          tx,
          author,
          {
            albumId: album.albumId,
            releaseId: FIXTURE.firstPressing,
            imageId: FIXTURE.frontImage,
            expectedCover: null,
          },
          providers,
        );
      expect(await refusal(tx, choose)).toBe("public_page");
      // With no journal public, the archived album still refuses a choice.
      await tx.execute(sql`
        update entry_texts set status = 'private', published_at = null
         where entry_id in (select entry_id from album_journals
                             where album_id = ${album.albumId})`);
      expect(await refusal(tx, choose)).toBe("archived_reference");
      expect((await storedCover(tx, album.albumId))!.coverUrl).toBe(null);
    });
  });

  it("works the same with the cover display switch on, off, or unset", async () => {
    for (const value of SWITCH) {
      await inRollbackTransaction(async (tx) => {
        vi.stubEnv(VARIABLE, value);
        const album = await coveredAlbum(tx);
        await publishedJournal(tx, album, [
          { locale: "en", status: "published" },
        ]);
        await removeAlbumArtwork(tx, author, {
          albumId: album.albumId,
          expectedCover: FRONT_STATE,
        });
        expect(await storedCover(tx, album.albumId), String(value)).toEqual({
          coverUrl: null,
          coverSource: null,
        });
        vi.unstubAllEnvs();
      });
    }
  });

  it("can be repeated: with no cover stored, it succeeds and writes nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await coveredAlbum(tx);
      await removeAlbumArtwork(tx, author, {
        albumId: album.albumId,
        expectedCover: FRONT_STATE,
      });
      const version = await rowVersion(tx, album.albumId);
      const before = await everythingBut(tx, album.albumId);
      // The same request again (a second tab, a double submission), and a
      // view that saw no cover.
      for (const expectedCover of [FRONT_STATE, null]) {
        await removeAlbumArtwork(tx, author, {
          albumId: album.albumId,
          expectedCover,
        });
      }
      expect(await rowVersion(tx, album.albumId)).toBe(version);
      expect(await everythingBut(tx, album.albumId)).toEqual(before);
      expect(await storedCover(tx, album.albumId)).toEqual({
        coverUrl: null,
        coverSource: null,
      });
    });
  });

  it("never removes a cover the author did not see", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await coveredAlbum(tx);
      await publishedJournal(tx, album, [
        { locale: "en", status: "published" },
      ]);
      const version = await rowVersion(tx, album.albumId);
      for (const expectedCover of [null, coverStateOf(LEGACY)]) {
        expect(
          await refusal(tx, (tx) =>
            removeAlbumArtwork(tx, author, {
              albumId: album.albumId,
              expectedCover,
            }),
          ),
          String(expectedCover),
        ).toBe("review_stale");
      }
      expect(await rowVersion(tx, album.albumId)).toBe(version);
      expect((await storedCover(tx, album.albumId))!.coverUrl).toBe(FRONT);
    });
  });

  it("refuses an unknown album and malformed input, writing nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await coveredAlbum(tx);
      expect(
        await refusal(tx, (tx) =>
          removeAlbumArtwork(tx, author, {
            albumId: "00000000-0000-4000-8000-000000000000",
            expectedCover: FRONT_STATE,
          }),
        ),
      ).toBe("not_found");
      for (const input of [
        { albumId: "nope", expectedCover: FRONT_STATE },
        { albumId: album.albumId, expectedCover: FRONT },
        { albumId: album.albumId },
        { albumId: album.albumId, expectedCoverUrl: FRONT },
      ]) {
        expect(
          await refusal(tx, (tx) => removeAlbumArtwork(tx, author, input)),
          JSON.stringify(input),
        ).toBe("invalid_input");
      }
      expect((await storedCover(tx, album.albumId))!.coverUrl).toBe(FRONT);
    });
  });

  it("does not let a removed cover come back by itself: only a new choice sets one", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await coveredAlbum(tx);
      await removeAlbumArtwork(tx, author, {
        albumId: album.albumId,
        expectedCover: FRONT_STATE,
      });
      // Archiving and restoring the album, and reading its artwork page, do
      // not bring it back.
      await tx.execute(
        sql`update albums set archived_at = now() where id = ${album.albumId}`,
      );
      await tx.execute(
        sql`update albums set archived_at = null where id = ${album.albumId}`,
      );
      vi.stubEnv(VARIABLE, "true");
      const { providers } = fixtureProviders();
      const choices = (await listAlbumArtworkChoices(
        tx,
        author,
        album.albumId,
        providers,
      ))!;
      expect(choices).toMatchObject({ coverStored: false, currentCover: null });
      expect(choices.choices.some((choice) => choice.current)).toBe(false);
      expect((await storedCover(tx, album.albumId))!.coverUrl).toBe(null);

      // A new, explicit choice, under the existing rules, sets one again.
      await setAlbumArtwork(
        tx,
        author,
        {
          albumId: album.albumId,
          releaseId: FIXTURE.firstPressing,
          imageId: FIXTURE.frontImage,
          expectedCover: null,
        },
        providers,
      );
      expect((await storedCover(tx, album.albumId))!.coverUrl).toBe(FRONT);
    });
  });
});

describe("removing a cover, over real connections", () => {
  const created: { albumIds: string[]; entryIds: string[] } = {
    albumIds: [],
    entryIds: [],
  };

  afterAll(async () => {
    const db = getDb();
    for (const entryId of created.entryIds) {
      await db.delete(schema.entries).where(eq(schema.entries.id, entryId));
    }
    for (const albumId of created.albumIds) {
      await db.delete(schema.albums).where(eq(schema.albums.id, albumId));
    }
  });

  /** A committed album with the front cover, and a published journal. */
  async function committedAlbum(withJournal: boolean) {
    const db = getDb();
    const [album] = await db
      .insert(schema.albums)
      .values({
        title: uniqueLabel("Takedown"),
        mbReleaseGroupId: null,
        coverUrl: FRONT,
        coverSource: "Cover Art Archive",
      })
      .returning({ id: schema.albums.id });
    created.albumIds.push(album!.id);
    let entryId: string | null = null;
    if (withJournal) {
      const [entry] = await db
        .insert(schema.entries)
        .values({ kind: "album_journal", firstPublishedAt: new Date() })
        .returning({ id: schema.entries.id });
      entryId = entry!.id;
      created.entryIds.push(entryId);
      await db.insert(schema.entryTexts).values({
        entryId,
        locale: "en",
        isOriginal: true,
        status: "published",
        publishedAt: new Date(),
        firstPublishedAt: new Date(),
      });
      await db
        .insert(schema.albumJournals)
        .values({ entryId, albumId: album!.id });
    }
    return { albumId: album!.id, entryId };
  }

  /** Whether `work` settles within `ms`. */
  async function settlesWithin(work: Promise<unknown>, ms: number) {
    return Promise.race([
      work.then(
        () => "settled",
        () => "settled",
      ),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("waiting"), ms),
      ),
    ]);
  }

  it("does not wait for a journal entry: a publication or takedown holding it does not block the removal", async () => {
    const { albumId, entryId } = await committedAlbum(true);
    await withConnections(2, async ([first, second]) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // What a publish, an unpublish, a delete, or a restore holds.
      const transition = first!.transaction(async (tx) => {
        await tx.execute(
          sql`select id from entries where id = ${entryId} for update`,
        );
        locked();
        await held;
      });
      await isLocked;
      const removal = removeAlbumArtwork(second!, author, {
        albumId,
        expectedCover: FRONT_STATE,
      });
      const outcome = await settlesWithin(removal, 3_000);
      release();
      await transition;
      await removal;
      expect(outcome).toBe("settled");
      expect(await storedCover(getDb(), albumId)).toEqual({
        coverUrl: null,
        coverSource: null,
      });
      // The journal is still published.
      const [text] = await getDb()
        .select({ status: schema.entryTexts.status })
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, entryId!));
      expect(text!.status).toBe("published");
    });
  });

  it("waits for a cover choice holding the album, then refuses: that cover was not the one seen", async () => {
    const { albumId } = await committedAlbum(false);
    await withConnections(2, async ([first, second]) => {
      let commit!: () => void;
      const committing = new Promise<void>((resolve) => (commit = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // setAlbumArtwork's transaction: the album row, then the new cover.
      const choice = first!.transaction(async (tx) => {
        await tx.execute(
          sql`select id from albums where id = ${albumId} for no key update`,
        );
        await tx.execute(
          sql`update albums set cover_url = ${LEGACY} where id = ${albumId}`,
        );
        locked();
        await committing;
      });
      await isLocked;
      const removal = removeAlbumArtwork(second!, author, {
        albumId,
        expectedCover: FRONT_STATE,
      }).then(
        () => "removed",
        (error: unknown) =>
          error instanceof CatalogError ? error.failure : String(error),
      );
      expect(await settlesWithin(removal, 300)).toBe("waiting");
      commit();
      await choice;
      expect(await removal).toBe("review_stale");
      expect((await storedCover(getDb(), albumId))!.coverUrl).toBe(LEGACY);
    });
  });

  it("makes a cover choice that waited for it refuse, since the cover it saw is gone", async () => {
    const { albumId } = await committedAlbum(false);
    await getDb()
      .update(schema.albums)
      .set({ mbReleaseGroupId: FIXTURE.paperMoon })
      .where(eq(schema.albums.id, albumId));
    vi.stubEnv(VARIABLE, "true");
    const { providers } = fixtureProviders();
    await withConnections(2, async ([first, second]) => {
      let commit!: () => void;
      const committing = new Promise<void>((resolve) => (commit = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // A removal's transaction, held open after its write.
      const removal = first!.transaction(async (tx) => {
        await tx.execute(
          sql`select id from albums where id = ${albumId} for no key update`,
        );
        await tx.execute(
          sql`update albums set cover_url = null, cover_source = null where id = ${albumId}`,
        );
        locked();
        await committing;
      });
      await isLocked;
      const choice = setAlbumArtwork(
        second!,
        author,
        {
          albumId,
          releaseId: FIXTURE.legacyEdition,
          imageId: FIXTURE.legacyFrontImage,
          expectedCover: FRONT_STATE,
        },
        providers,
      ).then(
        () => "chosen",
        (error: unknown) =>
          error instanceof CatalogError ? error.failure : String(error),
      );
      expect(await settlesWithin(choice, 300)).toBe("waiting");
      commit();
      await removal;
      expect(await choice).toBe("review_stale");
      expect(await storedCover(getDb(), albumId)).toEqual({
        coverUrl: null,
        coverSource: null,
      });
    });
  });

  it("two removals at once both succeed, and the second writes nothing", async () => {
    const { albumId } = await committedAlbum(true);
    await withConnections(2, async ([first, second]) => {
      const results = await Promise.all(
        [first!, second!].map((db) =>
          removeAlbumArtwork(db, author, {
            albumId,
            expectedCover: FRONT_STATE,
          }).then(
            () => "removed",
            (error: unknown) =>
              error instanceof CatalogError ? error.failure : String(error),
          ),
        ),
      );
      expect(results).toEqual(["removed", "removed"]);
      expect(await storedCover(getDb(), albumId)).toEqual({
        coverUrl: null,
        coverSource: null,
      });
    });
  });
});
