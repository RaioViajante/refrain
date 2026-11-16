import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, type Transaction } from "@/db";
import {
  normalizeSlug,
  previewPublication,
  publishLanguageVersion,
} from "@/modules/publication";
import {
  claimsOf,
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  inRollbackTransaction,
  otherSession,
  raceAll,
  reissueTestToken,
  rowChecksum,
  shiftedTestToken,
  testAuthor,
  uniqueLabel,
  withConnections,
} from "@/testing";

import {
  previewAlbumChange,
  previewArtistChange,
  previewTrackChange,
  updateAlbum,
  updateArtist,
  updateTrack,
} from "./commands";
import { CatalogError } from "./errors";

// ADR 0013 step 3: confirmed catalog edits on real PostgreSQL. An edit that
// changes a served page needs the author's `catalog_change` token, minted by
// the review for exactly that change; it is checked under the command's locks
// and the database clock, applied once, and never accepted for another
// purpose, subject, session, or state. Every refusal writes nothing.

const author = testAuthor();
const slugOf = () => normalizeSlug(`t ${uniqueLabel("cc")}`);

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

/** Every catalog and entry table, so a refusal can be shown to write nothing. */
async function everything(tx: Transaction): Promise<string> {
  const catalog = await tx.execute<{ sum: string }>(sql`
    select md5(
      coalesce((select string_agg(x::text, '|' order by x::text) from artists x), '') ||
      coalesce((select string_agg(x::text, '|' order by x::text) from albums x), '') ||
      coalesce((select string_agg(x::text, '|' order by x::text) from album_artists x), '') ||
      coalesce((select string_agg(x::text, '|' order by x::text) from album_editions x), '') ||
      coalesce((select string_agg(x::text, '|' order by x::text) from tracks x), '') ||
      coalesce((select string_agg(x::text, '|' order by x::text) from track_artists x), '')
    ) as sum`);
  return `${catalog.rows[0]!.sum}/${(await rowChecksum(tx)).join(",")}`;
}

/** An artist credited on an album whose journal is served. */
async function servedArtist(tx: Transaction, name = uniqueLabel("Served")) {
  const artistId = await createTestArtist(tx, name);
  const album = await createTestAlbum(tx, {
    title: uniqueLabel("Served album"),
    artistIds: [artistId],
  });
  const journalId = await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    slug: slugOf(),
    versions: [{ locale: "en", status: "published", publishedAt: new Date() }],
  });
  return { artistId, name, album, journalId };
}

async function nameOf(tx: Transaction, artistId: string) {
  return (
    await tx.execute<{ name: string }>(sql`
      select name from artists where id = ${artistId}`)
  ).rows[0]!.name;
}

describe("an edit that changes no published page", () => {
  it("is saved as before, with no review and no token", async () => {
    await inRollbackTransaction(async (tx) => {
      const hidden = await createTestArtist(tx, uniqueLabel("Unpublished"));
      const review = await previewArtistChange(tx, author, hidden, {
        name: "[Test] Still unpublished",
      });
      expect(review.confirmation).toBeNull();
      expect(review.review.pages).toEqual([]);
      await updateArtist(tx, author, hidden, {
        name: "[Test] Still unpublished",
      });
      expect(await nameOf(tx, hidden)).toBe("[Test] Still unpublished");
    });
  });

  it("is saved as before for a field no page renders, even on a public record", async () => {
    await inRollbackTransaction(async (tx) => {
      const world = await servedArtist(tx);
      await updateArtist(tx, author, world.artistId, {
        sortName: "[Test] Sort",
      });
      await updateTrack(tx, author, world.album.trackIds[0]!, {
        lengthMs: 1000,
      });
      await updateAlbum(tx, author, world.album.albumId, {
        edition: { country: "BR" },
      });
    });
  });
});

describe("an edit that changes a published page", () => {
  it("is refused without a token, writing nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const world = await servedArtist(tx);
      const before = await everything(tx);
      // One at a time: they share this transaction.
      for (const work of [
        () =>
          updateArtist(tx, author, world.artistId, {
            name: uniqueLabel("New"),
          }),
        () =>
          updateAlbum(tx, author, world.album.albumId, {
            title: uniqueLabel("New"),
          }),
        () =>
          updateTrack(tx, author, world.album.trackIds[0]!, {
            title: uniqueLabel("New"),
          }),
      ]) {
        expect(await failure(work())).toBe("confirmation_required");
      }
      expect(await everything(tx)).toBe(before);
    });
  });

  it("is saved with the review's token, exactly as reviewed, and the review lists every page and address", async () => {
    await inRollbackTransaction(async (tx) => {
      const world = await servedArtist(tx);
      const name = uniqueLabel("Renamed");
      const review = await previewArtistChange(tx, author, world.artistId, {
        name,
      });
      expect(review.confirmation).not.toBeNull();
      const surfaces = new Set(review.review.pages.map((page) => page.surface));
      expect([...surfaces].sort()).toEqual(
        [
          "album_archive",
          "album_journal",
          "artist",
          "artist_archive",
          "home",
          "sitemap",
        ].sort(),
      );
      expect(review.review.addresses).toHaveLength(1);
      expect(JSON.stringify(review.review)).not.toContain(world.artistId);
      await updateArtist(
        tx,
        author,
        world.artistId,
        { name },
        { confirmation: review.confirmation },
      );
      expect(await nameOf(tx, world.artistId)).toBe(name);
    });
  });

  it("refuses a token for another value, subject, purpose, or session, writing nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const world = await servedArtist(tx);
      const other = await servedArtist(tx);
      const reviewed = { name: uniqueLabel("Reviewed") };
      const { confirmation } = await previewArtistChange(
        tx,
        author,
        world.artistId,
        reviewed,
      );
      const token = confirmation!;
      const before = await everything(tx);
      // Another value than the one reviewed.
      expect(
        await failure(
          updateArtist(
            tx,
            author,
            world.artistId,
            { name: "[Test] Other" },
            { confirmation: token },
          ),
        ),
      ).toBe("confirmation_stale");
      // Another artist.
      expect(
        await failure(
          updateArtist(tx, author, other.artistId, reviewed, {
            confirmation: token,
          }),
        ),
      ).toBe("confirmation_invalid");
      // A token re-signed for another subject (only possible with the key):
      // the fingerprint binds the subject and the operation, so it is stale.
      expect(
        await failure(
          updateAlbum(
            tx,
            author,
            world.album.albumId,
            { title: "[Test] X" },
            {
              confirmation: reissueTestToken(token, {
                e: `album:${world.album.albumId}`,
              }),
            },
          ),
        ),
      ).toBe("confirmation_stale");
      // Another session of the same author.
      expect(
        await failure(
          updateArtist(tx, otherSession(author), world.artistId, reviewed, {
            confirmation: token,
          }),
        ),
      ).toBe("confirmation_invalid");
      // Another purpose: the same claims as a `publish` or `change_public`
      // token are not a catalog token, and the reverse.
      for (const p of ["publish", "change_public"] as const) {
        expect(
          await failure(
            updateArtist(tx, author, world.artistId, reviewed, {
              confirmation: reissueTestToken(token, {
                p,
                ...(p === "publish" ? { l: "en" } : {}),
              }),
            }),
          ),
        ).toBe("confirmation_invalid");
      }
      expect(await everything(tx)).toBe(before);
      // A catalog token is not a publication token either.
      const draft = await createTestAlbumJournal(tx, {
        albumId: world.album.albumId,
        slug: slugOf(),
        versions: [{ locale: "en", status: "private" }],
      });
      expect(
        await failure(
          publishLanguageVersion(tx, author, {
            entryId: draft,
            locale: "en",
            expectedVersion: 1,
            confirmation: reissueTestToken(token, { e: draft }),
          }),
        ),
      ).toBe("confirmation_invalid");
      await previewPublication(tx, author, { entryId: draft, locale: "en" });
    });
  });

  it("refuses an expired token, by the database clock", async () => {
    await inRollbackTransaction(async (tx) => {
      const world = await servedArtist(tx);
      const patch = { name: uniqueLabel("Late") };
      const { confirmation } = await previewArtistChange(
        tx,
        author,
        world.artistId,
        patch,
      );
      expect(
        await failure(
          updateArtist(tx, author, world.artistId, patch, {
            confirmation: shiftedTestToken(confirmation!, -16 * 60 * 1000),
          }),
        ),
      ).toBe("confirmation_expired");
    });
  });

  it("is single use: a replay, and A → B → A within a millisecond, are stale", async () => {
    await inRollbackTransaction(async (tx) => {
      const world = await servedArtist(tx);
      const a = world.name;
      const b = uniqueLabel("B");
      const toB = await previewArtistChange(tx, author, world.artistId, {
        name: b,
      });
      await updateArtist(
        tx,
        author,
        world.artistId,
        { name: b },
        { confirmation: toB.confirmation },
      );
      // Replayed at once.
      expect(
        await failure(
          updateArtist(
            tx,
            author,
            world.artistId,
            { name: b },
            { confirmation: toB.confirmation },
          ),
        ),
      ).toBe("confirmation_stale");
      const toA = await previewArtistChange(tx, author, world.artistId, {
        name: a,
      });
      const stampBefore = (
        await tx.execute<{ at: string }>(sql`
          select to_char(updated_at, 'HH24:MI:SS.US') as at from artists
           where id = ${world.artistId}`)
      ).rows[0]!.at;
      await updateArtist(
        tx,
        author,
        world.artistId,
        { name: a },
        { confirmation: toA.confirmation },
      );
      const stampAfter = (
        await tx.execute<{ at: string }>(sql`
          select to_char(updated_at, 'HH24:MI:SS.US') as at from artists
           where id = ${world.artistId}`)
      ).rows[0]!.at;
      // In one transaction `now()` never moves; the stamp still moved forward.
      expect(stampAfter > stampBefore).toBe(true);
      // Back at A: the page reads as it did when the first token was minted,
      // but the token for A → B still cannot be used.
      expect(
        await failure(
          updateArtist(
            tx,
            author,
            world.artistId,
            { name: b },
            { confirmation: toB.confirmation },
          ),
        ),
      ).toBe("confirmation_stale");
      expect(claimsOf(toB.confirmation!).p).toBe("catalog_change");
    });
  });

  it("is stale when a published page changed after the review", async () => {
    await inRollbackTransaction(async (tx) => {
      const world = await servedArtist(tx);
      const patch = { name: uniqueLabel("Rename") };
      const review = await previewArtistChange(
        tx,
        author,
        world.artistId,
        patch,
      );
      // Another catalog edit to the same page, confirmed in its turn.
      const track = world.album.trackIds[0]!;
      const retitle = { title: uniqueLabel("Track") };
      const trackReview = await previewTrackChange(tx, author, track, retitle);
      await updateTrack(tx, author, track, retitle, {
        confirmation: trackReview.confirmation,
      });
      const before = await everything(tx);
      expect(
        await failure(
          updateArtist(tx, author, world.artistId, patch, {
            confirmation: review.confirmation,
          }),
        ),
      ).toBe("confirmation_stale");
      expect(await everything(tx)).toBe(before);
    });
  });

  it("never opens an artist page, token or not (A5)", async () => {
    await inRollbackTransaction(async (tx) => {
      const world = await servedArtist(tx);
      const newcomer = await createTestArtist(tx, uniqueLabel("Newcomer"));
      const credits = [{ artistId: world.artistId }, { artistId: newcomer }];
      expect(
        await failure(
          previewAlbumChange(tx, author, world.album.albumId, { credits }),
        ),
      ).toBe("public_page");
      expect(
        await failure(
          updateAlbum(tx, author, world.album.albumId, { credits }),
        ),
      ).toBe("public_page");
    });
  });

  it("discloses a namesake's address move, and applies it only when confirmed", async () => {
    await inRollbackTransaction(async (tx) => {
      const shared = uniqueLabel("Namesake");
      const first = await servedArtist(tx, shared);
      const second = await servedArtist(tx, shared);
      const patch = { name: uniqueLabel("Unique now") };
      const review = await previewArtistChange(
        tx,
        author,
        second.artistId,
        patch,
      );
      // Both addresses move: the renamed artist's, and its namesake's, which
      // loses its suffix.
      expect(review.review.addresses).toHaveLength(2);
      expect(
        review.review.addresses.every((address) =>
          address.before?.includes("-"),
        ),
      ).toBe(true);
      // The namesake's own journal is listed, though its wording did not change.
      expect(
        review.review.pages.some(
          (page) =>
            page.surface === "album_journal" &&
            page.changes.some((change) => change.atom === "credits.1.link"),
        ),
      ).toBe(true);
      expect(
        await failure(updateArtist(tx, author, second.artistId, patch)),
      ).toBe("confirmation_required");
      await updateArtist(tx, author, second.artistId, patch, {
        confirmation: review.confirmation,
      });
      void first;
    });
  });

  it("fails closed when the impact cannot be computed, writing nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const world = await servedArtist(tx);
      // A temporary table in the way of the computation's copies (one the
      // command's own lock reads do not use).
      await tx.execute(
        sql`create temporary table edition_tracks (id uuid) on commit drop`,
      );
      expect(
        await failure(
          updateArtist(tx, author, world.artistId, { name: uniqueLabel("X") }),
        ),
      ).toBe("impact_unavailable");
      await tx.execute(sql`drop table pg_temp.edition_tracks`);
      expect(await nameOf(tx, world.artistId)).toBe(world.name);
    });
  });
});

describe("confirmed edits under concurrency", () => {
  const made: {
    entries: string[];
    albums: string[];
    tracks: string[];
    artists: string[];
  } = {
    entries: [],
    albums: [],
    tracks: [],
    artists: [],
  };
  afterAll(async () => {
    await getDb().transaction(async (tx) => {
      for (const id of made.entries) {
        await tx.execute(sql`delete from entry_slugs where entry_id = ${id}`);
        await tx.execute(sql`delete from entries where id = ${id}`);
      }
      for (const id of made.albums) {
        await tx.execute(sql`delete from albums where id = ${id}`);
      }
      for (const id of made.tracks) {
        await tx.execute(sql`delete from tracks where id = ${id}`);
      }
      for (const id of made.artists) {
        await tx.execute(sql`delete from artists where id = ${id}`);
      }
    });
  });

  async function committed() {
    return getDb().transaction(async (tx) => {
      const world = await servedArtist(tx);
      made.entries.push(world.journalId);
      made.albums.push(world.album.albumId);
      made.tracks.push(...world.album.trackIds);
      made.artists.push(world.artistId);
      return world;
    });
  }

  it("two confirmed edits of one artist race: one is saved, the other is stale", async () => {
    const world = await committed();
    const db = getDb();
    const first = await previewArtistChange(db, author, world.artistId, {
      name: "[Test] First",
    });
    const second = await previewArtistChange(db, author, world.artistId, {
      name: "[Test] Second",
    });
    await withConnections(2, async ([a, b]) => {
      const outcomes = await raceAll([
        () =>
          failure(
            updateArtist(
              a!,
              author,
              world.artistId,
              { name: "[Test] First" },
              { confirmation: first.confirmation },
            ),
          ),
        () =>
          failure(
            updateArtist(
              b!,
              author,
              world.artistId,
              { name: "[Test] Second" },
              { confirmation: second.confirmation },
            ),
          ),
      ]);
      const values = outcomes.map((o) =>
        o.status === "fulfilled" ? o.value : String(o.reason),
      );
      expect(values.sort()).toEqual(["confirmation_stale", "succeeded"]);
    });
  });

  it("a publication between the review and the confirmation makes it stale", async () => {
    const world = await committed();
    const db = getDb();
    const review = await previewArtistChange(db, author, world.artistId, {
      name: "[Test] After",
    });
    // Another journal crediting the artist is published meanwhile: one more
    // page shows the name.
    const otherAlbum = await db.transaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: uniqueLabel("Another"),
        artistIds: [world.artistId],
      });
      const entryId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        slug: slugOf(),
        versions: [{ locale: "en", status: "private", text: "[Test] Words" }],
      });
      made.entries.push(entryId);
      made.albums.push(album.albumId);
      made.tracks.push(...album.trackIds);
      return entryId;
    });
    const publication = await previewPublication(db, author, {
      entryId: otherAlbum,
      locale: "en",
    });
    await publishLanguageVersion(db, author, {
      entryId: otherAlbum,
      locale: "en",
      expectedVersion: publication.disclosure.entryVersion,
      confirmation: publication.confirmation,
    });
    expect(
      await failure(
        updateArtist(
          db,
          author,
          world.artistId,
          { name: "[Test] After" },
          { confirmation: review.confirmation },
        ),
      ),
    ).toBe("confirmation_stale");
  });
});
