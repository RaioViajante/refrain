import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Transaction } from "@/db";
import {
  getPublicLanguageVersion,
  resolvePublicSlug,
} from "@/modules/publication";
import {
  captureFailure,
  claimsOf,
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestMemory,
  inScratchTransaction,
  otherSession,
  publishForTest,
  reissueTestToken,
  rowChecksum,
  shiftedTestToken,
  testAuthor,
} from "@/testing";

// eslint-disable-next-line no-restricted-imports -- the reader and the sitemap's read, with a test transaction
import {
  getPublicMemory,
  listPublicMemoryAddresses,
} from "@/modules/publication/public-memory";
// eslint-disable-next-line no-restricted-imports -- which artists have a page
import { publicArtistAddresses } from "@/modules/publication/queries";

import { JournalError, type JournalFailure } from "./errors";
import {
  createMemory,
  deleteMemory,
  previewMemoryChange,
  restoreMemory,
  saveMemory,
  setMemoryPrivacy,
} from "./memories";
import {
  previewMemoryPublicChange,
  previewMemoryPublication,
  publishMemoryVersion,
} from "./memory-publishing";
import { getMemory } from "./memory-queries";
import { saveAlbumJournal } from "./commands";
import {
  previewAlbumJournalPublicChange,
  previewAlbumJournalPublication,
  publishAlbumJournalVersion,
} from "./publishing";

// Publishing a memory (M3.7), against real PostgreSQL in a rolled-back
// transaction: the review, the checked publish, the confirmed save, the
// lifecycle, and the page's read model, through the same engine and token as
// an album journal (ADR 0006). Every title and text is synthetic and labelled.

const author = testAuthor();

async function failure(
  tx: Transaction,
  work: (db: Transaction) => Promise<unknown>,
): Promise<JournalFailure> {
  const error = await captureFailure(tx, work);
  expect(error, "the command should have been refused").toBeInstanceOf(
    JournalError,
  );
  return (error as JournalError).failure;
}

/** Refused, and every table a reader could see is exactly as it was. */
async function refusedWithoutWriting(
  tx: Transaction,
  work: (db: Transaction) => Promise<unknown>,
): Promise<JournalFailure> {
  const before = await rowChecksum(tx);
  const refused = await failure(tx, work);
  expect(await rowChecksum(tx)).toEqual(before);
  return refused;
}

// Recordings with credited artists, on two albums, and an album journal
// that can be published to give an artist a page.
async function setUp(tx: Transaction) {
  const first = await createTestArtist(tx, "[Test] First Artist");
  const second = await createTestArtist(tx, "[Test] Second Artist");
  const album = await createTestAlbum(tx, {
    title: "[Test] Memory Album",
    trackTitles: ["[Test] Song A", "[Test] Song B", "[Test] Song C"],
    artistIds: [first],
    firstReleaseYear: 2001,
  });
  const [a, b, c] = album.trackIds as [string, string, string];
  await tx.insert(schema.trackArtists).values([
    { trackId: a, artistId: first, position: 1 },
    { trackId: a, artistId: second, position: 2 },
    { trackId: b, artistId: second, position: 1 },
  ]);
  return { ...album, first, second, a, b, c };
}

async function newMemory(
  tx: Transaction,
  trackIds: string[],
  extra: { title?: string; body?: string; rememberedWhen?: string } = {},
) {
  const { entryId } = await createMemory(tx, author, {
    title: extra.title ?? "[Test] A memory",
    body: extra.body ?? "[Test] What I remember.\n\n[Test] A second paragraph.",
    rememberedWhen: extra.rememberedWhen ?? "[Test] A summer",
    trackIds,
  });
  return entryId;
}

async function version(tx: Transaction, entryId: string) {
  return (await getMemory(tx, author, entryId))!.version;
}

async function statusOf(tx: Transaction, entryId: string) {
  const result = await tx.execute<{ status: string }>(sql`
    select status from entry_texts where entry_id = ${entryId}`);
  return result.rows[0]!.status;
}

describe("the publication review of a memory", () => {
  it("shows the title, the writing, the when, the songs as the page names them, and the address", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const entryId = await newMemory(tx, [music.b, music.a, music.c]);
      const before = await rowChecksum(tx);
      const { review, confirmation } = await previewMemoryPublication(
        tx,
        author,
        { entryId, locale: "en" },
      );
      expect(await rowChecksum(tx)).toEqual(before);
      expect(confirmation).toMatch(/^ct1\./);
      expect(claimsOf(confirmation)).toMatchObject({
        p: "publish",
        e: entryId,
        l: "en",
        n: 1,
      });
      expect(review).toMatchObject({
        entryId,
        locale: "en",
        entryVersion: 1,
        status: "draft",
        title: "[Test] A memory",
        rememberedWhen: "[Test] A summer",
        text: [["[Test] What I remember."], ["[Test] A second paragraph."]],
        address: { slug: "test-a-memory", wasPublic: false },
      });
      expect(review.music).toEqual([
        {
          number: 1,
          kind: "recording",
          title: "[Test] Song B",
          artists: [{ name: "[Test] Second Artist", address: null }],
          album: { title: "[Test] Memory Album", journalSlug: null },
        },
        {
          number: 2,
          kind: "recording",
          title: "[Test] Song A",
          artists: [
            { name: "[Test] First Artist", address: null },
            { name: "[Test] Second Artist", address: null },
          ],
          album: { title: "[Test] Memory Album", journalSlug: null },
        },
        {
          number: 3,
          kind: "recording",
          title: "[Test] Song C",
          artists: [],
          album: { title: "[Test] Memory Album", journalSlug: null },
        },
      ]);
    });
  });

  it("takes the same path from Draft and from Private, and needs a token for a memory with no songs", async () => {
    await inScratchTransaction(async (tx) => {
      const draft = await newMemory(tx, [], { title: "[Test] Draft one" });
      const privateOne = await newMemory(tx, [], { title: "[Test] Private" });
      await setMemoryPrivacy(tx, author, {
        entryId: privateOne,
        locale: "en",
        status: "private",
        expectedStatus: "draft",
      });
      for (const entryId of [draft, privateOne]) {
        const { review } = await previewMemoryPublication(tx, author, {
          entryId,
          locale: "en",
        });
        expect(review.music).toEqual([]);
        expect(
          await refusedWithoutWriting(tx, (db) =>
            publishMemoryVersion(db, author, {
              entryId,
              locale: "en",
              expectedVersion: 1,
            }),
          ),
        ).toBe("confirmation_required");
      }
    });
  });

  it("refuses a memory with nothing to publish, an unknown one, and one in Recently deleted", async () => {
    await inScratchTransaction(async (tx) => {
      const empty = await newMemory(tx, [], { body: "  " });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          previewMemoryPublication(db, author, {
            entryId: empty,
            locale: "en",
          }),
        ),
      ).toBe("nothing_to_publish");
      // A title written outside the studio, blank: never published either.
      const untitled = await newMemory(tx, []);
      await tx.execute(
        sql`update entry_texts set title = null where entry_id = ${untitled}`,
      );
      expect(
        await failure(tx, (db) =>
          previewMemoryPublication(db, author, {
            entryId: untitled,
            locale: "en",
          }),
        ),
      ).toBe("nothing_to_publish");
      expect(
        await failure(tx, (db) =>
          previewMemoryPublication(db, author, {
            entryId: "00000000-0000-4000-8000-00000000dead",
            locale: "en",
          }),
        ),
      ).toBe("entry_not_found");
      expect(
        await failure(tx, (db) =>
          previewMemoryPublication(db, author, {
            entryId: untitled,
            locale: "pt-BR",
          }),
        ),
      ).toBe("entry_not_found");
      const deleted = await newMemory(tx, [], { title: "[Test] Deleted" });
      await deleteMemory(tx, author, deleted);
      expect(
        await failure(tx, (db) =>
          previewMemoryPublication(db, author, {
            entryId: deleted,
            locale: "en",
          }),
        ),
      ).toBe("entry_deleted");
      expect(
        await failure(tx, (db) =>
          previewMemoryPublication(db, author, { entryId: "x", locale: "en" }),
        ),
      ).toBe("invalid_input");
    });
  });

  it("keeps each kind's wrappers to its own kind", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const memoryId = await newMemory(tx, [music.a]);
      const journalId = await createTestAlbumJournal(tx, {
        albumId: music.albumId,
        slug: "test-memory-album-journal",
        versions: [{ locale: "en", text: "[Test] Journal" }],
      });
      // The album-journal wrappers refuse a memory, before minting anything.
      expect(
        await refusedWithoutWriting(tx, (db) =>
          previewAlbumJournalPublication(db, author, {
            entryId: memoryId,
            locale: "en",
          }),
        ),
      ).toBe("entry_not_found");
      const { confirmation } = await previewMemoryPublication(tx, author, {
        entryId: memoryId,
        locale: "en",
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          publishAlbumJournalVersion(db, author, {
            entryId: memoryId,
            locale: "en",
            expectedVersion: 1,
            confirmation,
          }),
        ),
      ).toBe("entry_not_found");
      // And the memory wrappers refuse an album journal.
      expect(
        await refusedWithoutWriting(tx, (db) =>
          previewMemoryPublication(db, author, {
            entryId: journalId,
            locale: "en",
          }),
        ),
      ).toBe("entry_not_found");
      expect(
        await refusedWithoutWriting(tx, (db) =>
          publishMemoryVersion(db, author, {
            entryId: journalId,
            locale: "en",
            expectedVersion: 1,
          }),
        ),
      ).toBe("entry_not_found");
      expect(
        await refusedWithoutWriting(tx, (db) =>
          previewMemoryChange(db, author, {
            entryId: journalId,
            expectedVersion: 1,
            title: "[Test] X",
          }),
        ),
      ).toBe("entry_not_found");
    });
  });
});

describe("publishing a memory", () => {
  async function previewed(tx: Transaction, entryId: string) {
    return previewMemoryPublication(tx, author, { entryId, locale: "en" });
  }
  function publish(
    db: Transaction,
    entryId: string,
    confirmation: string | undefined,
    expectedVersion = 1,
  ) {
    return publishMemoryVersion(db, author, {
      entryId,
      locale: "en",
      expectedVersion,
      ...(confirmation === undefined ? {} : { confirmation }),
    });
  }

  it("publishes with the token of its review, and only then", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const entryId = await newMemory(tx, [music.a]);
      const { confirmation } = await previewed(tx, entryId);
      await expect(publish(tx, entryId, confirmation)).resolves.toEqual({
        changed: true,
      });
      expect(await statusOf(tx, entryId)).toBe("published");
      const slug = await tx.execute<{ was_published: boolean }>(sql`
        select was_published from entry_slugs
         where entry_id = ${entryId} and is_current`);
      expect(slug.rows[0]!.was_published).toBe(true);
      // The token is used up: the version's status is in its stamp.
      expect(
        await refusedWithoutWriting(tx, (db) =>
          publish(db, entryId, confirmation),
        ),
      ).toBe("confirmation_stale");
      // A review of the published memory, published again: a no-op.
      const again = await previewed(tx, entryId);
      expect(again.review.status).toBe("published");
      await expect(publish(tx, entryId, again.confirmation)).resolves.toEqual({
        changed: false,
      });
      // The memory's own rows were not touched by the publication.
      expect(await version(tx, entryId)).toBe(1);
    });
  });

  it("refuses a missing, malformed, forged, misbound, expired, or future token, writing nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const entryId = await newMemory(tx, [music.a]);
      const other = await newMemory(tx, [music.b], { title: "[Test] Other" });
      const { confirmation } = await previewed(tx, entryId);
      const { confirmation: forOther } = await previewed(tx, other);
      const claims = claimsOf(confirmation);
      const cases: [string, string | undefined, JournalFailure, number?][] = [
        ["no token", undefined, "confirmation_required"],
        ["an empty token", "", "invalid_input"],
        ["a malformed token", "ct1.x", "invalid_input"],
        [
          "the MAC altered",
          `${confirmation.slice(0, -1)}${confirmation.endsWith("A") ? "B" : "A"}`,
          "confirmation_invalid",
        ],
        ["another memory's token", forOther, "confirmation_invalid"],
        [
          "a change_public token",
          reissueTestToken(confirmation, { p: "change_public" }),
          "confirmation_invalid",
        ],
        [
          "another session's token",
          reissueTestToken(confirmation, {
            s: otherSession(author).sessionId,
          }),
          "confirmation_invalid",
        ],
        [
          "another language's token",
          reissueTestToken(confirmation, { l: "pt-BR" }),
          "confirmation_invalid",
        ],
        [
          "a token for a version the memory is not at",
          confirmation,
          "confirmation_invalid",
          2,
        ],
        [
          "a stale editor, with a token for its version",
          reissueTestToken(confirmation, { n: 2 }),
          "version_conflict",
          2,
        ],
        [
          "an expired token",
          shiftedTestToken(confirmation, -16 * 60 * 1000),
          "confirmation_expired",
        ],
        [
          "a token from the future",
          shiftedTestToken(confirmation, 60 * 60 * 1000),
          "confirmation_expired",
        ],
        [
          "a fingerprint of another state",
          reissueTestToken(confirmation, { f: `${claims.f.slice(1)}A` }),
          "confirmation_stale",
        ],
      ];
      for (const [name, token, expected, expectedVersion] of cases) {
        expect(
          await refusedWithoutWriting(tx, (db) =>
            publish(db, entryId, token, expectedVersion ?? 1),
          ),
          name,
        ).toBe(expected);
      }
      expect(await statusOf(tx, entryId)).toBe("draft");
    });
  });

  it.each<
    [
      string,
      (
        tx: Transaction,
        f: Awaited<ReturnType<typeof setUp>> & { entryId: string },
      ) => Promise<unknown>,
    ]
  >([
    [
      "the title saved",
      (tx, f) =>
        saveMemory(tx, author, {
          entryId: f.entryId,
          expectedVersion: 1,
          title: "[Test] Renamed",
        }),
    ],
    [
      "the writing saved",
      (tx, f) =>
        saveMemory(tx, author, {
          entryId: f.entryId,
          expectedVersion: 1,
          body: "[Test] Other words.",
        }),
    ],
    [
      "the when saved",
      (tx, f) =>
        saveMemory(tx, author, {
          entryId: f.entryId,
          expectedVersion: 1,
          rememberedWhen: "[Test] Winter",
        }),
    ],
    [
      "a song added",
      (tx, f) =>
        saveMemory(tx, author, {
          entryId: f.entryId,
          expectedVersion: 1,
          trackIds: [f.a, f.b, f.c],
        }),
    ],
    [
      "a song removed",
      (tx, f) =>
        saveMemory(tx, author, {
          entryId: f.entryId,
          expectedVersion: 1,
          trackIds: [f.a],
        }),
    ],
    [
      "the songs reordered",
      (tx, f) =>
        saveMemory(tx, author, {
          entryId: f.entryId,
          expectedVersion: 1,
          trackIds: [f.b, f.a],
        }),
    ],
    [
      "the address changed (outside the studio)",
      (tx, f) =>
        tx.execute(sql`update entry_slugs set slug = 'test-another-address'
                        where entry_id = ${f.entryId} and is_current`),
    ],
    [
      "the when changed outside the studio",
      (tx, f) =>
        tx.execute(sql`update memories set remembered_when = '[Test] Later'
                        where entry_id = ${f.entryId}`),
    ],
  ])("makes an earlier review stale: %s", async (_name, change) => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const entryId = await newMemory(tx, [music.a, music.b]);
      const { confirmation } = await previewed(tx, entryId);
      await change(tx, { ...music, entryId });
      const current = await version(tx, entryId);
      expect(
        await refusedWithoutWriting(tx, (db) =>
          publish(
            db,
            entryId,
            reissueTestToken(confirmation, { n: current }),
            current,
          ),
        ),
      ).toBe("confirmation_stale");
      expect(await statusOf(tx, entryId)).toBe("draft");
    });
  });

  it("does not bind catalog wording: a song renamed after the review is the documented gap C11 (gate G8)", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const entryId = await newMemory(tx, [music.a]);
      const { confirmation } = await previewed(tx, entryId);
      await tx
        .update(schema.tracks)
        .set({ title: "[Test] Renamed in the catalog" })
        .where(eq(schema.tracks.id, music.a));
      // The confirmation still matches: catalog wording is shown, not bound
      // (ADR 0006 § 2). Recorded as a release gate, not accepted as harmless.
      await expect(publish(tx, entryId, confirmation)).resolves.toEqual({
        changed: true,
      });
    });
  });

  it("writes no album journal, track reflection, or catalog row", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const journalId = await createTestAlbumJournal(tx, {
        albumId: music.albumId,
        slug: "test-untouched-journal",
        versions: [{ locale: "en", text: "[Test] Journal" }],
      });
      const entryId = await newMemory(tx, [music.a, music.b]);
      const others = async () =>
        tx.execute<{ sum: string }>(sql`
          select md5(coalesce((select string_agg(x::text, '|' order by x::text)
                                 from album_journals x), '')
                  || coalesce((select string_agg(x::text, '|' order by x::text)
                                 from track_reflections x), '')
                  || coalesce((select string_agg(x::text, '|' order by x::text)
                                 from track_reflection_texts x), '')
                  || coalesce((select string_agg(x::text, '|' order by x::text)
                                 from entry_texts x
                                where x.entry_id = ${journalId}), '')
                  || coalesce((select string_agg(x::text, '|' order by x::text)
                                 from tracks x), '')
                  || coalesce((select string_agg(x::text, '|' order by x::text)
                                 from artists x), '')
                  || coalesce((select string_agg(x::text, '|' order by x::text)
                                 from albums x), '')) as sum`);
      const before = (await others()).rows[0]!.sum;
      const { confirmation } = await previewed(tx, entryId);
      await publish(tx, entryId, confirmation);
      const review = await previewMemoryPublicChange(tx, author, {
        entryId,
        expectedVersion: 1,
        trackIds: [music.b, music.a],
      });
      await saveMemory(tx, author, {
        entryId,
        expectedVersion: 1,
        trackIds: [music.b, music.a],
        confirmation: review.confirmation!,
      });
      await setMemoryPrivacy(tx, author, {
        entryId,
        locale: "en",
        status: "private",
        expectedStatus: "published",
      });
      expect((await others()).rows[0]!.sum).toBe(before);
    });
  });
});

describe("saving a published memory (the confirmed save, ADR 0006 § 5)", () => {
  async function publishedMemory(tx: Transaction) {
    const music = await setUp(tx);
    const entryId = await newMemory(tx, [music.a, music.b]);
    await publishForTest(tx, entryId, "en");
    return { ...music, entryId };
  }

  it.each<
    [
      string,
      (
        f: Awaited<ReturnType<typeof publishedMemory>>,
      ) => Record<string, unknown>,
      string[],
    ]
  >([
    ["a longer title", () => ({ title: "[Test] A memory, retold" }), ["Title"]],
    ["a shorter title", () => ({ title: "[Test]" }), ["Title"]],
    ["the writing, shorter", () => ({ body: "[Test] Less." }), ["The memory"]],
    [
      "the writing, with only white space changed",
      () => ({
        body: "[Test]  What I remember.\n\n[Test] A second paragraph.",
      }),
      ["The memory"],
    ],
    ["the when", () => ({ rememberedWhen: "[Test] A winter" }), ["When"]],
    ["a song added", (f) => ({ trackIds: [f.a, f.b, f.c] }), ["The music"]],
    ["the songs reordered", (f) => ({ trackIds: [f.b, f.a] }), ["The music"]],
    [
      "a song added and one removed",
      (f) => ({ trackIds: [f.c, f.b] }),
      ["The music"],
    ],
  ])(
    "asks before %s, and saves with the token",
    async (_name, change, labels) => {
      await inScratchTransaction(async (tx) => {
        const f = await publishedMemory(tx);
        const input = { entryId: f.entryId, expectedVersion: 1, ...change(f) };
        expect(
          await refusedWithoutWriting(tx, (db) =>
            saveMemory(db, author, input),
          ),
        ).toBe("confirmation_required");
        const before = await rowChecksum(tx);
        const preview = await previewMemoryPublicChange(tx, author, input);
        expect(await rowChecksum(tx)).toEqual(before);
        expect(preview.review.changes.map((c) => c.label)).toEqual(labels);
        expect(preview.confirmation).toMatch(/^ct1\./);
        expect(claimsOf(preview.confirmation!)).toMatchObject({
          p: "change_public",
          e: f.entryId,
          n: 1,
        });
        await expect(
          saveMemory(tx, author, {
            ...input,
            confirmation: preview.confirmation!,
          }),
        ).resolves.toEqual({ version: 2 });
        // The token dies with the save: the version moved, so the same save
        // is a stale editor's, and the token re-bound to the new version is
        // stale for any further change. (The same save again changes
        // nothing a reader sees, so it needs no token at all.)
        expect(
          await refusedWithoutWriting(tx, (db) =>
            saveMemory(db, author, {
              ...input,
              expectedVersion: 1,
              confirmation: preview.confirmation!,
            }),
          ),
        ).toBe("version_conflict");
        expect(
          await refusedWithoutWriting(tx, (db) =>
            saveMemory(db, author, {
              entryId: input.entryId,
              expectedVersion: 2,
              title: "[Test] Something else entirely",
              confirmation: reissueTestToken(preview.confirmation!, { n: 2 }),
            }),
          ),
        ).toBe("confirmation_stale");
      });
    },
  );

  it("shows the music published now and after saving, as the songs' names", async () => {
    await inScratchTransaction(async (tx) => {
      const f = await publishedMemory(tx);
      const preview = await previewMemoryPublicChange(tx, author, {
        entryId: f.entryId,
        expectedVersion: 1,
        trackIds: [f.b, f.a, f.c],
      });
      expect(preview.review.changes).toEqual([
        {
          kind: "edited",
          label: "The music",
          before: {
            type: "list",
            items: [
              "[Test] Song A · [Test] First Artist, [Test] Second Artist",
              "[Test] Song B · [Test] Second Artist",
            ],
          },
          after: {
            type: "list",
            items: [
              "[Test] Song B · [Test] Second Artist",
              "[Test] Song A · [Test] First Artist, [Test] Second Artist",
              "[Test] Song C",
            ],
          },
        },
      ]);
    });
  });

  it("asks nothing for a removal, or for a save a reader cannot see", async () => {
    await inScratchTransaction(async (tx) => {
      const f = await publishedMemory(tx);
      for (const [index, change] of [
        { trackIds: [f.b] },
        { rememberedWhen: "" },
        { trackIds: [] },
        { title: "[Test] A memory" },
      ].entries()) {
        const input = {
          entryId: f.entryId,
          expectedVersion: index + 1,
          ...change,
        };
        const preview = await previewMemoryPublicChange(tx, author, input);
        expect(preview.confirmation, JSON.stringify(change)).toBeNull();
        expect(preview.review.changes).toEqual([]);
        await expect(saveMemory(tx, author, input)).resolves.toEqual({
          version: index + 2,
        });
      }
    });
  });

  it("refuses an expired, misbound, or stale token, and one for another change", async () => {
    await inScratchTransaction(async (tx) => {
      const f = await publishedMemory(tx);
      const input = {
        entryId: f.entryId,
        expectedVersion: 1,
        title: "[Test] New title",
      };
      const { confirmation } = await previewMemoryPublicChange(
        tx,
        author,
        input,
      );
      const token = confirmation!;
      const { confirmation: forOther } = await previewMemoryPublicChange(
        tx,
        author,
        { ...input, title: "[Test] A different title" },
      );
      for (const [name, presented, expected] of [
        [
          "expired",
          shiftedTestToken(token, -16 * 60 * 1000),
          "confirmation_expired",
        ],
        [
          "another session",
          reissueTestToken(token, { s: otherSession(author).sessionId }),
          "confirmation_invalid",
        ],
        [
          "the publish purpose",
          reissueTestToken(token, { p: "publish", l: "en" }),
          "confirmation_invalid",
        ],
        ["another change", forOther!, "confirmation_stale"],
      ] as const) {
        expect(
          await refusedWithoutWriting(tx, (db) =>
            saveMemory(db, author, { ...input, confirmation: presented }),
          ),
          name,
        ).toBe(expected);
      }
    });
  });

  it("never lets a memory's change token save an album journal, or the reverse", async () => {
    await inScratchTransaction(async (tx) => {
      const f = await publishedMemory(tx);
      const journalId = await createTestAlbumJournal(tx, {
        albumId: f.albumId,
        slug: "test-cross-kind-journal",
        versions: [{ locale: "en", status: "published", text: "[Test] J" }],
      });
      const { confirmation } = await previewMemoryPublicChange(tx, author, {
        entryId: f.entryId,
        expectedVersion: 1,
        title: "[Test] New",
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveAlbumJournal(db, author, {
            entryId: journalId,
            expectedVersion: 1,
            body: "[Test] Hijacked",
            confirmation: confirmation!,
          }),
        ),
      ).toBe("confirmation_invalid");
      const journalPreview = await previewAlbumJournalPublicChange(tx, author, {
        entryId: journalId,
        expectedVersion: 1,
        body: "[Test] New body",
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            entryId: f.entryId,
            expectedVersion: 1,
            title: "[Test] New",
            confirmation: journalPreview.confirmation!,
          }),
        ),
      ).toBe("confirmation_invalid");
    });
  });

  it("accepts a token for the same change with a removal bundled in", async () => {
    await inScratchTransaction(async (tx) => {
      const f = await publishedMemory(tx);
      const { confirmation } = await previewMemoryPublicChange(tx, author, {
        entryId: f.entryId,
        expectedVersion: 1,
        title: "[Test] New title",
      });
      await expect(
        saveMemory(tx, author, {
          entryId: f.entryId,
          expectedVersion: 1,
          title: "[Test] New title",
          rememberedWhen: "",
          confirmation: confirmation!,
        }),
      ).resolves.toEqual({ version: 2 });
    });
  });

  it("goes stale when the memory changes between the review and the save", async () => {
    await inScratchTransaction(async (tx) => {
      const f = await publishedMemory(tx);
      const input = {
        entryId: f.entryId,
        expectedVersion: 1,
        rememberedWhen: "[Test] Later",
      };
      const { confirmation } = await previewMemoryPublicChange(
        tx,
        author,
        input,
      );
      // Another tab removes a song: the version moves.
      await saveMemory(tx, author, {
        entryId: f.entryId,
        expectedVersion: 1,
        trackIds: [f.a],
      });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, { ...input, confirmation: confirmation! }),
        ),
      ).toBe("version_conflict");
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            ...input,
            expectedVersion: 2,
            confirmation: reissueTestToken(confirmation!, { n: 2 }),
          }),
        ),
      ).toBe("confirmation_stale");
    });
  });

  it("makes the same refusals in its preview as in the save", async () => {
    await inScratchTransaction(async (tx) => {
      const f = await publishedMemory(tx);
      for (const [input, expected] of [
        [{ expectedVersion: 7, title: "[Test] X" }, "version_conflict"],
        [{ expectedVersion: 1, body: "" }, "nothing_to_publish"],
        [
          {
            expectedVersion: 1,
            trackIds: ["00000000-0000-4000-8000-00000000dead"],
          },
          "track_not_found",
        ],
      ] as const) {
        expect(
          await refusedWithoutWriting(tx, (db) =>
            previewMemoryPublicChange(db, author, {
              entryId: f.entryId,
              ...input,
            }),
          ),
        ).toBe(expected);
        expect(
          await refusedWithoutWriting(tx, (db) =>
            saveMemory(db, author, { entryId: f.entryId, ...input }),
          ),
        ).toBe(expected);
      }
      await deleteMemory(tx, author, f.entryId);
      expect(
        await refusedWithoutWriting(tx, (db) =>
          previewMemoryPublicChange(db, author, {
            entryId: f.entryId,
            expectedVersion: 1,
            title: "[Test] X",
          }),
        ),
      ).toBe("entry_deleted");
    });
  });

  it("treats a recording spelled in upper case as the same link, and a duplicate however spelled as invalid", async () => {
    await inScratchTransaction(async (tx) => {
      const f = await publishedMemory(tx);
      // The same list, spelled in upper case: nothing a reader sees changes.
      const same = await previewMemoryPublicChange(tx, author, {
        entryId: f.entryId,
        expectedVersion: 1,
        trackIds: [f.a.toUpperCase(), f.b.toUpperCase()],
      });
      expect(same.confirmation).toBeNull();
      await expect(
        saveMemory(tx, author, {
          entryId: f.entryId,
          expectedVersion: 1,
          trackIds: [f.a.toUpperCase(), f.b],
        }),
      ).resolves.toEqual({ version: 2 });
      expect(
        await refusedWithoutWriting(tx, (db) =>
          saveMemory(db, author, {
            entryId: f.entryId,
            expectedVersion: 2,
            trackIds: [f.a, f.a.toUpperCase()],
          }),
        ),
      ).toBe("invalid_input");
    });
  });

  it("never asks for a draft or private memory", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const entryId = await newMemory(tx, [music.a]);
      const preview = await previewMemoryPublicChange(tx, author, {
        entryId,
        expectedVersion: 1,
        title: "[Test] Still a draft",
        trackIds: [music.b, music.a],
      });
      expect(preview.confirmation).toBeNull();
      expect(preview.review.changes).toEqual([]);
    });
  });
});

describe("unpublishing, deleting, and restoring a published memory", () => {
  it("unpublishes without a token, keeping the writing, songs, history, and address", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const entryId = await newMemory(tx, [music.a]);
      await publishForTest(tx, entryId, "en");
      const slug = (await getMemory(tx, author, entryId))!.slug!;
      expect(await resolvePublicSlug(tx, "memory", slug)).toEqual({
        outcome: "found",
        entryId,
      });
      await setMemoryPrivacy(tx, author, {
        entryId,
        locale: "en",
        status: "draft",
        expectedStatus: "published",
      });
      const memory = (await getMemory(tx, author, entryId))!;
      expect(memory.status).toBe("draft");
      expect(memory.recordings.map((r) => r.trackId)).toEqual([music.a]);
      expect(memory.slug).toBe(slug);
      expect(await resolvePublicSlug(tx, "memory", slug)).toEqual({
        outcome: "not_found",
      });
      expect(await getPublicMemory(tx, entryId, "en")).toBeNull();
      const history = await tx.execute<{ first: Date | null }>(sql`
        select first_published_at as first from entry_texts
         where entry_id = ${entryId}`);
      expect(history.rows[0]!.first).not.toBeNull();
    });
  });

  it("a restored memory is private, and publishing it again needs a new review (ADR 0005)", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const entryId = await newMemory(tx, [music.a]);
      const { confirmation: beforeDeletion } = await previewMemoryPublication(
        tx,
        author,
        { entryId, locale: "en" },
      );
      await publishMemoryVersion(tx, author, {
        entryId,
        locale: "en",
        expectedVersion: 1,
        confirmation: beforeDeletion,
      });
      await deleteMemory(tx, author, entryId);
      expect(await getPublicMemory(tx, entryId, "en")).toBeNull();
      expect(await restoreMemory(tx, author, entryId)).toEqual({
        madePrivate: ["en"],
      });
      expect(await statusOf(tx, entryId)).toBe("private");
      expect(await getPublicMemory(tx, entryId, "en")).toBeNull();
      expect(
        await refusedWithoutWriting(tx, (db) =>
          publishMemoryVersion(db, author, {
            entryId,
            locale: "en",
            expectedVersion: 1,
          }),
        ),
      ).toBe("confirmation_required");
      expect(
        await refusedWithoutWriting(tx, (db) =>
          publishMemoryVersion(db, author, {
            entryId,
            locale: "en",
            expectedVersion: 1,
            confirmation: beforeDeletion,
          }),
        ),
      ).toBe("confirmation_stale");
      const fresh = await previewMemoryPublication(tx, author, {
        entryId,
        locale: "en",
      });
      expect(fresh.review.status).toBe("private");
      await expect(
        publishMemoryVersion(tx, author, {
          entryId,
          locale: "en",
          expectedVersion: 1,
          confirmation: fresh.confirmation,
        }),
      ).resolves.toEqual({ changed: true });
      expect(await getPublicMemory(tx, entryId, "en")).not.toBeNull();
    });
  });
});

describe("the public memory page's read model", () => {
  it("serves exactly what the review disclosed, through the predicate", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const entryId = await newMemory(tx, [music.b, music.a]);
      const { review, confirmation } = await previewMemoryPublication(
        tx,
        author,
        { entryId, locale: "en" },
      );
      expect(await getPublicMemory(tx, entryId, "en")).toBeNull();
      await publishMemoryVersion(tx, author, {
        entryId,
        locale: "en",
        expectedVersion: 1,
        confirmation,
      });
      const page = (await getPublicMemory(tx, entryId, "en"))!;
      const version = (await getPublicLanguageVersion(tx, entryId, "en"))!;
      // Disclosure versus reader: the same title, writing, when, songs, and
      // address.
      expect(page.title).toBe(review.title);
      expect(page.body).toEqual(version.body);
      expect(page.rememberedWhen).toBe(review.rememberedWhen);
      expect(page.music).toEqual(review.music);
      expect(page.slug).toBe(review.address.slug);
      expect(page.locale).toBe("en");
      expect(page.isOriginal).toBe(true);
      expect(page.publishedAt).toBeInstanceOf(Date);
      // No identifier anywhere in what the page receives.
      const serialized = JSON.stringify(page);
      for (const id of [
        entryId,
        music.a,
        music.b,
        music.albumId,
        music.first,
      ]) {
        expect(serialized).not.toContain(id);
      }
      expect(await listPublicMemoryAddresses(tx)).toContain(page.slug);
    });
  });

  it("is null for a draft, a private, a deleted, and a missing memory, and lists none of them", async () => {
    await inScratchTransaction(async (tx) => {
      const draft = await createTestMemory(tx, { slug: "test-draft-memory" });
      const privateOne = await createTestMemory(tx, {
        slug: "test-private-memory",
        versions: [{ locale: "en", status: "private" }],
      });
      const deleted = await createTestMemory(tx, {
        slug: "test-deleted-memory",
        versions: [{ locale: "en", status: "published" }],
        deletedAt: new Date("2026-02-01T00:00:00Z"),
      });
      const shown = await createTestMemory(tx, {
        slug: "test-shown-memory",
        versions: [{ locale: "en", status: "published" }],
      });
      for (const id of [draft, privateOne, deleted]) {
        expect(await getPublicMemory(tx, id, "en")).toBeNull();
      }
      expect(await getPublicMemory(tx, shown, "en")).not.toBeNull();
      const listed = await listPublicMemoryAddresses(tx);
      expect(listed).toContain("test-shown-memory");
      for (const slug of [
        "test-draft-memory",
        "test-private-memory",
        "test-deleted-memory",
      ]) {
        expect(listed).not.toContain(slug);
        expect(await resolvePublicSlug(tx, "memory", slug)).toEqual({
          outcome: "not_found",
        });
      }
      // A memory's address is never an album journal's, and the reverse.
      expect(
        await resolvePublicSlug(tx, "album_journal", "test-shown-memory"),
      ).toEqual({ outcome: "not_found" });
    });
  });

  it("redirects a previous address of a public memory, and never one that was not public", async () => {
    await inScratchTransaction(async (tx) => {
      const shown = await createTestMemory(tx, {
        slug: "test-memory-now",
        versions: [{ locale: "en", status: "published" }],
      });
      await tx.insert(schema.entrySlugs).values([
        {
          kind: "memory",
          slug: "test-memory-before",
          entryId: shown,
          isCurrent: false,
          wasPublished: true,
        },
        {
          kind: "memory",
          slug: "test-memory-never-public",
          entryId: shown,
          isCurrent: false,
          wasPublished: false,
        },
      ]);
      expect(
        await resolvePublicSlug(tx, "memory", "test-memory-before"),
      ).toEqual({ outcome: "redirect", currentSlug: "test-memory-now" });
      expect(
        await resolvePublicSlug(tx, "memory", "test-memory-never-public"),
      ).toEqual({ outcome: "not_found" });
    });
  });

  it("links an artist only when it already has a page, an album journal only when served, and opens no page", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      // A second album with song C on it, and an album journal about it.
      const other = await createTestAlbum(tx, {
        title: "[Test] Later Album",
        trackTitles: ["[Test] Other song"],
        artistIds: [music.second],
        firstReleaseYear: 1999,
      });
      await tx
        .insert(schema.albumTracks)
        .values({ albumId: other.albumId, trackId: music.c });
      const otherJournal = await createTestAlbumJournal(tx, {
        albumId: other.albumId,
        slug: "test-later-album",
        versions: [{ locale: "en", text: "[Test] Journal" }],
      });
      const entryId = await newMemory(tx, [music.a, music.c]);
      await publishForTest(tx, entryId, "en");
      // The memory is public, and no artist has a page: memories open none.
      expect((await publicArtistAddresses(tx)).size).toBe(0);
      let page = (await getPublicMemory(tx, entryId, "en"))!;
      expect(page.music[0]!.artists.every((a) => a.address === null)).toBe(
        true,
      );
      // Song C is on two albums: with no journal served, the earliest is
      // named, as plain text.
      expect(page.music[1]!.album).toEqual({
        title: "[Test] Later Album",
        journalSlug: null,
      });

      // The other album's journal is published: its artist gets a page by
      // that publication, and the memory links both, now.
      await publishForTest(tx, otherJournal, "en");
      page = (await getPublicMemory(tx, entryId, "en"))!;
      expect(page.music[1]!.album).toEqual({
        title: "[Test] Later Album",
        journalSlug: "test-later-album",
      });
      expect(page.music[0]!.artists).toEqual([
        { name: "[Test] First Artist", address: null },
        { name: "[Test] Second Artist", address: "test-second-artist" },
      ]);

      // Archived, the artist's page closes, and its name is plain text.
      await tx
        .update(schema.artists)
        .set({ archivedAt: sql`now()` })
        .where(eq(schema.artists.id, music.second));
      page = (await getPublicMemory(tx, entryId, "en"))!;
      expect(page.music[0]!.artists[1]).toEqual({
        name: "[Test] Second Artist",
        address: null,
      });
      // An archived recording is still named, never dropped.
      await tx
        .update(schema.tracks)
        .set({ archivedAt: sql`now()` })
        .where(eq(schema.tracks.id, music.a));
      page = (await getPublicMemory(tx, entryId, "en"))!;
      expect(page.music[0]!.title).toBe("[Test] Song A");

      // Unpublishing the album journal takes its link away again.
      await setMemoryPrivacy(tx, author, {
        entryId,
        locale: "en",
        status: "private",
        expectedStatus: "published",
      });
      expect(await getPublicMemory(tx, entryId, "en")).toBeNull();
    });
  });

  it("names an album link with the album's own credits, and links its served journal", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const journal = await createTestAlbumJournal(tx, {
        albumId: music.albumId,
        slug: "test-memory-album",
        versions: [{ locale: "en", status: "published", text: "[Test] J" }],
      });
      const memoryId = await createTestMemory(tx, {
        slug: "test-album-memory",
        versions: [{ locale: "en", status: "published" }],
        music: [{ albumId: music.albumId }, { trackId: music.b }],
      });
      const page = (await getPublicMemory(tx, memoryId, "en"))!;
      expect(page.music).toEqual([
        {
          number: 1,
          kind: "album",
          title: "[Test] Memory Album",
          artists: [
            { name: "[Test] First Artist", address: "test-first-artist" },
          ],
          album: {
            title: "[Test] Memory Album",
            journalSlug: "test-memory-album",
          },
        },
        {
          number: 2,
          kind: "recording",
          title: "[Test] Song B",
          artists: [{ name: "[Test] Second Artist", address: null }],
          album: {
            title: "[Test] Memory Album",
            journalSlug: "test-memory-album",
          },
        },
      ]);
      expect(journal).toBeTruthy();
    });
  });

  it("shows no reflection of any album journal", async () => {
    await inScratchTransaction(async (tx) => {
      const music = await setUp(tx);
      const entryId = await newMemory(tx, [music.a]);
      await publishForTest(tx, entryId, "en");
      const page = (await getPublicMemory(tx, entryId, "en"))!;
      expect(Object.keys(page).sort()).toEqual([
        "body",
        "isOriginal",
        "locale",
        "music",
        "publishedAt",
        "rememberedWhen",
        "slug",
        "title",
      ]);
      expect(Object.keys(page.music[0]!).sort()).toEqual([
        "album",
        "artists",
        "kind",
        "number",
        "title",
      ]);
    });
  });
});
