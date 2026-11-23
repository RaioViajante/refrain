import { and, asc, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { readTestDatabaseUrl } from "@/db/env";

import {
  imageFiles,
  images,
  mixtapes,
  mixtapeTracks,
  siteImages,
  songs,
  textVersions,
  trashFiles,
  trashImageRefs,
  trashItems,
} from "@/db/schema";
import { resolvePhoto } from "@/server/media/photos";
import {
  getPublishedMixtape,
  listPublishedMixtapes,
} from "@/server/public-queries";
import { connectTestDatabase } from "@/test/db";
import {
  addTrack,
  insertImage,
  insertMixtape,
  insertSong,
} from "@/test/fixtures";

import { StudioError } from "./errors";
import { deleteImage, listImagesForStudio } from "./images";
import {
  addTrack as addTrackByName,
  deleteMixtape,
  removeSongFromMixtape,
  removeTrack,
} from "./mixtapes";
import { deleteSong, updateSong } from "./songs";
import {
  getRestoreImpact,
  RestoreNeedsConfirmation,
  restoreFromTrash,
} from "./trash";

const db = connectTestDatabase();

// Every scenario of decision 0003 § 3 against real PostgreSQL. Synthetic
// [Test] data only.

async function itemFor(kind: string, subjectId: string) {
  const [item] = await db
    .select()
    .from(trashItems)
    .where(and(eq(trashItems.kind, kind), eq(trashItems.subjectId, subjectId)));
  return item;
}

/** Makes an item 31 days old: expired, but not purged. */
async function expire(itemId: string) {
  await db.execute(sql`
    update trash_items
    set deleted_at = now() - interval '31 days',
        purge_after = now() - interval '31 days' + interval '720 hours'
    where id = ${itemId}
  `);
}

async function tracklist(mixtapeId: string) {
  return db
    .select({
      id: mixtapeTracks.id,
      songId: mixtapeTracks.songId,
      position: mixtapeTracks.position,
      note: mixtapeTracks.note,
      noteSide: mixtapeTracks.noteSide,
    })
    .from(mixtapeTracks)
    .where(eq(mixtapeTracks.mixtapeId, mixtapeId))
    .orderBy(asc(mixtapeTracks.position));
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to fail");
}

/** A published tape with a cover, a support photo, and three annotated tracks. */
async function richTape(values: Partial<typeof mixtapes.$inferInsert> = {}) {
  const cover = await insertImage(db, { rightsConfirmed: true });
  const detail = await insertImage(db, { rightsConfirmed: true });
  const tape = await insertMixtape(db, {
    status: "published",
    publishedAt: new Date("2026-01-02T03:04:05Z"),
    reflection: "[Test] a reflection",
    description: "[Test] a description",
    pullQuote: "[Test] a quote",
    detailCaption: "[Test] a caption",
    featuredRank: 2,
    coverImageId: cover.id,
    detailImageId: detail.id,
    ...values,
  });
  const a = await insertSong(db);
  const b = await insertSong(db);
  const c = await insertSong(db);
  await addTrack(db, tape.id, a.id, 1, "[Test] note a");
  await addTrack(db, tape.id, b.id, 2, "");
  await addTrack(db, tape.id, c.id, 3, "[Test] note c");
  await db
    .update(mixtapeTracks)
    .set({ noteSide: "left" })
    .where(eq(mixtapeTracks.songId, c.id));
  return { tape, cover, detail, songs: [a, b, c] };
}

describe("a deleted tape", () => {
  it("leaves the site at once and comes back as a draft, whole", async () => {
    const { tape, cover, detail } = await richTape();
    const before = await tracklist(tape.id);

    await deleteMixtape(db, tape.id);
    expect(await db.select().from(mixtapes)).toHaveLength(0);
    expect(await db.select().from(mixtapeTracks)).toHaveLength(0);
    expect(await listPublishedMixtapes(db)).toHaveLength(0);
    expect(await getPublishedMixtape(db, tape.slug)).toBeNull();
    const item = (await itemFor("mixtape", tape.id))!;
    expect(item.label).toBe(tape.title);
    const refs = await db
      .select({ imageId: trashImageRefs.imageId })
      .from(trashImageRefs);
    expect(refs.map((r) => r.imageId).sort()).toEqual(
      [cover.id, detail.id].sort(),
    );
    // Its photos are no longer public: no published tape uses them.
    expect((await resolvePhoto(db, cover.id, false)).status).toBe(404);

    const result = await restoreFromTrash(db, item.id);
    expect(result).toMatchObject({ kind: "mixtape", id: tape.id });
    expect(result.message).toMatch(/voltou como rascunho/);
    const [back] = await db.select().from(mixtapes);
    expect(back).toMatchObject({
      id: tape.id,
      number: tape.number,
      slug: tape.slug,
      title: tape.title,
      reflection: "[Test] a reflection",
      description: "[Test] a description",
      pullQuote: "[Test] a quote",
      detailCaption: "[Test] a caption",
      coverImageId: cover.id,
      detailImageId: detail.id,
      featuredRank: 2,
      status: "draft",
      publishedAt: null,
    });
    expect(back!.createdAt).toEqual(tape.createdAt);
    expect(await tracklist(tape.id)).toEqual(before);
    expect(await listPublishedMixtapes(db)).toHaveLength(0);
    expect(await db.select().from(trashItems)).toHaveLength(0);
    expect(await db.select().from(trashImageRefs)).toHaveLength(0);
  });

  it("takes a new address, number, or no featured place when its own were taken", async () => {
    const { tape } = await richTape({
      slug: "test-core",
      number: 5,
      featuredRank: 1,
    });
    await deleteMixtape(db, tape.id);
    await insertMixtape(db, { slug: "test-core", number: 5, featuredRank: 1 });
    const [last] = await db
      .select({ n: sql<number>`max(${mixtapes.number})` })
      .from(mixtapes);

    const item = (await itemFor("mixtape", tape.id))!;
    const result = await restoreFromTrash(db, item.id);
    const [back] = await db
      .select()
      .from(mixtapes)
      .where(eq(mixtapes.id, tape.id));
    expect(back!.slug).toBe("test-core-2");
    expect(back!.number).toBe(last!.n + 1);
    expect(back!.featuredRank).toBeNull();
    expect(back!.status).toBe("draft");
    expect(result.message).toMatch(/endereço test-core-2/);
    expect(result.message).toMatch(/número/);
    expect(result.message).toMatch(/1º lugar de destaque/);
  });

  it("keeps a suffixed address within the 80 characters allowed", async () => {
    const slug = `a${"-b".repeat(39)}c`;
    expect(slug).toHaveLength(80);
    const { tape } = await richTape({ slug, featuredRank: null });
    await deleteMixtape(db, tape.id);
    await insertMixtape(db, { slug });
    await insertMixtape(db, { slug: slug.slice(0, 77) });
    await restoreFromTrash(db, (await itemFor("mixtape", tape.id))!.id);
    const [back] = await db
      .select()
      .from(mixtapes)
      .where(eq(mixtapes.id, tape.id));
    expect(back!.slug).toBe(`${slug.slice(0, 77)}-2`);
  });

  it("stays in the trash when its number is taken and the shelf is full", async () => {
    const { tape } = await richTape({ number: 7 });
    await deleteMixtape(db, tape.id);
    await insertMixtape(db, { number: 7 });
    await insertMixtape(db, { number: 999 });
    const item = (await itemFor("mixtape", tape.id))!;
    const error = await failure(restoreFromTrash(db, item.id));
    expect(error).toBeInstanceOf(StudioError);
    expect(error.message).toMatch(/estante está cheia/);
    expect(await itemFor("mixtape", tape.id)).toBeDefined();
    expect(
      await db.select().from(mixtapes).where(eq(mixtapes.id, tape.id)),
    ).toHaveLength(0);
  });

  it("recreates a song deleted meanwhile, and holds back a track whose name now collides", async () => {
    const { tape, songs: s } = await richTape();
    await deleteMixtape(db, tape.id);
    // s[0] is deleted for good (its own trash item expires and is purged).
    await deleteSong(db, s[0]!.id);
    await db.delete(trashItems).where(eq(trashItems.kind, "song"));
    // s[1] is deleted, and s[2] renamed to s[1]'s name.
    await deleteSong(db, s[1]!.id);
    await updateSong(db, s[2]!.id, {
      title: s[1]!.title.toUpperCase(),
      artist: s[1]!.artist,
    });

    const item = (await itemFor("mixtape", tape.id))!;
    const result = await restoreFromTrash(db, item.id);
    const tracks = await tracklist(tape.id);
    // s[0] is recreated with a new id. s[2]'s own track keeps s[2] (same
    // id); s[1]'s track matches s[2] only by name, so it is held back.
    expect(tracks).toHaveLength(2);
    const [recreated] = await db
      .select()
      .from(songs)
      .where(eq(songs.title, s[0]!.title));
    expect(recreated!.id).not.toBe(s[0]!.id);
    expect(tracks[0]).toMatchObject({
      songId: recreated!.id,
      note: "[Test] note a",
      position: 1,
    });
    expect(tracks[1]).toMatchObject({
      songId: s[2]!.id,
      note: "[Test] note c",
      noteSide: "left",
      position: 2,
    });
    const [held] = await db
      .select()
      .from(trashItems)
      .where(eq(trashItems.kind, "track"));
    expect(held!.deletedAt).toEqual(item.deletedAt);
    expect(held!.purgeAfter).toEqual(item.purgeAfter);
    expect(held!.payload).toMatchObject({
      track: { song: { id: s[1]!.id }, position: 2, mixtapeId: tape.id },
    });
    expect(result.message).toMatch(/ficou na lixeira/);
    expect(result.message).toMatch(/renomeie uma das duas/);
    expect(result.message).toMatch(/voltou ao catálogo/);

    // As the message says, renaming one of the two frees the held track.
    expect((await failure(restoreFromTrash(db, held!.id))).message).toMatch(
      /já tem/,
    );
    await updateSong(db, s[2]!.id, {
      title: "[Test] renamed",
      artist: s[1]!.artist,
    });
    await restoreFromTrash(db, held!.id);
    expect((await tracklist(tape.id)).map((t) => t.position)).toEqual([
      1, 2, 3,
    ]);
  });

  it("waits for a note being saved, so the snapshot holds the saved note", async () => {
    const tape = await insertMixtape(db);
    const song = await insertSong(db);
    await addTrack(db, tape.id, song.id, 1, "[Test] old");
    const [track] = await tracklist(tape.id);
    const other = new Pool({ connectionString: readTestDatabaseUrl() });
    const client = await other.connect();
    try {
      await client.query("begin");
      await client.query("update mixtape_tracks set note = $1 where id = $2", [
        "[Test] new",
        track!.id,
      ]);
      const deleting = deleteMixtape(db, tape.id);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await client.query("commit");
      await deleting;
    } finally {
      client.release();
      await other.end();
    }
    const item = (await itemFor("mixtape", tape.id))!;
    expect(item.payload).toMatchObject({
      tracks: [{ id: track!.id, note: "[Test] new" }],
    });
  });

  it("restores a track while another track of its tape is being removed", async () => {
    const tape = await insertMixtape(db);
    const [a, b, c] = [
      await insertSong(db),
      await insertSong(db),
      await insertSong(db),
    ];
    await addTrack(db, tape.id, a!.id, 1);
    await addTrack(db, tape.id, b!.id, 2);
    await addTrack(db, tape.id, c!.id, 3);
    const [ta, , tc] = await tracklist(tape.id);
    await removeTrack(db, tc!.id);
    const other = new Pool({ connectionString: readTestDatabaseUrl() });
    const client = await other.connect();
    try {
      await client.query("begin");
      await client.query("delete from mixtape_tracks where id = $1", [ta!.id]);
      const restoring = restoreFromTrash(
        db,
        (await itemFor("track", tc!.id))!.id,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await client.query("commit");
      await restoring;
    } finally {
      client.release();
      await other.end();
    }
    expect(
      (await tracklist(tape.id)).map((t) => [t.songId, t.position]),
    ).toEqual([
      [b!.id, 1],
      [c!.id, 2],
    ]);
  });

  it("serializes concurrent restores that compete for the end of the shelf", async () => {
    const a = await insertMixtape(db, { slug: "test-a" });
    const b = await insertMixtape(db, { slug: "test-b" });
    await deleteMixtape(db, a.id);
    await deleteMixtape(db, b.id);
    await insertMixtape(db, { number: a.number });
    await insertMixtape(db, { number: b.number });
    const [last] = await db
      .select({ n: sql<number>`max(${mixtapes.number})` })
      .from(mixtapes);
    const results = await Promise.all([
      restoreFromTrash(db, (await itemFor("mixtape", a.id))!.id),
      restoreFromTrash(db, (await itemFor("mixtape", b.id))!.id),
    ]);
    expect(results.map((r) => r.kind)).toEqual(["mixtape", "mixtape"]);
    const numbers = (
      await db
        .select({ number: mixtapes.number })
        .from(mixtapes)
        .where(sql`${mixtapes.id} in (${a.id}, ${b.id})`)
    ).map((r) => r.number);
    expect(new Set(numbers).size).toBe(2);
    expect(Math.min(...numbers)).toBeGreaterThan(last!.n);
  });

  it("cannot be restored once expired, even before the purge, nor twice", async () => {
    const { tape } = await richTape();
    await deleteMixtape(db, tape.id);
    const item = (await itemFor("mixtape", tape.id))!;
    await expire(item.id);
    expect((await failure(restoreFromTrash(db, item.id))).message).toMatch(
      /passou dos 30 dias/,
    );
    expect(await itemFor("mixtape", tape.id)).toBeDefined();

    const other = await insertMixtape(db);
    await deleteMixtape(db, other.id);
    const second = (await itemFor("mixtape", other.id))!;
    const [one, two] = await Promise.allSettled([
      restoreFromTrash(db, second.id),
      restoreFromTrash(db, second.id),
    ]);
    const outcomes = [one!.status, two!.status].sort();
    expect(outcomes).toEqual(["fulfilled", "rejected"]);
    const rejected = [one, two].find((o) => o!.status === "rejected") as
      PromiseRejectedResult | undefined;
    expect(String(rejected!.reason.message)).toMatch(
      /não está mais na lixeira/,
    );
    expect(
      await db.select().from(mixtapes).where(eq(mixtapes.id, other.id)),
    ).toHaveLength(1);
  });

  it("can be deleted again after a restore, and replaces its own expired item", async () => {
    const { tape } = await richTape();
    await deleteMixtape(db, tape.id);
    await restoreFromTrash(db, (await itemFor("mixtape", tape.id))!.id);
    await deleteMixtape(db, tape.id);
    const first = (await itemFor("mixtape", tape.id))!;
    await restoreFromTrash(db, first.id);
    // An expired item for the same tape, never purged, does not block it.
    await deleteMixtape(db, tape.id);
    const expiring = (await itemFor("mixtape", tape.id))!;
    await restoreFromTrash(db, expiring.id);
    await db.insert(trashItems).values({
      kind: "mixtape",
      subjectId: tape.id,
      label: "[Test] stale",
      payload: {},
      payloadVersion: 1,
      deletedAt: new Date(Date.now() - 31 * 864e5),
      purgeAfter: new Date(Date.now() - 864e5),
    });
    await deleteMixtape(db, tape.id);
    const items = await db.select().from(trashItems);
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe(tape.title);
  });
});

describe("a deleted song", () => {
  it("needs an explicit confirmation naming each published page it changes", async () => {
    const live = await insertMixtape(db, { status: "published" });
    const draft = await insertMixtape(db);
    const song = await insertSong(db);
    const other = await insertSong(db);
    await addTrack(db, live.id, other.id, 1);
    await addTrack(db, live.id, song.id, 2, "[Test] live note");
    await addTrack(db, draft.id, song.id, 1, "[Test] draft note");
    const ids = {
      live: (await tracklist(live.id))[1]!.id,
      draft: (await tracklist(draft.id))[0]!.id,
    };

    await deleteSong(db, song.id);
    expect(await db.select().from(songs).where(eq(songs.id, song.id))).toEqual(
      [],
    );
    expect((await getPublishedMixtape(db, live.slug))!.tracks).toHaveLength(1);
    const item = (await itemFor("song", song.id))!;

    const impact = await getRestoreImpact(db, item.id);
    expect(impact.publishedTapes).toEqual([
      { id: live.id, title: live.title, path: `/mixtapes/${live.slug}` },
    ]);
    const refused = await failure(restoreFromTrash(db, item.id));
    expect(refused).toBeInstanceOf(RestoreNeedsConfirmation);
    expect((refused as RestoreNeedsConfirmation).tapes).toEqual(
      impact.publishedTapes,
    );
    expect(refused.message).toContain(`/mixtapes/${live.slug}`);
    expect(refused.message).toMatch(/na hora/);
    // Nothing was written: the song is still only in the trash.
    expect(await db.select().from(songs).where(eq(songs.id, song.id))).toEqual(
      [],
    );
    expect(await itemFor("song", song.id)).toBeDefined();
    // Confirming another tape is not confirming this one.
    expect(
      await failure(
        restoreFromTrash(db, item.id, { confirmedTapeIds: [draft.id] }),
      ),
    ).toBeInstanceOf(RestoreNeedsConfirmation);

    await restoreFromTrash(db, item.id, { confirmedTapeIds: [live.id] });
    expect(await tracklist(live.id)).toEqual([
      expect.objectContaining({ songId: other.id, position: 1 }),
      {
        id: ids.live,
        songId: song.id,
        position: 2,
        note: "[Test] live note",
        noteSide: "right",
      },
    ]);
    expect(await tracklist(draft.id)).toEqual([
      expect.objectContaining({ id: ids.draft, note: "[Test] draft note" }),
    ]);
    expect((await getPublishedMixtape(db, live.slug))!.tracks).toHaveLength(2);
  });

  it("goes back at its old position, or at the end of a shorter tape", async () => {
    const tape = await insertMixtape(db);
    const [a, b, c, d] = [
      await insertSong(db),
      await insertSong(db),
      await insertSong(db),
      await insertSong(db),
    ];
    for (const [i, s] of [a, b, c, d].entries()) {
      await addTrack(db, tape.id, s!.id, i + 1);
    }
    await deleteSong(db, b!.id);
    await restoreFromTrash(db, (await itemFor("song", b!.id))!.id);
    expect((await tracklist(tape.id)).map((t) => t.songId)).toEqual([
      a!.id,
      b!.id,
      c!.id,
      d!.id,
    ]);
    await deleteSong(db, d!.id);
    await removeSongFromMixtape(db, tape.id, c!.id);
    await removeSongFromMixtape(db, tape.id, b!.id);
    await restoreFromTrash(db, (await itemFor("song", d!.id))!.id);
    expect(
      (await tracklist(tape.id)).map((t) => [t.songId, t.position]),
    ).toEqual([
      [a!.id, 1],
      [d!.id, 2],
    ]);
  });

  it("keeps a track whose tape is in the trash as its own item, restorable later", async () => {
    const tape = await insertMixtape(db);
    const song = await insertSong(db);
    await addTrack(db, tape.id, song.id, 1, "[Test] waiting note");
    await deleteSong(db, song.id);
    await deleteMixtape(db, tape.id);
    const songItem = (await itemFor("song", song.id))!;

    const result = await restoreFromTrash(db, songItem.id);
    expect(result.message).toMatch(/ficou na lixeira, junto com a fita/);
    const [held] = await db
      .select()
      .from(trashItems)
      .where(eq(trashItems.kind, "track"));
    expect(held!.deletedAt).toEqual(songItem.deletedAt);
    expect(held!.purgeAfter).toEqual(songItem.purgeAfter);

    // The track refuses to go back before its tape, and stays.
    expect((await failure(restoreFromTrash(db, held!.id))).message).toMatch(
      /está na lixeira: restaure a fita antes/,
    );
    await restoreFromTrash(db, (await itemFor("mixtape", tape.id))!.id);
    await restoreFromTrash(db, held!.id);
    expect(await tracklist(tape.id)).toEqual([
      expect.objectContaining({ songId: song.id, note: "[Test] waiting note" }),
    ]);
  });

  it("never loses a note: one that cannot go back is kept as a version", async () => {
    const kept = await insertMixtape(db, { title: "[Test] kept tape" });
    const gone = await insertMixtape(db, { title: "[Test] gone tape" });
    const song = await insertSong(db);
    await addTrack(db, kept.id, song.id, 1, "[Test] old note");
    await addTrack(db, gone.id, song.id, 1, "[Test] orphan note");
    const goneTrackId = (await tracklist(gone.id))[0]!.id;
    await deleteSong(db, song.id);
    const songItem = (await itemFor("song", song.id))!;
    // The owner adds the song back to one tape by hand (same name), with a
    // new note; the other tape is deleted and purged.
    await addTrackByName(db, kept.id, {
      title: song.title,
      artist: song.artist,
    });
    const liveTrack = (await tracklist(kept.id))[0]!;
    await db
      .update(mixtapeTracks)
      .set({ note: "[Test] new note" })
      .where(eq(mixtapeTracks.id, liveTrack.id));
    await deleteMixtape(db, gone.id);
    await db.delete(trashItems).where(eq(trashItems.subjectId, gone.id));

    const result = await restoreFromTrash(db, songItem.id);
    expect(result.message).toMatch(/já tinha essa música/);
    expect(result.message).toMatch(/não existe mais; a nota ficou guardada/);
    // The live note is untouched; both old notes are versions.
    expect((await tracklist(kept.id))[0]!.note).toBe("[Test] new note");
    const versions = await db
      .select()
      .from(textVersions)
      .orderBy(asc(textVersions.body));
    expect(versions).toEqual([
      expect.objectContaining({
        subject: "track",
        subjectKey: liveTrack.id,
        field: "note",
        body: "[Test] old note",
        purgeAfter: songItem.purgeAfter,
      }),
      expect.objectContaining({
        subject: "track",
        subjectKey: goneTrackId,
        field: "note",
        body: "[Test] orphan note",
        purgeAfter: songItem.purgeAfter,
      }),
    ]);
    expect(versions[1]!.label).toContain("[Test] gone tape");
  });
});

describe("a removed track", () => {
  it("goes to the trash with or without a note, and back to its place", async () => {
    const tape = await insertMixtape(db);
    const [a, b, c] = [
      await insertSong(db),
      await insertSong(db),
      await insertSong(db),
    ];
    await addTrack(db, tape.id, a!.id, 1);
    await addTrack(db, tape.id, b!.id, 2);
    await addTrack(db, tape.id, c!.id, 3, "[Test] c note");
    const [, tb, tc] = await tracklist(tape.id);

    await removeTrack(db, tb!.id);
    await removeSongFromMixtape(db, tape.id, c!.id);
    expect(await db.select().from(trashItems)).toHaveLength(2);
    expect((await tracklist(tape.id)).map((t) => t.position)).toEqual([1]);

    await restoreFromTrash(db, (await itemFor("track", tc!.id))!.id);
    await restoreFromTrash(db, (await itemFor("track", tb!.id))!.id);
    expect(await tracklist(tape.id)).toEqual([
      expect.objectContaining({ songId: a!.id, position: 1 }),
      { ...tb!, position: 2 },
      { ...tc!, position: 3 },
    ]);
  });

  it("asks before changing a published tape, and refuses a song already back", async () => {
    const tape = await insertMixtape(db, { status: "published" });
    const song = await insertSong(db);
    await addTrack(db, tape.id, song.id, 1, "[Test] note");
    const [track] = await tracklist(tape.id);
    await removeTrack(db, track!.id);
    const item = (await itemFor("track", track!.id))!;

    expect(await failure(restoreFromTrash(db, item.id))).toBeInstanceOf(
      RestoreNeedsConfirmation,
    );
    expect(await tracklist(tape.id)).toEqual([]);

    await addTrack(db, tape.id, song.id, 1);
    expect(
      (
        await failure(
          restoreFromTrash(db, item.id, { confirmedTapeIds: [tape.id] }),
        )
      ).message,
    ).toMatch(/já tem/);
    expect(await itemFor("track", track!.id)).toBeDefined();

    await db.delete(mixtapeTracks);
    await restoreFromTrash(db, item.id, { confirmedTapeIds: [tape.id] });
    expect(await tracklist(tape.id)).toEqual([track]);
  });

  it("cannot come back once its tape is gone for good", async () => {
    const tape = await insertMixtape(db);
    const song = await insertSong(db);
    await addTrack(db, tape.id, song.id, 1);
    const [track] = await tracklist(tape.id);
    await removeTrack(db, track!.id);
    await deleteMixtape(db, tape.id);
    await db.delete(trashItems).where(eq(trashItems.kind, "mixtape"));
    const item = (await itemFor("track", track!.id))!;
    expect((await failure(restoreFromTrash(db, item.id))).message).toMatch(
      /não existe mais/,
    );
    expect(await itemFor("track", track!.id)).toBeDefined();
  });
});

describe("a deleted photo", () => {
  it("keeps its bytes exactly and comes back with its id and rights", async () => {
    const photo = await insertImage(db, {
      rightsConfirmed: true,
      rightsNote: "[Test] rights",
      focus: 2,
      treatment: "original",
    });
    const [file] = await db
      .select()
      .from(imageFiles)
      .where(eq(imageFiles.imageId, photo.id));

    await deleteImage(db, photo.id);
    expect(await db.select().from(images)).toHaveLength(0);
    expect((await resolvePhoto(db, photo.id, true)).status).toBe(404);
    const [kept] = await db.select().from(trashFiles);
    expect(kept!.bytes.equals(file!.bytes)).toBe(true);

    await restoreFromTrash(db, (await itemFor("image", photo.id))!.id);
    const [back] = await db.select().from(images);
    expect(back).toMatchObject({
      id: photo.id,
      alt: photo.alt,
      rightsConfirmed: true,
      rightsNote: "[Test] rights",
      focus: 2,
      treatment: "original",
    });
    const [restored] = await db.select().from(imageFiles);
    expect(restored!.bytes.equals(file!.bytes)).toBe(true);
    expect(restored!.contentType).toBe(file!.contentType);
    expect(await db.select().from(trashFiles)).toHaveLength(0);
  });

  it("cannot be deleted while a restorable item uses it, and can once that item expires", async () => {
    const cover = await insertImage(db);
    const tape = await insertMixtape(db, {
      title: "[Test] trashed",
      coverImageId: cover.id,
    });
    await deleteMixtape(db, tape.id);

    const [listed] = await listImagesForStudio(db);
    expect(listed!.usage).toEqual([{ kind: "trash", label: "[Test] trashed" }]);
    const error = await failure(deleteImage(db, cover.id));
    expect(error.message).toMatch(/em uso \(\[Test\] trashed \(na lixeira\)\)/);
    expect(await db.select().from(images)).toHaveLength(1);

    await expire((await itemFor("mixtape", tape.id))!.id);
    expect((await listImagesForStudio(db))[0]!.usage).toEqual([]);
    await deleteImage(db, cover.id);
    expect(await db.select().from(images)).toHaveLength(0);
    expect(await itemFor("mixtape", tape.id)).toBeUndefined();
    expect(await itemFor("image", cover.id)).toBeDefined();
  });

  it("is still refused while a live tape or a page slot uses it", async () => {
    const photo = await insertImage(db);
    await db
      .insert(siteImages)
      .values({ slot: "home.hero", imageId: photo.id });
    expect((await failure(deleteImage(db, photo.id))).message).toMatch(
      /em uso/,
    );
    expect(await db.select().from(trashItems)).toHaveLength(0);
  });
});

describe("the trash module", () => {
  it("is never imported by public code", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (path !== join("src", "app", "studio")) walk(path);
        } else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(join("src", "app"));
    walk(join("src", "components"));
    files.push(
      "src/server/public-queries.ts",
      "src/server/site.ts",
      "src/server/visibility.ts",
      "src/server/media/photos.ts",
    );
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /studio\/trash|trash_items|trashItems/,
      );
    }
  });
});
