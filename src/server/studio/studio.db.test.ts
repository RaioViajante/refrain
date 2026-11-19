import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { mixtapes, mixtapeTracks, songs } from "@/db/schema";
import { connectTestDatabase } from "@/test/db";
import { insertImage } from "@/test/fixtures";

import {
  getMixtapePage,
  getSiteImages,
  getSiteTexts,
  listPublishedMixtapes,
} from "../public-queries";
import { getDashboard } from "./dashboard";
import { StudioError } from "./errors";
import { deleteImage } from "./images";
import {
  addTrack,
  createMixtape,
  deleteMixtape,
  getStudioMixtape,
  listStudioMixtapes,
  moveMixtape,
  moveTrack,
  removeTrack,
  setMixtapeImage,
  setMixtapePublished,
  updateMixtape,
  updateTrackNote,
} from "./mixtapes";
import { getMixtapePreview, getSiteTextsPreview } from "./preview";
import { mixtapeFieldsSchema } from "./schemas";
import {
  saveSiteText,
  setSiteImage,
  setSiteTextPublished,
} from "./site-content";
import { createSong, deleteSong, listSongs, updateSong } from "./songs";

const db = connectTestDatabase();

const fields = (overrides: Record<string, string> = {}) =>
  mixtapeFieldsSchema.parse({
    title: "[test] tape",
    slug: "test-tape",
    theme: "",
    feeling: "",
    description: "",
    reflection: "",
    pullQuote: "",
    pullQuoteCredit: "",
    detailCaption: "",
    playlistUrl: "",
    year: "",
    featuredRank: "",
    ...overrides,
  });

async function positions(mixtapeId: string) {
  return db
    .select({ title: songs.title, position: mixtapeTracks.position })
    .from(mixtapeTracks)
    .innerJoin(songs, eq(songs.id, mixtapeTracks.songId))
    .where(eq(mixtapeTracks.mixtapeId, mixtapeId))
    .orderBy(asc(mixtapeTracks.position));
}

describe("mixtapes", () => {
  it("creates drafts at the end of the shelf with unique addresses", async () => {
    const a = await createMixtape(db, "[Test] Core");
    const b = await createMixtape(db, "[Test] Core");
    const list = await listStudioMixtapes(db);
    expect(list.map((m) => [m.id, m.number, m.slug, m.status])).toEqual([
      [a, 1, "test-core", "draft"],
      [b, 2, "test-core-2", "draft"],
    ]);
  });

  it("saves the editor's fields and moves a featured place", async () => {
    const a = await createMixtape(db, "[Test] A");
    const b = await createMixtape(db, "[Test] B");
    await updateMixtape(db, a, fields({ slug: "a", featuredRank: "1" }));
    await updateMixtape(
      db,
      b,
      fields({
        slug: "b",
        featuredRank: "1",
        year: "2024",
        playlistUrl: "https://example.test/p",
      }),
    );
    const [ta, tb] = await Promise.all([
      getStudioMixtape(db, a),
      getStudioMixtape(db, b),
    ]);
    expect(ta?.mixtape.featuredRank).toBeNull();
    expect(tb?.mixtape).toMatchObject({
      featuredRank: 1,
      year: 2024,
      playlistUrl: "https://example.test/p",
    });
    await expect(updateMixtape(db, a, fields({ slug: "b" }))).rejects.toThrow(
      "já existe uma fita com esse endereço.",
    );
  });

  it("validates fields before they reach the database", () => {
    const bad = mixtapeFieldsSchema.safeParse({
      ...fields(),
      title: " ",
      slug: "Not A Slug",
      playlistUrl: "javascript:alert(1)",
      year: "24",
      featuredRank: "9",
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path[0]).sort()).toEqual(
      ["featuredRank", "playlistUrl", "slug", "title", "year"].sort(),
    );
  });

  it("publishes, unpublishes, and keeps drafts out of every public read", async () => {
    const id = await createMixtape(db, "[Test] Secret");
    await addTrack(db, id, { title: "[Test] Hidden song", artist: "[Test] X" });
    await updateMixtape(db, id, fields({ slug: "secret", featuredRank: "1" }));
    expect(await listPublishedMixtapes(db)).toEqual([]);
    expect(await getMixtapePage(db, "secret")).toBeNull();

    await setMixtapePublished(db, id, true);
    expect((await listPublishedMixtapes(db)).map((m) => m.slug)).toEqual([
      "secret",
    ]);
    expect((await getMixtapePage(db, "secret"))?.mixtape.tracks).toHaveLength(
      1,
    );

    await setMixtapePublished(db, id, false);
    expect(await getMixtapePage(db, "secret")).toBeNull();
  });

  it("deletes a tape with its tracklist, keeping its songs", async () => {
    const id = await createMixtape(db, "[Test] Gone");
    await addTrack(db, id, { title: "[Test] Stays", artist: "[Test] Y" });
    await deleteMixtape(db, id);
    expect(await getStudioMixtape(db, id)).toBeNull();
    expect(await db.select().from(mixtapeTracks)).toEqual([]);
    expect((await listSongs(db)).found).toBe(1);
    await expect(deleteMixtape(db, id)).rejects.toBeInstanceOf(StudioError);
  });

  it("reorders the shelf by swapping numbers", async () => {
    const a = await createMixtape(db, "[Test] A");
    const b = await createMixtape(db, "[Test] B");
    const c = await createMixtape(db, "[Test] C");
    await moveMixtape(db, c, "up");
    await moveMixtape(db, a, "up"); // already first: no change
    const order = (await listStudioMixtapes(db)).map((m) => [m.id, m.number]);
    expect(order).toEqual([
      [a, 1],
      [c, 2],
      [b, 3],
    ]);
  });
});

describe("tracklist", () => {
  it("adds songs (reusing the catalogue's, any case), refusing duplicates", async () => {
    const id = await createMixtape(db, "[Test] T");
    await createSong(db, { title: "[Test] Angel", artist: "[Test] Priest" });
    await addTrack(db, id, { title: "[test] angel", artist: "[test] priest" });
    await addTrack(db, id, { title: "[Test] Second", artist: "[Test] Z" });
    expect((await listSongs(db)).found).toBe(2);
    await expect(
      addTrack(db, id, { title: "[TEST] ANGEL", artist: "[Test] Priest" }),
    ).rejects.toThrow("essa música já está na fita.");
    expect(await positions(id)).toEqual([
      { title: "[Test] Angel", position: 1 },
      { title: "[Test] Second", position: 2 },
    ]);
  });

  it("moves, annotates, and removes tracks, keeping positions contiguous", async () => {
    const id = await createMixtape(db, "[Test] T");
    const t1 = await addTrack(db, id, {
      title: "[Test] 1",
      artist: "[Test] A",
    });
    await addTrack(db, id, { title: "[Test] 2", artist: "[Test] A" });
    const t3 = await addTrack(db, id, {
      title: "[Test] 3",
      artist: "[Test] A",
    });

    await moveTrack(db, t3, "up");
    await moveTrack(db, t1, "up"); // first: no change
    expect((await positions(id)).map((p) => p.title)).toEqual([
      "[Test] 1",
      "[Test] 3",
      "[Test] 2",
    ]);

    await updateTrackNote(db, t3, "[Test] a note", "left");
    await removeTrack(db, t1);
    const tape = await getStudioMixtape(db, id);
    expect(
      tape?.tracks.map((t) => [t.position, t.title, t.note, t.noteSide]),
    ).toEqual([
      [1, "[Test] 3", "[Test] a note", "left"],
      [2, "[Test] 2", "", "right"],
    ]);
  });
});

describe("songs", () => {
  it("filters, sorts, and lists where each song appears", async () => {
    const a = await createMixtape(db, "[Test] A");
    await addTrack(db, a, { title: "[Test] Bloom", artist: "[Test] Kites" });
    const t = await addTrack(db, a, {
      title: "[Test] Angie",
      artist: "[Test] Stones",
    });
    await updateTrackNote(db, t, "[Test] note", "right");
    await createSong(db, { title: "[Test] Loose", artist: "[Test] Nobody" });

    expect(
      (await listSongs(db, { q: "kites" })).rows.map((s) => s.title),
    ).toEqual(["[Test] Bloom"]);
    expect(
      (await listSongs(db, { tape: "nenhuma" })).rows.map((s) => s.title),
    ).toEqual(["[Test] Loose"]);
    expect((await listSongs(db, { tape: a })).found).toBe(2);
    expect(
      (await listSongs(db, { notesOnly: true })).rows.map((s) => s.title),
    ).toEqual(["[Test] Angie"]);
    expect(
      (await listSongs(db, { sort: "musica" })).rows.map((s) => s.title),
    ).toEqual(["[Test] Angie", "[Test] Bloom", "[Test] Loose"]);
    const angie = (await listSongs(db, { q: "angie" })).rows[0]!;
    expect(angie.appearances).toEqual([
      {
        mixtapeId: a,
        number: 1,
        title: "[Test] A",
        position: 2,
        note: "[Test] note",
      },
    ]);
    // A search with LIKE wildcards matches them literally.
    expect((await listSongs(db, { q: "%" })).found).toBe(0);
  });

  it("renames without duplicating, and deletes from every tape", async () => {
    const a = await createMixtape(db, "[Test] A");
    const b = await createMixtape(db, "[Test] B");
    await addTrack(db, a, { title: "[Test] 1", artist: "[Test] X" });
    await addTrack(db, a, { title: "[Test] Doomed", artist: "[Test] X" });
    await addTrack(db, a, { title: "[Test] 3", artist: "[Test] X" });
    await addTrack(db, b, { title: "[Test] Doomed", artist: "[Test] X" });
    const doomed = (await listSongs(db, { q: "doomed" })).rows[0]!.id;

    await expect(
      updateSong(db, doomed, { title: "[Test] 1", artist: "[Test] X" }),
    ).rejects.toThrow("essa música já está no catálogo.");

    await deleteSong(db, doomed);
    expect(await positions(a)).toEqual([
      { title: "[Test] 1", position: 1 },
      { title: "[Test] 3", position: 2 },
    ]);
    expect(await positions(b)).toEqual([]);
  });
});

describe("site texts", () => {
  it("start as drafts, publish, and disappear when emptied", async () => {
    await saveSiteText(db, "about.letter", "[Test] letter");
    expect(await getSiteTexts(db, ["about.letter"])).toEqual({});
    expect(await getSiteTextsPreview(db, ["about.letter"])).toEqual({
      "about.letter": "[Test] letter",
    });

    await setSiteTextPublished(db, "about.letter", true);
    expect(await getSiteTexts(db, ["about.letter"])).toEqual({
      "about.letter": "[Test] letter",
    });

    await saveSiteText(db, "about.letter", "[Test] edited");
    expect(await getSiteTexts(db, ["about.letter"])).toEqual({
      "about.letter": "[Test] edited",
    });

    await saveSiteText(db, "about.letter", "");
    expect(await getSiteTexts(db, ["about.letter"])).toEqual({});
    await expect(setSiteTextPublished(db, "about.quote", true)).rejects.toThrow(
      "escreva o texto antes de publicá-lo.",
    );
  });
});

describe("photographs", () => {
  it("appear publicly only with confirmed rights, and cannot be deleted in use", async () => {
    const unconfirmed = await insertImage(db);
    await setSiteImage(db, "footer.road", unconfirmed.id);
    expect(await getSiteImages(db, ["footer.road"])).toEqual({});

    const id = await createMixtape(db, "[Test] With cover");
    await setMixtapeImage(db, id, "cover", unconfirmed.id);
    expect((await getMixtapePreview(db, id))?.mixtape.cover).toBeNull();

    await expect(deleteImage(db, unconfirmed.id)).rejects.toThrow(
      "essa foto está em uso",
    );
    await setSiteImage(db, "footer.road", null);
    await setMixtapeImage(db, id, "cover", null);
    expect(await deleteImage(db, unconfirmed.id)).toBe(unconfirmed.url);
  });
});

describe("preview and dashboard", () => {
  it("previews a draft tape as its public page would show it", async () => {
    const id = await createMixtape(db, "[Test] Draft");
    await addTrack(db, id, { title: "[Test] S", artist: "[Test] A" });
    const preview = await getMixtapePreview(db, id);
    expect(preview?.mixtape.title).toBe("[Test] Draft");
    expect(preview?.mixtape.tracks).toHaveLength(1);
    expect(preview?.artists).toEqual([{ artist: "[Test] A", count: 1 }]);
    expect(await listPublishedMixtapes(db)).toEqual([]);
  });

  it("counts real data and derives what is missing", async () => {
    const a = await createMixtape(db, "[Test] A");
    await createMixtape(db, "[Test] B");
    const t = await addTrack(db, a, { title: "[Test] S", artist: "[Test] A" });
    await updateTrackNote(db, t, "[Test] n", "right");
    await setMixtapePublished(db, a, true);
    await insertImage(db);

    const d = await getDashboard(db);
    expect(d.counts).toMatchObject({
      tapes: 2,
      published: 1,
      drafts: 1,
      tracks: 1,
      tapesWithTracks: 1,
      tapesWithoutTracks: 1,
      notes: 1,
      songs: 1,
      unconfirmedPhotos: 1,
    });
    const labels = d.pending.map((p) => p.label);
    expect(labels).toContain("faixas de [Test] B");
    expect(labels).toContain("escrever a reflexão de [Test] A");
    expect(labels).toContain("publicar [Test] B");
    expect(labels).toContain("confirmar os direitos de 1 foto");
    expect(await db.select().from(mixtapes)).toHaveLength(2);
  });
});
