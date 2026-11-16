import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestMemory,
  inRollbackTransaction,
  testAuthor,
} from "@/testing";

import { catalogPublicImpact } from "./catalog-impact";
import { previewCatalogChange } from "./catalog-confirmation";

// ADR 0013 step 3: the cost of the public impact on a realistically sized
// synthetic catalog. It is a measurement, not a check of behaviour, so it
// runs only when asked (`REFRAIN_BENCH=1`), on the disposable test database,
// inside one rolled-back transaction. Everything it creates is synthetic.
//
//   REFRAIN_BENCH=1 pnpm exec vitest run --project integration \
//     src/modules/publication/catalog-impact.bench.integration.test.ts

const SIZE = {
  artists: 200,
  albums: 300,
  tracksPerAlbum: 12,
  servedJournals: 120,
  translatedJournals: 40,
  servedMemories: 80,
};

describe.skipIf(!process.env.REFRAIN_BENCH)("the impact's cost", () => {
  it("on a realistic catalog", { timeout: 600_000 }, async () => {
    await inRollbackTransaction(async (tx) => {
      const built = Date.now();
      const artists: string[] = [];
      for (let i = 0; i < SIZE.artists; i++) {
        artists.push(await createTestArtist(tx, `[Test] Bench artist ${i}`));
      }
      const albums: { albumId: string; trackIds: string[] }[] = [];
      for (let i = 0; i < SIZE.albums; i++) {
        albums.push(
          await createTestAlbum(tx, {
            title: `[Test] Bench album ${i}`,
            artistIds: [artists[i % SIZE.artists]!],
            firstReleaseYear: 1960 + (i % 60),
            trackTitles: Array.from(
              { length: SIZE.tracksPerAlbum },
              (_, n) => `[Test] Bench track ${i}.${n}`,
            ),
          }),
        );
      }
      for (let i = 0; i < SIZE.servedJournals; i++) {
        await createTestAlbumJournal(tx, {
          albumId: albums[i]!.albumId,
          slug: `t-bench-journal-${i}`,
          versions: [
            { locale: "en", status: "published", publishedAt: new Date() },
            ...(i < SIZE.translatedJournals
              ? [
                  {
                    locale: "pt-BR" as const,
                    status: "published" as const,
                    publishedAt: new Date(),
                  },
                ]
              : []),
          ],
        });
      }
      for (let i = 0; i < SIZE.servedMemories; i++) {
        await createTestMemory(tx, {
          slug: `t-bench-memory-${i}`,
          versions: [
            {
              locale: "en",
              status: "published",
              publishedAt: new Date(),
              title: `[Test] Bench memory ${i}`,
            },
          ],
          music: [
            { trackId: albums[(i * 7) % SIZE.albums]!.trackIds[0]! },
            { trackId: albums[(i * 11) % SIZE.albums]!.trackIds[1]! },
          ],
        });
      }
      const buildMs = Date.now() - built;
      const counts = (
        await tx.execute<{ tracks: number }>(sql`
          select count(*)::int as tracks from tracks`)
      ).rows[0]!;

      const times: number[] = [];
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        const impact = await catalogPublicImpact(tx, [
          {
            op: "update_artist",
            artistId: artists[0]!,
            name: `[Test] Renamed ${run}`,
          },
        ]);
        times.push(performance.now() - started);
        expect(impact.pages.length).toBeGreaterThan(0);
      }
      const previewStarted = performance.now();
      const preview = await previewCatalogChange(
        tx,
        testAuthor(),
        { kind: "artist", id: artists[0]! },
        async () => [
          {
            op: "update_artist",
            artistId: artists[0]!,
            name: "[Test] Renamed",
          },
        ],
      );
      const previewMs = performance.now() - previewStarted;
      expect(preview.confirmation).not.toBeNull();
      // ADR 0013 step 4: a tracklist edit on a served album (two tracks
      // swapped), reviewed the same way.
      const reorderStarted = performance.now();
      const [first, second, ...rest] = albums[0]!.trackIds;
      const reorder = await catalogPublicImpact(tx, [
        {
          op: "set_tracklist",
          albumId: albums[0]!.albumId,
          tracks: [second!, first!, ...rest].map((trackId) => ({
            trackId,
            discNumber: 1,
          })),
        },
      ]);
      const reorderMs = performance.now() - reorderStarted;
      expect(reorder.pages.length).toBeGreaterThan(0);

      console.info(
        JSON.stringify({
          size: SIZE,
          tracksInDatabase: counts.tracks,
          buildMs,
          impactMs: times.map((ms) => Math.round(ms)),
          previewMs: Math.round(previewMs),
          tracklistImpactMs: Math.round(reorderMs),
          affectedPages: preview.review.pages.length,
        }),
      );
    });
  });
});
