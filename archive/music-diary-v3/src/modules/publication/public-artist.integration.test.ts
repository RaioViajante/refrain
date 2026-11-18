import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Transaction, VisibilityStatus } from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestArtistJournal,
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
import { commonsThumbnail, PHOTO } from "@/testing/wikimedia-fixtures";

import { artistAddressBase, artistAddressSuffix } from "./artist-address";
import { isArtistOnPublicPage } from "./catalog-exposure";
import { restoreDeletedEntry, unpublishLanguageVersion } from "./commands";
import { getPublicAlbumJournal } from "./public-album-journal";
import { getPublicArtist, listPublicArtistAddresses } from "./public-artist";
import { normalizeSlug } from "./slug";
import { publicArtistAddresses, resolvePublicArtistAddress } from "./queries";

// The public artist read model (M3.5) against real PostgreSQL. An artist is
// public only while a served album journal is about an album that credits it
// and the artist is not archived; everything else answers as an unknown
// address. Committed rows from other suites can be visible inside the
// transaction, so every artist here has a run-unique name and each test looks
// only at its own.

const author = testAuthor();

type Status = VisibilityStatus | "none";

/**
 * The oracle: an independent statement of the rule, in plain TypeScript, from
 * the state of one journal and its artist.
 */
function oracleVisible(state: {
  deleted: boolean;
  en: VisibilityStatus;
  ptBR: Status;
  archived: boolean;
}): boolean {
  const versionPublic = state.en === "published" || state.ptBR === "published";
  return !state.deleted && versionPublic && !state.archived;
}

async function artistNamed(tx: Transaction, label: string) {
  const name = uniqueLabel(label);
  return { id: await createTestArtist(tx, name), name };
}

async function journalFor(
  tx: Transaction,
  artistIds: string[],
  options: {
    slug: string;
    versions?: TestVersion[];
    deletedAt?: Date;
    isFeatured?: boolean;
    trackTitles?: string[];
    albumId?: string;
  },
) {
  const album = options.albumId
    ? { albumId: options.albumId, trackIds: [] as string[] }
    : await createTestAlbum(tx, {
        title: uniqueLabel("Album"),
        artistIds,
        firstReleaseYear: 2001,
        trackTitles: options.trackTitles,
      });
  const entryId = await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    slug: options.slug,
    versions: options.versions ?? [
      { locale: "en", status: "published", publishedAt: new Date() },
    ],
    deletedAt: options.deletedAt,
    isFeatured: options.isFeatured,
  });
  return { entryId, albumId: album.albumId, trackIds: album.trackIds };
}

const slugOf = (label: string) => normalizeSlug(`t ${uniqueLabel(label)}`);

describe("which artists are public", () => {
  it("agrees with the oracle in every state of the one journal that credits them", async () => {
    const statuses: VisibilityStatus[] = ["draft", "private", "published"];
    const ptStatuses: Status[] = ["none", "draft", "private", "published"];
    let cells = 0;
    await inRollbackTransaction(async (tx) => {
      for (const deleted of [false, true]) {
        for (const en of statuses) {
          for (const ptBR of ptStatuses) {
            for (const archived of [false, true]) {
              const artist = await artistNamed(tx, "Oracle artist");
              if (archived) {
                await tx.execute(sql`
                  update artists set archived_at = now()
                   where id = ${artist.id}`);
              }
              // Every artist has a photograph: it must never matter.
              await setTestArtistPhoto(tx, artist.id, GRACE_ARTIST_PHOTO);
              const versions: TestVersion[] = [
                { locale: "en", status: en, publishedAt: new Date() },
              ];
              if (ptBR !== "none") {
                versions.push({
                  locale: "pt-BR",
                  status: ptBR,
                  publishedAt: new Date(),
                });
              }
              const journal = await journalFor(tx, [artist.id], {
                slug: slugOf("oracle"),
                versions,
                deletedAt: deleted ? new Date() : undefined,
              });
              const expected = oracleVisible({ deleted, en, ptBR, archived });
              const cell = JSON.stringify({ deleted, en, ptBR, archived });

              const addresses = await publicArtistAddresses(tx);
              expect(addresses.has(artist.id), cell).toBe(expected);
              expect(await isArtistOnPublicPage(tx, artist.id), cell).toBe(
                expected,
              );
              const page = await getPublicArtist(tx, artist.id, "en");
              expect(page !== null, cell).toBe(expected);
              const base = artistAddressBase(artist.name);
              expect(
                (await resolvePublicArtistAddress(tx, base)).outcome,
                cell,
              ).toBe(expected ? "found" : "not_found");
              expect(
                (await listPublicArtistAddresses(tx)).includes(base),
                cell,
              ).toBe(expected);

              // The album page links the credit exactly when the page exists.
              const album = await getPublicAlbumJournal(
                tx,
                journal.entryId,
                "en",
              );
              if (album) {
                expect(album.credits[0]!.artistAddress, cell).toBe(
                  expected ? base : null,
                );
              }
              cells++;
            }
          }
        }
      }
    });
    expect(cells).toBe(48);
  });

  it("is never made public by the catalog, a photograph, or an artist journal alone", async () => {
    await inRollbackTransaction(async (tx) => {
      const catalogOnly = await artistNamed(tx, "Catalog only");
      await setTestArtistPhoto(tx, catalogOnly.id, GRACE_ARTIST_PHOTO);
      // Credited on an album that has no journal at all.
      await createTestAlbum(tx, { artistIds: [catalogOnly.id] });
      // A published artist journal: no public reading contract exists yet.
      await createTestArtistJournal(tx, {
        artistId: catalogOnly.id,
        slug: slugOf("artist-journal"),
        versions: [{ locale: "en", status: "published" }],
      });
      expect((await publicArtistAddresses(tx)).has(catalogOnly.id)).toBe(false);
      expect(await getPublicArtist(tx, catalogOnly.id, "en")).toBeNull();
      expect(
        (
          await resolvePublicArtistAddress(
            tx,
            artistAddressBase(catalogOnly.name),
          )
        ).outcome,
      ).toBe("not_found");
    });
  });

  it("is public while any one journal about any credited album is, and stops with the last", async () => {
    await inRollbackTransaction(async (tx) => {
      const artist = await artistNamed(tx, "Two albums");
      const hidden = await journalFor(tx, [artist.id], {
        slug: slugOf("hidden"),
        versions: [{ locale: "en", status: "private" }],
      });
      expect((await publicArtistAddresses(tx)).has(artist.id)).toBe(false);
      const shown = await journalFor(tx, [artist.id], {
        slug: slugOf("shown"),
      });
      expect((await publicArtistAddresses(tx)).has(artist.id)).toBe(true);
      const page = await getPublicArtist(tx, artist.id, "en");
      // Only the album whose journal is public is listed.
      expect(page!.albums).toHaveLength(1);
      expect(hidden.entryId).not.toBe(shown.entryId);

      // The real command: unpublishing the last public journal hides it.
      await unpublishLanguageVersion(
        tx,
        author,
        shown.entryId,
        "en",
        "private",
      );
      expect((await publicArtistAddresses(tx)).has(artist.id)).toBe(false);
      expect(await getPublicArtist(tx, artist.id, "en")).toBeNull();
    });
  });

  it("stays hidden when its only journal is restored from Recently deleted", async () => {
    await inRollbackTransaction(async (tx) => {
      const artist = await artistNamed(tx, "Restored");
      const journal = await journalFor(tx, [artist.id], {
        slug: slugOf("restored"),
        deletedAt: new Date(),
      });
      expect((await publicArtistAddresses(tx)).has(artist.id)).toBe(false);
      await restoreDeletedEntry(tx, journal.entryId);
      // A restored published version comes back private (ADR 0005).
      expect((await publicArtistAddresses(tx)).has(artist.id)).toBe(false);
    });
  });

  it("is not made public by a credit on a track alone", async () => {
    await inRollbackTransaction(async (tx) => {
      const albumArtist = await artistNamed(tx, "Album credit");
      const trackOnly = await artistNamed(tx, "Track credit only");
      const journal = await journalFor(tx, [albumArtist.id], {
        slug: slugOf("track-credit"),
      });
      await tx.execute(sql`
        insert into track_artists (track_id, artist_id, position)
        values (${journal.trackIds[0]!}, ${trackOnly.id}, 1)`);
      const addresses = await publicArtistAddresses(tx);
      expect(addresses.has(albumArtist.id)).toBe(true);
      expect(addresses.has(trackOnly.id)).toBe(false);
    });
  });

  it("counts a translation only when it is itself published", async () => {
    await inRollbackTransaction(async (tx) => {
      const artist = await artistNamed(tx, "Translated");
      await journalFor(tx, [artist.id], {
        slug: slugOf("translated"),
        versions: [
          { locale: "en", status: "draft" },
          { locale: "pt-BR", status: "published", publishedAt: new Date() },
        ],
      });
      expect((await publicArtistAddresses(tx)).has(artist.id)).toBe(true);
    });
  });
});

describe("artist addresses", () => {
  it("never reflect a private namesake, and disambiguate two public ones", async () => {
    await inRollbackTransaction(async (tx) => {
      const name = uniqueLabel("Namesake");
      const publicOne = await createTestArtist(tx, name);
      const privateOne = await createTestArtist(tx, name);
      await journalFor(tx, [publicOne], { slug: slugOf("ns-public") });
      await journalFor(tx, [privateOne], {
        slug: slugOf("ns-private"),
        versions: [{ locale: "en", status: "draft" }],
      });
      const base = artistAddressBase(name);
      // The private namesake changes nothing: the bare name.
      expect((await publicArtistAddresses(tx)).get(publicOne)).toBe(base);

      await tx.execute(sql`
        update entry_texts set status = 'published', published_at = now(),
               first_published_at = now()
         where entry_id in (select entry_id from album_journals aj
                             join album_artists aa on aa.album_id = aj.album_id
                            where aa.artist_id = ${privateOne})`);
      await tx.execute(sql`
        update entry_slugs set was_published = true
         where entry_id in (select entry_id from album_journals aj
                             join album_artists aa on aa.album_id = aj.album_id
                            where aa.artist_id = ${privateOne})`);
      const addresses = await publicArtistAddresses(tx);
      expect(addresses.get(publicOne)).toBe(
        `${base}-${artistAddressSuffix(publicOne)}`,
      );
      expect(addresses.get(privateOne)).toBe(
        `${base}-${artistAddressSuffix(privateOne)}`,
      );
      // Neither has the bare name while both are public.
      expect((await resolvePublicArtistAddress(tx, base)).outcome).toBe(
        "not_found",
      );
      expect(
        await resolvePublicArtistAddress(tx, addresses.get(privateOne)!),
      ).toEqual({ outcome: "found", artistId: privateOne });
    });
  });

  it("refuses malformed addresses without reading", async () => {
    await inRollbackTransaction(async (tx) => {
      for (const address of [
        "",
        "Jeff-Buckley",
        "a--b",
        "-a",
        "a/b",
        "x".repeat(81),
      ]) {
        expect((await resolvePublicArtistAddress(tx, address)).outcome).toBe(
          "not_found",
        );
      }
    });
  });
});

describe("the artist page", () => {
  it("returns exactly what a reader may see, with no identifier", async () => {
    await inRollbackTransaction(async (tx) => {
      const artist = await artistNamed(tx, "Projected");
      await setTestArtistPhoto(tx, artist.id, GRACE_ARTIST_PHOTO);
      const journal = await journalFor(tx, [artist.id], {
        slug: slugOf("projected"),
        trackTitles: ["[Test] One", "[Test] Two", "[Test] Three"],
      });
      await createTestTrackReflection(tx, {
        albumJournalId: journal.entryId,
        albumId: journal.albumId,
        trackId: journal.trackIds[1]!,
        isPublished: true,
        texts: { en: "[Test] public" },
      });
      // Not public: no flag, and a flagged text in a language not published.
      await createTestTrackReflection(tx, {
        albumJournalId: journal.entryId,
        albumId: journal.albumId,
        trackId: journal.trackIds[0]!,
        isPublished: false,
        texts: { en: "[Test] PRIVATE" },
      });
      await createTestTrackReflection(tx, {
        albumJournalId: journal.entryId,
        albumId: journal.albumId,
        trackId: journal.trackIds[2]!,
        isPublished: true,
        texts: { "pt-BR": "[Test] PRIVATE" },
      });

      const page = (await getPublicArtist(tx, artist.id, "en"))!;
      expect(Object.keys(page).sort()).toEqual(
        ["address", "albums", "name", "photo", "tracks"].sort(),
      );
      expect(page.name).toBe(artist.name);
      expect(page.address).toBe(artistAddressBase(artist.name));
      expect(page.albums).toHaveLength(1);
      expect(Object.keys(page.albums[0]!).sort()).toEqual(
        [
          "artwork",
          "firstReleaseYear",
          "slug",
          "title",
          "trackCount",
          "writtenTrackCount",
        ].sort(),
      );
      expect(page.albums[0]).toMatchObject({
        firstReleaseYear: 2001,
        trackCount: 3,
        writtenTrackCount: 1,
        artwork: null,
      });
      expect(page.tracks).toEqual([
        {
          title: "[Test] Two",
          albumTitle: page.albums[0]!.title,
          slug: page.albums[0]!.slug,
          number: 2,
        },
      ]);
      expect(page.photo).toEqual({
        src: commonsThumbnail(PHOTO.onStage, 330),
        srcSet: `${commonsThumbnail(PHOTO.onStage, 330)} 330w, ${commonsThumbnail(PHOTO.onStage, 500)} 500w`,
        title: PHOTO.onStage.replace(/_/g, " "),
        sourceUrl: `https://commons.wikimedia.org/wiki/File:${PHOTO.onStage}`,
        credit: GRACE_ARTIST_PHOTO.credit,
        caption: `Photo: ${GRACE_ARTIST_PHOTO.credit}`,
        license: {
          name: "CC BY-SA 4.0",
          url: "https://creativecommons.org/licenses/by-sa/4.0/",
          shareAlike: true,
        },
        modifications:
          "Resized, and cropped to fit the frame. No other changes.",
      });
      const text = JSON.stringify(page);
      expect(text).not.toContain(artist.id);
      expect(text).not.toContain(journal.entryId);
      expect(text).not.toContain(journal.albumId);
      expect(text).not.toContain("PRIVATE");
    });
  });

  it("shows the fallback for any photograph not in the one stored form", async () => {
    await inRollbackTransaction(async (tx) => {
      const artist = await artistNamed(tx, "Tampered");
      await journalFor(tx, [artist.id], { slug: slugOf("tampered") });
      const tampered = [
        sql`photo_url = 'https://evil.example/x.jpg'`,
        sql`photo_url = ${commonsThumbnail(PHOTO.onStage, 500)}`,
        sql`photo_source_url = 'https://commons.wikimedia.org/wiki/File:Other.jpg'`,
        sql`photo_license = 'CC BY-NC 4.0'`,
        sql`photo_credit = '<script>alert(1)</script>'`,
        sql`photo_credit = ${"[Test] ‮override"}`,
      ];
      for (const change of tampered) {
        await setTestArtistPhoto(tx, artist.id, GRACE_ARTIST_PHOTO);
        expect(
          (await getPublicArtist(tx, artist.id, "en"))!.photo,
        ).not.toBeNull();
        await tx.execute(
          sql`update artists set ${change} where id = ${artist.id}`,
        );
        const page = await getPublicArtist(tx, artist.id, "en");
        // Still a page: a bad photograph never hides the artist, only itself.
        expect(page, String(change.queryChunks)).not.toBeNull();
        expect(page!.photo).toBeNull();
      }
    });
  });

  it("presents each album by its presented journal, and lists only its reflections", async () => {
    await inRollbackTransaction(async (tx) => {
      const artist = await artistNamed(tx, "Presented");
      const first = await journalFor(tx, [artist.id], {
        slug: slugOf("first"),
        trackTitles: ["[Test] A", "[Test] B"],
      });
      // A second, featured journal about the same album.
      const featured = await journalFor(tx, [artist.id], {
        slug: slugOf("featured"),
        albumId: first.albumId,
        isFeatured: true,
      });
      await createTestTrackReflection(tx, {
        albumJournalId: first.entryId,
        albumId: first.albumId,
        trackId: first.trackIds[0]!,
        isPublished: true,
        texts: { en: "[Test] in the journal that is not presented" },
      });
      const page = (await getPublicArtist(tx, artist.id, "en"))!;
      expect(page.albums).toHaveLength(1);
      const slugs = await tx.execute<{ slug: string }>(sql`
        select slug from entry_slugs where entry_id = ${featured.entryId}`);
      expect(page.albums[0]!.slug).toBe(slugs.rows[0]!.slug);
      // The reflection belongs to the other journal, so it is not listed here.
      expect(page.tracks).toEqual([]);
    });
  });
});
