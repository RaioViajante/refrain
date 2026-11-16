import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Locale, Transaction } from "@/db";
// The real commands, so each test changes the catalog exactly as the Studio
// would. Tests may reach a module's internals.
// eslint-disable-next-line no-restricted-imports
import * as catalog from "@/modules/catalog/commands";
// eslint-disable-next-line no-restricted-imports
import {
  previewAlbumJournalChange,
  saveAlbumJournal,
} from "@/modules/journals/commands";
// eslint-disable-next-line no-restricted-imports
import { previewMemoryChange, saveMemory } from "@/modules/journals/memories";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestMemory,
  createTestTrackReflection,
  inRollbackTransaction,
  publishForTest,
  rowChecksum,
  testAuthor,
  uniqueLabel,
} from "@/testing";

import { previewPublication, publishLanguageVersion } from "./publish";
import { normalizeSlug } from "./slug";

// ADR 0013 § 5 (step 2): a confirmation binds the catalog wording the page
// renders. A catalog edit between the preview and the confirmation makes it
// `confirmation_stale`, and nothing is written; an edit to a record the page
// does not render, or to a hidden entry, does not. On real PostgreSQL, every
// test rolled back.

const author = testAuthor();
const slugOf = (label: string) => normalizeSlug(`t ${uniqueLabel(label)}`);

async function failure(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return (error as { failure?: string }).failure ?? String(error);
  }
  return "succeeded";
}

async function statusOf(tx: Transaction, entryId: string, locale: Locale) {
  const result = await tx.execute<{ status: string }>(sql`
    select status from entry_texts
     where entry_id = ${entryId} and locale = ${locale}`);
  return result.rows[0]!.status;
}

/** An unpublished album journal about a credited album, with a reflection. */
async function draftJournal(tx: Transaction, locale: Locale = "en") {
  const artistName = uniqueLabel("Credited");
  const artistId = await createTestArtist(tx, artistName);
  const album = await createTestAlbum(tx, {
    title: uniqueLabel("Album"),
    artistIds: [artistId],
    firstReleaseYear: 2000,
  });
  const entryId = await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    slug: slugOf("journal"),
    versions: [{ locale, status: "private", text: "[Test] Writing" }],
  });
  await createTestTrackReflection(tx, {
    albumJournalId: entryId,
    albumId: album.albumId,
    trackId: album.trackIds[0]!,
    isPublished: true,
    texts: { [locale]: "[Test] Reflection" },
  });
  return { artistId, artistName, album, entryId, locale };
}

/** Previews, lets `change` run, then publishes with the preview's token. */
async function publishAfter(
  tx: Transaction,
  entryId: string,
  locale: Locale,
  change: () => Promise<unknown>,
): Promise<string> {
  const preview = await previewPublication(tx, author, { entryId, locale });
  await change();
  const before = await rowChecksum(tx);
  const outcome = await failure(
    publishLanguageVersion(tx, author, {
      entryId,
      locale,
      expectedVersion: preview.disclosure.entryVersion,
      confirmation: preview.confirmation,
    }),
  );
  if (outcome !== "succeeded") {
    // A refusal writes nothing at all.
    expect(await rowChecksum(tx)).toEqual(before);
    expect(await statusOf(tx, entryId, locale)).not.toBe("published");
  }
  return outcome;
}

describe("publishing an album journal binds its catalog wording", () => {
  const edits: [
    string,
    (
      tx: Transaction,
      fixture: Awaited<ReturnType<typeof draftJournal>>,
    ) => Promise<unknown>,
  ][] = [
    [
      "the credited artist renamed",
      (tx, f) =>
        catalog.updateArtist(tx, author, f.artistId, {
          name: uniqueLabel("Renamed"),
        }),
    ],
    [
      "the album retitled",
      (tx, f) =>
        catalog.updateAlbum(tx, author, f.album.albumId, {
          title: uniqueLabel("Retitled"),
        }),
    ],
    [
      "the year changed",
      (tx, f) =>
        catalog.updateAlbum(tx, author, f.album.albumId, {
          firstReleaseYear: 1999,
        }),
    ],
    [
      "the label changed",
      (tx, f) =>
        catalog.updateAlbum(tx, author, f.album.albumId, {
          edition: { label: "[Test] Another label" },
        }),
    ],
    [
      "the credit's wording changed",
      (tx, f) =>
        catalog.updateAlbum(tx, author, f.album.albumId, {
          credits: [{ artistId: f.artistId, creditedAs: "[Test] As credited" }],
        }),
    ],
    [
      "a track retitled",
      (tx, f) =>
        catalog.updateTrack(tx, author, f.album.trackIds[1]!, {
          title: uniqueLabel("Track"),
        }),
    ],
    [
      "a track's credit changed",
      (tx, f) =>
        catalog.updateTrack(tx, author, f.album.trackIds[2]!, {
          credit: "[Test] A cover",
        }),
    ],
    [
      "the reflected track retitled",
      (tx, f) =>
        catalog.updateTrack(tx, author, f.album.trackIds[0]!, {
          title: uniqueLabel("Reflected"),
        }),
    ],
    [
      "the tracklist reordered",
      (tx, f) =>
        catalog.moveTrackInAlbum(
          tx,
          author,
          f.album.albumId,
          f.album.trackIds[1]!,
          "up",
        ),
    ],
    [
      "a track removed from the tracklist",
      (tx, f) =>
        catalog.removeTrackFromAlbum(
          tx,
          author,
          f.album.albumId,
          f.album.trackIds[2]!,
        ),
    ],
    [
      "the stored cover changed",
      (tx, f) =>
        tx.execute(sql`
          update albums
             set cover_url = 'https://coverartarchive.org/release/00000000-0000-4000-8000-000000000001/2-500.jpg',
                 cover_source = 'cover_art_archive'
           where id = ${f.album.albumId}`),
    ],
    [
      "a namesake becoming public, which moves the credit's address",
      async (tx, f) => {
        const namesake = await createTestArtist(tx, f.artistName);
        const other = await createTestAlbum(tx, {
          title: uniqueLabel("Namesake album"),
          artistIds: [namesake],
        });
        await createTestAlbumJournal(tx, {
          albumId: other.albumId,
          slug: slugOf("namesake"),
          versions: [
            { locale: "en", status: "published", publishedAt: new Date() },
          ],
        });
      },
    ],
    [
      "a memory linking one of its tracks published",
      async (tx, f) => {
        const memoryId = await createTestMemory(tx, {
          slug: slugOf("memory"),
          versions: [{ locale: "en", title: uniqueLabel("Memory") }],
          music: [{ trackId: f.album.trackIds[1]! }],
        });
        await publishForTest(tx, memoryId, "en");
      },
    ],
  ];

  for (const locale of ["en", "pt-BR"] as const) {
    it.each(edits)(
      `%s after the preview: stale, nothing written (${locale})`,
      async (_name, edit) => {
        await inRollbackTransaction(async (tx) => {
          const fixture = await draftJournal(tx, locale);
          expect(
            await publishAfter(tx, fixture.entryId, locale, () =>
              edit(tx, fixture),
            ),
          ).toBe("confirmation_stale");
        });
      },
    );
  }

  it("is not stale for an edit the page does not render, or for hidden entries", async () => {
    await inRollbackTransaction(async (tx) => {
      const fixture = await draftJournal(tx);
      const outcome = await publishAfter(
        tx,
        fixture.entryId,
        "en",
        async () => {
          // An artist on nothing this page renders.
          const other = await createTestArtist(tx, uniqueLabel("Unrelated"));
          await catalog.updateArtist(tx, author, other, {
            name: uniqueLabel("Still unrelated"),
          });
          // A track's own artists, which an album-journal page does not show.
          await catalog.updateTrack(tx, author, fixture.album.trackIds[1]!, {
            artistIds: [other],
          });
          // Hidden entries linking its tracks: draft, private, and deleted
          // memories, and an unpublished translation.
          for (const [status, deletedAt] of [
            ["draft", undefined],
            ["private", undefined],
            ["published", new Date()],
          ] as const) {
            await createTestMemory(tx, {
              slug: slugOf("hidden memory"),
              versions: [
                {
                  locale: "en",
                  status,
                  publishedAt: new Date(),
                  title: uniqueLabel("Hidden"),
                },
              ],
              deletedAt,
              music: [{ trackId: fixture.album.trackIds[1]! }],
            });
          }
        },
      );
      expect(outcome).toBe("succeeded");
      expect(await statusOf(tx, fixture.entryId, "en")).toBe("published");
    });
  });
});

describe("publishing a memory binds its music's wording", () => {
  async function draftMemory(tx: Transaction) {
    const artistId = await createTestArtist(tx, uniqueLabel("Singer"));
    const earlier = await createTestAlbum(tx, {
      title: uniqueLabel("Earlier"),
      artistIds: [artistId],
      firstReleaseYear: 1990,
      trackTitles: [uniqueLabel("Song")],
    });
    const later = await createTestAlbum(tx, {
      title: uniqueLabel("Later"),
      artistIds: [artistId],
      firstReleaseYear: 2000,
      trackTitles: [],
    });
    const trackId = earlier.trackIds[0]!;
    await tx.execute(sql`
      insert into track_artists (track_id, artist_id, position)
      values (${trackId}, ${artistId}, 1)`);
    await catalog.addTrackToAlbum(tx, author, later.albumId, trackId);
    const entryId = await createTestMemory(tx, {
      slug: slugOf("memory"),
      versions: [
        { locale: "en", status: "private", title: uniqueLabel("Memory") },
      ],
      music: [{ trackId }],
    });
    return { artistId, earlier, later, trackId, entryId };
  }

  it.each([
    [
      "the song retitled",
      (tx: Transaction, f: Awaited<ReturnType<typeof draftMemory>>) =>
        catalog.updateTrack(tx, author, f.trackId, {
          title: uniqueLabel("Retitled"),
        }),
    ],
    [
      "the singer renamed",
      (tx: Transaction, f: Awaited<ReturnType<typeof draftMemory>>) =>
        catalog.updateArtist(tx, author, f.artistId, {
          name: uniqueLabel("Renamed"),
        }),
    ],
    [
      "the song's artists changed",
      async (tx: Transaction, f: Awaited<ReturnType<typeof draftMemory>>) => {
        const other = await createTestArtist(tx, uniqueLabel("Other"));
        await catalog.updateTrack(tx, author, f.trackId, {
          artistIds: [f.artistId, other],
        });
      },
    ],
    [
      "the album it names changed (the later album moved earlier)",
      (tx: Transaction, f: Awaited<ReturnType<typeof draftMemory>>) =>
        catalog.updateAlbum(tx, author, f.later.albumId, {
          firstReleaseYear: 1980,
        }),
    ],
    [
      "the named album's credits changed (shown in the review)",
      (tx: Transaction, f: Awaited<ReturnType<typeof draftMemory>>) =>
        catalog.updateAlbum(tx, author, f.earlier.albumId, {
          credits: [{ artistId: f.artistId, creditedAs: "[Test] Credited" }],
        }),
    ],
    [
      "the song added to another album",
      async (tx: Transaction, f: Awaited<ReturnType<typeof draftMemory>>) => {
        const third = await createTestAlbum(tx, {
          title: uniqueLabel("Third"),
          firstReleaseYear: 1970,
          trackTitles: [],
        });
        await catalog.addTrackToAlbum(tx, author, third.albumId, f.trackId);
      },
    ],
    [
      "the named album gaining a served journal (its link appears)",
      async (tx: Transaction, f: Awaited<ReturnType<typeof draftMemory>>) => {
        await createTestAlbumJournal(tx, {
          albumId: f.earlier.albumId,
          slug: slugOf("named journal"),
          versions: [
            { locale: "en", status: "published", publishedAt: new Date() },
          ],
        });
      },
    ],
  ])("%s after the preview: stale, nothing written", async (_name, edit) => {
    await inRollbackTransaction(async (tx) => {
      const fixture = await draftMemory(tx);
      expect(
        await publishAfter(tx, fixture.entryId, "en", () => edit(tx, fixture)),
      ).toBe("confirmation_stale");
    });
  });

  it("is not stale for the later album's title, which the page does not show", async () => {
    await inRollbackTransaction(async (tx) => {
      const fixture = await draftMemory(tx);
      expect(
        await publishAfter(tx, fixture.entryId, "en", () =>
          catalog.updateAlbum(tx, author, fixture.later.albumId, {
            title: uniqueLabel("Still later"),
          }),
        ),
      ).toBe("succeeded");
    });
  });
});

describe("a confirmed save binds its page's catalog wording", () => {
  it("an album journal: a track renamed between the preview and the save", async () => {
    await inRollbackTransaction(async (tx) => {
      const fixture = await draftJournal(tx);
      await publishForTest(tx, fixture.entryId, "en");
      const input = {
        entryId: fixture.entryId,
        expectedVersion: 1,
        opening: "[Test] A new opening",
      };
      const preview = await previewAlbumJournalChange(tx, author, input);
      expect(preview.confirmation).not.toBeNull();
      await catalog.updateTrack(tx, author, fixture.album.trackIds[1]!, {
        title: uniqueLabel("Renamed"),
      });
      const before = await rowChecksum(tx);
      expect(
        await failure(
          saveAlbumJournal(tx, author, {
            ...input,
            confirmation: preview.confirmation!,
          }),
        ),
      ).toBe("confirmation_stale");
      expect(await rowChecksum(tx)).toEqual(before);
    });
  });

  it("an album journal: a reflection the save makes public, on a track outside the reference edition, renamed before the save", async () => {
    await inRollbackTransaction(async (tx) => {
      const fixture = await draftJournal(tx);
      // A member of the album that is not in the reference edition: the page
      // still renders it once a reflection on it is public (mergeTracks).
      const outside = fixture.album.trackIds[2]!;
      await tx.execute(sql`
        delete from edition_tracks where track_id = ${outside}`);
      await publishForTest(tx, fixture.entryId, "en");
      const input = {
        entryId: fixture.entryId,
        expectedVersion: 1,
        reflections: [
          {
            trackId: outside,
            isPublished: true,
            texts: { en: "[Test] A reflection made public" },
          },
        ],
      };
      const preview = await previewAlbumJournalChange(tx, author, input);
      expect(preview.confirmation).not.toBeNull();
      await catalog.updateTrack(tx, author, outside, {
        title: uniqueLabel("Renamed"),
      });
      const before = await rowChecksum(tx);
      expect(
        await failure(
          saveAlbumJournal(tx, author, {
            ...input,
            confirmation: preview.confirmation!,
          }),
        ),
      ).toBe("confirmation_stale");
      expect(await rowChecksum(tx)).toEqual(before);
    });
  });

  it("a memory: a song added, then renamed in the catalog before the save", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Album"),
        trackTitles: [uniqueLabel("Kept"), uniqueLabel("Added")],
      });
      const [kept, added] = album.trackIds as [string, string];
      const entryId = await createTestMemory(tx, {
        slug: slugOf("memory"),
        versions: [{ locale: "en", title: uniqueLabel("Memory") }],
        music: [{ trackId: kept }],
      });
      await publishForTest(tx, entryId, "en");
      const input = { entryId, expectedVersion: 1, trackIds: [kept, added] };
      const preview = await previewMemoryChange(tx, author, input);
      expect(preview.confirmation).not.toBeNull();
      await catalog.updateTrack(tx, author, added, {
        title: uniqueLabel("Renamed"),
      });
      const before = await rowChecksum(tx);
      expect(
        await failure(
          saveMemory(tx, author, {
            ...input,
            confirmation: preview.confirmation!,
          }),
        ),
      ).toBe("confirmation_stale");
      expect(await rowChecksum(tx)).toEqual(before);
    });
  });

  it("a memory: an edit to a song it does not link leaves the token valid", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Album"),
        trackTitles: [uniqueLabel("Linked"), uniqueLabel("Not linked")],
      });
      const [linked, other] = album.trackIds as [string, string];
      const entryId = await createTestMemory(tx, {
        slug: slugOf("memory"),
        versions: [{ locale: "en", title: uniqueLabel("Memory") }],
        music: [{ trackId: linked }],
      });
      await publishForTest(tx, entryId, "en");
      const input = { entryId, expectedVersion: 1, title: "[Test] New title" };
      const preview = await previewMemoryChange(tx, author, input);
      await catalog.updateTrack(tx, author, other, {
        title: uniqueLabel("Renamed"),
      });
      expect(
        await failure(
          saveMemory(tx, author, {
            ...input,
            confirmation: preview.confirmation!,
          }),
        ),
      ).toBe("succeeded");
    });
  });
});
