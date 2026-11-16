import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb, type Transaction } from "@/db";
// The real catalog commands are the oracle: what they do to the pages is what
// the impact must have predicted. Tests may reach a module's internals.
// eslint-disable-next-line no-restricted-imports
import * as catalog from "@/modules/catalog/commands";
import * as confirmed from "@/testing/confirmed-catalog-edits";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestMemory,
  createTestTrackReflection,
  inRollbackTransaction,
  rowChecksum,
  testAuthor,
  uniqueLabel,
  type TestVersion,
} from "@/testing";

import { artistAddressBase } from "./artist-address";
import {
  CATALOG_TABLES,
  CatalogImpactError,
  catalogPublicImpact,
  compareRenders,
  isEmptyImpact,
  renderServedCatalog,
  type CatalogChange,
  type CatalogPublicImpact,
} from "./catalog-impact";
import { normalizeSlug } from "./slug";

// The public impact of a catalog change (ADR 0013 § 1.2, step 1) against real
// PostgreSQL. The oracle in most tests is the catalog itself: the impact is
// computed, then the real catalog command runs in the same rolled-back
// transaction, and the pages rendered afterwards must differ from those
// rendered before in exactly the way the impact said. Each test reads one
// REPEATABLE READ snapshot, so rows other suites commit meanwhile cannot
// appear between the two renders.

const author = testAuthor();
const published = (locale: "en" | "pt-BR" = "en"): TestVersion => ({
  locale,
  status: "published",
  publishedAt: new Date(),
});
const slugOf = (label: string) => normalizeSlug(`t ${uniqueLabel(label)}`);

async function inSnapshotTest(work: (tx: Transaction) => Promise<void>) {
  await inRollbackTransaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read`);
    await work(tx);
  });
}

/** The impact, checked against what the real command then does. */
async function impactOf(
  tx: Transaction,
  change: CatalogChange,
  command: () => Promise<unknown>,
): Promise<CatalogPublicImpact> {
  const before = await renderServedCatalog(tx);
  const impact = await catalogPublicImpact(tx, change);
  // Nothing of the computation is left behind: the pages are as they were.
  expect(compareRenders(before, await renderServedCatalog(tx)).pages).toEqual(
    [],
  );
  await command();
  const after = await renderServedCatalog(tx);
  expect(impact).toEqual(compareRenders(before, after));
  return impact;
}

const pagesOf = (impact: CatalogPublicImpact, entryId: string) =>
  impact.pages.filter((page) => page.entryId === entryId);
const atomsOf = (impact: CatalogPublicImpact, entryId: string) =>
  pagesOf(impact, entryId).map((page) => ({
    locale: page.locale,
    changes: page.changes,
  }));

/**
 * A small public world: artist A credited on album X, which has a served
 * journal; X's second track is credited to A too, and a served memory links
 * it. Artist B is credited on nothing served.
 */
async function servedWorld(tx: Transaction) {
  const artistA = { id: "", name: uniqueLabel("Artist A") };
  artistA.id = await createTestArtist(tx, artistA.name);
  const artistB = { id: "", name: uniqueLabel("Artist B") };
  artistB.id = await createTestArtist(tx, artistB.name);
  const album = await createTestAlbum(tx, {
    title: uniqueLabel("Album X"),
    artistIds: [artistA.id],
    firstReleaseYear: 2001,
    trackTitles: [
      uniqueLabel("Track 1"),
      uniqueLabel("Track 2"),
      uniqueLabel("Track 3"),
    ],
  });
  await tx.execute(sql`
    insert into track_artists (track_id, artist_id, position)
    values (${album.trackIds[1]!}, ${artistA.id}, 1)`);
  const journalSlug = slugOf("journal");
  const journalId = await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    slug: journalSlug,
    versions: [published("en")],
  });
  const memorySlug = slugOf("memory");
  const memoryId = await createTestMemory(tx, {
    slug: memorySlug,
    versions: [{ ...published("en"), title: uniqueLabel("Memory") }],
    music: [{ trackId: album.trackIds[1]! }],
  });
  return {
    artistA,
    artistB,
    album,
    journalId,
    journalSlug,
    memoryId,
    memorySlug,
  };
}

describe("what a change affects", () => {
  it("lists every served page an artist rename changes, in both languages, with its address", async () => {
    await inSnapshotTest(async (tx) => {
      const world = await servedWorld(tx);
      const name = uniqueLabel("Renamed A");
      const impact = await impactOf(
        tx,
        [{ op: "update_artist", artistId: world.artistA.id, name }],
        () => confirmed.updateArtist(tx, author, world.artistA.id, { name }),
      );

      const linkBefore = `/artists/${artistAddressBase(world.artistA.name)}`;
      const linkAfter = `/artists/${artistAddressBase(name)}`;
      for (const locale of ["en", "pt-BR"] as const) {
        expect(atomsOf(impact, world.journalId)).toContainEqual({
          locale,
          changes: [
            { atom: "credits.1.name", before: world.artistA.name, after: name },
            { atom: "credits.1.link", before: linkBefore, after: linkAfter },
          ],
        });
        expect(atomsOf(impact, world.memoryId)).toContainEqual({
          locale,
          changes: [
            {
              atom: "music.1.artists.1.name",
              before: world.artistA.name,
              after: name,
            },
            {
              atom: "music.1.artists.1.link",
              before: linkBefore,
              after: linkAfter,
            },
          ],
        });
        const artistPage = impact.pages.find(
          (page) =>
            page.surface === "artist" &&
            page.artistId === world.artistA.id &&
            page.locale === locale,
        );
        expect(artistPage?.path).toBe(linkBefore);
        expect(artistPage?.pathAfter).toBe(linkAfter);
        for (const surface of ["album_archive", "artist_archive", "home"]) {
          expect(
            impact.pages.some(
              (page) => page.surface === surface && page.locale === locale,
            ),
            surface,
          ).toBe(true);
        }
      }
      expect(impact.pages.some((page) => page.surface === "sitemap")).toBe(
        true,
      );
      expect(impact.artistAddresses).toEqual([
        {
          artistId: world.artistA.id,
          before: artistAddressBase(world.artistA.name),
          after: artistAddressBase(name),
        },
      ]);
      expect(impact.opensArtistPage).toBe(false);
      // Nothing about the artist that has no page.
      expect(JSON.stringify(impact)).not.toContain(world.artistB.name);
    });
  });

  it("lists a namesake whose address moves, and the pages that link it", async () => {
    await inSnapshotTest(async (tx) => {
      const name = uniqueLabel("Namesake");
      const first = await createTestArtist(tx, name);
      const second = await createTestArtist(tx, name);
      const journals: string[] = [];
      for (const artistId of [first, second]) {
        const album = await createTestAlbum(tx, {
          title: uniqueLabel("Namesake album"),
          artistIds: [artistId],
        });
        journals.push(
          await createTestAlbumJournal(tx, {
            albumId: album.albumId,
            slug: slugOf("namesake"),
            versions: [published()],
          }),
        );
      }
      const renamed = uniqueLabel("No longer a namesake");
      const impact = await impactOf(
        tx,
        [{ op: "update_artist", artistId: second, name: renamed }],
        () => confirmed.updateArtist(tx, author, second, { name: renamed }),
      );

      const moved = impact.artistAddresses.find((c) => c.artistId === first);
      expect(moved?.before).toMatch(
        new RegExp(`^${artistAddressBase(name)}-[0-9a-f]{10}$`),
      );
      expect(moved?.after).toBe(artistAddressBase(name));
      // The first artist's own journal links the moved address, though its
      // wording did not change.
      expect(atomsOf(impact, journals[0]!)).toContainEqual({
        locale: "en",
        changes: [
          {
            atom: "credits.1.link",
            before: `/artists/${moved!.before}`,
            after: `/artists/${moved!.after}`,
          },
        ],
      });
    });
  });

  it("lists the pages of artists whose address a rename collides with (the review's counterexample)", async () => {
    await inSnapshotTest(async (tx) => {
      // Q and R are public namesakes, so each has a suffixed address; P is
      // another public artist. Renaming P to Q's whole address collides with
      // it: both P's and Q's addresses close. Q's journal loses its link.
      const shared = uniqueLabel("Namesake");
      const artists: string[] = [];
      for (const name of [shared, shared, uniqueLabel("Plain")]) {
        const id = await createTestArtist(tx, name);
        artists.push(id);
        const album = await createTestAlbum(tx, {
          title: uniqueLabel("Collision album"),
          artistIds: [id],
        });
        await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          slug: slugOf("collision"),
          versions: [published()],
        });
      }
      const [q, , p] = artists as [string, string, string];
      const qAddress = (await renderServedCatalog(tx)).artistAddresses.get(q)!;
      expect(qAddress).toMatch(/-[0-9a-f]{10}$/);
      const impact = await impactOf(
        tx,
        [{ op: "update_artist", artistId: p, name: qAddress }],
        () => confirmed.updateArtist(tx, author, p, { name: qAddress }),
      );
      expect(
        impact.pages.some(
          (page) => page.surface === "artist" && page.artistId === q,
        ),
      ).toBe(true);
    });
  });

  it("follows album, track, and tracklist edits on every page that renders them", async () => {
    await inSnapshotTest(async (tx) => {
      const world = await servedWorld(tx);
      const albumId = world.album.albumId;
      const [track1, track2, track3] = world.album.trackIds as [
        string,
        string,
        string,
      ];

      const title = uniqueLabel("Album X retitled");
      let impact = await impactOf(
        tx,
        [
          {
            op: "update_album",
            albumId,
            title,
            firstReleaseYear: 1999,
            label: "[Test] Other label",
          },
        ],
        () =>
          confirmed.updateAlbum(tx, author, albumId, {
            title,
            firstReleaseYear: 1999,
            edition: { label: "[Test] Other label" },
          }),
      );
      expect(
        atomsOf(impact, world.journalId)[0]?.changes.map((c) => c.atom),
      ).toEqual(["album.title", "album.year", "album.label"]);
      // The memory names the album: its title changes there too.
      expect(atomsOf(impact, world.memoryId)[0]?.changes).toEqual([
        {
          atom: "music.1.album.title",
          before: expect.any(String),
          after: title,
        },
      ]);

      const trackTitle = uniqueLabel("Track 2 retitled");
      impact = await impactOf(
        tx,
        [{ op: "update_track", trackId: track2, title: trackTitle }],
        () => confirmed.updateTrack(tx, author, track2, { title: trackTitle }),
      );
      expect(atomsOf(impact, world.journalId)[0]?.changes).toEqual([
        {
          atom: "tracks.2.title",
          before: expect.any(String),
          after: trackTitle,
        },
      ]);
      expect(atomsOf(impact, world.memoryId)[0]?.changes).toEqual([
        {
          atom: "music.1.title",
          before: expect.any(String),
          after: trackTitle,
        },
      ]);

      impact = await impactOf(
        tx,
        [
          {
            op: "set_tracklist",
            albumId,
            tracks: [track3, track1, track2].map((trackId) => ({
              trackId,
              discNumber: 1,
            })),
          },
        ],
        () =>
          catalog.setAlbumTracklist(tx, author, albumId, {
            tracks: [track3, track1, track2].map((trackId) => ({ trackId })),
          }),
      );
      expect(
        atomsOf(impact, world.journalId)[0]?.changes.map((c) => c.atom),
      ).toEqual(["tracks.1.title", "tracks.2.title", "tracks.3.title"]);
      // The memory links track 2 itself: its page does not change.
      expect(pagesOf(impact, world.memoryId)).toEqual([]);

      // A new track appended to the album: createTrack's own effect, with
      // the id the command chose, is what the impact must predict.
      const newTitle = uniqueLabel("Track 4");
      const before = await renderServedCatalog(tx);
      const created = await catalog.createTrack(tx, author, {
        title: newTitle,
        albumId,
        artistIds: [world.artistA.id],
      });
      const after = await renderServedCatalog(tx);
      await tx.execute(
        sql`delete from edition_tracks where track_id = ${created.id}`,
      );
      await tx.execute(
        sql`delete from album_tracks where track_id = ${created.id}`,
      );
      await tx.execute(
        sql`delete from track_artists where track_id = ${created.id}`,
      );
      await tx.execute(sql`delete from tracks where id = ${created.id}`);
      expect(
        compareRenders(before, await renderServedCatalog(tx)).pages,
      ).toEqual([]);
      const predicted = await catalogPublicImpact(tx, [
        {
          op: "create_track",
          trackId: created.id,
          title: newTitle,
          artistIds: [world.artistA.id],
        },
        {
          op: "set_tracklist",
          albumId,
          tracks: [track3, track1, track2, created.id].map((trackId) => ({
            trackId,
            discNumber: 1,
          })),
        },
      ]);
      expect(predicted).toEqual(compareRenders(before, after));
      expect(atomsOf(predicted, world.journalId)[0]?.changes).toContainEqual({
        atom: "tracks.4.title",
        before: null,
        after: newTitle,
      });
    });
  });

  it("follows which album a memory names, and leaves a containing album that stays unnamed alone", async () => {
    await inSnapshotTest(async (tx) => {
      // One recording on two albums, neither with a journal: the memory
      // names the earlier one, as plain text.
      const earlier = await createTestAlbum(tx, {
        title: uniqueLabel("Earlier album"),
        firstReleaseYear: 1990,
        trackTitles: [uniqueLabel("Shared recording")],
      });
      const recording = earlier.trackIds[0]!;
      const later = await createTestAlbum(tx, {
        title: uniqueLabel("Later album"),
        firstReleaseYear: 2000,
        trackTitles: [],
      });
      await catalog.setAlbumTracklist(tx, author, later.albumId, {
        tracks: [{ trackId: recording }],
      });
      const memoryId = await createTestMemory(tx, {
        slug: slugOf("named album"),
        versions: [{ ...published(), title: uniqueLabel("Memory") }],
        music: [{ trackId: recording }],
      });

      // Retitling the album that is not named changes nothing served.
      const quiet = uniqueLabel("Still later");
      let impact = await impactOf(
        tx,
        [{ op: "update_album", albumId: later.albumId, title: quiet }],
        () =>
          confirmed.updateAlbum(tx, author, later.albumId, { title: quiet }),
      );
      expect(pagesOf(impact, memoryId)).toEqual([]);

      // Moving it before the other makes it the album the memory names.
      impact = await impactOf(
        tx,
        [
          {
            op: "update_album",
            albumId: later.albumId,
            firstReleaseYear: 1980,
          },
        ],
        () =>
          confirmed.updateAlbum(tx, author, later.albumId, {
            firstReleaseYear: 1980,
          }),
      );
      expect(atomsOf(impact, memoryId)).toContainEqual({
        locale: "en",
        changes: [
          {
            atom: "music.1.album.title",
            before: (await titleOf(tx, earlier.albumId)) as string,
            after: quiet,
          },
        ],
      });

      // Deleting the album it now names names the other one again.
      impact = await impactOf(
        tx,
        [{ op: "delete_album", albumId: later.albumId }],
        () => catalog.deleteAlbum(tx, author, later.albumId),
      );
      expect(atomsOf(impact, memoryId)[0]?.changes).toEqual([
        {
          atom: "music.1.album.title",
          before: quiet,
          after: await titleOf(tx, earlier.albumId),
        },
      ]);
    });
  });

  it("predicts a credit's stored wording, as the command keeps it", async () => {
    await inSnapshotTest(async (tx) => {
      const world = await servedWorld(tx);
      const albumId = world.album.albumId;
      await tx.execute(sql`
        update album_artists set credited_as = '[Test] A, credited'
         where album_id = ${albumId}`);
      const impact = await impactOf(
        tx,
        [
          {
            op: "update_album",
            albumId,
            title: "[Test] Credit kept",
            credits: [
              { artistId: world.artistA.id, creditedAs: "[Test] A, credited" },
            ],
          },
        ],
        // The command keeps the stored `credited_as` of a credit that leaves
        // it out; the change states it.
        () =>
          confirmed.updateAlbum(tx, author, albumId, {
            title: "[Test] Credit kept",
            credits: [{ artistId: world.artistA.id }],
          }),
      );
      expect(
        atomsOf(impact, world.journalId)[0]?.changes.map((c) => c.atom),
      ).toEqual(["album.title"]);
    });
  });

  it("reports an artist page that would open, and one that closes", async () => {
    await inSnapshotTest(async (tx) => {
      const world = await servedWorld(tx);

      // Crediting an artist that has no page on a served album opens one:
      // A5 refuses that, so the command does too; the impact says so.
      const opening = await catalogPublicImpact(tx, [
        {
          op: "update_album",
          albumId: world.album.albumId,
          credits: [
            { artistId: world.artistA.id, creditedAs: null },
            { artistId: world.artistB.id, creditedAs: null },
          ],
        },
      ]);
      expect(opening.opensArtistPage).toBe(true);
      expect(opening.artistAddresses).toEqual([
        {
          artistId: world.artistB.id,
          before: null,
          after: artistAddressBase(world.artistB.name),
        },
      ]);

      // Archiving a public artist closes its page: a reduction, not an
      // opening; its credits become plain text.
      const closing = await impactOf(
        tx,
        [{ op: "update_artist", artistId: world.artistA.id, archived: true }],
        () => catalog.archiveArtist(tx, author, world.artistA.id),
      );
      expect(closing.opensArtistPage).toBe(false);
      expect(closing.artistAddresses).toEqual([
        {
          artistId: world.artistA.id,
          before: artistAddressBase(world.artistA.name),
          after: null,
        },
      ]);
      expect(atomsOf(closing, world.journalId)[0]?.changes).toEqual([
        {
          atom: "credits.1.link",
          before: `/artists/${artistAddressBase(world.artistA.name)}`,
          after: null,
        },
      ]);

      // Restoring it would open the page again: the command refuses
      // (`public_page`), and the impact reports the opening.
      const restoring = await catalogPublicImpact(tx, [
        { op: "update_artist", artistId: world.artistA.id, archived: false },
      ]);
      expect(restoring.opensArtistPage).toBe(true);
      await expect(
        catalog.restoreArtist(tx, author, world.artistA.id),
      ).rejects.toMatchObject({ failure: "public_page" });
    });
  });
});

describe("what is never counted", () => {
  const hiddenStates: {
    name: string;
    versions: TestVersion[];
    deletedAt?: Date;
  }[] = [
    { name: "draft", versions: [{ locale: "en", status: "draft" }] },
    { name: "private", versions: [{ locale: "en", status: "private" }] },
    { name: "deleted", versions: [published()], deletedAt: new Date() },
    {
      name: "only an unpublished translation",
      versions: [
        { locale: "en", status: "private" },
        { locale: "pt-BR", status: "draft" },
      ],
    },
  ];

  it("has an empty impact for records that nothing served shows", async () => {
    await inSnapshotTest(async (tx) => {
      for (const state of hiddenStates) {
        const artistId = await createTestArtist(tx, uniqueLabel("Hidden"));
        const album = await createTestAlbum(tx, {
          title: uniqueLabel("Hidden album"),
          artistIds: [artistId],
        });
        await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          slug: slugOf("hidden"),
          versions: state.versions,
          deletedAt: state.deletedAt,
        });
        await createTestMemory(tx, {
          slug: slugOf("hidden memory"),
          versions: state.versions.map((v) => ({
            ...v,
            title: uniqueLabel("Memory"),
          })),
          deletedAt: state.deletedAt,
          music: [{ trackId: album.trackIds[0]! }],
        });
        const newName = uniqueLabel("Hidden renamed");
        const newTitle = uniqueLabel("Hidden retitled");
        const impact = await impactOf(
          tx,
          [
            { op: "update_artist", artistId, name: newName },
            { op: "update_album", albumId: album.albumId, title: newTitle },
            {
              op: "update_track",
              trackId: album.trackIds[0]!,
              title: newTitle,
            },
          ],
          async () => {
            await confirmed.updateArtist(tx, author, artistId, {
              name: newName,
            });
            await confirmed.updateAlbum(tx, author, album.albumId, {
              title: newTitle,
            });
            await confirmed.updateTrack(tx, author, album.trackIds[0]!, {
              title: newTitle,
            });
          },
        );
        expect(isEmptyImpact(impact), state.name).toBe(true);
      }
    });
  });

  it("carries no writing, rating, or private text, only catalog wording", async () => {
    await inSnapshotTest(async (tx) => {
      const marker = `MARKER-${crypto.randomUUID()}`;
      const world = await servedWorld(tx);
      await tx.execute(sql`
        update entry_texts
           set title = ${`${marker} title`}, body_text = ${marker},
               body = ${JSON.stringify({
                 type: "doc",
                 content: [
                   {
                     type: "paragraph",
                     content: [{ type: "text", text: `${marker} body` }],
                   },
                 ],
               })}::jsonb
         where entry_id in (${world.journalId}, ${world.memoryId})`);
      await createTestTrackReflection(tx, {
        albumJournalId: world.journalId,
        albumId: world.album.albumId,
        trackId: world.album.trackIds[0]!,
        isPublished: true,
        ratingHalfSteps: 7,
        texts: { en: `${marker} reflection` },
      });
      const impact = await catalogPublicImpact(tx, [
        {
          op: "update_artist",
          artistId: world.artistA.id,
          name: uniqueLabel("Renamed"),
        },
        {
          op: "update_track",
          trackId: world.album.trackIds[0]!,
          title: uniqueLabel("Retitled"),
        },
      ]);
      expect(impact.pages.length).toBeGreaterThan(0);
      const text = JSON.stringify(impact);
      expect(text).not.toContain(marker);
      expect(text).not.toMatch(/rating|published_?at|body|excerpt|opening/i);
    });
  });

  it("does not depend on the public-reads or cover switch", async () => {
    const saved = {
      reads: process.env.REFRAIN_PUBLIC_READS_ENABLED,
      covers: process.env.REFRAIN_COVER_DISPLAY_ENABLED,
    };
    try {
      await inSnapshotTest(async (tx) => {
        const world = await servedWorld(tx);
        await tx.execute(sql`
          update albums
             set cover_url = 'https://coverartarchive.org/release/00000000-0000-4000-8000-000000000000/1-500.jpg',
                 cover_source = 'cover_art_archive'
           where id = ${world.album.albumId}`);
        const change: CatalogChange = [
          { op: "update_artist", artistId: world.artistA.id, name: "[Test] Z" },
        ];
        const impacts = [];
        for (const [reads, covers] of [
          [undefined, undefined],
          ["true", "true"],
          ["false", "false"],
        ] as const) {
          setEnv("REFRAIN_PUBLIC_READS_ENABLED", reads);
          setEnv("REFRAIN_COVER_DISPLAY_ENABLED", covers);
          impacts.push(await catalogPublicImpact(tx, change));
        }
        expect(pagesOf(impacts[0]!, world.journalId)).toHaveLength(2);
        expect(impacts[1]).toEqual(impacts[0]);
        expect(impacts[2]).toEqual(impacts[0]);
      });
    } finally {
      setEnv("REFRAIN_PUBLIC_READS_ENABLED", saved.reads);
      setEnv("REFRAIN_COVER_DISPLAY_ENABLED", saved.covers);
    }
  });

  it("lists a journal served only in Portuguese under both interface languages", async () => {
    await inSnapshotTest(async (tx) => {
      const artistId = await createTestArtist(tx, uniqueLabel("PT artist"));
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("PT album"),
        artistIds: [artistId],
      });
      const journalId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        slug: slugOf("pt only"),
        versions: [
          { locale: "pt-BR", status: "published", publishedAt: new Date() },
          { locale: "en", status: "draft" },
        ],
      });
      const title = uniqueLabel("PT retitled");
      const impact = await impactOf(
        tx,
        [{ op: "update_album", albumId: album.albumId, title }],
        () => confirmed.updateAlbum(tx, author, album.albumId, { title }),
      );
      expect(pagesOf(impact, journalId).map((page) => page.locale)).toEqual([
        "en",
        "pt-BR",
      ]);
    });
  });
});

describe("how it reads", () => {
  it("writes nothing: every table is unchanged, and the caller's writes still reach the catalog", async () => {
    await inSnapshotTest(async (tx) => {
      const world = await servedWorld(tx);
      const catalogSum = async () =>
        (
          await tx.execute<{ sum: string }>(
            sql.raw(`
            select ${CATALOG_TABLES.map(
              (table) =>
                `(select md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
                    from public.${table} x)`,
            ).join(" || ")} as sum`),
          )
        ).rows[0]!.sum;
      const entries = await rowChecksum(tx);
      const catalogBefore = await catalogSum();

      await catalogPublicImpact(tx, [
        { op: "update_artist", artistId: world.artistA.id, name: "[Test] X" },
        { op: "delete_album", albumId: world.album.albumId },
        {
          op: "create_track",
          trackId: crypto.randomUUID(),
          title: "[Test] New",
        },
      ]);

      expect(await catalogSum()).toBe(catalogBefore);
      expect(await rowChecksum(tx)).toEqual(entries);
      const copies = await tx.execute(sql`
        select 1 from pg_class where relnamespace = pg_my_temp_schema()`);
      expect(copies.rows).toEqual([]);

      // After the computation, a write in the caller's transaction reaches
      // the permanent table, not a copy.
      await confirmed.updateArtist(tx, author, world.artistA.id, {
        name: "[Test] After",
      });
      const stored = await tx.execute<{ name: string }>(sql`
        select name from public.artists where id = ${world.artistA.id}`);
      expect(stored.rows[0]!.name).toBe("[Test] After");
    });
  });

  it("finds its copies even when the search path names pg_temp last, and restores the path", async () => {
    await inSnapshotTest(async (tx) => {
      const world = await servedWorld(tx);
      const change: CatalogChange = [
        { op: "update_artist", artistId: world.artistA.id, name: "[Test] P" },
      ];
      const usual = await catalogPublicImpact(tx, change);
      expect(pagesOf(usual, world.journalId)).toHaveLength(2);

      await tx.execute(sql`set local search_path = public, pg_temp`);
      const hardened = await catalogPublicImpact(tx, change);
      expect(hardened).toEqual(usual);
      const path = await tx.execute<{ path: string }>(sql`
        select current_setting('search_path') as path`);
      expect(path.rows[0]!.path).toBe("public, pg_temp");
    });
  });

  it("refuses to start when a copy already exists in the session", async () => {
    await inSnapshotTest(async (tx) => {
      await tx.execute(
        sql`create temporary table artists (id uuid) on commit drop`,
      );
      await expect(
        catalogPublicImpact(tx, [
          {
            op: "update_artist",
            artistId: crypto.randomUUID(),
            name: "[Test] Y",
          },
        ]),
      ).rejects.toMatchObject({ code: "shadow_conflict" });
      await tx.execute(sql`drop table pg_temp.artists`);
    });
  });

  it("refuses an invalid change before reading anything", async () => {
    await expect(
      catalogPublicImpact(getDb(), [
        { op: "update_artist", artistId: "not an id", name: "[Test]" },
      ]),
    ).rejects.toBeInstanceOf(CatalogImpactError);
  });

  it("runs in its own snapshot when no transaction is given", async () => {
    const impact = await catalogPublicImpact(getDb(), [
      { op: "update_artist", artistId: crypto.randomUUID(), name: "[Test] Q" },
    ]);
    expect(isEmptyImpact(impact)).toBe(true);
  });
});

async function titleOf(tx: Transaction, albumId: string): Promise<string> {
  const result = await tx.execute<{ title: string }>(sql`
    select title from albums where id = ${albumId}`);
  return result.rows[0]!.title;
}

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
