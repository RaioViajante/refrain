import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { images, mixtapes, mixtapeTracks, songs } from "@/db/schema";
import {
  addTrack,
  insertImage,
  insertMixtape,
  insertSong,
} from "@/test/fixtures";
import { pgError, connectTestDatabase } from "@/test/db";

const db = connectTestDatabase();

describe("schema integrity (PostgreSQL constraints)", () => {
  it("ties publication to a publication date, in both directions", async () => {
    expect(
      await pgError(
        insertMixtape(db, { status: "published", publishedAt: null }),
      ),
    ).toMatchObject({ code: "23514", constraint: "mixtapes_published_at" });
    expect(
      await pgError(
        insertMixtape(db, { status: "draft", publishedAt: new Date() }),
      ),
    ).toMatchObject({ code: "23514", constraint: "mixtapes_published_at" });
    expect(
      await pgError(insertMixtape(db, { status: "hidden" })),
    ).toMatchObject({ code: "23514", constraint: "mixtapes_status" });
  });

  it("keeps catalogue numbers, slugs, and featured places unique", async () => {
    await insertMixtape(db, { number: 900, slug: "core", featuredRank: 1 });
    expect(await pgError(insertMixtape(db, { number: 900 }))).toMatchObject({
      code: "23505",
      constraint: "mixtapes_number_key",
    });
    expect(await pgError(insertMixtape(db, { slug: "core" }))).toMatchObject({
      code: "23505",
      constraint: "mixtapes_slug_key",
    });
    expect(await pgError(insertMixtape(db, { featuredRank: 1 }))).toMatchObject(
      {
        code: "23505",
        constraint: "mixtapes_featured_rank_key",
      },
    );
    expect(await pgError(insertMixtape(db, { featuredRank: 4 }))).toMatchObject(
      {
        code: "23514",
        constraint: "mixtapes_featured_rank_range",
      },
    );
  });

  it("refuses malformed slugs and non-https links", async () => {
    for (const slug of ["Core", "core tape", "-core", "core--x", ""]) {
      expect(await pgError(insertMixtape(db, { slug }))).toMatchObject({
        constraint: "mixtapes_slug_format",
      });
    }
    expect(
      await pgError(
        insertMixtape(db, { playlistUrl: "http://example.test/x" }),
      ),
    ).toMatchObject({ constraint: "mixtapes_playlist_url_https" });
    expect(
      await pgError(insertImage(db, { url: "javascript:alert(1)" })),
    ).toMatchObject({ constraint: "images_url_https" });
  });

  it("treats a song as the same song regardless of letter case", async () => {
    await insertSong(db, { title: "[Test] Angel", artist: "[Test] Band" });
    expect(
      await pgError(
        insertSong(db, { title: "[test] ANGEL", artist: "[TEST] band" }),
      ),
    ).toMatchObject({ code: "23505", constraint: "songs_title_artist_key" });
    expect(
      await pgError(insertSong(db, { title: "   ", artist: "x" })),
    ).toMatchObject({ constraint: "songs_title_length" });
  });

  it("keeps one position and one appearance per song on each tape", async () => {
    const tape = await insertMixtape(db);
    const a = await insertSong(db);
    const b = await insertSong(db);
    await addTrack(db, tape.id, a.id, 1);
    expect(await pgError(addTrack(db, tape.id, b.id, 1))).toMatchObject({
      constraint: "mixtape_tracks_position_key",
    });
    expect(await pgError(addTrack(db, tape.id, a.id, 2))).toMatchObject({
      constraint: "mixtape_tracks_song_key",
    });
    expect(await pgError(addTrack(db, tape.id, b.id, 0))).toMatchObject({
      constraint: "mixtape_tracks_position_positive",
    });
  });

  it("never removes authored notes by cascade", async () => {
    const tape = await insertMixtape(db);
    const song = await insertSong(db);
    await addTrack(db, tape.id, song.id, 1, "[Test] a note");

    expect(
      await pgError(db.delete(songs).where(eq(songs.id, song.id))),
    ).toMatchObject({ code: "23503" });
    expect(
      await pgError(db.delete(mixtapes).where(eq(mixtapes.id, tape.id))),
    ).toMatchObject({ code: "23503" });
    expect(await db.select().from(mixtapeTracks)).toHaveLength(1);
  });

  it("refuses to delete an image a tape still uses", async () => {
    const cover = await insertImage(db);
    await insertMixtape(db, { coverImageId: cover.id });
    expect(
      await pgError(db.delete(images).where(eq(images.id, cover.id))),
    ).toMatchObject({ code: "23503" });
  });
});
