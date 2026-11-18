import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { getDb, schema, type Database, type Transaction } from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestArtistJournal,
  createTestMemory,
  databaseErrorOf,
  inRollbackTransaction,
  testAuthor,
  uniqueLabel,
  withConnections,
  type TestAlbum,
  type TestVersion,
} from "@/testing";
import {
  GRACE_ARTIST_PHOTO,
  setTestArtistPhoto,
} from "@/testing/public-artists";
import { publishForTest } from "@/testing/publishing";

import { artistAddressBase } from "./artist-address";

import {
  changeEntrySlug,
  restoreDeletedEntry,
  unpublishLanguageVersion,
} from "./commands";
import { publicArtistAddresses, resolvePresentedJournal } from "./queries";
import {
  listPublicAlbumArchive,
  listPublicArtistArchive,
  listPublicMemoryArchive,
} from "./public-archives";
import { listPublicAlbumJournalAddresses } from "./public-album-journal";
import {
  getPublicHome,
  HOME_ALBUM_LIMIT,
  HOME_ARTIST_LIMIT,
  HOME_MEMORY_LIMIT,
  HOME_RECENT_LIMIT,
  listHomeArtists,
  listPublicAlbums,
  listRecentPublicEntries,
  type PublicHomeAlbumJournal,
} from "./public-home";
import { listPublicMemoryAddresses } from "./public-memory";
import { inSnapshot } from "./snapshot";

afterEach(() => {
  vi.unstubAllEnvs();
});

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

function own<Card extends { slug: string }>(cards: Card[], prefix: string) {
  return cards.filter((card) => card.slug.startsWith(prefix));
}

/** "Recently written", album journals only (the M3.4 assertions). */
async function recentAlbumJournals(
  tx: Parameters<typeof listRecentPublicEntries>[0],
  locale: Parameters<typeof listRecentPublicEntries>[1],
  limit?: number,
): Promise<PublicHomeAlbumJournal[]> {
  return (await listRecentPublicEntries(tx, locale, limit)).filter(
    (entry): entry is PublicHomeAlbumJournal => entry.kind === "album_journal",
  );
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
        "kind",
        "publishedAt",
        "ratingHalfSteps",
        "slug",
      ]);
      expect(card).toEqual({
        kind: "album_journal",
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

      const recent = await recentAlbumJournals(tx, "en");
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

      const recent = own(await recentAlbumJournals(tx, "en", BIG), p);
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
      expect(own(await recentAlbumJournals(tx, "en", BIG), p)).toEqual([]);
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
          own(await recentAlbumJournals(tx, locale, BIG), p).map((card) => [
            card.slug.slice(p.length + 1),
            card.publishedAt,
          ]),
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
      const recent = own(await recentAlbumJournals(tx, "en", BIG), p);
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
        ...own(await recentAlbumJournals(tx, "en", BIG), p),
        ...own(await listPublicAlbums(tx, "en", BIG), p),
      ].map((card) => card.slug);
      expect(slugs).toEqual([`${p}-new`, `${p}-new`]);
    });
  });

  it("names the credited artists in order, and shows a stored cover only in the form Refrain writes", async () => {
    vi.stubEnv("REFRAIN_COVER_DISPLAY_ENABLED", "true");
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
        recentAlbumJournals(tx, "en", BIG).then((cards) => own(cards, p)[0]!);
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
      // The cover display switch off: the fallback, whatever is stored.
      for (const value of [undefined, "false", "TRUE"]) {
        vi.stubEnv("REFRAIN_COVER_DISPLAY_ENABLED", value);
        expect((await card()).artwork, value).toBeNull();
      }
      vi.stubEnv("REFRAIN_COVER_DISPLAY_ENABLED", "true");

      // Anything else in those columns is never an address on the page.
      await tx
        .update(schema.albums)
        .set({ coverUrl: "https://example.com/x.jpg" })
        .where(eq(schema.albums.id, album.albumId));
      expect((await card()).artwork).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// M3.8b (ADR 0006 A6): memories and artists on the Home. Each test dates its
// own rows in 2099 or later, after anything another suite uses, so it owns
// the top of every list; checks that cannot rely on that look only at their
// own slugs and names.

const in2099 = (day: number) => new Date(Date.UTC(2099, 0, day));
const a6run = randomUUID().slice(0, 8);

async function memory(
  tx: Transaction,
  slug: string,
  options: {
    versions?: TestVersion[];
    music?: ({ trackId: string } | { albumId: string })[];
    deletedAt?: Date;
    rememberedWhen?: string;
  } = {},
) {
  const entryId = await createTestMemory(tx, {
    slug,
    versions: options.versions ?? [
      {
        locale: "en",
        status: "published",
        publishedAt: in2099(1),
        title: `[Test] Memory ${slug}`,
        text: `[Test] Writing of ${slug}`,
      },
    ],
    music: options.music,
    deletedAt: options.deletedAt,
  });
  if (options.rememberedWhen !== undefined) {
    await tx.execute(sql`
      update memories set remembered_when = ${options.rememberedWhen}
       where entry_id = ${entryId}`);
  }
  return entryId;
}

const publishedMemory = (day: number, title: string): TestVersion => ({
  locale: "en",
  status: "published",
  publishedAt: in2099(day),
  title,
  text: `[Test] Writing of ${title}`,
});

describe("the Home's chronology (A6)", () => {
  it("lists album journals and memories together, newest first, an album journal before a memory on a tie, then by address", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `a6-chron-${a6run}`;
      const singer = await createTestArtist(tx, uniqueLabel("Singer"));
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Record"),
        trackTitles: ["[Test] First song", "[Test] Second song"],
        artistIds: [singer],
      });
      await tx.execute(sql`
        insert into track_artists (track_id, artist_id, position)
        values (${album.trackIds[0]!}, ${singer}, 1)`);
      await journal(tx, `${p}-j3`, { versions: [published("en", in2099(3))] });
      await journal(tx, `${p}-j5`, { versions: [published("en", in2099(5))] });
      await memory(tx, `${p}-m5`, {
        versions: [publishedMemory(5, "[Test] On the fifth")],
        music: [
          { trackId: album.trackIds[0]! },
          { trackId: album.trackIds[1]! },
        ],
      });
      await memory(tx, `${p}-m6`, {
        versions: [publishedMemory(6, "[Test] On the sixth")],
      });
      await memory(tx, `${p}-m4b`, {
        versions: [publishedMemory(4, "[Test] Fourth b")],
      });
      await memory(tx, `${p}-m4a`, {
        versions: [publishedMemory(4, "[Test] Fourth a")],
      });

      const home = await getPublicHome(tx, "en");
      expect(home.recent.map((entry) => [entry.kind, entry.slug])).toEqual([
        ["memory", `${p}-m6`],
        ["album_journal", `${p}-j5`],
        ["memory", `${p}-m5`],
        ["memory", `${p}-m4a`],
        ["memory", `${p}-m4b`],
      ]);

      // A memory row: its title, the language of the version shown, the
      // first song only (named as its page names it), and the date.
      const singerName = (
        await tx.execute<{ name: string }>(
          sql`select name from artists where id = ${singer}`,
        )
      ).rows[0]!.name;
      const fifth = home.recent[2]!;
      expect(Object.keys(fifth).sort()).toEqual([
        "firstSong",
        "kind",
        "locale",
        "publishedAt",
        "slug",
        "title",
      ]);
      expect(fifth).toEqual({
        kind: "memory",
        slug: `${p}-m5`,
        locale: "en",
        title: "[Test] On the fifth",
        firstSong: { title: "[Test] First song", artists: [singerName] },
        publishedAt: in2099(5),
      });
      expect(JSON.stringify(home.recent)).not.toContain("[Test] Second song");
      // No music: no song.
      expect(home.recent[0]).toMatchObject({ firstSong: null });
    });
  });

  it("never lists an artist journal, and lists memories only at their served addresses", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `a6-kinds-${a6run}`;
      const artist = await createTestArtist(tx, uniqueLabel("Journal subject"));
      await createTestArtistJournal(tx, {
        artistId: artist,
        slug: `${p}-artist-journal`,
        versions: [published("en", in2099(40))],
      });
      const moved = await memory(tx, `${p}-old`, {
        versions: [publishedMemory(39, "[Test] Moved")],
      });
      await changeEntrySlug(tx, moved, `${p}-new`);

      const recent = own(await listRecentPublicEntries(tx, "en", BIG), p);
      expect(recent.map((entry) => entry.slug)).toEqual([`${p}-new`]);
      const served = new Set(await listPublicMemoryAddresses(tx));
      expect(served.has(`${p}-new`)).toBe(true);
    });
  });
});

describe("the Home's memories in every state (A6)", () => {
  const STATUSES = ["draft", "private", "published"] as const;
  const cases: { deleted: boolean; en: string; pt: string | null }[] = [];
  for (const deleted of [false, true]) {
    for (const en of STATUSES) {
      cases.push({ deleted, en, pt: null });
      for (const pt of STATUSES) cases.push({ deleted, en, pt });
    }
  }

  it("lists a memory exactly when the predicate shows it, in the version shown, and never an unpublished translation's words", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `a6-states-${a6run}`;
      const titleOf = (index: number, locale: string, status: string) =>
        `[Test] ${p} ${index} ${locale} ${status}`;
      for (const [index, state] of cases.entries()) {
        const versions: TestVersion[] = [
          {
            locale: "en",
            status: state.en as TestVersion["status"],
            publishedAt: in2099(10),
            title: titleOf(index, "en", state.en),
            text: `${titleOf(index, "en", state.en)} writing`,
          },
        ];
        if (state.pt) {
          versions.push({
            locale: "pt-BR",
            isOriginal: false,
            status: state.pt as TestVersion["status"],
            publishedAt: in2099(11),
            title: titleOf(index, "pt-BR", state.pt),
            text: `${titleOf(index, "pt-BR", state.pt)} escrita`,
          });
        }
        await memory(tx, `${p}-${index}`, {
          versions,
          deletedAt: state.deleted ? new Date() : undefined,
        });
      }
      const recent = new Map(
        own(await listRecentPublicEntries(tx, "en", BIG), p).map((entry) => [
          entry.slug,
          entry,
        ]),
      );
      const archive = new Map(
        own(await listPublicMemoryArchive(tx, "en"), p).map((card) => [
          card.slug,
          card,
        ]),
      );
      for (const [index, state] of cases.entries()) {
        const enVisible = !state.deleted && state.en === "published";
        const ptVisible = !state.deleted && state.pt === "published";
        const shown = enVisible ? "en" : ptVisible ? "pt-BR" : null;
        const entry = recent.get(`${p}-${index}`);
        expect(entry !== undefined, JSON.stringify(state)).toBe(shown !== null);
        expect(archive.has(`${p}-${index}`)).toBe(shown !== null);
        if (entry && entry.kind === "memory" && shown) {
          expect(entry.locale).toBe(shown);
          expect(entry.title).toBe(
            titleOf(index, shown, shown === "en" ? state.en : state.pt!),
          );
          expect(entry.publishedAt).toEqual(
            shown === "en" ? in2099(10) : in2099(11),
          );
        }
      }
      // No words of a version that is not published, anywhere in the lists.
      const text = JSON.stringify([...recent.values(), ...archive.values()]);
      for (const [index, state] of cases.entries()) {
        for (const [locale, status] of [
          ["en", state.en],
          ["pt-BR", state.pt],
        ] as const) {
          if (status && status !== "published") {
            expect(text).not.toContain(titleOf(index, locale, status));
          }
        }
        if (state.deleted) {
          expect(text).not.toContain(`${p} ${index} `);
        }
      }
    });
  });

  it("drops a memory that is unpublished, deleted, or restored, and keeps only the current address of a re-addressed one", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `a6-moves-${a6run}`;
      const gone = await memory(tx, `${p}-gone`, {
        versions: [publishedMemory(20, "[Test] Gone")],
      });
      const restored = await memory(tx, `${p}-restored`, {
        versions: [publishedMemory(21, "[Test] Restored")],
      });
      const moved = await memory(tx, `${p}-moved`, {
        versions: [publishedMemory(22, "[Test] Moved")],
      });
      await unpublishLanguageVersion(tx, testAuthor(), gone, "en", "private");
      await tx.execute(
        sql`update entries set deleted_at = now() where id = ${restored}`,
      );
      await restoreDeletedEntry(tx, restored);
      await changeEntrySlug(tx, moved, `${p}-moved-new`);
      const home = await getPublicHome(tx, "en");
      const slugs = [...home.recent, ...home.memories]
        .map((entry) => entry.slug)
        .filter((slug) => slug.startsWith(p));
      expect(slugs).toEqual([`${p}-moved-new`, `${p}-moved-new`]);
    });
  });
});

describe("the Home's sections are prefixes of the archives (A6)", () => {
  it("holds nothing that its archive or the sitemap does not list, in the archive's order, within the limits", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `a6-prefix-${a6run}`;
      for (let day = 1; day <= 6; day++) {
        await journal(tx, `${p}-j${day}`, {
          versions: [published("en", in2099(60 + day))],
        });
        await memory(tx, `${p}-m${day}`, {
          versions: [publishedMemory(60 + day, `[Test] ${p} memory ${day}`)],
          rememberedWhen: day === 1 ? "  " : `[Test] Summer ${day}`,
        });
      }
      const home = await getPublicHome(tx, "en");
      expect([
        home.recent.length,
        home.albums.length,
        home.artists.length,
        home.memories.length,
      ]).toEqual([
        HOME_RECENT_LIMIT,
        HOME_ALBUM_LIMIT,
        HOME_ARTIST_LIMIT,
        HOME_MEMORY_LIMIT,
      ]);
      expect([HOME_ARTIST_LIMIT, HOME_MEMORY_LIMIT]).toEqual([3, 3]);

      // Recently written: every entry served, and the first of one order.
      const servedJournals = new Set(await listPublicAlbumJournalAddresses(tx));
      const servedMemories = new Set(await listPublicMemoryAddresses(tx));
      for (const entry of home.recent) {
        const served =
          entry.kind === "memory" ? servedMemories : servedJournals;
        expect(served.has(entry.slug), entry.slug).toBe(true);
      }
      expect(home.recent).toEqual(
        (await listRecentPublicEntries(tx, "en", BIG)).slice(0, 5),
      );
      // Memories: exactly the archive's first three.
      expect(home.memories).toEqual(
        (await listPublicMemoryArchive(tx, "en")).slice(0, 3),
      );
      // Albums: every card is the archive's card for that journal's album.
      const albumArchive = await listPublicAlbumArchive(tx, "en");
      for (const card of home.albums) {
        expect(albumArchive.some((album) => album.slug === card.slug)).toBe(
          true,
        );
      }
      // Artists: each is the archive's own card, address and counts alike.
      const artistArchive = new Map(
        (await listPublicArtistArchive(tx)).map((artist) => [
          artist.address,
          artist,
        ]),
      );
      for (const artist of home.artists) {
        expect(artist).toEqual(artistArchive.get(artist.address));
      }
      expect(home.artists).toEqual(
        (await listHomeArtists(tx, "en", BIG)).slice(0, 3),
      );
    });
  });
});

describe("the Home's artists (A6)", () => {
  it("never shows a catalog-only, hidden-only, archived, memory-only, recording-only, artist-journal-only, or photo-only artist", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `a6-hidden-artist-${a6run}`;
      const named = async (label: string) => {
        const name = uniqueLabel(label);
        return { name, id: await createTestArtist(tx, name) };
      };
      const visible = await named("Visible");
      const hidden = {
        catalogOnly: await named("Catalog only"),
        draftOnly: await named("Draft only"),
        privateOnly: await named("Private only"),
        deletedOnly: await named("Deleted only"),
        restoredOnly: await named("Restored only"),
        archived: await named("Archived"),
        memoryOnly: await named("Memory only"),
        recordingOnly: await named("Recording only"),
        journalOnly: await named("Artist journal only"),
        photoOnly: await named("Photo only"),
      };
      const albumJournal = async (
        artistId: string,
        name: string,
        status: "draft" | "private" | "published",
        deletedAt?: Date,
      ) => {
        const album = await createTestAlbum(tx, {
          title: uniqueLabel(name),
          artistIds: [artistId],
        });
        const entryId = await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          slug: `${p}-${name}`,
          deletedAt,
          versions: [{ locale: "en", status, publishedAt: in2099(70) }],
        });
        return { album, entryId };
      };
      const shown = await albumJournal(visible.id, "visible", "published");
      await albumJournal(hidden.draftOnly.id, "draft", "draft");
      await albumJournal(hidden.privateOnly.id, "private", "private");
      await albumJournal(
        hidden.deletedOnly.id,
        "deleted",
        "published",
        new Date(),
      );
      const restored = await albumJournal(
        hidden.restoredOnly.id,
        "restored",
        "published",
        new Date(),
      );
      await restoreDeletedEntry(tx, restored.entryId);
      await albumJournal(hidden.archived.id, "archived", "published");
      await tx.execute(
        sql`update artists set archived_at = now() where id = ${hidden.archived.id}`,
      );
      // Credited only on a recording of an album that has a served journal.
      await tx.execute(sql`
        insert into track_artists (track_id, artist_id, position)
        values (${shown.album.trackIds[0]!}, ${hidden.recordingOnly.id}, 1)`);
      // A published memory with a recording credited to the artist.
      const memoryAlbum = await createTestAlbum(tx, {
        title: uniqueLabel("Memory album"),
      });
      await tx.execute(sql`
        insert into track_artists (track_id, artist_id, position)
        values (${memoryAlbum.trackIds[0]!}, ${hidden.memoryOnly.id}, 1)`);
      await memory(tx, `${p}-memory`, {
        versions: [publishedMemory(70, "[Test] Memory credit")],
        music: [{ trackId: memoryAlbum.trackIds[0]! }],
      });
      await createTestArtistJournal(tx, {
        artistId: hidden.journalOnly.id,
        slug: `${p}-artist-journal`,
        versions: [published("en", in2099(70))],
      });
      await setTestArtistPhoto(tx, hidden.photoOnly.id, GRACE_ARTIST_PHOTO);

      const names = new Set(
        (await listHomeArtists(tx, "en", BIG)).map((artist) => artist.name),
      );
      expect(names.has(visible.name)).toBe(true);
      for (const [reason, artist] of Object.entries(hidden)) {
        expect(names.has(artist.name), reason).toBe(false);
      }
    });
  });

  it("puts the newest served album journal first, then the name, then the address, and counts only served journals", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `a6-artist-order-${a6run}`;
      const artist = async (name: string) =>
        createTestArtist(tx, `[Test] ${a6run} ${name}`);
      const alpha = await artist("Alpha");
      const beta = await artist("beta");
      const gamma = await artist("Gamma");
      const delta = await artist("Delta");
      const credited = async (artistIds: string[], label: string) =>
        (
          await createTestAlbum(tx, {
            title: uniqueLabel(label),
            artistIds,
          })
        ).albumId;
      const day = (n: number) => [published("en", in2099(n))];
      // Alpha and beta tie on the newest date: by name, case aside.
      await journal(tx, `${p}-beta`, {
        albumId: await credited([beta], "beta"),
        versions: day(90),
      });
      await journal(tx, `${p}-alpha`, {
        albumId: await credited([alpha], "alpha"),
        versions: day(90),
      });
      // Gamma: a newer journal that is only a draft, and a newer one that is
      // deleted, never date it; its served journal does.
      const gammaAlbum = await credited([gamma], "gamma");
      await journal(tx, `${p}-gamma`, {
        albumId: gammaAlbum,
        versions: day(85),
      });
      await journal(tx, `${p}-gamma-draft`, {
        albumId: gammaAlbum,
        versions: [{ locale: "en", status: "draft" }],
      });
      await journal(tx, `${p}-gamma-deleted`, {
        albumId: gammaAlbum,
        versions: day(99),
        deletedAt: new Date(),
      });
      // Delta: two albums, one with two served journals and a private one.
      const deltaOne = await credited([delta], "delta one");
      const deltaTwo = await credited([delta], "delta two");
      await journal(tx, `${p}-delta-1a`, {
        albumId: deltaOne,
        versions: day(80),
      });
      await journal(tx, `${p}-delta-1b`, {
        albumId: deltaOne,
        versions: day(81),
      });
      await journal(tx, `${p}-delta-1c`, {
        albumId: deltaOne,
        versions: [{ locale: "en", status: "private" }],
      });
      await journal(tx, `${p}-delta-2`, {
        albumId: deltaTwo,
        versions: day(82),
      });
      // And two albums that never count: one with only a draft journal, one
      // with no journal at all.
      await journal(tx, `${p}-delta-draft`, {
        albumId: await credited([delta], "delta draft"),
        versions: [{ locale: "en", status: "draft" }],
      });
      await credited([delta], "delta catalog only");

      const mine = (await listHomeArtists(tx, "en", BIG)).filter((card) =>
        card.name.startsWith(`[Test] ${a6run} `),
      );
      expect(
        mine.map((card) => [
          card.name.slice(`[Test] ${a6run} `.length),
          card.albumCount,
          card.journalCount,
        ]),
      ).toEqual([
        ["Alpha", 1, 1],
        ["beta", 1, 1],
        ["Gamma", 1, 1],
        ["Delta", 2, 3],
      ]);
      // The same order every time.
      expect(
        (await listHomeArtists(tx, "en", BIG)).filter((card) =>
          card.name.startsWith(`[Test] ${a6run} `),
        ),
      ).toEqual(mine);
      // No identifier and no date in what the Home receives.
      expect(Object.keys(mine[0]!).sort()).toEqual([
        "address",
        "albumCount",
        "journalCount",
        "name",
      ]);
      for (const id of [alpha, beta, gamma, delta]) {
        expect(JSON.stringify(mine)).not.toContain(id);
      }
    });
  });

  it("gives a namesake the address its page answers at, computed over every visible artist before the limit", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `a6-namesake-${a6run}`;
      const name = uniqueLabel("Namesake");
      const newest = await createTestArtist(tx, name);
      const oldest = await createTestArtist(tx, name);
      const albumOf = async (artistId: string) =>
        (
          await createTestAlbum(tx, {
            title: uniqueLabel("Namesake album"),
            artistIds: [artistId],
          })
        ).albumId;
      await journal(tx, `${p}-newest`, {
        albumId: await albumOf(newest),
        versions: [published("en", in2099(200))],
      });
      // Three other artists between them, so the oldest namesake is not in
      // the Home's three.
      for (const n of [150, 151, 152]) {
        await journal(tx, `${p}-between-${n}`, {
          versions: [published("en", in2099(n))],
        });
      }
      await journal(tx, `${p}-oldest`, {
        albumId: await albumOf(oldest),
        versions: [published("en", in2099(100))],
      });

      const home = await getPublicHome(tx, "en");
      const shown = home.artists.filter((artist) => artist.name === name);
      expect(shown).toHaveLength(1);
      const addresses = await publicArtistAddresses(tx);
      expect(shown[0]!.address).toBe(addresses.get(newest));
      // While two visible artists share the name, neither has the bare one.
      expect(shown[0]!.address).not.toBe(artistAddressBase(name));
      expect(
        (await listPublicArtistArchive(tx)).find(
          (artist) => artist.address === shown[0]!.address,
        )?.name,
      ).toBe(name);
      expect(home.artists.some((artist) => artist.name !== name)).toBe(true);
    });
  });
});

describe("the Home's memory excerpts (A6)", () => {
  it("returns only the bounded excerpt of the version shown, never the rest of the writing", async () => {
    await inRollbackTransaction(async (tx) => {
      const p = `a6-excerpt-${a6run}`;
      const long = `[Test] ${"lantern ".repeat(80)}`.trim();
      const entryId = await memory(tx, `${p}-long`, {
        versions: [publishedMemory(300, "[Test] Long memory")],
      });
      const paragraph = (text: string) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      });
      const body = {
        type: "doc",
        content: [
          paragraph(long),
          paragraph("[Test] SECOND-PARAGRAPH-MARKER"),
          ...Array.from({ length: 15 }, () => ({ type: "paragraph" })),
          paragraph("[Test] BLOCK-18-MARKER"),
        ],
      };
      await tx.execute(sql`
        update entry_texts set body = ${JSON.stringify(body)}::jsonb
         where entry_id = ${entryId}`);
      // A memory whose writing is not a document the renderer reads.
      const odd = await memory(tx, `${p}-odd`, {
        versions: [publishedMemory(299, "[Test] Odd memory")],
      });
      await tx.execute(sql`
        update entry_texts
           set body = ${JSON.stringify({ type: "doc", content: [{ type: "heading", content: "not an array" }] })}::jsonb
         where entry_id = ${odd}`);

      const home = await getPublicHome(tx, "en");
      const card = home.memories.find((row) => row.slug === `${p}-long`)!;
      expect(card.excerpt!.length).toBeLessThanOrEqual(241);
      expect(card.excerpt!.endsWith("…")).toBe(true);
      expect(
        home.memories.find((row) => row.slug === `${p}-odd`)!.excerpt,
      ).toBeNull();
      const text = JSON.stringify(home);
      expect(text).not.toContain(long);
      expect(text).not.toContain("SECOND-PARAGRAPH-MARKER");
      expect(text).not.toContain("BLOCK-18-MARKER");
      expect(Object.keys(card).sort()).toEqual([
        "excerpt",
        "locale",
        "music",
        "publishedAt",
        "rememberedWhen",
        "slug",
        "title",
      ]);
    });
  });
});

// One snapshot for the whole Home (A6, item 8), over real connections: the
// rows are committed to the disposable test database and removed at the end.
const committed: { entries: string[]; albums: TestAlbum[] } = {
  entries: [],
  albums: [],
};

afterAll(async () => {
  await getDb().transaction(async (tx) => {
    for (const entryId of committed.entries) {
      await tx.execute(
        sql`delete from entry_slugs where entry_id = ${entryId}`,
      );
      await tx.execute(sql`delete from entries where id = ${entryId}`);
    }
    for (const album of committed.albums) {
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

describe("the Home's snapshot (A6, item 8)", () => {
  it("is a read-only REPEATABLE READ transaction", async () => {
    await withConnections(1, async ([reader]) => {
      const settings = await inSnapshot(
        reader!,
        async (snapshot) =>
          (
            await snapshot.execute<{
              isolation: string;
              read_only: string;
            }>(sql`
            select current_setting('transaction_isolation') as isolation,
                   current_setting('transaction_read_only') as read_only`)
          ).rows[0],
      );
      expect(settings).toEqual({
        isolation: "repeatable read",
        read_only: "on",
      });
      const write = await inSnapshot(reader!, (snapshot) =>
        snapshot.execute(sql`create temporary table a6_probe (x int)`),
      ).then(
        () => null,
        (error: unknown) => databaseErrorOf(error)?.code,
      );
      expect(write).toBe("25006");
    });
  });

  it("shows every section as of one moment: an unpublication committed during a read is seen from the next request", async () => {
    const slug = `a6-snapshot-${a6run}`;
    const entryId = await committedMemory(slug, "published");
    await withConnections(2, async ([reader, writer]) => {
      const watched = watchedReader(reader!, () =>
        unpublishLanguageVersion(
          writer!,
          testAuthor(),
          entryId,
          "en",
          "private",
        ),
      );
      const during = await getPublicHome(watched.db, "en");
      expect(watched.options()).toEqual({
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
      expect(watched.statements()).toBeGreaterThan(1);
      // Every section agrees: the memory as it was when the snapshot began,
      // with its music read in the same snapshot.
      expect(during.recent[0]?.slug).toBe(slug);
      expect(during.memories[0]?.slug).toBe(slug);
      expect(during.memories[0]?.music).toHaveLength(1);

      const after = await getPublicHome(reader!, "en");
      expect(
        [...after.recent, ...after.memories].some((row) => row.slug === slug),
      ).toBe(false);
    });
  });

  it("shows every section as of one moment: a publication committed during a read is seen from the next request", async () => {
    const slug = `a6-snapshot-publish-${a6run}`;
    const entryId = await committedMemory(slug, "private");
    await withConnections(2, async ([reader, writer]) => {
      const watched = watchedReader(reader!, async () => {
        await publishForTest(writer!, entryId, "en");
        // Dated after anything another suite uses, so it would lead both
        // lists if any statement saw it.
        await writer!.execute(sql`
          update entry_texts set published_at = ${SNAPSHOT_DATE}
           where entry_id = ${entryId} and locale = 'en'`);
      });
      const during = await getPublicHome(watched.db, "en");
      expect(watched.statements()).toBeGreaterThan(1);
      // No section saw it: the snapshot began before it was published.
      expect(
        [...during.recent, ...during.memories].some((row) => row.slug === slug),
      ).toBe(false);

      const after = await getPublicHome(reader!, "en");
      expect(after.recent[0]?.slug).toBe(slug);
      expect(after.memories[0]?.slug).toBe(slug);
      expect(after.memories[0]?.music).toHaveLength(1);
    });
  });
});

const SNAPSHOT_DATE = new Date(Date.UTC(2100, 0, 1));

/** A memory with one album link, committed, and removed after the file. */
async function committedMemory(
  slug: string,
  status: "published" | "private",
): Promise<string> {
  return getDb().transaction(async (tx) => {
    const album = await createTestAlbum(tx, {
      title: uniqueLabel("Snapshot album"),
    });
    committed.albums.push(album);
    const entryId = await memory(tx, slug, {
      versions: [
        {
          locale: "en",
          status,
          publishedAt: SNAPSHOT_DATE,
          title: "[Test] Snapshot memory",
          text: "[Test] Snapshot writing",
        },
      ],
      music: [{ albumId: album.albumId }],
    });
    committed.entries.push(entryId);
    return entryId;
  });
}

/**
 * The reader's connection, with `afterFirst` committed on another connection
 * right after the first statement of the next transaction it opens: as a
 * concurrent change committing in the middle of a request would.
 */
function watchedReader(reader: Database, afterFirst: () => Promise<unknown>) {
  let statements = 0;
  let options: unknown;
  const db = new Proxy(reader, {
    get(target, property, receiver) {
      if (property !== "transaction") {
        return Reflect.get(target, property, receiver);
      }
      return (work: (tx: Transaction) => Promise<unknown>, config: unknown) => {
        options = config;
        return target.transaction(
          (tx) =>
            work(
              new Proxy(tx, {
                get(inner, name, innerReceiver) {
                  if (name !== "execute") {
                    return Reflect.get(inner, name, innerReceiver);
                  }
                  return async (query: Parameters<typeof tx.execute>[0]) => {
                    const result = await inner.execute(query);
                    statements += 1;
                    if (statements === 1) {
                      await afterFirst();
                    }
                    return result;
                  };
                },
              }),
            ),
          config as Parameters<typeof target.transaction>[1],
        );
      };
    },
  });
  return { db, statements: () => statements, options: () => options };
}
