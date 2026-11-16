import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { schema, type Transaction } from "@/db";
import { normalizeSlug } from "@/modules/publication";
// The limits are lowered for a moment to show each one failing closed.
// eslint-disable-next-line no-restricted-imports
import {
  catalogPublicImpact,
  impactLimits,
} from "@/modules/publication/catalog-impact";
// eslint-disable-next-line no-restricted-imports
import { computeImpact } from "@/modules/publication/catalog-confirmation";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestMemory,
  inRollbackTransaction,
  otherSession,
  rowChecksum,
  shiftedTestToken,
  testAuthor,
  uniqueLabel,
  withConnections,
} from "@/testing";
import { FIXTURE } from "@/testing/provider-fixtures";
import { fixtureProviders } from "@/testing/provider-runtime";

import {
  addTrackToAlbum,
  createTrack,
  deleteAlbum,
  editTracklist,
  moveTrackInAlbum,
  previewArtistChange,
  previewTracklistChange,
  removeTrackFromAlbum,
  setAlbumTracklist,
  updateArtist,
} from "./commands";
import { CatalogError } from "./errors";
import { importMusicRelease, reviewMusicRelease } from "./music";

// ADR 0013 step 4 on real PostgreSQL: the tracklist commands and a new track
// on an album go through the `catalog_change` gate; deleting an album a
// served memory uses, and an import that would change a served memory's
// album, are refused; and every limit of the impact fails closed for real
// (a statement timeout, the deadline, the page cap, and a role without the
// TEMPORARY privilege), with a fixed code and nothing written.

const author = testAuthor();
const slugOf = () => normalizeSlug(`t ${uniqueLabel("s4")}`);

async function failure(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof CatalogError
      ? error.failure
      : ((error as { failure?: string }).failure ?? String(error));
  }
  return "succeeded";
}

// One snapshot per test: whole-table checksums must not see other suites'
// commits (see catalog-confirmation.integration.test.ts).
async function inSnapshot(work: (tx: Transaction) => Promise<void>) {
  await inRollbackTransaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read`);
    await work(tx);
  });
}

async function catalogSum(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ sum: string }>(sql`
    select md5(
      coalesce((select string_agg(x::text, '|' order by x::text) from public.albums x), '') ||
      coalesce((select string_agg(x::text, '|' order by x::text) from public.tracks x), '') ||
      coalesce((select string_agg(x::text, '|' order by x::text) from public.album_tracks x), '') ||
      coalesce((select string_agg(x::text, '|' order by x::text) from public.edition_tracks x), '') ||
      coalesce((select string_agg(x::text, '|' order by x::text) from public.artists x), '')
    ) as sum`);
  return `${result.rows[0]!.sum}/${(await rowChecksum(tx)).join(",")}`;
}

async function servedAlbum(tx: Transaction) {
  const artistId = await createTestArtist(tx, uniqueLabel("Artist"));
  const album = await createTestAlbum(tx, {
    title: uniqueLabel("Album"),
    artistIds: [artistId],
  });
  await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    slug: slugOf(),
    versions: [{ locale: "en", status: "published", publishedAt: new Date() }],
  });
  return { artistId, album };
}

async function titles(tx: Transaction, albumId: string): Promise<string[]> {
  const result = await tx.execute<{ title: string }>(sql`
    select t.title from album_editions ed
      join edition_tracks et on et.edition_id = ed.id
      join tracks t on t.id = et.track_id
     where ed.album_id = ${albumId} and ed.is_reference
     order by et.disc_number, et.position`);
  return result.rows.map((row) => row.title);
}

describe("tracklist edits on a published album", () => {
  it("each edit is refused without a token, writing nothing, and saved with the review's token", async () => {
    await inSnapshot(async (tx) => {
      const { artistId, album } = await servedAlbum(tx);
      const albumId = album.albumId;
      const [t1, t2, t3] = album.trackIds as [string, string, string];
      const loose = (
        await tx
          .insert(schema.tracks)
          .values({ title: uniqueLabel("Loose") })
          .returning({ id: schema.tracks.id })
      )[0]!.id;
      const edits = [
        { operation: "move", trackId: t2, direction: "up" },
        { operation: "remove", trackId: t3 },
        { operation: "add", trackId: loose },
        { operation: "set", tracks: [{ trackId: loose }, { trackId: t1 }] },
        {
          operation: "create",
          track: { title: uniqueLabel("New"), artistIds: [artistId] },
        },
      ] as const;
      const commands = [
        () => moveTrackInAlbum(tx, author, albumId, t2, "up"),
        () => removeTrackFromAlbum(tx, author, albumId, t3),
        () => addTrackToAlbum(tx, author, albumId, loose),
        () =>
          setAlbumTracklist(tx, author, albumId, {
            tracks: [{ trackId: loose }, { trackId: t1 }],
          }),
        () =>
          createTrack(tx, author, {
            title: edits[4].track.title,
            artistIds: [artistId],
            albumId,
          }),
      ];
      for (const [index, edit] of edits.entries()) {
        const before = await catalogSum(tx);
        expect(await failure(commands[index]!()), edit.operation).toBe(
          "confirmation_required",
        );
        expect(await catalogSum(tx), edit.operation).toBe(before);
        const review = await previewTracklistChange(tx, author, albumId, edit);
        expect(review.confirmation, edit.operation).not.toBeNull();
        // The review shows the track titles, positions, and order that change.
        expect(
          review.review.pages.some(
            (page) =>
              page.surface === "album_journal" &&
              page.changes.some((change) => change.atom.startsWith("tracks.")),
          ),
          edit.operation,
        ).toBe(true);
        await editTracklist(tx, author, albumId, {
          ...edit,
          confirmation: review.confirmation,
        });
        // Used once: replaying it is stale.
        expect(
          await failure(
            editTracklist(tx, author, albumId, {
              ...edit,
              confirmation: review.confirmation,
            }),
          ),
          edit.operation,
        ).not.toBe("succeeded");
      }
      const final = await titles(tx, albumId);
      expect(final).toHaveLength(3);
      expect(final.at(-1)).toBe(edits[4].track.title);
    });
  });

  it("refuses an expired, another session's, or another purpose's token for a tracklist", async () => {
    await inSnapshot(async (tx) => {
      const { album } = await servedAlbum(tx);
      const edit = {
        operation: "move" as const,
        trackId: album.trackIds[1]!,
        direction: "up" as const,
      };
      const { confirmation } = await previewTracklistChange(
        tx,
        author,
        album.albumId,
        edit,
      );
      expect(
        await failure(
          moveTrackInAlbum(tx, author, album.albumId, edit.trackId, "up", {
            confirmation: shiftedTestToken(confirmation!, -16 * 60 * 1000),
          }),
        ),
      ).toBe("confirmation_expired");
      expect(
        await failure(
          moveTrackInAlbum(
            tx,
            otherSession(author),
            album.albumId,
            edit.trackId,
            "up",
            {
              confirmation,
            },
          ),
        ),
      ).toBe("confirmation_invalid");
      // An artist's token is not an album's.
      const artist = await createTestArtist(tx, uniqueLabel("Other"));
      const artistToken = (
        await previewArtistChange(tx, author, artist, { name: "[Test] X" })
      ).confirmation;
      expect(artistToken).toBeNull();
    });
  });

  it("leaves an unpublished album's tracklist as before: no review, no token", async () => {
    await inSnapshot(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Private"),
      });
      await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        slug: slugOf(),
        versions: [{ locale: "en", status: "private" }],
      });
      await moveTrackInAlbum(
        tx,
        author,
        album.albumId,
        album.trackIds[1]!,
        "up",
      );
      const review = await previewTracklistChange(tx, author, album.albumId, {
        operation: "remove",
        trackId: album.trackIds[2]!,
      });
      expect(review.confirmation).toBeNull();
    });
  });

  it("lists a journal served only in Portuguese under both interface languages", async () => {
    await inSnapshot(async (tx) => {
      const album = await createTestAlbum(tx, { title: uniqueLabel("PT") });
      await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        slug: slugOf(),
        versions: [
          { locale: "pt-BR", status: "published", publishedAt: new Date() },
        ],
      });
      const review = await previewTracklistChange(tx, author, album.albumId, {
        operation: "move",
        trackId: album.trackIds[1]!,
        direction: "up",
      });
      const locales = review.review.pages
        .filter((page) => page.surface === "album_journal")
        .map((page) => page.locale)
        .sort();
      expect(locales).toEqual(["en", "pt-BR"]);
    });
  });
});

describe("permanent refusals", () => {
  it("refuses to delete an album whose track a served memory links, writing nothing", async () => {
    await inSnapshot(async (tx) => {
      const album = await createTestAlbum(tx, { title: uniqueLabel("Holds") });
      await createTestMemory(tx, {
        slug: slugOf(),
        versions: [
          {
            locale: "en",
            status: "published",
            publishedAt: new Date(),
            title: uniqueLabel("M"),
          },
        ],
        music: [{ trackId: album.trackIds[0]! }],
      });
      const before = await catalogSum(tx);
      expect(await failure(deleteAlbum(tx, author, album.albumId))).toBe(
        "public_page",
      );
      expect(await catalogSum(tx)).toBe(before);
      // A private memory does not hold it.
      const other = await createTestAlbum(tx, { title: uniqueLabel("Free") });
      await createTestMemory(tx, {
        slug: slugOf(),
        versions: [
          { locale: "en", status: "private", title: uniqueLabel("M") },
        ],
        music: [{ trackId: other.trackIds[0]! }],
      });
      expect(await failure(deleteAlbum(tx, author, other.albumId))).toBe(
        "succeeded",
      );
    });
  });

  async function memoryOnRecording(tx: Transaction, year: number) {
    // A recording the fixture release reuses, on an album of `year` with no
    // journal, which a served memory links.
    const [track] = await tx
      .insert(schema.tracks)
      .values({ title: "[Test] Reused", mbRecordingId: FIXTURE.recording1 })
      .returning({ id: schema.tracks.id });
    const album = await createTestAlbum(tx, {
      title: uniqueLabel("Earlier home"),
      firstReleaseYear: year,
      trackTitles: [],
    });
    await addTrackToAlbum(tx, author, album.albumId, track!.id);
    await createTestMemory(tx, {
      slug: slugOf(),
      versions: [
        {
          locale: "en",
          status: "published",
          publishedAt: new Date(),
          title: uniqueLabel("M"),
        },
      ],
      music: [{ trackId: track!.id }],
    });
  }

  async function importFixture(tx: Transaction) {
    const { providers } = fixtureProviders();
    const { review } = await reviewMusicRelease(
      tx,
      author,
      FIXTURE.firstPressing,
      providers,
    );
    return importMusicRelease(
      tx,
      author,
      { releaseId: FIXTURE.firstPressing, review },
      providers,
    );
  }

  it("refuses an import that would change the album a served memory names, writing nothing", async () => {
    await inSnapshot(async (tx) => {
      // The fixture release is from 1994: earlier than 2000, so it would
      // become the album the memory names.
      await memoryOnRecording(tx, 2000);
      const before = await catalogSum(tx);
      expect(await failure(importFixture(tx))).toBe("public_page");
      expect(await catalogSum(tx)).toBe(before);
    });
  });

  it("allows an import that leaves the named album as it is", async () => {
    await inSnapshot(async (tx) => {
      await memoryOnRecording(tx, 1980);
      expect(await failure(importFixture(tx))).toBe("succeeded");
    });
  });
});

describe("the impact's limits fail closed, for real", () => {
  const saved = { ...impactLimits };
  afterEach(() => {
    Object.assign(impactLimits, saved);
  });

  async function refusedRename(tx: Transaction, set: () => void) {
    const { artistId } = await servedAlbum(tx);
    const before = await catalogSum(tx);
    set();
    let thrown: unknown;
    try {
      await updateArtist(tx, author, artistId, { name: uniqueLabel("R") });
    } catch (error) {
      thrown = error;
    }
    Object.assign(impactLimits, saved);
    expect(thrown).toBeInstanceOf(CatalogError);
    expect((thrown as CatalogError).failure).toBe("impact_unavailable");
    // A fixed code: no SQL, no names, no ids in the message.
    expect((thrown as Error).message).toBe(
      "Catalog operation refused: impact_unavailable",
    );
    expect(await catalogSum(tx)).toBe(before);
  }

  it("a statement over its timeout (SQLSTATE 57014)", async () => {
    // Another session holds the album_tracks table, so the impact's first
    // read of it waits until its own statement timeout ends it: a real
    // 57014, which the gate turns into impact_unavailable.
    await withConnections(1, async ([holder]) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const holding = holder!.transaction(async (tx) => {
        await tx.execute(
          sql`lock table public.album_tracks in access exclusive mode`,
        );
        locked();
        await held;
      });
      await isLocked;
      try {
        await inSnapshot(async (tx) => {
          impactLimits.statementTimeoutMs = 200;
          const raw = await catalogPublicImpact(tx, [
            {
              op: "update_artist",
              artistId: crypto.randomUUID(),
              name: "[Test] T",
            },
          ]).then(
            () => "computed",
            (error: { cause?: { code?: string }; code?: string }) =>
              error.cause?.code ?? error.code,
          );
          expect(raw).toBe("57014");
          const mapped = await computeImpact(tx, [
            {
              op: "update_artist",
              artistId: crypto.randomUUID(),
              name: "[Test] T",
            },
          ]).then(
            () => "computed",
            (error: { failure?: string; message?: string }) => error,
          );
          expect((mapped as { failure?: string }).failure).toBe(
            "impact_unavailable",
          );
          expect(String((mapped as Error).message)).not.toMatch(
            /album_tracks|select/i,
          );
          Object.assign(impactLimits, saved);
          // The timeout was the impact's own, undone with its savepoint.
          const setting = await tx.execute<{ t: string }>(sql`
            select current_setting('statement_timeout') as t`);
          expect(setting.rows[0]!.t).toBe("0");
        });
      } finally {
        release();
        await holding;
      }
    });
  });

  it("the whole computation past its deadline", async () => {
    await inSnapshot(async (tx) => {
      await refusedRename(tx, () => {
        impactLimits.timeLimitMs = -1;
      });
    });
  });

  it("more served pages than the computation reads", async () => {
    await inSnapshot(async (tx) => {
      await refusedRename(tx, () => {
        impactLimits.maxServedPages = 0;
      });
    });
  });

  it("a database role without the TEMPORARY privilege", async () => {
    // A fresh connection, whose session has no temporary schema yet, so
    // PostgreSQL checks the privilege; the role and the revocation exist only
    // in this rolled-back transaction.
    await withConnections(1, async ([db]) => {
      const outcome = await db!
        .transaction(async (tx) => {
          const { artistId } = await servedAlbum(tx);
          await tx.execute(sql`create role refrain_test_no_temp nologin`);
          await tx.execute(
            sql`grant usage on schema public to refrain_test_no_temp`,
          );
          await tx.execute(sql`
            grant select, insert, update, delete
               on all tables in schema public to refrain_test_no_temp`);
          await tx.execute(sql`
            do $$ begin
              execute format('revoke temporary on database %I from public',
                             current_database());
            end $$`);
          await tx.execute(sql`set local role refrain_test_no_temp`);
          // The cause is the privilege itself: this role cannot create a
          // temporary table (42501), checked in a savepoint.
          const probe = await tx
            .transaction(async (inner) => {
              await inner.execute(sql`create temporary table probe (x int)`);
            })
            .then(
              () => "created",
              (error: { cause?: { code?: string } }) => error.cause?.code,
            );
          expect(probe).toBe("42501");
          const answer = await failure(
            updateArtist(tx, author, artistId, { name: "[Test] No temp" }),
          );
          await tx.execute(sql`reset role`);
          const name = (
            await tx
              .select({ name: schema.artists.name })
              .from(schema.artists)
              .where(eq(schema.artists.id, artistId))
          )[0]!.name;
          throw Object.assign(new Error("rollback"), { answer, name });
        })
        .catch((error: { answer?: string; name?: string }) => error);
      expect(outcome.answer).toBe("impact_unavailable");
      expect(outcome.name).not.toBe("[Test] No temp");
    });
  });
});
