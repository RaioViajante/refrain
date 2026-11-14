// The cover display switch in the Writing Studio, on real PostgreSQL
// (docs/security.md § Deployment gate, item 6; the design proposed in ADR 0009
// § 12): while `REFRAIN_COVER_DISPLAY_ENABLED` is anything but exactly `true`,
// no Studio read returns a cover's image address, the choosing screens list
// candidates without images, a cover choice is refused before any provider
// request and writes nothing, removing a cover still works, and every stored
// cover is kept. The providers answer from deterministic fixtures (no
// network); everything is synthetic and rolled back.
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { schema, type Transaction } from "@/db";
import { captureFailure, inRollbackTransaction, testAuthor } from "@/testing";
import { FIXTURE } from "@/testing/provider-fixtures";
import { fixtureProviders } from "@/testing/provider-runtime";

import { CatalogError } from "./errors";
import {
  coverStateOf,
  importMusicRelease,
  listAlbumArtworkChoices,
  listMusicEditions,
  removeAlbumArtwork,
  reviewMusicRelease,
  setAlbumArtwork,
} from "./music";
import { getAlbum, getAlbumCover, listAlbumCovers } from "./queries";

const author = testAuthor();
const VARIABLE = "REFRAIN_COVER_DISPLAY_ENABLED";
const FRONT = `https://coverartarchive.org/release/${FIXTURE.firstPressing}/${FIXTURE.frontImage}`;
/** Every value that leaves covers off, and the variable unset. */
const OFF = [undefined, "", "false", "TRUE", "1", "yes", " true"];

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

/** Every row of the catalog's tables, as text, for a before/after check. */
async function catalogState(tx: Transaction): Promise<string> {
  const tables = [
    "albums",
    "album_editions",
    "album_artists",
    "artists",
    "tracks",
    "track_artists",
    "album_tracks",
    "edition_tracks",
  ];
  const state: Record<string, unknown> = {};
  for (const table of tables) {
    const result = await tx.execute(
      sql`select * from ${sql.identifier(table)} order by 1`,
    );
    state[table] = result.rows;
  }
  return JSON.stringify(state);
}

/** An album imported from the fixtures with its front cover chosen. */
async function coveredAlbum(tx: Transaction): Promise<string> {
  vi.stubEnv(VARIABLE, "true");
  const { providers } = fixtureProviders();
  const { review } = await reviewMusicRelease(
    tx,
    author,
    FIXTURE.firstPressing,
    providers,
  );
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
  vi.unstubAllEnvs();
  return id;
}

async function storedCover(tx: Transaction, albumId: string) {
  const [row] = await tx
    .select({
      coverUrl: schema.albums.coverUrl,
      coverSource: schema.albums.coverSource,
    })
    .from(schema.albums)
    .where(eq(schema.albums.id, albumId));
  return row;
}

describe("the Studio's reads while covers are off", () => {
  it("return no image address, say a cover is stored, and keep it", async () => {
    await inRollbackTransaction(async (tx) => {
      const albumId = await coveredAlbum(tx);
      expect(await storedCover(tx, albumId)).toEqual({
        coverUrl: FRONT,
        coverSource: "Cover Art Archive",
      });
      const before = await catalogState(tx);

      for (const value of OFF) {
        vi.stubEnv(VARIABLE, value);
        const what = String(value);
        expect((await listAlbumCovers(tx, author)).has(albumId), what).toBe(
          false,
        );
        expect(await getAlbumCover(tx, author, albumId), what).toEqual({
          artwork: null,
          stored: true,
        });
        const album = (await getAlbum(tx, author, albumId))!;
        expect([album.artwork, album.coverStored], what).toEqual([null, true]);

        const { providers } = fixtureProviders();
        const choices = (await listAlbumArtworkChoices(
          tx,
          author,
          albumId,
          providers,
        ))!;
        expect(choices, what).toMatchObject({
          current: null,
          coverStored: true,
          currentCover: coverStateOf(FRONT),
          coverDisplay: false,
          unavailable: false,
        });
        // The candidates are still listed, as text, with no image.
        expect(choices.choices.length, what).toBeGreaterThan(0);
        for (const choice of choices.choices) {
          expect(choice.artwork, what).toBeNull();
        }
        expect(
          choices.choices.find((choice) => choice.current)?.imageId,
          what,
        ).toBe(FIXTURE.frontImage);

        const editions = await listMusicEditions(
          tx,
          author,
          FIXTURE.paperMoon,
          providers,
        );
        for (const release of editions.releases) {
          expect(release.artwork, `${what} ${release.id}`).toBeNull();
        }

        const review = await reviewMusicRelease(
          tx,
          author,
          FIXTURE.firstPressing,
          providers,
        );
        expect(review.coverDisplay, what).toBe(false);
        expect(review.artwork.length, what).toBeGreaterThan(0);
        for (const choice of review.artwork) {
          expect(choice.artwork, what).toBeNull();
        }
      }

      // Reading wrote nothing: the stored cover and every catalog row stay.
      expect(await catalogState(tx)).toBe(before);
    });
  });

  it("show the cover again, unchanged, once the switch is exactly `true`", async () => {
    await inRollbackTransaction(async (tx) => {
      const albumId = await coveredAlbum(tx);
      vi.stubEnv(VARIABLE, "true");
      const sources = {
        src: `${FRONT}-500.jpg`,
        srcSet: `${FRONT}-250.jpg 250w, ${FRONT}-500.jpg 500w, ${FRONT}-1200.jpg 1200w`,
      };
      expect((await listAlbumCovers(tx, author)).get(albumId)).toEqual(sources);
      expect(await getAlbumCover(tx, author, albumId)).toEqual({
        artwork: sources,
        stored: true,
      });
      const { providers } = fixtureProviders();
      const choices = (await listAlbumArtworkChoices(
        tx,
        author,
        albumId,
        providers,
      ))!;
      expect(choices.coverDisplay).toBe(true);
      expect(choices.current).toEqual(sources);
      expect(choices.choices.every((choice) => choice.artwork !== null)).toBe(
        true,
      );
    });
  });
});

describe("the Studio's commands while covers are off", () => {
  it("refuse a cover choice before any provider request, and write nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const albumId = await coveredAlbum(tx);
      const before = await catalogState(tx);
      for (const value of OFF) {
        vi.stubEnv(VARIABLE, value);
        const { providers, calls } = fixtureProviders();
        expect(
          await refusal(tx, (tx) =>
            setAlbumArtwork(
              tx,
              author,
              {
                albumId,
                releaseId: FIXTURE.legacyEdition,
                imageId: FIXTURE.legacyFrontImage,
                expectedCover: coverStateOf(FRONT),
              },
              providers,
            ),
          ),
          String(value),
        ).toBe("cover_display_disabled");
        expect(calls, String(value)).toEqual([]);
      }
      expect(await catalogState(tx)).toBe(before);
    });
  });

  it("refuse an import that names a cover, before any request, and import without one", async () => {
    await inRollbackTransaction(async (tx) => {
      vi.stubEnv(VARIABLE, "true");
      const { review } = await reviewMusicRelease(
        tx,
        author,
        FIXTURE.firstPressing,
        fixtureProviders().providers,
      );
      const before = await catalogState(tx);
      for (const value of OFF) {
        vi.stubEnv(VARIABLE, value);
        const { providers, calls } = fixtureProviders();
        expect(
          await refusal(tx, (tx) =>
            importMusicRelease(
              tx,
              author,
              {
                releaseId: FIXTURE.firstPressing,
                review,
                coverImageId: FIXTURE.frontImage,
              },
              providers,
            ),
          ),
          String(value),
        ).toBe("cover_display_disabled");
        expect(calls, String(value)).toEqual([]);
      }
      expect(await catalogState(tx)).toBe(before);

      // The same release, without a cover, is imported as before.
      vi.stubEnv(VARIABLE, undefined);
      const { id } = await importMusicRelease(
        tx,
        author,
        { releaseId: FIXTURE.firstPressing, review, coverImageId: null },
        fixtureProviders().providers,
      );
      expect(await storedCover(tx, id)).toEqual({
        coverUrl: null,
        coverSource: null,
      });
    });
  });

  it("still remove a cover, on the stored cover the author saw", async () => {
    await inRollbackTransaction(async (tx) => {
      const albumId = await coveredAlbum(tx);
      vi.stubEnv(VARIABLE, undefined);
      // A fingerprint of something else is a change the author did not see.
      expect(
        await refusal(tx, (tx) =>
          removeAlbumArtwork(tx, author, {
            albumId,
            expectedCover: coverStateOf(`${FRONT}0`),
          }),
        ),
      ).toBe("review_stale");
      expect(
        await refusal(tx, (tx) =>
          removeAlbumArtwork(tx, author, { albumId, expectedCover: null }),
        ),
      ).toBe("review_stale");
      expect((await storedCover(tx, albumId))!.coverUrl).toBe(FRONT);

      await removeAlbumArtwork(tx, author, {
        albumId,
        expectedCover: coverStateOf(FRONT),
      });
      expect(await storedCover(tx, albumId)).toEqual({
        coverUrl: null,
        coverSource: null,
      });
    });
  });

  it("take a fingerprint, never an address: the stored address itself is refused as input", async () => {
    await inRollbackTransaction(async (tx) => {
      const albumId = await coveredAlbum(tx);
      for (const value of [undefined, "true"]) {
        vi.stubEnv(VARIABLE, value);
        for (const expectedCover of [
          FRONT,
          "",
          "A".repeat(64),
          coverStateOf(FRONT)!.slice(1),
          `${coverStateOf(FRONT)} `,
          42,
        ]) {
          expect(
            await refusal(tx, (tx) =>
              removeAlbumArtwork(tx, author, { albumId, expectedCover }),
            ),
            `${value} ${String(expectedCover)}`,
          ).toBe("invalid_input");
        }
        expect(
          await refusal(tx, (tx) =>
            removeAlbumArtwork(tx, author, {
              albumId,
              expectedCoverUrl: FRONT,
            }),
          ),
        ).toBe("invalid_input");
      }
      expect((await storedCover(tx, albumId))!.coverUrl).toBe(FRONT);
    });
  });
});
