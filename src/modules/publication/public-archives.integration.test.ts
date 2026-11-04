import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  schema,
  type Locale,
  type Transaction,
  type VisibilityStatus,
} from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestArtistJournal,
  createTestMemory,
  createTestTrackReflection,
  inRollbackTransaction,
  testAuthor,
  uniqueLabel,
  type TestVersion,
} from "@/testing";
import {
  GRACE_ARTIST_PHOTO,
  setTestArtistPhoto,
} from "@/testing/public-artists";

import { artistAddressBase } from "./artist-address";
import {
  changeEntrySlug,
  restoreDeletedEntry,
  unpublishLanguageVersion,
} from "./commands";
import {
  listPublicAlbumArchive,
  listPublicArtistArchive,
  listPublicMemoryArchive,
} from "./public-archives";
import { listPublicAlbumJournalAddresses } from "./public-album-journal";
import { listPublicArtistAddresses } from "./public-artist";
import { listRecentPublicAlbumJournals } from "./public-home";
import { listPublicMemoryAddresses } from "./public-memory";
import { publicArtistAddresses } from "./queries";

// The public archives' read models (M3.8a) against real PostgreSQL, each
// compared with an independent account of the publication predicate written
// here in plain TypeScript, and with the addresses the sitemap lists (the
// served-address rule every detail page answers by). Other suites can commit
// rows to the shared test database, so every name and address here is unique
// to the run, and each check looks only at its own rows.

const author = testAuthor();
const STATUSES: VisibilityStatus[] = ["draft", "private", "published"];
const run = randomUUID().slice(0, 8);
const slugOf = (name: string) => `archive-${run}-${name}`;

interface State {
  deleted: boolean;
  en: VisibilityStatus;
  pt: VisibilityStatus | null;
  original: Locale;
  flag: boolean;
  enText: boolean;
}

function states(): State[] {
  const all: State[] = [];
  for (const deleted of [false, true]) {
    for (const en of STATUSES) {
      for (const pt of [null, ...STATUSES]) {
        for (const original of ["en", "pt-BR"] as const) {
          if (pt === null && original === "pt-BR") continue;
          for (const flag of [false, true]) {
            for (const enText of [false, true]) {
              all.push({ deleted, en, pt, original, flag, enText });
            }
          }
        }
      }
    }
  }
  return all;
}

const PUBLISHED_ON = {
  en: new Date("2026-01-05T00:00:00Z"),
  "pt-BR": new Date("2026-02-05T00:00:00Z"),
} as const;

/** The predicate and ADR 0002 D1.2's version choice, for an English reader. */
function oracle(state: Omit<State, "flag" | "enText">) {
  const visible = (status: VisibilityStatus | null) =>
    !state.deleted && status === "published";
  const en = visible(state.en);
  const pt = visible(state.pt);
  if (!en && !pt) return null;
  const originalVisible = state.original === "en" ? en : pt;
  const locale: Locale = en ? "en" : originalVisible ? state.original : "pt-BR";
  return { locale };
}

function versionsOf(state: Omit<State, "flag" | "enText">): TestVersion[] {
  const versions: TestVersion[] = [
    {
      locale: "en",
      status: state.en,
      isOriginal: state.original === "en",
      text: "[Test] English body",
      title: "[Test] English title",
      publishedAt: PUBLISHED_ON.en,
    },
  ];
  if (state.pt !== null) {
    versions.push({
      locale: "pt-BR",
      status: state.pt,
      isOriginal: state.original === "pt-BR",
      text: "[Test] Portuguese body",
      title: "[Test] Portuguese title",
      publishedAt: PUBLISHED_ON["pt-BR"],
    });
  }
  return versions;
}

describe("the Albums and Artists archives in every state of a journal", () => {
  it("are exactly what the independent oracle says, for every combination", async () => {
    const all = states();
    expect(all.length).toBeGreaterThan(150);
    const mismatches: string[] = [];

    await inRollbackTransaction(async (tx) => {
      const shared = uniqueLabel("Shared artist");
      const sharedId = await createTestArtist(tx, shared);
      const own: string[] = [];
      for (const [index, state] of all.entries()) {
        const ownName = uniqueLabel(`Artist ${index}`);
        own.push(ownName);
        const ownId = await createTestArtist(tx, ownName);
        const album = await createTestAlbum(tx, {
          title: `[Test] Album ${run} ${index}`,
          trackTitles: ["[Test] A", "[Test] B", "[Test] C"],
          artistIds: [ownId, sharedId],
        });
        const entryId = await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          versions: versionsOf(state),
          slug: slugOf(`m${index}`),
          ratingHalfSteps: 7,
          deletedAt: state.deleted ? new Date() : undefined,
        });
        await createTestTrackReflection(tx, {
          albumJournalId: entryId,
          albumId: album.albumId,
          trackId: album.trackIds[1]!,
          isPublished: state.flag,
          texts: {
            ...(state.enText ? { en: "[Test] en reflection" } : {}),
            ...(state.pt !== null ? { "pt-BR": "[Test] pt reflection" } : {}),
          },
        });
      }

      const archive = await listPublicAlbumArchive(tx, "en");
      const cards = new Map(archive.map((card) => [card.slug, card]));
      const artists = new Map(
        (await listPublicArtistArchive(tx)).map((artist) => [
          artist.name,
          artist,
        ]),
      );
      let visibleCount = 0;
      for (const [index, state] of all.entries()) {
        const want = oracle(state);
        const label = JSON.stringify(state);
        const card = cards.get(slugOf(`m${index}`));
        const artist = artists.get(own[index]!);
        if (want === null) {
          if (card) mismatches.push(`${label}: the archive listed it`);
          if (artist) mismatches.push(`${label}: its artist was listed`);
          continue;
        }
        visibleCount += 1;
        if (!card) {
          mismatches.push(`${label}: the archive lacks it`);
          continue;
        }
        if (card.publishedAt.getTime() !== PUBLISHED_ON[want.locale].getTime())
          mismatches.push(`${label}: dated another version`);
        if (card.ratingHalfSteps !== 7)
          mismatches.push(`${label}: rating ${card.ratingHalfSteps}`);
        if (card.trackCount !== 3)
          mismatches.push(`${label}: ${card.trackCount} tracks`);
        const hasText = want.locale === "en" ? state.enText : true;
        const written = state.flag && hasText ? 1 : 0;
        if (card.writtenTrackCount !== written)
          mismatches.push(`${label}: ${card.writtenTrackCount} written`);
        if (card.otherJournals.length !== 0)
          mismatches.push(`${label}: other journals listed`);
        if (!artist) {
          mismatches.push(`${label}: its artist is missing`);
        } else if (artist.albumCount !== 1 || artist.journalCount !== 1) {
          mismatches.push(`${label}: its artist's counts`);
        }
      }
      const sharedCard = artists.get(shared);
      expect(sharedCard?.albumCount).toBe(visibleCount);
      expect(sharedCard?.journalCount).toBe(visibleCount);

      // Every address the archive links to is one the sitemap lists, and
      // every album journal the sitemap lists is reachable from the archive.
      const linked = archive.flatMap((card) => [
        card.slug,
        ...card.otherJournals.map((journal) => journal.slug),
      ]);
      expect(new Set(linked).size).toBe(linked.length);
      expect([...linked].sort()).toEqual(
        [...(await listPublicAlbumJournalAddresses(tx))].sort(),
      );
      // And the artists are exactly the ones with a page, at their address.
      const archived = await listPublicArtistArchive(tx);
      expect(archived.map((artist) => artist.address).sort()).toEqual(
        [...(await listPublicArtistAddresses(tx))].sort(),
      );
    });

    expect(mismatches).toEqual([]);
  }, 60_000);
});

async function publishedJournal(
  tx: Transaction,
  albumId: string,
  name: string,
  options: {
    publishedAt: Date;
    isFeatured?: boolean;
    status?: VisibilityStatus;
    deletedAt?: Date;
  },
) {
  return createTestAlbumJournal(tx, {
    albumId,
    slug: slugOf(name),
    isFeatured: options.isFeatured,
    deletedAt: options.deletedAt,
    versions: [
      {
        locale: "en",
        status: options.status ?? "published",
        publishedAt: options.publishedAt,
      },
    ],
  });
}

describe("the Albums archive keeps every served journal reachable", () => {
  it("shows an album once, opening its presented journal, with every other served one under it", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistName = uniqueLabel("Several");
      const artist = await createTestArtist(tx, artistName);
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Several journals"),
        artistIds: [artist],
      });
      await publishedJournal(tx, album.albumId, "first", {
        publishedAt: new Date("2026-03-01T00:00:00Z"),
      });
      await publishedJournal(tx, album.albumId, "second", {
        publishedAt: new Date("2026-03-02T00:00:00Z"),
      });
      await publishedJournal(tx, album.albumId, "third", {
        publishedAt: new Date("2026-03-03T00:00:00Z"),
      });
      // Never listed: a draft, a private one, and a deleted one.
      await publishedJournal(tx, album.albumId, "draft", {
        publishedAt: new Date("2026-03-04T00:00:00Z"),
        status: "draft",
      });
      await publishedJournal(tx, album.albumId, "private", {
        publishedAt: new Date("2026-03-04T00:00:00Z"),
        status: "private",
      });
      await publishedJournal(tx, album.albumId, "deleted", {
        publishedAt: new Date("2026-03-05T00:00:00Z"),
        deletedAt: new Date(),
      });

      const mine = (await listPublicAlbumArchive(tx, "en")).filter((card) =>
        card.slug.startsWith(slugOf("")),
      );
      expect(mine).toHaveLength(1);
      // No journal is featured: the most recently published is presented.
      expect(mine[0]!.slug).toBe(slugOf("third"));
      expect(mine[0]!.otherJournals.map((journal) => journal.slug)).toEqual([
        slugOf("second"),
        slugOf("first"),
      ]);
      expect(mine[0]!.otherJournals[0]!.publishedAt).toEqual(
        new Date("2026-03-02T00:00:00Z"),
      );

      // The artist has one album, written about three times.
      const card = (await listPublicArtistArchive(tx)).find(
        (row) => row.name === artistName,
      );
      expect(card).toMatchObject({ albumCount: 1, journalCount: 3 });
    });
  });

  it("opens the featured journal when it is visible, and the newest one when it is not", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Featured"),
      });
      const featured = await publishedJournal(tx, album.albumId, "featured", {
        publishedAt: new Date("2026-03-01T00:00:00Z"),
        isFeatured: true,
      });
      await publishedJournal(tx, album.albumId, "newer", {
        publishedAt: new Date("2026-03-09T00:00:00Z"),
      });
      const read = async () =>
        (await listPublicAlbumArchive(tx, "en")).filter((card) =>
          card.slug.startsWith(slugOf("")),
        );
      let mine = await read();
      expect(mine.map((card) => card.slug)).toEqual([slugOf("featured")]);
      expect(mine[0]!.otherJournals.map((journal) => journal.slug)).toEqual([
        slugOf("newer"),
      ]);

      await unpublishLanguageVersion(tx, author, featured, "en", "private");
      mine = await read();
      expect(mine.map((card) => card.slug)).toEqual([slugOf("newer")]);
      expect(mine[0]!.otherJournals).toEqual([]);
    });
  });

  it("lists journals beyond the Home's recent limit, unpublished, retired, deleted, and restored ones as their state says", async () => {
    await inRollbackTransaction(async (tx) => {
      const ids: string[] = [];
      for (let index = 0; index < 8; index += 1) {
        const album = await createTestAlbum(tx, {
          title: uniqueLabel(`Shelf ${index}`),
        });
        ids.push(
          await publishedJournal(tx, album.albumId, `shelf-${index}`, {
            // In the far future, so these are the newest rows of the database
            // and fill the Home's five.
            publishedAt: new Date(Date.UTC(2090, 0, 1 + index)),
          }),
        );
      }
      const mine = async () =>
        (await listPublicAlbumArchive(tx, "en"))
          .map((card) => card.slug)
          .filter((slug) => slug.startsWith(slugOf("")));

      const recent = (await listRecentPublicAlbumJournals(tx, "en")).map(
        (card) => card.slug,
      );
      expect(recent).toHaveLength(5);
      expect(recent).not.toContain(slugOf("shelf-0"));
      // The archive still has all eight, the newest first.
      expect(await mine()).toEqual(
        [7, 6, 5, 4, 3, 2, 1, 0].map((index) => slugOf(`shelf-${index}`)),
      );

      // Unpublished: gone. Re-addressed: listed at its current address only.
      await unpublishLanguageVersion(tx, author, ids[0]!, "en", "private");
      await changeEntrySlug(tx, ids[1]!, slugOf("renamed"));
      // Deleted: gone; restored: still gone, because a restore makes it
      // private (ADR 0005).
      await tx.execute(
        sql`update entries set deleted_at = now() where id in (${ids[2]!}, ${ids[3]!})`,
      );
      await restoreDeletedEntry(tx, ids[3]!);

      const after = await mine();
      expect(after).not.toContain(slugOf("shelf-0"));
      expect(after).not.toContain(slugOf("shelf-1"));
      expect(after).toContain(slugOf("renamed"));
      expect(after).not.toContain(slugOf("shelf-2"));
      expect(after).not.toContain(slugOf("shelf-3"));
      expect(after).toHaveLength(5);
    });
  });

  it("counts only public reflections on the reference edition's tracks, in the version shown", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Counted"),
        trackTitles: ["[Test] 1", "[Test] 2", "[Test] 3", "[Test] 4"],
      });
      const entryId = await publishedJournal(tx, album.albumId, "counted", {
        publishedAt: new Date("2026-04-01T00:00:00Z"),
      });
      const reflect = (index: number, isPublished: boolean, en: boolean) =>
        createTestTrackReflection(tx, {
          albumJournalId: entryId,
          albumId: album.albumId,
          trackId: album.trackIds[index]!,
          isPublished,
          texts: en ? { en: "[Test] text" } : { "pt-BR": "[Test] texto" },
        });
      await reflect(0, true, true); // counted
      await reflect(1, false, true); // not included when published
      await reflect(2, true, false); // only in a language that is not public
      await reflect(3, true, true); // counted
      const card = (await listPublicAlbumArchive(tx, "en")).find(
        (row) => row.slug === slugOf("counted"),
      )!;
      expect(card.trackCount).toBe(4);
      expect(card.writtenTrackCount).toBe(2);
    });
  });

  it("returns a projection with no identifier, status, or writing", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, { title: uniqueLabel("Shape") });
      await publishedJournal(tx, album.albumId, "shape-a", {
        publishedAt: new Date("2026-04-01T00:00:00Z"),
      });
      await publishedJournal(tx, album.albumId, "shape-b", {
        publishedAt: new Date("2026-04-02T00:00:00Z"),
      });
      const card = (await listPublicAlbumArchive(tx, "en")).find(
        (row) => row.slug === slugOf("shape-b"),
      )!;
      expect(Object.keys(card).sort()).toEqual([
        "albumTitle",
        "artwork",
        "credits",
        "firstReleaseYear",
        "otherJournals",
        "publishedAt",
        "ratingHalfSteps",
        "slug",
        "trackCount",
        "writtenTrackCount",
      ]);
      expect(Object.keys(card.otherJournals[0]!).sort()).toEqual([
        "publishedAt",
        "slug",
      ]);
    });
  });
});

describe("the Artists archive lists exactly the artists whose page is served", () => {
  it("never a catalog-only, private-only, deleted-only, archived, memory-only, artist-journal-only, or photo-only artist", async () => {
    await inRollbackTransaction(async (tx) => {
      const named = async (label: string) => {
        const name = uniqueLabel(label);
        return { name, id: await createTestArtist(tx, name) };
      };
      const visible = await named("Visible");
      const catalogOnly = await named("Catalog only");
      const draftOnly = await named("Draft only");
      const privateOnly = await named("Private only");
      const deletedOnly = await named("Deleted only");
      const archived = await named("Archived");
      const memoryOnly = await named("Memory only");
      const journalOnly = await named("Artist journal only");
      const photoOnly = await named("Photo only");

      const journal = async (
        artistId: string,
        name: string,
        status: VisibilityStatus,
        deletedAt?: Date,
      ) => {
        const album = await createTestAlbum(tx, {
          title: uniqueLabel(name),
          artistIds: [artistId],
        });
        await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          slug: slugOf(name),
          deletedAt,
          versions: [{ locale: "en", status }],
        });
        return album;
      };
      await journal(visible.id, "visible", "published");
      await journal(draftOnly.id, "draft-only", "draft");
      await journal(privateOnly.id, "private-only", "private");
      await journal(deletedOnly.id, "deleted-only", "published", new Date());
      await journal(archived.id, "archived", "published");
      await tx.execute(
        sql`update artists set archived_at = now() where id = ${archived.id}`,
      );
      // A published memory with a recording credited to the artist, on an
      // album that has no journal.
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Memory album"),
      });
      await tx.execute(sql`
        insert into track_artists (track_id, artist_id, position)
        values (${album.trackIds[0]!}, ${memoryOnly.id}, 1)`);
      await createTestMemory(tx, {
        slug: slugOf("memory-only"),
        versions: [{ locale: "en", status: "published" }],
        music: [{ trackId: album.trackIds[0]! }],
      });
      await createTestArtistJournal(tx, {
        artistId: journalOnly.id,
        slug: slugOf("artist-journal"),
        versions: [{ locale: "en", status: "published" }],
      });
      await setTestArtistPhoto(tx, photoOnly.id, GRACE_ARTIST_PHOTO);

      const names = new Set(
        (await listPublicArtistArchive(tx)).map((artist) => artist.name),
      );
      expect(names.has(visible.name)).toBe(true);
      for (const hidden of [
        catalogOnly,
        draftOnly,
        privateOnly,
        deletedOnly,
        archived,
        memoryOnly,
        journalOnly,
        photoOnly,
      ]) {
        expect(names.has(hidden.name), hidden.name).toBe(false);
      }
    });
  });

  it("gives namesakes the addresses their pages answer at, unaffected by a hidden namesake", async () => {
    await inRollbackTransaction(async (tx) => {
      const name = uniqueLabel("Namesake");
      const first = await createTestArtist(tx, name);
      const second = await createTestArtist(tx, name);
      const lone = uniqueLabel("Lone");
      const loneId = await createTestArtist(tx, lone);
      // A catalog-only namesake of the lone artist: it must not change the
      // lone artist's bare address.
      await createTestArtist(tx, lone);
      for (const [index, artistId] of [first, second, loneId].entries()) {
        const album = await createTestAlbum(tx, {
          title: uniqueLabel(`Namesake album ${index}`),
          artistIds: [artistId],
        });
        await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          slug: slugOf(`namesake-${index}`),
          versions: [{ locale: "en", status: "published" }],
        });
      }
      const pages = await publicArtistAddresses(tx);
      const archive = await listPublicArtistArchive(tx);
      const byAddress = new Map(archive.map((row) => [row.address, row]));
      for (const artistId of [first, second, loneId]) {
        const address = pages.get(artistId)!;
        expect(byAddress.has(address), address).toBe(true);
      }
      expect(pages.get(first)).not.toBe(pages.get(second));
      expect(pages.get(first)).not.toBe(artistAddressBase(name));
      expect(pages.get(loneId)).toBe(artistAddressBase(lone));
    });
  });

  it("is in alphabetical order, whatever the case, with counts of albums and journals", async () => {
    await inRollbackTransaction(async (tx) => {
      const tag = randomUUID().slice(0, 6);
      const names = [`zz ${tag} b`, `ZZ ${tag} a`, `zz ${tag} C`];
      const ids = [];
      for (const name of names) ids.push(await createTestArtist(tx, name));
      // The first artist: two albums, one written about twice.
      for (const [index, journals] of [2, 1].entries()) {
        const album = await createTestAlbum(tx, {
          title: uniqueLabel(`Counts ${index}`),
          artistIds: [ids[0]!],
        });
        for (let n = 0; n < journals; n += 1) {
          await createTestAlbumJournal(tx, {
            albumId: album.albumId,
            slug: slugOf(`counts-${index}-${n}`),
            versions: [{ locale: "en", status: "published" }],
          });
        }
      }
      for (const [index, artistId] of ids.slice(1).entries()) {
        const album = await createTestAlbum(tx, {
          title: uniqueLabel(`Order ${index}`),
          artistIds: [artistId],
        });
        await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          slug: slugOf(`order-${index}`),
          versions: [{ locale: "en", status: "published" }],
        });
      }
      const mine = (await listPublicArtistArchive(tx)).filter((row) =>
        row.name.toLowerCase().startsWith(`zz ${tag}`),
      );
      expect(mine.map((row) => row.name)).toEqual([
        `ZZ ${tag} a`,
        `zz ${tag} b`,
        `zz ${tag} C`,
      ]);
      expect(mine[1]).toMatchObject({ albumCount: 2, journalCount: 3 });
      expect(Object.keys(mine[0]!).sort()).toEqual([
        "address",
        "albumCount",
        "journalCount",
        "name",
      ]);
    });
  });
});

describe("the Memories archive", () => {
  const cases: { deleted: boolean; statuses: VisibilityStatus[] }[] = [];
  for (const deleted of [false, true]) {
    for (const en of STATUSES) {
      cases.push({ deleted, statuses: [en] });
      for (const pt of STATUSES) cases.push({ deleted, statuses: [en, pt] });
    }
  }

  it("lists a memory exactly when the oracle says, in the version it chooses", async () => {
    await inRollbackTransaction(async (tx) => {
      for (const [index, state] of cases.entries()) {
        await createTestMemory(tx, {
          slug: slugOf(`memory-${index}`),
          deletedAt: state.deleted ? new Date() : undefined,
          versions: state.statuses.map((status, position) => ({
            locale: position === 0 ? "en" : "pt-BR",
            status,
            title: position === 0 ? "[Test] Title en" : "[Test] Título pt",
            text: position === 0 ? "[Test] Writing en" : "[Test] Escrita pt",
            publishedAt:
              position === 0 ? PUBLISHED_ON.en : PUBLISHED_ON["pt-BR"],
          })),
        });
      }
      const listed = new Map(
        (await listPublicMemoryArchive(tx, "en")).map((card) => [
          card.slug,
          card,
        ]),
      );
      const served = new Set(await listPublicMemoryAddresses(tx));
      for (const [index, state] of cases.entries()) {
        const slug = slugOf(`memory-${index}`);
        const want = oracle({
          deleted: state.deleted,
          en: state.statuses[0]!,
          pt: state.statuses[1] ?? null,
          original: "en",
        });
        const card = listed.get(slug);
        expect(card !== undefined, JSON.stringify(state)).toBe(want !== null);
        expect(served.has(slug)).toBe(want !== null);
        if (card && want) {
          expect(card.locale).toBe(want.locale);
          expect(card.title).toBe(
            want.locale === "en" ? "[Test] Title en" : "[Test] Título pt",
          );
          expect(card.excerpt).toBe(
            want.locale === "en" ? "[Test] Writing en" : "[Test] Escrita pt",
          );
          expect(card.publishedAt).toEqual(PUBLISHED_ON[want.locale]);
        }
      }
    });
  });

  it("is ordered by the publication date of the version shown, ties by address, and follows unpublishing, deleting, restoring, and re-addressing", async () => {
    await inRollbackTransaction(async (tx) => {
      const at = (day: number) => new Date(Date.UTC(2091, 0, day));
      const make = (name: string, day: number) =>
        createTestMemory(tx, {
          slug: slugOf(name),
          versions: [
            { locale: "en", status: "published", publishedAt: at(day) },
          ],
        });
      const a = await make("order-a", 1);
      await make("order-c", 3);
      await make("order-b2", 2);
      await make("order-b1", 2);
      const gone = await make("order-gone", 4);
      const restored = await make("order-restored", 5);
      const renamed = await make("order-renamed", 6);

      await unpublishLanguageVersion(tx, author, gone, "en", "private");
      await tx.execute(
        sql`update entries set deleted_at = now() where id = ${restored}`,
      );
      await restoreDeletedEntry(tx, restored);
      await changeEntrySlug(tx, renamed, slugOf("order-new-address"));

      const mine = (await listPublicMemoryArchive(tx, "en"))
        .map((card) => card.slug)
        .filter((slug) => slug.startsWith(slugOf("order-")));
      expect(mine).toEqual([
        slugOf("order-new-address"),
        slugOf("order-c"),
        slugOf("order-b1"),
        slugOf("order-b2"),
        slugOf("order-a"),
      ]);
      expect(a).toBeTruthy();
    });
  });

  it("names the music as the memory page does, and holds no identifier or whole writing", async () => {
    await inRollbackTransaction(async (tx) => {
      const artist = await createTestArtist(tx, uniqueLabel("Singer"));
      const albumArtist = await createTestArtist(tx, uniqueLabel("Band"));
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Record"),
        trackTitles: ["[Test] Song one", "[Test] Song two"],
        artistIds: [albumArtist],
      });
      await tx.execute(sql`
        insert into track_artists (track_id, artist_id, position)
        values (${album.trackIds[0]!}, ${artist}, 1)`);
      const long = `[Test] ${"word ".repeat(120)}`.trim();
      const entryId = await createTestMemory(tx, {
        slug: slugOf("music"),
        versions: [{ locale: "en", status: "published", text: long }],
        music: [
          { trackId: album.trackIds[0]! },
          { trackId: album.trackIds[1]! },
          { albumId: album.albumId },
        ],
      });
      await tx.execute(
        sql`update memories set remembered_when = '  ' where entry_id = ${entryId}`,
      );
      const card = (await listPublicMemoryArchive(tx, "en")).find(
        (row) => row.slug === slugOf("music"),
      )!;
      const artistName = (
        await tx.execute<{ name: string }>(
          sql`select name from artists where id = ${artist}`,
        )
      ).rows[0]!.name;
      const bandName = (
        await tx.execute<{ name: string }>(
          sql`select name from artists where id = ${albumArtist}`,
        )
      ).rows[0]!.name;
      expect(card.music).toEqual([
        { title: "[Test] Song one", artists: [artistName] },
        { title: "[Test] Song two", artists: [] },
        { title: expect.stringContaining("Record"), artists: [bandName] },
      ]);
      // A blank "when" is no "when".
      expect(card.rememberedWhen).toBeNull();
      // The excerpt is cut, so the whole writing is never in the read model.
      expect(card.excerpt!.length).toBeLessThan(long.length);
      expect(card.excerpt!.endsWith("…")).toBe(true);
      expect(JSON.stringify(card)).not.toContain(long);
      expect(JSON.stringify(card)).not.toContain(entryId);
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

describe("the archives' review follow-ups", () => {
  it("takes a card's rating and written count from the journal it opens, never from a hidden featured one", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Hidden featured"),
      });
      const hidden = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        slug: slugOf("hidden-featured"),
        isFeatured: true,
        ratingHalfSteps: 10,
        versions: [{ locale: "en", status: "private" }],
      });
      await createTestTrackReflection(tx, {
        albumJournalId: hidden,
        albumId: album.albumId,
        trackId: album.trackIds[0]!,
        isPublished: true,
        texts: { en: "[Test] hidden reflection" },
      });
      await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        slug: slugOf("served-plain"),
        ratingHalfSteps: 3,
        versions: [{ locale: "en", status: "published" }],
      });
      const card = (await listPublicAlbumArchive(tx, "en")).find(
        (row) => row.slug === slugOf("served-plain"),
      )!;
      expect(card).toMatchObject({ ratingHalfSteps: 3, writtenTrackCount: 0 });
      expect(card.otherJournals).toEqual([]);
    });
  });

  it("never lists an artist credited only on a recording, even on an album with a served journal", async () => {
    await inRollbackTransaction(async (tx) => {
      const name = uniqueLabel("Recording only");
      const artist = await createTestArtist(tx, name);
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Credited album"),
      });
      await tx.execute(sql`
        insert into track_artists (track_id, artist_id, position)
        values (${album.trackIds[0]!}, ${artist}, 1)`);
      await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        slug: slugOf("recording-only"),
        versions: [{ locale: "en", status: "published" }],
      });
      const names = (await listPublicArtistArchive(tx)).map((row) => row.name);
      expect(names).not.toContain(name);
    });
  });

  it("chooses a memory's version by the reader's language, then the original, when the original is Portuguese", async () => {
    await inRollbackTransaction(async (tx) => {
      for (const [index, [pt, en]] of (
        [
          ["published", "published"],
          ["published", "private"],
          ["private", "published"],
          ["draft", "draft"],
        ] as const
      ).entries()) {
        await createTestMemory(tx, {
          slug: slugOf(`pt-original-${index}`),
          versions: [
            {
              locale: "pt-BR",
              isOriginal: true,
              status: pt,
              title: "[Test] Original pt",
              text: "[Test] Texto",
            },
            {
              locale: "en",
              isOriginal: false,
              status: en,
              title: "[Test] Translation en",
              text: "[Test] Text",
            },
          ],
        });
      }
      const listed = new Map(
        (await listPublicMemoryArchive(tx, "en")).map((card) => [
          card.slug,
          card,
        ]),
      );
      expect(listed.get(slugOf("pt-original-0"))?.locale).toBe("en");
      expect(listed.get(slugOf("pt-original-1"))).toMatchObject({
        locale: "pt-BR",
        title: "[Test] Original pt",
        excerpt: "[Test] Texto",
      });
      expect(listed.get(slugOf("pt-original-2"))?.locale).toBe("en");
      expect(listed.has(slugOf("pt-original-3"))).toBe(false);
    });
  });

  it("reads no songs of a memory unpublished between its two statements", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Race album"),
      });
      const entryId = await createTestMemory(tx, {
        slug: slugOf("race"),
        versions: [{ locale: "en", status: "published" }],
        music: [{ trackId: album.trackIds[0]! }],
      });
      let calls = 0;
      // The memory becomes private right after the first statement, as a
      // concurrent unpublish committed in between would make it.
      const racing = new Proxy(tx, {
        get(target, property, receiver) {
          if (property !== "execute")
            return Reflect.get(target, property, receiver);
          return async (query: Parameters<typeof tx.execute>[0]) => {
            const result = await target.execute(query);
            calls += 1;
            if (calls === 1) {
              await target.execute(sql`
                update entry_texts set status = 'private', published_at = null
                 where entry_id = ${entryId}`);
            }
            return result;
          };
        },
      });
      const card = (await listPublicMemoryArchive(racing, "en")).find(
        (row) => row.slug === slugOf("race"),
      );
      expect(card).toBeDefined();
      expect(card!.music).toEqual([]);
    });
  });
});

describe("the archives' counts and excerpts at their edges", () => {
  it("does not count a public reflection on a track outside the reference edition", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Bonus track"),
        trackTitles: ["[Test] 1", "[Test] 2"],
      });
      const [bonus] = await tx
        .insert(schema.tracks)
        .values({ title: "[Test] Bonus" })
        .returning({ id: schema.tracks.id });
      await tx
        .insert(schema.albumTracks)
        .values({ albumId: album.albumId, trackId: bonus!.id });
      const entryId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        slug: slugOf("bonus"),
        versions: [{ locale: "en", status: "published" }],
      });
      for (const trackId of [album.trackIds[0]!, bonus!.id]) {
        await createTestTrackReflection(tx, {
          albumJournalId: entryId,
          albumId: album.albumId,
          trackId,
          isPublished: true,
          texts: { en: "[Test] text" },
        });
      }
      const card = (await listPublicAlbumArchive(tx, "en")).find(
        (row) => row.slug === slugOf("bonus"),
      )!;
      expect(card).toMatchObject({ trackCount: 2, writtenTrackCount: 1 });
    });
  });

  it("finds the first readable paragraph after empty ones, reading only the first blocks", async () => {
    await inRollbackTransaction(async (tx) => {
      const entryId = await createTestMemory(tx, {
        slug: slugOf("late-paragraph"),
        versions: [{ locale: "en", status: "published" }],
      });
      const paragraphs = [
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "   " }] },
        {
          type: "heading",
          content: [{ type: "text", text: "[Test] A heading" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "[Test] The first words." }],
        },
        ...Array.from({ length: 30 }, (_, index) => ({
          type: "paragraph",
          content: [{ type: "text", text: `[Test] Later ${index}` }],
        })),
      ];
      await tx.execute(sql`
        update entry_texts
           set body = ${JSON.stringify({ type: "doc", content: paragraphs })}::jsonb
         where entry_id = ${entryId}`);
      const card = (await listPublicMemoryArchive(tx, "en")).find(
        (row) => row.slug === slugOf("late-paragraph"),
      )!;
      expect(card.excerpt).toBe("[Test] The first words.");
    });
  });
});

describe("the Albums archive groups by catalog album, never by what a card shows", () => {
  // The owner's visual review of #56 saw two "Grace · Jeff Buckley · 1994"
  // cards: two distinct catalog albums (two fixture records with the same
  // title, artist name, and year, and no MusicBrainz release group), one of
  // them with a second journal. This pins both halves of that behaviour.
  it("shows two catalog albums that look the same as two cards, and one album's journals under one card", async () => {
    await inRollbackTransaction(async (tx) => {
      const title = uniqueLabel("Twin title");
      const makeAlbum = async () =>
        createTestAlbum(tx, {
          title,
          artistIds: [await createTestArtist(tx, "[Test] Same Name")],
          firstReleaseYear: 1994,
        });
      const first = await makeAlbum();
      const second = await makeAlbum();
      await publishedJournal(tx, first.albumId, "twin-first", {
        publishedAt: new Date("2026-05-02T00:00:00Z"),
      });
      await publishedJournal(tx, first.albumId, "twin-first-earlier", {
        publishedAt: new Date("2020-01-02T00:00:00Z"),
      });
      await publishedJournal(tx, second.albumId, "twin-second", {
        publishedAt: new Date("2026-05-01T00:00:00Z"),
      });
      const cards = (await listPublicAlbumArchive(tx, "en")).filter(
        (card) => card.albumTitle === title,
      );
      expect(
        cards.map((card) => [
          card.slug,
          card.otherJournals.map((journal) => journal.slug),
        ]),
      ).toEqual([
        [slugOf("twin-first"), [slugOf("twin-first-earlier")]],
        [slugOf("twin-second"), []],
      ]);
      // Identical to a reader, and no identifier tells them apart in the
      // projection: the address is the only difference.
      expect(cards[0]!.credits).toEqual(cards[1]!.credits);
      expect(cards[0]!.firstReleaseYear).toBe(cards[1]!.firstReleaseYear);
      expect(JSON.stringify(cards)).not.toContain(first.albumId);
      expect(JSON.stringify(cards)).not.toContain(second.albumId);
    });
  });
});
