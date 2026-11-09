import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, schema, type Transaction } from "@/db";
import {
  captureFailure,
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  inRollbackTransaction,
  testAuthor,
  uniqueLabel,
  withConnections,
} from "@/testing";
import { FIXTURE, releaseLookup, SCENARIO } from "@/testing/provider-fixtures";
import { providerResponse } from "@/testing/provider-mock";
import { fixtureProviders } from "@/testing/provider-runtime";

import { lockAlbumPublicExposure } from "@/modules/publication";

import { CatalogError } from "./errors";
import {
  importMusicArtist,
  importMusicRelease,
  linkAlbumToMusic,
  linkArtistToMusic,
  listAlbumArtworkChoices,
  listMusicEditions,
  removeAlbumArtwork,
  reviewMusicArtist,
  reviewMusicRelease,
  searchMusic,
  setAlbumArtwork,
} from "./music";
import { getAlbum } from "./queries";

// Adding music from MusicBrainz and artwork from the Cover Art Archive, on
// real PostgreSQL, with the real adapters answering from deterministic
// fixtures (no network). Everything is synthetic and rolled back, except the
// lock test, which commits and removes its own rows.

const author = testAuthor();
const FRONT = `https://coverartarchive.org/release/${FIXTURE.firstPressing}/${FIXTURE.frontImage}`;

function failureOf(error: unknown) {
  return error instanceof CatalogError ? error.failure : error;
}

async function failure(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    return failureOf(error);
  }
  return "no failure";
}

/** The same, inside a savepoint, so the test's transaction stays usable. */
async function refusal(
  tx: Transaction,
  work: (tx: Transaction) => Promise<unknown>,
) {
  return failureOf(await captureFailure(tx, work));
}

async function count(tx: Transaction, table: string) {
  const result = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return result.rows[0]!.n;
}

const CATALOG = [
  "artists",
  "albums",
  "album_artists",
  "album_editions",
  "tracks",
  "track_artists",
  "album_tracks",
  "edition_tracks",
] as const;

async function catalogCounts(tx: Transaction) {
  // One statement at a time: a transaction is one connection.
  const counts: Record<string, number> = {};
  for (const table of CATALOG) {
    counts[table] = await count(tx, table);
  }
  return counts;
}

async function reviewed(tx: Transaction, releaseId: string) {
  const { providers } = fixtureProviders();
  return reviewMusicRelease(tx, author, releaseId, providers);
}

describe("reviewing a release", () => {
  it("shows exactly what would be written, with nothing chosen for artwork", async () => {
    await inRollbackTransaction(async (tx) => {
      const review = await reviewed(tx, FIXTURE.firstPressing);
      expect(review.unsupported).toBeNull();
      expect(review.review).toMatch(/^[0-9a-f]{64}$/);
      expect(review.plan).toMatchObject({
        releaseGroupId: FIXTURE.paperMoon,
        releaseId: FIXTURE.firstPressing,
        title: "[Test] Paper Moon",
        firstReleaseYear: 1994,
        edition: {
          label: "[Test] Label",
          releaseDate: "1994-08-15",
          country: "GB",
        },
        credits: [{ mbArtistId: FIXTURE.inkQuartet, creditedAs: null }],
      });
      expect(
        review.plan!.tracks.map((t) => [t.discNumber, t.position, t.title]),
      ).toEqual([
        [1, 1, "[Test] Opening Line"],
        [1, 2, "[Test] Second Verse"],
        [1, 3, "[Test] Last Light"],
      ]);
      expect(review.plan!.tracks[1]!.artistMbIds).toEqual([
        FIXTURE.inkQuartet,
        FIXTURE.paperSinger,
      ]);
      expect(review.artists.map((a) => [a.name, a.kind, a.existing])).toEqual([
        ["[Test] Ink Quartet", "group", null],
        ["[Test] Paper Singer", "person", null],
      ]);
      // Only front images are offered, and they are built, not copied.
      expect(review.artwork.map((choice) => choice.imageId)).toEqual([
        FIXTURE.frontImage,
      ]);
      expect(review.artwork[0]!.artwork.coverUrl).toBe(FRONT);
      expect(review.existingAlbum).toBeNull();
      expect(review.sameTitle).toEqual([]);
    });
  });

  it("marks what is already in the catalog and albums that could be linked instead", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(
        tx,
        "[Test] Ink Quartet (my spelling)",
      );
      await tx
        .update(schema.artists)
        .set({ mbArtistId: FIXTURE.inkQuartet })
        .where(eq(schema.artists.id, artistId));
      const manual = await createTestAlbum(tx, {
        title: "[test] paper moon",
        artistIds: [artistId],
      });

      const review = await reviewed(tx, FIXTURE.firstPressing);
      expect(review.artists[0]!.existing).toEqual({
        id: artistId,
        name: "[Test] Ink Quartet (my spelling)",
        archived: false,
      });
      expect(review.sameTitle.map((album) => album.id)).toEqual([
        manual.albumId,
      ]);
    });
  });

  it("says why a release cannot be imported as one album", async () => {
    await inRollbackTransaction(async (tx) => {
      const review = await reviewed(tx, FIXTURE.repeatedRecording);
      expect(review.unsupported).toBe("repeated_recording");
      expect(review.plan).toBeNull();
      expect(review.review).toBeNull();
      expect(review.linkReview).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it("keeps working without artwork when the archive is unreachable", async () => {
    await inRollbackTransaction(async (tx) => {
      const { providers } = fixtureProviders((url) =>
        url.includes("/caa/")
          ? new Response(null, { status: 503 })
          : providerResponse(url),
      );
      const review = await reviewMusicRelease(
        tx,
        author,
        FIXTURE.firstPressing,
        providers,
      );
      expect(review.artworkUnavailable).toBe(true);
      expect(review.artwork).toEqual([]);
      expect(review.review).not.toBeNull();
    });
  });

  it("does not ask the archive when MusicBrainz says there is no front cover", async () => {
    await inRollbackTransaction(async (tx) => {
      const { providers, calls } = fixtureProviders();
      await reviewMusicRelease(tx, author, FIXTURE.digitalEdition, providers);
      expect(calls.some((call) => call.url.includes("/caa/"))).toBe(false);
    });
  });
});

describe("importing a release (boundary 1)", () => {
  it("adds the album, its reference edition, credits, tracks, and order in one go, publishing nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const entriesBefore = await count(tx, "entries");
      const { review } = await reviewed(tx, FIXTURE.firstPressing);
      const { providers } = fixtureProviders();
      const { id } = await importMusicRelease(
        tx,
        author,
        {
          releaseId: FIXTURE.firstPressing,
          review,
          coverImageId: FIXTURE.frontImage,
        },
        providers,
      );

      const album = await getAlbum(tx, author, id);
      expect(album).toMatchObject({
        title: "[Test] Paper Moon",
        firstReleaseYear: 1994,
        mbReleaseGroupId: FIXTURE.paperMoon,
        edition: {
          label: "[Test] Label",
          releaseDate: "1994-08-15",
          country: "GB",
          mbReleaseId: FIXTURE.firstPressing,
        },
        credits: [{ artistName: "[Test] Ink Quartet", creditedAs: null }],
      });
      expect(album!.artwork?.coverUrl).toBe(FRONT);
      expect(
        album!.tracklist.map((t) => [
          t.position,
          t.title,
          t.lengthMs,
          t.artistNames,
        ]),
      ).toEqual([
        [1, "[Test] Opening Line", 342266, "[Test] Ink Quartet"],
        [
          2,
          "[Test] Second Verse",
          322066,
          "[Test] Ink Quartet, [Test] Paper Singer",
        ],
        [3, "[Test] Last Light", null, "[Test] Ink Quartet"],
      ]);
      const [stored] = await tx
        .select({ source: schema.albums.coverSource })
        .from(schema.albums)
        .where(eq(schema.albums.id, id));
      expect(stored!.source).toBe("Cover Art Archive");
      const tracks = await tx
        .select({
          mbRecordingId: schema.tracks.mbRecordingId,
          credit: schema.tracks.credit,
        })
        .from(schema.tracks)
        .where(
          inArray(schema.tracks.mbRecordingId, [
            FIXTURE.recording1,
            FIXTURE.recording2,
          ]),
        );
      expect(tracks.every((track) => track.credit === null)).toBe(true);
      expect(await count(tx, "entries")).toBe(entriesBefore);
    });
  });

  it("adds no artwork unless the author chose it", async () => {
    await inRollbackTransaction(async (tx) => {
      const { review } = await reviewed(tx, FIXTURE.firstPressing);
      const { providers, calls } = fixtureProviders();
      const { id } = await importMusicRelease(
        tx,
        author,
        { releaseId: FIXTURE.firstPressing, review },
        providers,
      );
      expect((await getAlbum(tx, author, id))!.artwork).toBeNull();
      expect(calls.some((call) => call.url.includes("/caa/"))).toBe(false);
    });
  });

  it("keeps the release group and the release distinct: a multi-disc edition keeps its discs", async () => {
    await inRollbackTransaction(async (tx) => {
      const { review } = await reviewed(tx, FIXTURE.legacyEdition);
      const { providers } = fixtureProviders();
      const { id } = await importMusicRelease(
        tx,
        author,
        { releaseId: FIXTURE.legacyEdition, review },
        providers,
      );
      const album = await getAlbum(tx, author, id);
      expect(album!.mbReleaseGroupId).toBe(FIXTURE.paperMoon);
      expect(album!.edition!.mbReleaseId).toBe(FIXTURE.legacyEdition);
      expect(album!.tracklist.map((t) => [t.discNumber, t.position])).toEqual([
        [1, 1],
        [1, 2],
        [1, 3],
        [2, 1],
      ]);
      // A partial date is not stored as a full one.
      expect(album!.firstReleaseYear).toBe(1994);
    });
  });

  it("reuses artists and recordings already in the catalog without changing them", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, "[Test] My Own Spelling");
      await tx
        .update(schema.artists)
        .set({ mbArtistId: FIXTURE.inkQuartet, sortName: "[Test] keep" })
        .where(eq(schema.artists.id, artistId));
      const [track] = await tx
        .insert(schema.tracks)
        .values({
          title: "[Test] My Title",
          lengthMs: 1,
          mbRecordingId: FIXTURE.recording1,
        })
        .returning({ id: schema.tracks.id });
      const before = await tx
        .select()
        .from(schema.artists)
        .where(eq(schema.artists.id, artistId));
      const trackBefore = await tx
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.id, track!.id));

      const { review } = await reviewed(tx, FIXTURE.firstPressing);
      const { providers } = fixtureProviders();
      const { id } = await importMusicRelease(
        tx,
        author,
        { releaseId: FIXTURE.firstPressing, review },
        providers,
      );

      expect(
        await tx
          .select()
          .from(schema.artists)
          .where(eq(schema.artists.id, artistId)),
      ).toEqual(before);
      expect(
        await tx
          .select()
          .from(schema.tracks)
          .where(eq(schema.tracks.id, track!.id)),
      ).toEqual(trackBefore);
      const album = await getAlbum(tx, author, id);
      expect(album!.credits[0]!.artistId).toBe(artistId);
      expect(album!.tracklist[0]!.trackId).toBe(track!.id);
      expect(album!.tracklist[0]!.title).toBe("[Test] My Title");
    });
  });

  it("refuses an archived artist or recording instead of using it, writing nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, "[Test] Archived");
      await tx
        .update(schema.artists)
        .set({ mbArtistId: FIXTURE.paperSinger, archivedAt: sql`now()` })
        .where(eq(schema.artists.id, artistId));
      const counts = await catalogCounts(tx);
      const { review } = await reviewed(tx, FIXTURE.firstPressing);
      const { providers } = fixtureProviders();
      expect(
        await refusal(tx, (savepoint) =>
          importMusicRelease(
            savepoint,
            author,
            { releaseId: FIXTURE.firstPressing, review },
            providers,
          ),
        ),
      ).toBe("archived_reference");
      expect(await catalogCounts(tx)).toEqual(counts);
    });
  });

  it("refuses a release group or a release that is already in the catalog", async () => {
    await inRollbackTransaction(async (tx) => {
      const first = await reviewed(tx, FIXTURE.firstPressing);
      const { providers } = fixtureProviders();
      await importMusicRelease(
        tx,
        author,
        { releaseId: FIXTURE.firstPressing, review: first.review },
        providers,
      );
      const counts = await catalogCounts(tx);

      // Another edition of the same release group: the album already exists.
      const legacy = await reviewed(tx, FIXTURE.legacyEdition);
      expect(legacy.existingAlbum?.title).toBe("[Test] Paper Moon");
      expect(
        await refusal(tx, (savepoint) =>
          importMusicRelease(
            savepoint,
            author,
            { releaseId: FIXTURE.legacyEdition, review: legacy.review },
            providers,
          ),
        ),
      ).toBe("duplicate_identifier");
      expect(
        await refusal(tx, (savepoint) =>
          importMusicRelease(
            savepoint,
            author,
            { releaseId: FIXTURE.firstPressing, review: first.review },
            providers,
          ),
        ),
      ).toBe("duplicate_identifier");
      expect(await catalogCounts(tx)).toEqual(counts);
    });
  });

  it("asks MusicBrainz again on approval, even when the review came from its cache", async () => {
    await inRollbackTransaction(async (tx) => {
      let edited = false;
      const changed = releaseLookup(FIXTURE.firstPressing)!;
      changed.media[0]!.tracks[0]!.title = "[Test] Opening Line (edited)";
      // One client for the review and the approval, as in the server.
      const { providers } = fixtureProviders((url) =>
        edited &&
        new URL(url).pathname === `/ws/2/release/${FIXTURE.firstPressing}`
          ? new Response(JSON.stringify(changed))
          : providerResponse(url),
      );
      const { review } = await reviewMusicRelease(
        tx,
        author,
        FIXTURE.firstPressing,
        providers,
      );
      edited = true;
      const counts = await catalogCounts(tx);
      expect(
        await failure(() =>
          importMusicRelease(
            tx,
            author,
            { releaseId: FIXTURE.firstPressing, review },
            providers,
          ),
        ),
      ).toBe("review_stale");
      expect(await catalogCounts(tx)).toEqual(counts);
    });
  });

  it("writes nothing when the provider's data is not what was reviewed", async () => {
    await inRollbackTransaction(async (tx) => {
      const counts = await catalogCounts(tx);
      const { review } = await reviewed(tx, FIXTURE.firstPressing);
      // MusicBrainz changed a track title after the review.
      const edited = releaseLookup(FIXTURE.firstPressing)!;
      edited.media[0]!.tracks[2]!.title = "[Test] Last Light (edited)";
      const { providers } = fixtureProviders((url) =>
        new URL(url).pathname === `/ws/2/release/${FIXTURE.firstPressing}`
          ? new Response(JSON.stringify(edited))
          : providerResponse(url),
      );
      expect(
        await failure(() =>
          importMusicRelease(
            tx,
            author,
            { releaseId: FIXTURE.firstPressing, review },
            providers,
          ),
        ),
      ).toBe("review_stale");
      // A fingerprint that was never issued.
      expect(
        await failure(() =>
          importMusicRelease(
            tx,
            author,
            { releaseId: FIXTURE.firstPressing, review: "0".repeat(64) },
            fixtureProviders().providers,
          ),
        ),
      ).toBe("review_stale");
      // A cover the release does not list as a front image.
      expect(
        await failure(() =>
          importMusicRelease(
            tx,
            author,
            {
              releaseId: FIXTURE.firstPressing,
              review,
              coverImageId: FIXTURE.backImage,
            },
            fixtureProviders().providers,
          ),
        ),
      ).toBe("review_stale");
      expect(await catalogCounts(tx)).toEqual(counts);
    });
  });

  it("refuses an unsupported release and invalid input", async () => {
    await inRollbackTransaction(async (tx) => {
      const { providers } = fixtureProviders();
      expect(
        await failure(() =>
          importMusicRelease(
            tx,
            author,
            { releaseId: FIXTURE.repeatedRecording, review: "0".repeat(64) },
            providers,
          ),
        ),
      ).toBe("unsupported_release");
      for (const input of [
        {},
        { releaseId: "not-an-id", review: "0".repeat(64) },
        { releaseId: FIXTURE.firstPressing, review: "short" },
        {
          releaseId: FIXTURE.firstPressing,
          review: "0".repeat(64),
          coverImageId: "../x",
        },
        {
          releaseId: FIXTURE.firstPressing,
          review: "0".repeat(64),
          coverImageId: "https://evil.example/x.jpg",
        },
      ]) {
        expect(
          await failure(() => importMusicRelease(tx, author, input, providers)),
        ).toBe("invalid_input");
      }
    });
  });

  it("reports an unreachable provider and writes nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const counts = await catalogCounts(tx);
      const { providers } = fixtureProviders(
        () => new Response(null, { status: 503 }),
      );
      expect(
        await failure(() =>
          importMusicRelease(
            tx,
            author,
            { releaseId: FIXTURE.firstPressing, review: "0".repeat(64) },
            providers,
          ),
        ),
      ).toBe("provider_unavailable");
      expect(
        await failure(() =>
          searchMusic(
            tx,
            author,
            { kind: "albums", query: "paper" },
            providers,
          ),
        ),
      ).toBe("provider_unavailable");
      expect(await catalogCounts(tx)).toEqual(counts);
    });
  });
});

describe("searching", () => {
  it("lists MusicBrainz results, marks those in the catalog, and finds catalog matches", async () => {
    await inRollbackTransaction(async (tx) => {
      const { review } = await reviewed(tx, FIXTURE.firstPressing);
      const { providers, calls } = fixtureProviders();
      const { id } = await importMusicRelease(
        tx,
        author,
        { releaseId: FIXTURE.firstPressing, review },
        providers,
      );
      const found = await searchMusic(
        tx,
        author,
        { kind: "albums", query: "Paper 100%_" },
        providers,
      );
      expect(found.kind).toBe("albums");
      if (found.kind !== "albums") return;
      // `%` and `_` are matched literally, so nothing local matches here.
      expect(found.local).toEqual([]);
      const albums = await searchMusic(
        tx,
        author,
        { kind: "albums", query: "paper moon" },
        providers,
      );
      if (albums.kind !== "albums") return;
      expect(albums.local.map((album) => album.id)).toEqual([id]);
      expect(albums.results.map((r) => r.catalogAlbumId)).toEqual([
        id,
        null,
        null,
      ]);
      expect(albums.results[0]!.credit).toBe("[Test] Ink Quartet");
      // Only the words reach MusicBrainz.
      expect(new URL(calls.at(-1)!.url).searchParams.get("query")).toBe(
        "(paper moon) OR artist:(paper moon)",
      );
      // Words of the title and of the artist find it together, in any order.
      for (const query of ["paper moon ink quartet", "quartet paper"]) {
        const across = await searchMusic(
          tx,
          author,
          { kind: "albums", query },
          providers,
        );
        if (across.kind !== "albums") return;
        expect(across.local.map((album) => album.id)).toEqual([id]);
      }
      const unrelated = await searchMusic(
        tx,
        author,
        { kind: "albums", query: "paper someone else" },
        providers,
      );
      if (unrelated.kind !== "albums") return;
      expect(unrelated.local).toEqual([]);
      // A wildcard, a quote, or a later unrelated word matches nothing extra.
      for (const query of [
        "paper %",
        "paper _",
        "paper moon'",
        "paper moon ink quartet one two three four five unrelated",
      ]) {
        const literal = await searchMusic(
          tx,
          author,
          { kind: "albums", query },
          providers,
        );
        if (literal.kind !== "albums") return;
        expect(literal.local).toEqual([]);
      }
    });
  });

  it("finds artists, and nothing for words with no match", async () => {
    await inRollbackTransaction(async (tx) => {
      const { providers } = fixtureProviders();
      const artists = await searchMusic(
        tx,
        author,
        { kind: "artists", query: "ink" },
        providers,
      );
      if (artists.kind !== "artists") throw new Error("expected artists");
      expect(artists.results.map((r) => r.name)).toEqual([
        "[Test] Ink Quartet",
        "[Test] Paper Singer",
      ]);
      const nothing = await searchMusic(
        tx,
        author,
        { kind: "albums", query: SCENARIO.nothing },
        providers,
      );
      expect(nothing.results).toEqual([]);
      expect(
        await failure(() =>
          searchMusic(tx, author, { kind: "tracks", query: "x" }, providers),
        ),
      ).toBe("invalid_input");
      expect(
        await failure(() =>
          searchMusic(tx, author, { kind: "albums", query: " " }, providers),
        ),
      ).toBe("invalid_input");
    });
  });

  it("lists a release group's editions and which are in the catalog", async () => {
    await inRollbackTransaction(async (tx) => {
      const { providers } = fixtureProviders();
      const before = await listMusicEditions(
        tx,
        author,
        FIXTURE.paperMoon,
        providers,
      );
      expect(before.catalogAlbum).toBeNull();
      expect(before.group.title).toBe("[Test] Paper Moon");
      expect(before.releases.map((r) => r.id)).toEqual([
        FIXTURE.firstPressing,
        FIXTURE.legacyEdition,
        FIXTURE.digitalEdition,
      ]);
      // A preview only where MusicBrainz says there is a front cover, built
      // from the release's identifier.
      expect(before.releases[0]!.artwork?.src).toBe(
        `https://coverartarchive.org/release/${FIXTURE.firstPressing}/front-250`,
      );
      expect(before.releases[2]!.hasFrontArtwork).toBe(false);
      expect(before.releases[2]!.artwork).toBeNull();
      const { review } = await reviewed(tx, FIXTURE.firstPressing);
      const { id } = await importMusicRelease(
        tx,
        author,
        { releaseId: FIXTURE.firstPressing, review },
        providers,
      );
      const after = await listMusicEditions(
        tx,
        author,
        FIXTURE.paperMoon,
        providers,
      );
      expect(after.catalogAlbum?.id).toBe(id);
      expect(after.releases[0]!.catalogAlbumId).toBe(id);
      expect(
        await failure(() => listMusicEditions(tx, author, "nope", providers)),
      ).toBe("invalid_input");
      expect(
        await failure(() =>
          listMusicEditions(
            tx,
            author,
            "00000000-0000-4000-8000-000000000000",
            providers,
          ),
        ),
      ).toBe("provider_not_found");
    });
  });
});

describe("linking an existing album", () => {
  it("fills only the empty identifiers and changes nothing a page shows", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const manual = await createTestAlbum(tx, {
        title: "[Test] Paper Moon",
        artistIds: [artistId],
        firstReleaseYear: 1993,
      });
      const before = await getAlbum(tx, author, manual.albumId);
      const { linkReview } = await reviewed(tx, FIXTURE.firstPressing);
      const { providers } = fixtureProviders();
      await linkAlbumToMusic(
        tx,
        author,
        {
          albumId: manual.albumId,
          releaseId: FIXTURE.firstPressing,
          review: linkReview,
        },
        providers,
      );
      const after = await getAlbum(tx, author, manual.albumId);
      expect(after).toEqual({
        ...before,
        mbReleaseGroupId: FIXTURE.paperMoon,
        edition: { ...before!.edition, mbReleaseId: FIXTURE.firstPressing },
      });
      // Linking again to the same identity changes nothing.
      await linkAlbumToMusic(
        tx,
        author,
        {
          albumId: manual.albumId,
          releaseId: FIXTURE.firstPressing,
          review: linkReview,
        },
        providers,
      );
      expect(await getAlbum(tx, author, manual.albumId)).toEqual(after);
    });
  });

  it("never replaces another identity, and refuses a stale review", async () => {
    await inRollbackTransaction(async (tx) => {
      const manual = await createTestAlbum(tx, { title: "[Test] Paper Moon" });
      await tx
        .update(schema.albums)
        .set({ mbReleaseGroupId: FIXTURE.paperMoonCover })
        .where(eq(schema.albums.id, manual.albumId));
      const { linkReview } = await reviewed(tx, FIXTURE.firstPressing);
      const { providers } = fixtureProviders();
      expect(
        await refusal(tx, (savepoint) =>
          linkAlbumToMusic(
            savepoint,
            author,
            {
              albumId: manual.albumId,
              releaseId: FIXTURE.firstPressing,
              review: linkReview,
            },
            providers,
          ),
        ),
      ).toBe("already_linked");

      const other = await createTestAlbum(tx, { title: "[Test] Other" });
      await tx
        .update(schema.albumEditions)
        .set({ mbReleaseId: FIXTURE.legacyEdition })
        .where(eq(schema.albumEditions.id, other.editionId));
      expect(
        await refusal(tx, (savepoint) =>
          linkAlbumToMusic(
            savepoint,
            author,
            {
              albumId: other.albumId,
              releaseId: FIXTURE.firstPressing,
              review: linkReview,
            },
            providers,
          ),
        ),
      ).toBe("already_linked");
      expect(
        await refusal(tx, (savepoint) =>
          linkAlbumToMusic(
            savepoint,
            author,
            {
              albumId: other.albumId,
              releaseId: FIXTURE.firstPressing,
              review: "1".repeat(64),
            },
            providers,
          ),
        ),
      ).toBe("review_stale");
    });
  });

  it("refuses a second album with the same release group", async () => {
    await inRollbackTransaction(async (tx) => {
      const { review, linkReview } = await reviewed(tx, FIXTURE.firstPressing);
      const { providers } = fixtureProviders();
      await importMusicRelease(
        tx,
        author,
        { releaseId: FIXTURE.firstPressing, review },
        providers,
      );
      const manual = await createTestAlbum(tx, { title: "[Test] Paper Moon" });
      expect(
        await refusal(tx, (savepoint) =>
          linkAlbumToMusic(
            savepoint,
            author,
            {
              albumId: manual.albumId,
              releaseId: FIXTURE.firstPressing,
              review: linkReview,
            },
            providers,
          ),
        ),
      ).toBe("duplicate_identifier");
    });
  });
});

describe("artists", () => {
  it("adds a reviewed artist, refuses it twice, and links a manual one without renaming it", async () => {
    await inRollbackTransaction(async (tx) => {
      const { providers } = fixtureProviders();
      const review = await reviewMusicArtist(
        tx,
        author,
        FIXTURE.paperSinger,
        providers,
      );
      expect(review.plan).toMatchObject({
        name: "[Test] Paper Singer",
        kind: "person",
        kindFromProvider: true,
      });
      const { id } = await importMusicArtist(
        tx,
        author,
        { mbArtistId: FIXTURE.paperSinger, review: review.review },
        providers,
      );
      const [row] = await tx
        .select()
        .from(schema.artists)
        .where(eq(schema.artists.id, id));
      expect(row).toMatchObject({
        name: "[Test] Paper Singer",
        sortName: "Singer, [Test] Paper",
        kind: "person",
        mbArtistId: FIXTURE.paperSinger,
      });
      expect(
        await refusal(tx, (savepoint) =>
          importMusicArtist(
            savepoint,
            author,
            { mbArtistId: FIXTURE.paperSinger, review: review.review },
            providers,
          ),
        ),
      ).toBe("duplicate_identifier");

      const manualId = await createTestArtist(tx, "[test] ink quartet");
      const quartet = await reviewMusicArtist(
        tx,
        author,
        FIXTURE.inkQuartet,
        providers,
      );
      expect(quartet.sameName.map((artist) => artist.id)).toEqual([manualId]);
      await linkArtistToMusic(
        tx,
        author,
        {
          artistId: manualId,
          mbArtistId: FIXTURE.inkQuartet,
          review: quartet.review,
        },
        providers,
      );
      const [linked] = await tx
        .select()
        .from(schema.artists)
        .where(eq(schema.artists.id, manualId));
      expect(linked).toMatchObject({
        name: "[test] ink quartet",
        kind: "person",
        mbArtistId: FIXTURE.inkQuartet,
      });
      expect(
        await refusal(tx, (savepoint) =>
          linkArtistToMusic(
            savepoint,
            author,
            {
              artistId: id,
              mbArtistId: FIXTURE.inkQuartet,
              review: quartet.review,
            },
            providers,
          ),
        ),
      ).toBe("already_linked");
    });
  });
});

describe("artwork", () => {
  async function linkedAlbum(tx: Transaction) {
    const { review } = await reviewed(tx, FIXTURE.firstPressing);
    const { providers } = fixtureProviders();
    const { id } = await importMusicRelease(
      tx,
      author,
      { releaseId: FIXTURE.firstPressing, review },
      providers,
    );
    return id;
  }

  it("lists front covers of the album's own release, and sets and removes one", async () => {
    await inRollbackTransaction(async (tx) => {
      const albumId = await linkedAlbum(tx);
      const { providers } = fixtureProviders();
      const choices = await listAlbumArtworkChoices(
        tx,
        author,
        albumId,
        providers,
      );
      expect(choices).toMatchObject({
        linked: true,
        source: "release",
        onPublicPage: false,
        current: null,
      });
      expect(choices!.choices.map((c) => c.imageId)).toEqual([
        FIXTURE.frontImage,
      ]);

      await setAlbumArtwork(
        tx,
        author,
        {
          albumId,
          releaseId: FIXTURE.firstPressing,
          imageId: FIXTURE.frontImage,
          expectedCoverUrl: null,
        },
        providers,
      );
      expect((await getAlbum(tx, author, albumId))!.artwork?.coverUrl).toBe(
        FRONT,
      );

      // Another release of the same release group.
      const legacy = `https://coverartarchive.org/release/${FIXTURE.legacyEdition}/${FIXTURE.legacyFrontImage}`;
      await setAlbumArtwork(
        tx,
        author,
        {
          albumId,
          releaseId: FIXTURE.legacyEdition,
          imageId: FIXTURE.legacyFrontImage,
          expectedCoverUrl: FRONT,
        },
        providers,
      );
      expect((await getAlbum(tx, author, albumId))!.artwork?.coverUrl).toBe(
        legacy,
      );

      await removeAlbumArtwork(tx, author, {
        albumId,
        expectedCoverUrl: legacy,
      });
      const [row] = await tx
        .select()
        .from(schema.albums)
        .where(eq(schema.albums.id, albumId));
      expect([row!.coverUrl, row!.coverSource]).toEqual([null, null]);
    });
  });

  it("never replaces artwork the author did not see, and refuses foreign or back images", async () => {
    await inRollbackTransaction(async (tx) => {
      const albumId = await linkedAlbum(tx);
      const { providers } = fixtureProviders();
      await setAlbumArtwork(
        tx,
        author,
        {
          albumId,
          releaseId: FIXTURE.firstPressing,
          imageId: FIXTURE.frontImage,
          expectedCoverUrl: null,
        },
        providers,
      );
      const attempts: [string, unknown][] = [
        [
          "stale expectation",
          {
            albumId,
            releaseId: FIXTURE.legacyEdition,
            imageId: FIXTURE.legacyFrontImage,
            expectedCoverUrl: null,
          },
        ],
        [
          "back image",
          {
            albumId,
            releaseId: FIXTURE.firstPressing,
            imageId: FIXTURE.backImage,
            expectedCoverUrl: FRONT,
          },
        ],
        [
          "unknown image",
          {
            albumId,
            releaseId: FIXTURE.firstPressing,
            imageId: "999",
            expectedCoverUrl: FRONT,
          },
        ],
      ];
      for (const [label, input] of attempts) {
        expect(
          await refusal(tx, (savepoint) =>
            setAlbumArtwork(savepoint, author, input, providers),
          ),
          label,
        ).toBe("review_stale");
      }
      expect(
        await refusal(tx, (savepoint) =>
          removeAlbumArtwork(savepoint, author, {
            albumId,
            expectedCoverUrl: null,
          }),
        ),
      ).toBe("review_stale");
      expect((await getAlbum(tx, author, albumId))!.artwork?.coverUrl).toBe(
        FRONT,
      );
    });
  });

  it("refuses a release of another release group, an unlinked album, and invalid input", async () => {
    await inRollbackTransaction(async (tx) => {
      const { providers } = fixtureProviders();
      const manual = await createTestAlbum(tx, { title: "[Test] Elsewhere" });
      expect(
        await refusal(tx, (savepoint) =>
          setAlbumArtwork(
            savepoint,
            author,
            {
              albumId: manual.albumId,
              releaseId: FIXTURE.firstPressing,
              imageId: FIXTURE.frontImage,
              expectedCoverUrl: null,
            },
            providers,
          ),
        ),
      ).toBe("not_linked");
      await tx
        .update(schema.albums)
        .set({ mbReleaseGroupId: FIXTURE.paperMoonCover })
        .where(eq(schema.albums.id, manual.albumId));
      expect(
        await refusal(tx, (savepoint) =>
          setAlbumArtwork(
            savepoint,
            author,
            {
              albumId: manual.albumId,
              releaseId: FIXTURE.firstPressing,
              imageId: FIXTURE.frontImage,
              expectedCoverUrl: null,
            },
            providers,
          ),
        ),
      ).toBe("review_stale");
      for (const input of [
        {
          albumId: manual.albumId,
          releaseId: FIXTURE.firstPressing,
          imageId: "https://evil.example/a.jpg",
          expectedCoverUrl: null,
        },
        {
          albumId: manual.albumId,
          releaseId: "javascript:alert(1)",
          imageId: "1",
          expectedCoverUrl: null,
        },
        {
          albumId: "x",
          releaseId: FIXTURE.firstPressing,
          imageId: "1",
          expectedCoverUrl: null,
        },
      ]) {
        expect(
          await refusal(tx, (savepoint) =>
            setAlbumArtwork(savepoint, author, input, providers),
          ),
        ).toBe("invalid_input");
      }
    });
  });

  it("refuses any artwork change while the album is on a public page, and allows it otherwise", async () => {
    await inRollbackTransaction(async (tx) => {
      const albumId = await linkedAlbum(tx);
      const { providers } = fixtureProviders();
      // A private journal and a deleted published one do not make it public.
      await createTestAlbumJournal(tx, {
        albumId,
        versions: [{ locale: "en", status: "private" }],
      });
      await createTestAlbumJournal(tx, {
        albumId,
        versions: [{ locale: "en", status: "published" }],
        deletedAt: new Date(),
      });
      expect(
        (await listAlbumArtworkChoices(tx, author, albumId, providers))!
          .onPublicPage,
      ).toBe(false);
      await setAlbumArtwork(
        tx,
        author,
        {
          albumId,
          releaseId: FIXTURE.firstPressing,
          imageId: FIXTURE.frontImage,
          expectedCoverUrl: null,
        },
        providers,
      );

      // A translation alone being published is enough.
      await createTestAlbumJournal(tx, {
        albumId,
        versions: [
          { locale: "en", status: "draft" },
          { locale: "pt-BR", status: "published", isOriginal: false },
        ],
      });
      expect(
        (await listAlbumArtworkChoices(tx, author, albumId, providers))!
          .onPublicPage,
      ).toBe(true);
      expect(
        await refusal(tx, (savepoint) =>
          setAlbumArtwork(
            savepoint,
            author,
            {
              albumId,
              releaseId: FIXTURE.legacyEdition,
              imageId: FIXTURE.legacyFrontImage,
              expectedCoverUrl: FRONT,
            },
            providers,
          ),
        ),
      ).toBe("public_page");
      expect(
        await refusal(tx, (savepoint) =>
          removeAlbumArtwork(savepoint, author, {
            albumId,
            expectedCoverUrl: FRONT,
          }),
        ),
      ).toBe("public_page");
      expect((await getAlbum(tx, author, albumId))!.artwork?.coverUrl).toBe(
        FRONT,
      );
    });
  });

  it("shows no artwork for a stored value that is not the one canonical form", async () => {
    await inRollbackTransaction(async (tx) => {
      const manual = await createTestAlbum(tx, { title: "[Test] Tampered" });
      for (const [coverUrl, coverSource] of [
        ["https://evil.example/cover.jpg", "Cover Art Archive"],
        [`${FRONT}-500.jpg`, "Cover Art Archive"],
        [FRONT, "Somewhere"],
      ]) {
        await tx
          .update(schema.albums)
          .set({ coverUrl, coverSource })
          .where(eq(schema.albums.id, manual.albumId));
        expect(
          (await getAlbum(tx, author, manual.albumId))!.artwork,
          coverUrl,
        ).toBeNull();
      }
    });
  });
});

describe("the artwork guard and publishing, over real connections", () => {
  const raced: { albumId?: string; entryId?: string } = {};
  afterAll(async () => {
    const db = getDb();
    if (raced.entryId) {
      await db
        .delete(schema.entries)
        .where(eq(schema.entries.id, raced.entryId));
    }
    if (raced.albumId) {
      await db.delete(schema.albums).where(eq(schema.albums.id, raced.albumId));
    }
  });

  const created: { albumId?: string; entryId?: string; artistIds: string[] } = {
    artistIds: [],
  };

  afterAll(async () => {
    const db = getDb();
    if (created.entryId) {
      await db
        .delete(schema.entries)
        .where(eq(schema.entries.id, created.entryId));
    }
    if (created.albumId) {
      await db
        .delete(schema.albums)
        .where(eq(schema.albums.id, created.albumId));
    }
    if (created.artistIds.length > 0) {
      await db
        .delete(schema.artists)
        .where(inArray(schema.artists.id, created.artistIds));
    }
  });

  it("holds every journal entry of the album, so a publish waits for the artwork change", async () => {
    const db = getDb();
    const [album] = await db
      .insert(schema.albums)
      .values({ title: uniqueLabel("Guarded") })
      .returning({ id: schema.albums.id });
    created.albumId = album!.id;
    const [entry] = await db
      .insert(schema.entries)
      .values({ kind: "album_journal" })
      .returning({ id: schema.entries.id });
    created.entryId = entry!.id;
    await db
      .insert(schema.entryTexts)
      .values({ entryId: entry!.id, locale: "en", isOriginal: true });
    await db
      .insert(schema.albumJournals)
      .values({ entryId: entry!.id, albumId: album!.id });

    await withConnections(2, async ([first, second]) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const guard = first!.transaction(async (tx) => {
        expect(await lockAlbumPublicExposure(tx, album!.id)).toBe(false);
        locked();
        await held;
      });
      await isLocked;
      // The lock a publish takes cannot be granted meanwhile.
      const blocked = await second!
        .transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '300ms'`);
          await tx.execute(
            sql`select id from entries where id = ${entry!.id} for update`,
          );
        })
        .then(
          () => "granted",
          (error: unknown) =>
            (error as { cause?: { code?: string } }).cause?.code ??
            String(error),
        );
      release();
      await guard;
      expect(blocked).toBe("55P03");
    });
  });

  it("refuses the change once a publish that held the entry has committed", async () => {
    const db = getDb();
    const [album] = await db
      .insert(schema.albums)
      .values({
        title: uniqueLabel("Raced"),
        mbReleaseGroupId: FIXTURE.paperMoon,
      })
      .returning({ id: schema.albums.id });
    raced.albumId = album!.id;
    await db.insert(schema.albumEditions).values({
      albumId: album!.id,
      isReference: true,
      mbReleaseId: FIXTURE.firstPressing,
    });
    const [entry] = await db
      .insert(schema.entries)
      .values({ kind: "album_journal" })
      .returning({ id: schema.entries.id });
    raced.entryId = entry!.id;
    await db
      .insert(schema.entryTexts)
      .values({ entryId: entry!.id, locale: "en", isOriginal: true });
    await db
      .insert(schema.albumJournals)
      .values({ entryId: entry!.id, albumId: album!.id });

    const { providers } = fixtureProviders();
    await withConnections(2, async ([first, second]) => {
      let commit!: () => void;
      const committing = new Promise<void>((resolve) => (commit = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // A publish in progress: the entry locked, the version published.
      const publish = first!.transaction(async (tx) => {
        await tx.execute(
          sql`select id from entries where id = ${entry!.id} for update`,
        );
        await tx.execute(sql`
          update entry_texts
             set status = 'published', published_at = now(),
                 first_published_at = now()
           where entry_id = ${entry!.id}`);
        locked();
        await committing;
      });
      await isLocked;
      const change = setAlbumArtwork(
        second!,
        author,
        {
          albumId: album!.id,
          releaseId: FIXTURE.firstPressing,
          imageId: FIXTURE.frontImage,
          expectedCoverUrl: null,
        },
        providers,
      ).then(
        () => "changed",
        (error: unknown) => failureOf(error),
      );
      // Wait until the artwork change is queued behind the publish's lock.
      for (let tries = 0; tries < 100; tries++) {
        const waiting = await db.execute<{ n: number }>(sql`
          select count(*)::int as n from pg_stat_activity
           where application_name = 'refrain-concurrency-tests'
             and wait_event_type = 'Lock'`);
        if (waiting.rows[0]!.n > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      commit();
      await publish;
      expect(await change).toBe("public_page");
    });
    const [row] = await db
      .select({ coverUrl: schema.albums.coverUrl })
      .from(schema.albums)
      .where(eq(schema.albums.id, album!.id));
    expect(row!.coverUrl).toBeNull();
  });
});
