import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { mixtapeTracks } from "@/db/schema";
import { addTrack, insertMixtape, insertSong } from "@/test/fixtures";
import { connectTestDatabase } from "@/test/db";

import { setTrackOrder, TracklistError } from "./tracklist";

const db = connectTestDatabase();

async function order(mixtapeId: string) {
  return db
    .select({ id: mixtapeTracks.id, position: mixtapeTracks.position })
    .from(mixtapeTracks)
    .where(eq(mixtapeTracks.mixtapeId, mixtapeId))
    .orderBy(asc(mixtapeTracks.position));
}

async function tapeWithTracks(count: number) {
  const tape = await insertMixtape(db);
  const tracks = [];
  for (let i = 1; i <= count; i++) {
    const song = await insertSong(db);
    tracks.push(await addTrack(db, tape.id, song.id, i));
  }
  return { tape, ids: tracks.map((t) => t.id) };
}

describe("setTrackOrder", () => {
  it("rewrites positions to the new order, contiguous from 1", async () => {
    const { tape, ids } = await tapeWithTracks(4);
    const reordered = [ids[3]!, ids[0]!, ids[2]!, ids[1]!];

    await setTrackOrder(db, tape.id, reordered);

    expect(await order(tape.id)).toEqual(
      reordered.map((id, i) => ({ id, position: i + 1 })),
    );
  });

  it("leaves other tapes untouched", async () => {
    const one = await tapeWithTracks(2);
    const other = await tapeWithTracks(2);
    await setTrackOrder(db, one.tape.id, [one.ids[1]!, one.ids[0]!]);
    expect((await order(other.tape.id)).map((t) => t.id)).toEqual(other.ids);
  });

  it("refuses anything but a permutation, and changes nothing", async () => {
    const { tape, ids } = await tapeWithTracks(3);
    const foreign = (await tapeWithTracks(1)).ids[0]!;

    for (const bad of [
      [ids[0]!, ids[1]!],
      [ids[0]!, ids[1]!, ids[1]!],
      [ids[0]!, ids[1]!, foreign],
      [...ids, foreign],
    ]) {
      await expect(setTrackOrder(db, tape.id, bad)).rejects.toBeInstanceOf(
        TracklistError,
      );
    }
    expect((await order(tape.id)).map((t) => t.id)).toEqual(ids);
  });
});
