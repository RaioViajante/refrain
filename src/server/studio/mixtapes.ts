// Studio reads and writes for mixtapes and their tracklists. Callers (Server
// Actions and pages) authorize first; these functions enforce data rules.
import "server-only";

import { and, asc, count, eq, isNotNull, max, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { images, mixtapes, mixtapeTracks, songs } from "@/db/schema";
import type { Database } from "@/db/types";

import { setTrackOrder } from "../tracklist";
import { pgCode, StudioError } from "./errors";
import type { MixtapeFields, SongInput } from "./schemas";

export const MAX_NUMBER = 999;
// Numbers are moved above this offset while the shelf is reordered, so the
// non-deferrable UNIQUE (number) never sees two equal values.
const NUMBER_PARKING = 10_000;

export type StudioMixtapeRow = {
  id: string;
  number: number;
  slug: string;
  title: string;
  theme: string;
  status: "draft" | "published";
  featuredRank: number | null;
  coverUrl: string | null;
  trackCount: number;
  noteCount: number;
};

export function slugify(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72)
      .replace(/-+$/g, "") || "fita"
  );
}

/** Every tape, drafts included, in shelf order, with its counts. */
export async function listStudioMixtapes(
  db: Database,
): Promise<StudioMixtapeRow[]> {
  const stats = db
    .select({
      mixtapeId: mixtapeTracks.mixtapeId,
      trackCount: count().as("track_count"),
      noteCount:
        sql<number>`count(*) filter (where ${mixtapeTracks.note} <> '')`
          .mapWith(Number)
          .as("note_count"),
    })
    .from(mixtapeTracks)
    .groupBy(mixtapeTracks.mixtapeId)
    .as("stats");
  return db
    .select({
      id: mixtapes.id,
      number: mixtapes.number,
      slug: mixtapes.slug,
      title: mixtapes.title,
      theme: mixtapes.theme,
      status: sql<"draft" | "published">`${mixtapes.status}`,
      featuredRank: mixtapes.featuredRank,
      coverUrl: images.url,
      trackCount: sql<number>`coalesce(${stats.trackCount}, 0)`.mapWith(Number),
      noteCount: sql<number>`coalesce(${stats.noteCount}, 0)`.mapWith(Number),
    })
    .from(mixtapes)
    .leftJoin(stats, eq(stats.mixtapeId, mixtapes.id))
    .leftJoin(images, eq(images.id, mixtapes.coverImageId))
    .orderBy(asc(mixtapes.number));
}

const detailImages = alias(images, "detail_image");

/** One tape with everything the editor shows, or null. */
export async function getStudioMixtape(db: Database, id: string) {
  const [row] = await db
    .select({
      mixtape: mixtapes,
      cover: images,
      detail: detailImages,
    })
    .from(mixtapes)
    .leftJoin(images, eq(images.id, mixtapes.coverImageId))
    .leftJoin(detailImages, eq(detailImages.id, mixtapes.detailImageId))
    .where(eq(mixtapes.id, id))
    .limit(1);
  if (!row) return null;
  const tracks = await db
    .select({
      id: mixtapeTracks.id,
      position: mixtapeTracks.position,
      note: mixtapeTracks.note,
      noteSide: sql<"left" | "right">`${mixtapeTracks.noteSide}`,
      songId: songs.id,
      title: songs.title,
      artist: songs.artist,
    })
    .from(mixtapeTracks)
    .innerJoin(songs, eq(songs.id, mixtapeTracks.songId))
    .where(eq(mixtapeTracks.mixtapeId, id))
    .orderBy(asc(mixtapeTracks.position));
  return { ...row, tracks };
}
export type StudioMixtape = NonNullable<
  Awaited<ReturnType<typeof getStudioMixtape>>
>;

async function uniqueSlug(db: Database, base: string, exceptId?: string) {
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const [taken] = await db
      .select({ id: mixtapes.id })
      .from(mixtapes)
      .where(
        exceptId
          ? and(eq(mixtapes.slug, slug), ne(mixtapes.id, exceptId))
          : eq(mixtapes.slug, slug),
      )
      .limit(1);
    if (!taken) return slug;
  }
  throw new StudioError("não foi possível criar um endereço para essa fita.");
}

/** A new draft at the end of the shelf. Returns its id. */
export async function createMixtape(
  db: Database,
  title: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    // Serializes concurrent creations on the shelf's last number.
    await tx.execute(sql`lock table ${mixtapes} in share row exclusive mode`);
    const [last] = await tx.select({ n: max(mixtapes.number) }).from(mixtapes);
    const number = (last?.n ?? 0) + 1;
    if (number > MAX_NUMBER) throw new StudioError("a estante está cheia.");
    const [row] = await tx
      .insert(mixtapes)
      .values({ number, title, slug: await uniqueSlug(tx, slugify(title)) })
      .returning({ id: mixtapes.id });
    return row!.id;
  });
}

/** Saves the editor's fields. A featured place taken by another tape moves here. */
export async function updateMixtape(
  db: Database,
  id: string,
  fields: MixtapeFields,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      if (fields.featuredRank !== null) {
        await tx
          .update(mixtapes)
          .set({ featuredRank: null, updatedAt: new Date() })
          .where(
            and(
              eq(mixtapes.featuredRank, fields.featuredRank),
              ne(mixtapes.id, id),
            ),
          );
      }
      const updated = await tx
        .update(mixtapes)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(mixtapes.id, id))
        .returning({ id: mixtapes.id });
      if (updated.length === 0) throw new StudioError("essa fita não existe.");
    });
  } catch (error) {
    if (pgCode(error) === "23505") {
      throw new StudioError("já existe uma fita com esse endereço.");
    }
    throw error;
  }
}

export async function setMixtapePublished(
  db: Database,
  id: string,
  published: boolean,
): Promise<void> {
  const updated = await db
    .update(mixtapes)
    .set({
      status: published ? "published" : "draft",
      publishedAt: published
        ? sql`coalesce(${mixtapes.publishedAt}, now())`
        : null,
      updatedAt: new Date(),
    })
    .where(eq(mixtapes.id, id))
    .returning({ id: mixtapes.id });
  if (updated.length === 0) throw new StudioError("essa fita não existe.");
}

/** Deletes a tape and its tracklist (its songs stay in the catalogue). */
export async function deleteMixtape(db: Database, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(mixtapeTracks).where(eq(mixtapeTracks.mixtapeId, id));
    const deleted = await tx
      .delete(mixtapes)
      .where(eq(mixtapes.id, id))
      .returning({ id: mixtapes.id });
    if (deleted.length === 0) throw new StudioError("essa fita não existe.");
  });
}

/** Swaps a tape with its neighbour on the shelf (its number with theirs). */
export async function moveMixtape(
  db: Database,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${mixtapes} in share row exclusive mode`);
    const shelf = await tx
      .select({ id: mixtapes.id, number: mixtapes.number })
      .from(mixtapes)
      .orderBy(asc(mixtapes.number));
    const i = shelf.findIndex((m) => m.id === id);
    if (i < 0) throw new StudioError("essa fita não existe.");
    const j = direction === "up" ? i - 1 : i + 1;
    const a = shelf[i]!;
    const b = shelf[j];
    if (!b) return;
    await tx
      .update(mixtapes)
      .set({ number: a.number + NUMBER_PARKING })
      .where(eq(mixtapes.id, a.id));
    await tx
      .update(mixtapes)
      .set({ number: a.number, updatedAt: new Date() })
      .where(eq(mixtapes.id, b.id));
    await tx
      .update(mixtapes)
      .set({ number: b.number, updatedAt: new Date() })
      .where(eq(mixtapes.id, a.id));
  });
}

/** Sets or clears a tape's cover or detail photograph. */
export async function setMixtapeImage(
  db: Database,
  id: string,
  slot: "cover" | "detail",
  imageId: string | null,
): Promise<void> {
  const updated = await db
    .update(mixtapes)
    .set(
      slot === "cover"
        ? { coverImageId: imageId, updatedAt: new Date() }
        : { detailImageId: imageId, updatedAt: new Date() },
    )
    .where(eq(mixtapes.id, id))
    .returning({ id: mixtapes.id });
  if (updated.length === 0) throw new StudioError("essa fita não existe.");
}

// ---------- tracklist ----------

/** The catalogue's song with this title and artist (any letter case), created if new. */
export async function findOrCreateSong(
  db: Database,
  input: SongInput,
): Promise<string> {
  await db.insert(songs).values(input).onConflictDoNothing();
  const [song] = await db
    .select({ id: songs.id })
    .from(songs)
    .where(
      and(
        sql`lower(${songs.title}) = lower(${input.title})`,
        sql`lower(${songs.artist}) = lower(${input.artist})`,
      ),
    )
    .limit(1);
  return song!.id;
}

/** Puts a catalogue song at the end of a tape. Returns the track's id. */
export async function addSongToMixtape(
  db: Database,
  mixtapeId: string,
  songId: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [tape] = await tx
      .select({ id: mixtapes.id })
      .from(mixtapes)
      .where(eq(mixtapes.id, mixtapeId))
      .for("update");
    if (!tape) throw new StudioError("essa fita não existe.");
    const [already] = await tx
      .select({ id: mixtapeTracks.id })
      .from(mixtapeTracks)
      .where(
        and(
          eq(mixtapeTracks.mixtapeId, mixtapeId),
          eq(mixtapeTracks.songId, songId),
        ),
      )
      .limit(1);
    if (already) throw new StudioError("essa música já está na fita.");
    const [last] = await tx
      .select({ p: max(mixtapeTracks.position) })
      .from(mixtapeTracks)
      .where(eq(mixtapeTracks.mixtapeId, mixtapeId));
    const [track] = await tx
      .insert(mixtapeTracks)
      .values({ mixtapeId, songId, position: (last?.p ?? 0) + 1 })
      .returning({ id: mixtapeTracks.id });
    return track!.id;
  });
}

/** Adds a song by title and artist (reusing the catalogue's) to a tape. */
export async function addTrack(
  db: Database,
  mixtapeId: string,
  input: SongInput,
): Promise<string> {
  return db.transaction(async (tx) =>
    addSongToMixtape(tx, mixtapeId, await findOrCreateSong(tx, input)),
  );
}

/** Rewrites a tape's positions 1…n in their current order. */
async function compact(db: Database, mixtapeId: string) {
  const rest = await db
    .select({ id: mixtapeTracks.id })
    .from(mixtapeTracks)
    .where(eq(mixtapeTracks.mixtapeId, mixtapeId))
    .orderBy(asc(mixtapeTracks.position));
  await setTrackOrder(
    db,
    mixtapeId,
    rest.map((t) => t.id),
  );
}

/** Removes a track; the tape's positions close the gap. Its note goes with it. */
export async function removeTrack(
  db: Database,
  trackId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [track] = await tx
      .delete(mixtapeTracks)
      .where(eq(mixtapeTracks.id, trackId))
      .returning({ mixtapeId: mixtapeTracks.mixtapeId });
    if (!track) throw new StudioError("essa faixa não existe.");
    await compact(tx, track.mixtapeId);
  });
}

/** Moves a track one place up or down on its tape. */
export async function moveTrack(
  db: Database,
  trackId: string,
  direction: "up" | "down",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [track] = await tx
      .select({ mixtapeId: mixtapeTracks.mixtapeId })
      .from(mixtapeTracks)
      .where(eq(mixtapeTracks.id, trackId));
    if (!track) throw new StudioError("essa faixa não existe.");
    const order = (
      await tx
        .select({ id: mixtapeTracks.id })
        .from(mixtapeTracks)
        .where(eq(mixtapeTracks.mixtapeId, track.mixtapeId))
        .orderBy(asc(mixtapeTracks.position))
    ).map((t) => t.id);
    const i = order.indexOf(trackId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    await setTrackOrder(tx, track.mixtapeId, order);
  });
}

export async function updateTrackNote(
  db: Database,
  trackId: string,
  note: string,
  noteSide: "left" | "right",
): Promise<void> {
  const updated = await db
    .update(mixtapeTracks)
    .set({ note, noteSide, updatedAt: new Date() })
    .where(eq(mixtapeTracks.id, trackId))
    .returning({ id: mixtapeTracks.id });
  if (updated.length === 0) throw new StudioError("essa faixa não existe.");
}

/** Removes a song from one tape (by song), closing the gap. */
export async function removeSongFromMixtape(
  db: Database,
  mixtapeId: string,
  songId: string,
): Promise<void> {
  const [track] = await db
    .select({ id: mixtapeTracks.id })
    .from(mixtapeTracks)
    .where(
      and(
        eq(mixtapeTracks.mixtapeId, mixtapeId),
        eq(mixtapeTracks.songId, songId),
      ),
    );
  if (track) await removeTrack(db, track.id);
}

/** The featured tapes' current holders, for the editor's "destaque" field. */
export async function listFeaturedHolders(db: Database) {
  return db
    .select({
      id: mixtapes.id,
      title: mixtapes.title,
      featuredRank: mixtapes.featuredRank,
    })
    .from(mixtapes)
    .where(isNotNull(mixtapes.featuredRank));
}
