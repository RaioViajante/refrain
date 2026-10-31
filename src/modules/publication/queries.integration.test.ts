import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Transaction } from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestArtistJournal,
  createTestMemory,
  createTestTrackReflection,
  inRollbackTransaction,
  type TestVersion,
} from "@/testing";

import { publishLanguageVersion } from "./commands";
import {
  getPublicLanguageVersion,
  listPublicLanguageVersions,
  listPublicTrackReflections,
  resolvePresentedJournal,
  resolvePublicSlug,
  type JournalSubject,
} from "./queries";

// Database-level tests of the publication predicate and the public queries
// built on it. HTTP-level tests of the same invariants (status codes,
// metadata, sitemaps, caches) belong to the milestones that add public
// routes; see docs/security.md § Required tests.

const january = new Date("2026-01-10T00:00:00Z");
const march = new Date("2026-03-10T00:00:00Z");
const june = new Date("2026-06-10T00:00:00Z");

const published = (
  locale: TestVersion["locale"],
  publishedAt = january,
  isOriginal?: boolean,
): TestVersion => ({ locale, status: "published", publishedAt, isOriginal });

/** Resolves in every interface language and checks the journal is the same. */
async function presentedJournalId(tx: Transaction, subject: JournalSubject) {
  // Sequential: one transaction is one connection.
  const ids: (string | null)[] = [];
  for (const locale of schema.locales) {
    const result = await resolvePresentedJournal(tx, subject, locale);
    ids.push(result?.entryId ?? null);
  }
  expect(new Set(ids).size, "the reader's language changed the journal").toBe(
    1,
  );
  return ids[0];
}

describe("featured-journal resolution (ADR 0002, D1.2; INV-1)", () => {
  it("presents the featured journal when it is publicly visible", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const featured = await createTestAlbumJournal(tx, {
        albumId,
        isFeatured: true,
        versions: [published("en", january)],
      });
      await createTestAlbumJournal(tx, {
        albumId,
        versions: [published("en", june)],
      });
      expect(await presentedJournalId(tx, { kind: "album", albumId })).toBe(
        featured,
      );
    });
  });

  it.each([
    ["only a draft", { versions: [{ locale: "en" as const }] }],
    [
      "private",
      { versions: [{ locale: "en" as const, status: "private" as const }] },
    ],
    ["deleted", { versions: [published("en", june)], deletedAt: new Date() }],
  ])(
    "falls back to the most recently published journal when the featured one is %s",
    async (_label, featuredOptions) => {
      await inRollbackTransaction(async (tx) => {
        const { albumId } = await createTestAlbum(tx);
        await createTestAlbumJournal(tx, {
          albumId,
          isFeatured: true,
          ...featuredOptions,
        });
        await createTestAlbumJournal(tx, {
          albumId,
          versions: [published("en", january)],
        });
        const latest = await createTestAlbumJournal(tx, {
          albumId,
          versions: [published("en", march)],
        });
        expect(await presentedJournalId(tx, { kind: "album", albumId })).toBe(
          latest,
        );
      });
    },
  );

  it("uses the latest visible version's published_at, ignoring unpublished ones", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const withTranslation = await createTestAlbumJournal(tx, {
        albumId,
        versions: [published("en", january), published("pt-BR", june, false)],
      });
      const marchJournal = await createTestAlbumJournal(tx, {
        albumId,
        versions: [published("en", march)],
      });
      expect(await presentedJournalId(tx, { kind: "album", albumId })).toBe(
        withTranslation,
      );

      // Unpublishing the June translation removes it from the comparison.
      await tx
        .update(schema.entryTexts)
        .set({ status: "private", publishedAt: null })
        .where(
          and(
            eq(schema.entryTexts.entryId, withTranslation),
            eq(schema.entryTexts.locale, "pt-BR"),
          ),
        );
      expect(await presentedJournalId(tx, { kind: "album", albumId })).toBe(
        marchJournal,
      );
    });
  });

  it("presents a featured journal that is visible only through its translation", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const featured = await createTestAlbumJournal(tx, {
        albumId,
        isFeatured: true,
        versions: [
          { locale: "en", status: "private" },
          published("pt-BR", january, false),
        ],
      });
      await createTestAlbumJournal(tx, {
        albumId,
        versions: [published("en", june)],
      });
      expect(await presentedJournalId(tx, { kind: "album", albumId })).toBe(
        featured,
      );
      expect(
        (await resolvePresentedJournal(tx, { kind: "album", albumId }, "en"))
          ?.locale,
      ).toBe("pt-BR");
    });
  });

  it("breaks a published_at tie by the lowest entry id", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const ids = [
        await createTestAlbumJournal(tx, {
          albumId,
          versions: [published("en", march)],
        }),
        await createTestAlbumJournal(tx, {
          albumId,
          versions: [published("en", march)],
        }),
        await createTestAlbumJournal(tx, {
          albumId,
          versions: [published("en", march)],
        }),
      ];
      const lowest = (
        await tx.execute<{ id: string }>(
          sql`select min(id::text) as id from entries where id = any(array[${sql.join(ids, sql`, `)}]::uuid[])`,
        )
      ).rows[0]!.id;
      for (let attempt = 0; attempt < 3; attempt++) {
        expect(await presentedJournalId(tx, { kind: "album", albumId })).toBe(
          lowest,
        );
      }
    });
  });

  it("presents nothing when no journal is publicly visible", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      await createTestAlbumJournal(tx, { albumId, isFeatured: true });
      await createTestAlbumJournal(tx, {
        albumId,
        versions: [{ locale: "en", status: "private" }],
      });
      expect(
        await presentedJournalId(tx, { kind: "album", albumId }),
      ).toBeNull();
    });
  });

  it("chooses the version: reader's language, else original, else the remaining one", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = (await createTestAlbum(tx)).albumId;
      const versionFor = async (albumId: string, locale: "en" | "pt-BR") =>
        (await resolvePresentedJournal(tx, { kind: "album", albumId }, locale))
          ?.locale;

      // Both versions published: each reader gets their own language.
      await createTestAlbumJournal(tx, {
        albumId: album,
        versions: [published("en"), published("pt-BR", january, false)],
      });
      expect(await versionFor(album, "en")).toBe("en");
      expect(await versionFor(album, "pt-BR")).toBe("pt-BR");

      // Translation not published: everyone gets the original.
      const second = (await createTestAlbum(tx)).albumId;
      await createTestAlbumJournal(tx, {
        albumId: second,
        versions: [published("pt-BR"), { locale: "en", isOriginal: false }],
      });
      expect(await versionFor(second, "en")).toBe("pt-BR");
      expect(await versionFor(second, "pt-BR")).toBe("pt-BR");

      // Original private, translation published: the remaining version.
      const third = (await createTestAlbum(tx)).albumId;
      await createTestAlbumJournal(tx, {
        albumId: third,
        versions: [
          { locale: "en", status: "private" },
          published("pt-BR", january, false),
        ],
      });
      expect(await versionFor(third, "en")).toBe("pt-BR");
      expect(await versionFor(third, "pt-BR")).toBe("pt-BR");
    });
  });

  it("resolves artist journals by the same rules", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      await createTestArtistJournal(tx, {
        artistId,
        isFeatured: true,
        versions: [{ locale: "en" }],
      });
      const latest = await createTestArtistJournal(tx, {
        artistId,
        versions: [published("pt-BR", june)],
      });
      await createTestArtistJournal(tx, {
        artistId,
        versions: [published("en", january)],
      });
      expect(await presentedJournalId(tx, { kind: "artist", artistId })).toBe(
        latest,
      );
      // An album journal never answers for an artist, or the other way round.
      const { albumId } = await createTestAlbum(tx);
      expect(
        await presentedJournalId(tx, { kind: "album", albumId }),
      ).toBeNull();
    });
  });
});

describe("language versions through the publication predicate (INV-3)", () => {
  it("exposes a published original but not its private translation", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx, {
        versions: [
          { ...published("en"), title: "[Test] Public title" },
          {
            locale: "pt-BR",
            status: "private",
            title: "[Test] Título privado",
          },
        ],
      });

      expect(await listPublicLanguageVersions(tx, memoryId)).toEqual([
        { locale: "en", isOriginal: true, publishedAt: january },
      ]);
      expect(await getPublicLanguageVersion(tx, memoryId, "pt-BR")).toBeNull();
      expect(await getPublicLanguageVersion(tx, memoryId, "en")).toMatchObject({
        entryId: memoryId,
        kind: "memory",
        locale: "en",
        title: "[Test] Public title",
      });
    });
  });

  it.each([
    ["a draft", { versions: [{ locale: "en" as const }] }],
    [
      "private",
      { versions: [{ locale: "en" as const, status: "private" as const }] },
    ],
    ["deleted", { versions: [published("en")], deletedAt: new Date() }],
  ])("exposes nothing of an entry that is %s", async (_label, options) => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx, options);
      expect(await listPublicLanguageVersions(tx, memoryId)).toEqual([]);
      expect(await getPublicLanguageVersion(tx, memoryId, "en")).toBeNull();
    });
  });

  it("returns no visibility or deletion fields", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx, {
        versions: [published("en")],
      });
      const version = await getPublicLanguageVersion(tx, memoryId, "en");
      expect(Object.keys(version!).sort()).toEqual(
        [
          "body",
          "entryId",
          "isOriginal",
          "kind",
          "locale",
          "marginNote",
          "opening",
          "publishedAt",
          "title",
        ].sort(),
      );
    });
  });
});

describe("track reflections through the publication predicate (D5; INV-2, INV-3)", () => {
  async function journalWithTracks(
    tx: Transaction,
    versions: TestVersion[] = [
      published("en"),
      { locale: "pt-BR", isOriginal: false },
    ],
    deletedAt?: Date,
  ) {
    const album = await createTestAlbum(tx, {
      trackTitles: ["[Test] One", "[Test] Two", "[Test] Three", "[Test] Four"],
    });
    const journalId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      versions,
      deletedAt,
    });
    const reflect = (
      index: number,
      options: Partial<Parameters<typeof createTestTrackReflection>[1]>,
    ) =>
      createTestTrackReflection(tx, {
        albumJournalId: journalId,
        albumId: album.albumId,
        trackId: album.trackIds[index]!,
        ...options,
      });
    return { album, journalId, reflect };
  }

  it("shows only explicitly published reflections with text in that language", async () => {
    await inRollbackTransaction(async (tx) => {
      const { album, journalId, reflect } = await journalWithTracks(tx);
      await reflect(0, {
        isPublished: true,
        isFavourite: true,
        ratingHalfSteps: 9,
        texts: { en: "[Test] Published", "pt-BR": "[Test] Tradução privada" },
      });
      await reflect(1, {
        isPublished: false,
        isFavourite: true,
        ratingHalfSteps: 2,
        texts: { en: "[Test] Not authorized" },
      });
      await reflect(2, {
        isPublished: true,
        texts: { "pt-BR": "[Test] Só em português" },
      });
      await reflect(3, { isPublished: true }); // authorized, but no text

      const english = await listPublicTrackReflections(tx, journalId, "en");
      expect(english).toEqual([
        expect.objectContaining({
          trackId: album.trackIds[0],
          trackTitle: "[Test] One",
          isFavourite: true,
          ratingHalfSteps: 9,
        }),
      ]);
      // The pt-BR journal version is a draft: none of its reflections show.
      expect(await listPublicTrackReflections(tx, journalId, "pt-BR")).toEqual(
        [],
      );
    });
  });

  it("shows a reflection in each language whose journal version is published", async () => {
    await inRollbackTransaction(async (tx) => {
      const { album, journalId, reflect } = await journalWithTracks(tx, [
        published("en"),
        published("pt-BR", january, false),
      ]);
      await reflect(0, {
        isPublished: true,
        texts: { en: "[Test] English", "pt-BR": "[Test] Português" },
      });
      await reflect(1, {
        isPublished: true,
        texts: { "pt-BR": "[Test] Só PT" },
      });

      const ids = async (locale: "en" | "pt-BR") =>
        (await listPublicTrackReflections(tx, journalId, locale)).map(
          (row) => row.trackId,
        );
      expect(await ids("en")).toEqual([album.trackIds[0]]);
      expect(await ids("pt-BR")).toEqual([
        album.trackIds[0],
        album.trackIds[1],
      ]);
    });
  });

  it("shows nothing while the journal version is unpublished or the entry deleted", async () => {
    await inRollbackTransaction(async (tx) => {
      for (const [versions, deletedAt] of [
        [[{ locale: "en", status: "private" }], undefined],
        [[{ locale: "en" }], undefined],
        [[published("en")], new Date()],
      ] as [TestVersion[], Date | undefined][]) {
        const { journalId, reflect } = await journalWithTracks(
          tx,
          versions,
          deletedAt,
        );
        await reflect(0, {
          isPublished: true,
          isFavourite: true,
          ratingHalfSteps: 10,
          texts: { en: "[Test] Authorized" },
        });
        expect(await listPublicTrackReflections(tx, journalId, "en")).toEqual(
          [],
        );
      }
    });
  });

  it("never changes visibility, rating, or favourite with the still-writing flag (INV-2)", async () => {
    await inRollbackTransaction(async (tx) => {
      const { journalId, reflect } = await journalWithTracks(tx);
      const authorized = await reflect(0, {
        isPublished: true,
        isFavourite: true,
        ratingHalfSteps: 7,
        texts: { en: "[Test] Authorized" },
      });
      const unauthorized = await reflect(1, {
        isPublished: false,
        isFavourite: true,
        ratingHalfSteps: 3,
        texts: { en: "[Test] Not authorized" },
      });

      // Everything public about the reflections except the progress label.
      const snapshot = async () =>
        (await listPublicTrackReflections(tx, journalId, "en")).map((row) => ({
          trackReflectionId: row.trackReflectionId,
          trackId: row.trackId,
          isFavourite: row.isFavourite,
          ratingHalfSteps: row.ratingHalfSteps,
          body: row.body,
        }));
      const setStillWriting = (isStillWriting: boolean) =>
        tx
          .update(schema.trackReflections)
          .set({ isStillWriting })
          .where(eq(schema.trackReflections.albumJournalId, journalId));

      const before = await snapshot();
      expect(before.map((row) => row.trackReflectionId)).toEqual([authorized]);

      await setStillWriting(true);
      const whileWriting = await listPublicTrackReflections(
        tx,
        journalId,
        "en",
      );
      expect(whileWriting.map((row) => row.isStillWriting)).toEqual([true]);
      expect(await snapshot()).toEqual(before);

      await setStillWriting(false);
      expect(await snapshot()).toEqual(before);
      expect(
        (await snapshot()).some(
          (row) => row.trackReflectionId === unauthorized,
        ),
      ).toBe(false);
    });
  });

  it("does not publish reflections when the journal is published", async () => {
    await inRollbackTransaction(async (tx) => {
      const { journalId, reflect } = await journalWithTracks(tx, [
        { locale: "en", status: "private" },
      ]);
      await reflect(0, { texts: { en: "[Test] Written" } });
      await tx.insert(schema.entrySlugs).values({
        kind: "album_journal",
        slug: "test-journal",
        entryId: journalId,
        isCurrent: true,
      });
      await publishLanguageVersion(tx, journalId, "en");
      expect(await listPublicTrackReflections(tx, journalId, "en")).toEqual([]);
    });
  });

  it("orders by the reference edition and lists recordings outside it last", async () => {
    await inRollbackTransaction(async (tx) => {
      const { album, journalId, reflect } = await journalWithTracks(tx);
      const [extra] = await tx
        .insert(schema.tracks)
        .values({ title: "[Test] A recording outside the edition" })
        .returning();
      await tx
        .insert(schema.albumTracks)
        .values({ albumId: album.albumId, trackId: extra!.id });
      await createTestTrackReflection(tx, {
        albumJournalId: journalId,
        albumId: album.albumId,
        trackId: extra!.id,
        isPublished: true,
        texts: { en: "[Test] Outside" },
      });
      for (const index of [3, 0, 2]) {
        await reflect(index, {
          isPublished: true,
          texts: { en: "[Test] In order" },
        });
      }

      const titles = (
        await listPublicTrackReflections(tx, journalId, "en")
      ).map((row) => row.trackTitle);
      expect(titles).toEqual([
        "[Test] One",
        "[Test] Three",
        "[Test] Four",
        "[Test] A recording outside the edition",
      ]);
    });
  });
});

describe("slug resolution (ADR 0002, D7.5; INV-5)", () => {
  // A memory renamed from test-old to test-new. When it has ever been
  // published, both slugs are marked as published, as the publication
  // commands would leave them.
  async function memoryWithRenamedSlug(
    tx: Transaction,
    options: Parameters<typeof createTestMemory>[1] = {},
  ) {
    const memoryId = await createTestMemory(tx, {
      slug: "test-old",
      ...options,
    });
    const wasPublished = (options.versions ?? []).some(
      (version) => version.status === "published",
    );
    await tx
      .update(schema.entrySlugs)
      .set({ isCurrent: false })
      .where(eq(schema.entrySlugs.entryId, memoryId));
    await tx.insert(schema.entrySlugs).values({
      kind: "memory",
      slug: "test-new",
      entryId: memoryId,
      wasPublished,
      isCurrent: true,
    });
    return memoryId;
  }

  it("finds the current slug and redirects a previous one of a visible entry", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await memoryWithRenamedSlug(tx, {
        versions: [published("en")],
      });
      expect(await resolvePublicSlug(tx, "memory", "test-new")).toEqual({
        outcome: "found",
        entryId: memoryId,
      });
      expect(await resolvePublicSlug(tx, "memory", "test-old")).toEqual({
        outcome: "redirect",
        currentSlug: "test-new",
      });
    });
  });

  it("treats an entry visible only through its translation as visible", async () => {
    await inRollbackTransaction(async (tx) => {
      await memoryWithRenamedSlug(tx, {
        versions: [
          { locale: "en", status: "private" },
          published("pt-BR", january, false),
        ],
      });
      expect(await resolvePublicSlug(tx, "memory", "test-old")).toEqual({
        outcome: "redirect",
        currentSlug: "test-new",
      });
    });
  });

  it.each([
    ["a draft", { versions: [{ locale: "en" as const }] }],
    [
      "private",
      { versions: [{ locale: "en" as const, status: "private" as const }] },
    ],
    ["deleted", { versions: [published("en")], deletedAt: new Date() }],
  ])(
    "answers exactly like an unknown slug for an entry that is %s",
    async (_label, options) => {
      await inRollbackTransaction(async (tx) => {
        await memoryWithRenamedSlug(tx, options);
        const unknown = await resolvePublicSlug(
          tx,
          "memory",
          "test-never-used",
        );
        expect(unknown).toEqual({ outcome: "not_found" });
        expect(await resolvePublicSlug(tx, "memory", "test-new")).toEqual(
          unknown,
        );
        expect(await resolvePublicSlug(tx, "memory", "test-old")).toEqual(
          unknown,
        );
      });
    },
  );

  it("stops redirecting as soon as the entry stops being visible", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await memoryWithRenamedSlug(tx, {
        versions: [published("en")],
      });
      await tx
        .update(schema.entryTexts)
        .set({ status: "private", publishedAt: null })
        .where(eq(schema.entryTexts.entryId, memoryId));
      expect(await resolvePublicSlug(tx, "memory", "test-old")).toEqual({
        outcome: "not_found",
      });
    });
  });

  it("resolves a slug only within its own kind", async () => {
    await inRollbackTransaction(async (tx) => {
      await createTestMemory(tx, {
        slug: "test-kind",
        versions: [published("en")],
      });
      expect(await resolvePublicSlug(tx, "album_journal", "test-kind")).toEqual(
        {
          outcome: "not_found",
        },
      );
    });
  });
});
