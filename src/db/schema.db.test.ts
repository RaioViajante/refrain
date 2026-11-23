import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  imageFiles,
  images,
  mixtapes,
  mixtapeTracks,
  songs,
} from "@/db/schema";
import {
  addTrack,
  insertImage,
  insertMixtape,
  insertSong,
} from "@/test/fixtures";
import { connectTestDatabase, pgError, RESTRICTED } from "@/test/db";

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

  it("refuses malformed slugs, non-https links, and unsafe photo files", async () => {
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
    const image = await insertImage(db);
    await db.delete(imageFiles).where(eq(imageFiles.imageId, image.id));
    expect(
      await pgError(
        db.insert(imageFiles).values({
          imageId: image.id,
          contentType: "image/svg+xml",
          byteSize: 3,
          bytes: Buffer.from("<s>"),
        }),
      ),
    ).toMatchObject({ constraint: "image_files_content_type" });
    expect(
      await pgError(
        db.insert(imageFiles).values({
          imageId: image.id,
          contentType: "image/png",
          byteSize: 99,
          bytes: Buffer.from("abc"),
        }),
      ),
    ).toMatchObject({ constraint: "image_files_byte_size" });
  });

  it("accepts one or two lower-case words as a tape's feeling", async () => {
    await insertMixtape(db, { feeling: "saudade" });
    await insertMixtape(db, { feeling: "raízes" });
    for (const feeling of ["Saudade", "dor, memória", "a b c", "x1"]) {
      expect(await pgError(insertMixtape(db, { feeling }))).toMatchObject({
        constraint: "mixtapes_feeling_format",
      });
    }
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
    ).toMatchObject({ code: RESTRICTED });
    expect(
      await pgError(db.delete(mixtapes).where(eq(mixtapes.id, tape.id))),
    ).toMatchObject({ code: RESTRICTED });
    expect(await db.select().from(mixtapeTracks)).toHaveLength(1);
  });

  it("refuses to delete an image a tape still uses", async () => {
    const cover = await insertImage(db);
    await insertMixtape(db, { coverImageId: cover.id });
    expect(
      await pgError(db.delete(images).where(eq(images.id, cover.id))),
    ).toMatchObject({ code: RESTRICTED });
  });
});
