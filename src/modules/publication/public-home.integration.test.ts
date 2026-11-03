import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Transaction } from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  inRollbackTransaction,
  testAuthor,
  type TestVersion,
} from "@/testing";

import {
  changeEntrySlug,
  restoreDeletedEntry,
  unpublishLanguageVersion,
} from "./commands";
import { resolvePresentedJournal } from "./queries";
import {
  getPublicHome,
  HOME_ALBUM_LIMIT,
  HOME_RECENT_LIMIT,
  listPublicAlbums,
  listRecentPublicAlbumJournals,
  type PublicJournalCard,
} from "./public-home";

// The Home's read model against real PostgreSQL (M3.4). What it lists is
// compared with the publication predicate's own oracle in
// public-album-journal.integration.test.ts (every state of a journal); this
// file covers what that matrix does not: the order, the limits, the
// presented journal of an album, the served address, the version's date, and
// the projection. Committed rows from other suites can be visible inside the
// transaction, so each test looks only at its own slugs, and dates its own
// journals after anything a fixture uses, so it owns the top of each list.

const later = (day: number) => new Date(Date.UTC(2030, 0, day));
const published = (
  locale: TestVersion["locale"],
  publishedAt: Date,
  isOriginal?: boolean,
): TestVersion => ({ locale, status: "published", publishedAt, isOriginal });

const BIG = 100_000;

async function journal(
  tx: Transaction,
  slug: string,
  options: {
    title?: string;
    versions?: TestVersion[];
    albumId?: string;
    isFeatured?: boolean;
    ratingHalfSteps?: number | null;
    deletedAt?: Date;
  } = {},
) {
  const albumId =
    options.albumId ??
    (
      await createTestAlbum(tx, {
        title: options.title ?? `[Test] ${slug}`,
        artistIds: [await createTestArtist(tx, `[Test] Artist of ${slug}`)],
        firstReleaseYear: 1994,
      })
    ).albumId;
  const entryId = await createTestAlbumJournal(tx, {
    albumId,
    slug,
    versions: options.versions ?? [published("en", later(1))],
    isFeatured: options.isFeatured,
    ratingHalfSteps: options.ratingHalfSteps,
    deletedAt: options.deletedAt,
  });
  return { entryId, albumId, slug };
}

function own(cards: PublicJournalCard[], prefix: string) {
  return cards.filter((card) => card.slug.startsWith(prefix));
}

describe("the Home's read model", () => {
  it("returns only what a reader may see, with no identifier", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `home-${randomUUID().slice(0, 8)}`;
      await journal(tx, `${p}-a`, { ratingHalfSteps: 9 });
      const home = await getPublicHome(tx, "en");
      const card = own(home.recent, p)[0]!;
      expect(Object.keys(card).sort()).toEqual([
        "albumTitle",
        "artwork",
        "credits",
        "firstReleaseYear",
        "publishedAt",
        "ratingHalfSteps",
        "slug",
      ]);
      expect(card).toEqual({
        slug: `${p}-a`,
        albumTitle: `[Test] ${p}-a`,
        credits: [`[Test] Artist of ${p}-a`],
        firstReleaseYear: 1994,
        ratingHalfSteps: 9,
        artwork: null,
        publishedAt: later(1),
      });
      // No database id anywhere in what the Home receives.
      const text = JSON.stringify(home);
      const ids = await tx.execute<{ id: string }>(sql`
        select id::text from entries union select id::text from albums
        union select id::text from artists`);
      for (const { id } of ids.rows) {
        expect(text).not.toContain(id);
      }
    });
  });

  it("lists the most recently published first, at most five, and the albums at most four", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `order-${randomUUID().slice(0, 8)}`;
      for (const day of [3, 7, 1, 9, 5, 2, 8]) {
        await journal(tx, `${p}-${day}`, {
          versions: [published("en", later(day))],
        });
      }
      // A tie on the date is broken by the address, so the order is stable.
      await journal(tx, `${p}-9b`, { versions: [published("en", later(9))] });

      const recent = await listRecentPublicAlbumJournals(tx, "en");
      expect(HOME_RECENT_LIMIT).toBe(5);
      expect(recent.map((card) => card.slug)).toEqual([
        `${p}-9`,
        `${p}-9b`,
        `${p}-8`,
        `${p}-7`,
        `${p}-5`,
      ]);
      const albums = await listPublicAlbums(tx, "en");
      expect(HOME_ALBUM_LIMIT).toBe(4);
      expect(albums.map((card) => card.slug)).toEqual([
        `${p}-9`,
        `${p}-9b`,
        `${p}-8`,
        `${p}-7`,
      ]);
    });
  });

  it("never lists a draft, a private journal, a deleted one, or a restored one", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `hidden-${randomUUID().slice(0, 8)}`;
      await journal(tx, `${p}-draft`, {
        versions: [{ locale: "en", status: "draft" }],
      });
      await journal(tx, `${p}-private`, {
        versions: [{ locale: "en", status: "private" }],
      });
      await journal(tx, `${p}-deleted`, {
        versions: [published("en", later(2))],
        deletedAt: new Date(),
      });
      // Deleted while published, then restored: a restore never republishes
      // (ADR 0005), so it stays off the Home.
      const restored = await journal(tx, `${p}-restored`, {
        versions: [published("en", later(3))],
        deletedAt: new Date(),
      });
      await restoreDeletedEntry(tx, restored.entryId);
      const visible = await journal(tx, `${p}-public`);

      const recent = own(await listRecentPublicAlbumJournals(tx, "en", BIG), p);
      const albums = own(await listPublicAlbums(tx, "en", BIG), p);
      expect(recent.map((card) => card.slug)).toEqual([visible.slug]);
      expect(albums.map((card) => card.slug)).toEqual([visible.slug]);

      // Unpublishing takes it off at once.
      await unpublishLanguageVersion(
        tx,
        testAuthor(),
        visible.entryId,
        "en",
        "private",
      );
      expect(
        own(await listRecentPublicAlbumJournals(tx, "en", BIG), p),
      ).toEqual([]);
      expect(own(await listPublicAlbums(tx, "en", BIG), p)).toEqual([]);
    });
  });

  it("dates a journal by the version the reader is shown, never by an unpublished translation", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `lang-${randomUUID().slice(0, 8)}`;
      // English published on the 2nd; a Portuguese translation exists as a
      // draft, which carries no publication date at all.
      await journal(tx, `${p}-draft-pt`, {
        versions: [
          published("en", later(2)),
          { locale: "pt-BR", status: "draft", isOriginal: false },
        ],
      });
      // Both published, on different days: each reader sees their own.
      await journal(tx, `${p}-both`, {
        versions: [
          published("en", later(4)),
          published("pt-BR", later(6), false),
        ],
      });
      // Only the Portuguese original is public: everyone is shown it.
      await journal(tx, `${p}-pt-only`, {
        versions: [
          published("pt-BR", later(5)),
          { locale: "en", status: "private", isOriginal: false },
        ],
      });

      const dates = async (locale: "en" | "pt-BR") =>
        Object.fromEntries(
          own(await listRecentPublicAlbumJournals(tx, locale, BIG), p).map(
            (card) => [card.slug.slice(p.length + 1), card.publishedAt],
          ),
        );
      expect(await dates("en")).toEqual({
        "draft-pt": later(2),
        both: later(4),
        "pt-only": later(5),
      });
      expect(await dates("pt-BR")).toEqual({
        "draft-pt": later(2),
        both: later(6),
        "pt-only": later(5),
      });
    });
  });

  it("shows each album once, by its presented journal, while Recently written lists every journal", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `feat-${randomUUID().slice(0, 8)}`;
      const { albumId } = await createTestAlbum(tx, {
        title: `[Test] ${p}`,
        artistIds: [await createTestArtist(tx, "[Test] Featured artist")],
      });
      const older = await journal(tx, `${p}-older`, {
        albumId,
        isFeatured: true,
        versions: [published("en", later(1))],
        ratingHalfSteps: 6,
      });
      const newer = await journal(tx, `${p}-newer`, {
        albumId,
        versions: [published("en", later(8))],
        ratingHalfSteps: 10,
      });

      const albums = own(await listPublicAlbums(tx, "en", BIG), p);
      // The featured journal is the album's presentation, with its rating.
      expect(albums.map((card) => [card.slug, card.ratingHalfSteps])).toEqual([
        [older.slug, 6],
      ]);
      const recent = own(await listRecentPublicAlbumJournals(tx, "en", BIG), p);
      expect(recent.map((card) => card.slug)).toEqual([newer.slug, older.slug]);

      // When the featured journal stops being visible, the most recently
      // published one presents the album.
      await unpublishLanguageVersion(
        tx,
        testAuthor(),
        older.entryId,
        "en",
        "private",
      );
      expect(
        own(await listPublicAlbums(tx, "en", BIG), p).map((card) => card.slug),
      ).toEqual([newer.slug]);
    });
  });

  it("presents the same journal of every album to every reader, dated by the reader's version (INV-1)", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `inv1-${randomUUID().slice(0, 8)}`;
      const albums: string[] = [];
      for (const name of ["a", "b"]) {
        const { albumId } = await createTestAlbum(tx, {
          title: `[Test] ${p}-${name}`,
          artistIds: [await createTestArtist(tx, "[Test] INV-1 artist")],
        });
        albums.push(albumId);
        // Featured, published in both languages on different days.
        await journal(tx, `${p}-${name}-featured`, {
          albumId,
          isFeatured: true,
          versions: [
            published("en", later(2)),
            published("pt-BR", later(3), false),
          ],
        });
        // Newer, but not featured, and public only in Portuguese.
        await journal(tx, `${p}-${name}-newer`, {
          albumId,
          versions: [
            published("pt-BR", later(9)),
            { locale: "en", status: "private", isOriginal: false },
          ],
        });
      }
      const chosen = async (locale: "en" | "pt-BR") =>
        Object.fromEntries(
          own(await listPublicAlbums(tx, locale, BIG), p).map((card) => [
            card.slug,
            card.publishedAt,
          ]),
        );
      expect(await chosen("en")).toEqual({
        [`${p}-a-featured`]: later(2),
        [`${p}-b-featured`]: later(2),
      });
      expect(await chosen("pt-BR")).toEqual({
        [`${p}-a-featured`]: later(3),
        [`${p}-b-featured`]: later(3),
      });
      // And the same choice as the single-album resolution.
      for (const albumId of albums) {
        for (const locale of ["en", "pt-BR"] as const) {
          const presented = await resolvePresentedJournal(
            tx,
            { kind: "album", albumId },
            locale,
          );
          expect(presented?.locale).toBe(locale);
        }
      }
    });
  });

  it("links to the current address after a change, never to the old one", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `addr-${randomUUID().slice(0, 8)}`;
      const moved = await journal(tx, `${p}-old`);
      await changeEntrySlug(tx, moved.entryId, `${p}-new`);
      const slugs = [
        ...own(await listRecentPublicAlbumJournals(tx, "en", BIG), p),
        ...own(await listPublicAlbums(tx, "en", BIG), p),
      ].map((card) => card.slug);
      expect(slugs).toEqual([`${p}-new`, `${p}-new`]);
    });
  });

  it("names the credited artists in order, and shows a stored cover only in the form Refrain writes", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `facts-${randomUUID().slice(0, 8)}`;
      const first = await createTestArtist(tx, "[Test] First");
      const second = await createTestArtist(tx, "[Test] Second");
      const album = await createTestAlbum(tx, {
        title: `[Test] ${p}`,
        artistIds: [first, second],
      });
      await tx
        .update(schema.albumArtists)
        .set({ creditedAs: "[Test] Second, as credited" })
        .where(
          and(
            eq(schema.albumArtists.albumId, album.albumId),
            eq(schema.albumArtists.artistId, second),
          ),
        );
      await journal(tx, `${p}-a`, { albumId: album.albumId });

      const card = () =>
        listRecentPublicAlbumJournals(tx, "en", BIG).then(
          (cards) => own(cards, p)[0]!,
        );
      expect((await card()).credits).toEqual([
        "[Test] First",
        "[Test] Second, as credited",
      ]);

      const release = "3f8c4f8e-0000-4000-8000-000000000001";
      await tx
        .update(schema.albums)
        .set({
          coverUrl: `https://coverartarchive.org/release/${release}/1000000001`,
          coverSource: "Cover Art Archive",
        })
        .where(eq(schema.albums.id, album.albumId));
      const artwork = (await card()).artwork!;
      expect(artwork.src).toMatch(/^https:\/\/coverartarchive\.org\/release\//);
      expect(artwork.srcSet).toContain("250w");

      // Anything else in those columns is never an address on the page.
      await tx
        .update(schema.albums)
        .set({ coverUrl: "https://example.com/x.jpg" })
        .where(eq(schema.albums.id, album.albumId));
      expect((await card()).artwork).toBeNull();
    });
  });
});
