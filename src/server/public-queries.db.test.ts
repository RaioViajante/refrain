import { describe, expect, it } from "vitest";

import { siteImages, siteTexts } from "@/db/schema";
import {
  addTrack,
  insertImage,
  insertMixtape,
  insertSong,
} from "@/test/fixtures";
import { connectTestDatabase } from "@/test/db";

import {
  getArchiveStats,
  getPublishedMixtape,
  getSiteImages,
  getSiteTexts,
  listFeaturedMixtapes,
  listPublishedMixtapes,
} from "./public-queries";

const db = connectTestDatabase();

describe("public reads never expose a draft", () => {
  it("hides a draft from every public read, even when featured", async () => {
    const draft = await insertMixtape(db, {
      slug: "draft-tape",
      featuredRank: 1,
      year: 1999,
    });
    const song = await insertSong(db);
    await addTrack(db, draft.id, song.id, 1, "[Test] private note");

    expect(await listPublishedMixtapes(db)).toEqual([]);
    expect(await listFeaturedMixtapes(db)).toEqual([]);
    expect(await getPublishedMixtape(db, "draft-tape")).toBeNull();
    expect(await getArchiveStats(db)).toEqual({
      mixtapes: 0,
      tracks: 0,
      artists: 0,
      since: null,
    });
  });
});

describe("listPublishedMixtapes", () => {
  it("lists published tapes by number, with track and note counts", async () => {
    const second = await insertMixtape(db, { number: 2, status: "published" });
    const first = await insertMixtape(db, { number: 1, status: "published" });
    await insertMixtape(db, { number: 3 });
    const songs = await Promise.all([1, 2, 3].map(() => insertSong(db)));
    await addTrack(db, first.id, songs[0]!.id, 1, "[Test] note");
    await addTrack(db, first.id, songs[1]!.id, 2);
    await addTrack(db, first.id, songs[2]!.id, 3, "[Test] another");

    const list = await listPublishedMixtapes(db);
    expect(list.map((m) => [m.slug, m.trackCount, m.noteCount])).toEqual([
      [first.slug, 3, 2],
      [second.slug, 0, 0],
    ]);
  });

  it("shows a cover only when its publishing rights are confirmed", async () => {
    const unverified = await insertImage(db);
    const confirmed = await insertImage(db, {
      rightsConfirmed: true,
      alt: "[Test] confirmed cover",
    });
    await insertMixtape(db, {
      number: 1,
      status: "published",
      coverImageId: unverified.id,
    });
    await insertMixtape(db, {
      number: 2,
      status: "published",
      coverImageId: confirmed.id,
    });

    const [a, b] = await listPublishedMixtapes(db);
    expect(a?.cover).toBeNull();
    expect(b?.cover).toMatchObject({
      url: confirmed.url,
      alt: "[Test] confirmed cover",
      treatment: "mood",
      focus: 4,
    });
  });
});

describe("listFeaturedMixtapes", () => {
  it("returns published featured tapes in featured order", async () => {
    const third = await insertMixtape(db, {
      status: "published",
      featuredRank: 3,
    });
    const first = await insertMixtape(db, {
      status: "published",
      featuredRank: 1,
    });
    await insertMixtape(db, { status: "published" });
    await insertMixtape(db, { featuredRank: 2 });

    const list = await listFeaturedMixtapes(db);
    expect(list.map((m) => m.slug)).toEqual([first.slug, third.slug]);
  });
});

describe("getPublishedMixtape", () => {
  it("returns the tape with its tracklist in order, joined to songs", async () => {
    const tape = await insertMixtape(db, {
      status: "published",
      slug: "core",
      reflection: "[Test] reflection",
    });
    const a = await insertSong(db, { title: "[Test] A", artist: "[Test] X" });
    const b = await insertSong(db, { title: "[Test] B", artist: "[Test] Y" });
    await addTrack(db, tape.id, b.id, 2);
    await addTrack(db, tape.id, a.id, 1, "[Test] first");

    const result = await getPublishedMixtape(db, "core");
    expect(result).toMatchObject({
      slug: "core",
      reflection: "[Test] reflection",
      cover: null,
      detailImage: null,
    });
    expect(result).not.toHaveProperty("id");
    expect(result?.tracks).toEqual([
      {
        position: 1,
        title: "[Test] A",
        artist: "[Test] X",
        note: "[Test] first",
        noteSide: "right",
      },
      {
        position: 2,
        title: "[Test] B",
        artist: "[Test] Y",
        note: "",
        noteSide: "right",
      },
    ]);
  });

  it("returns null for an unknown slug", async () => {
    expect(await getPublishedMixtape(db, "nowhere")).toBeNull();
  });
});

describe("getArchiveStats", () => {
  it("counts tapes, tracks, distinct artists, and the first year, published only", async () => {
    const a = await insertMixtape(db, { status: "published", year: 2025 });
    const b = await insertMixtape(db, { status: "published", year: 2024 });
    const draft = await insertMixtape(db, { year: 2001 });
    const s1 = await insertSong(db, { artist: "[Test] Same" });
    const s2 = await insertSong(db, { artist: "[Test] Same" });
    const s3 = await insertSong(db, { artist: "[Test] Other" });
    const hidden = await insertSong(db, { artist: "[Test] Hidden" });
    await addTrack(db, a.id, s1.id, 1);
    await addTrack(db, a.id, s2.id, 2);
    await addTrack(db, b.id, s1.id, 1);
    await addTrack(db, b.id, s3.id, 2);
    await addTrack(db, draft.id, hidden.id, 1);

    expect(await getArchiveStats(db)).toEqual({
      mixtapes: 2,
      tracks: 4,
      artists: 2,
      since: 2024,
    });
  });
});

describe("site texts and images", () => {
  it("returns the requested texts only", async () => {
    await db.insert(siteTexts).values([
      { key: "home.letter", body: "[Test] letter" },
      { key: "about.intro", body: "[Test] intro" },
    ]);
    expect(await getSiteTexts(db, ["home.letter", "home.quote"])).toEqual({
      "home.letter": "[Test] letter",
    });
  });

  it("fills an image slot only with a rights-confirmed image", async () => {
    const ok = await insertImage(db, { rightsConfirmed: true });
    const unverified = await insertImage(db);
    await db.insert(siteImages).values([
      { slot: "footer.road", imageId: ok.id },
      { slot: "home.hero", imageId: unverified.id },
    ]);
    const result = await getSiteImages(db, ["footer.road", "home.hero"]);
    expect(Object.keys(result)).toEqual(["footer.road"]);
    expect(result["footer.road"]?.url).toBe(ok.url);
  });
});
