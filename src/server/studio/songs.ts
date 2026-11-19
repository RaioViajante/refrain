// Studio reads and writes for the song catalogue. Callers authorize first.
import "server-only";

import { and, asc, count, desc, eq, ne, sql, type SQL } from "drizzle-orm";

import { mixtapes, mixtapeTracks, songs } from "@/db/schema";
import type { Database } from "@/db/types";

import { setTrackOrder } from "../tracklist";
import { pgCode, StudioError } from "./errors";
import type { SongInput } from "./schemas";

export type SongAppearance = {
  mixtapeId: string;
  number: number;
  title: string;
  position: number;
  note: string;
};

export type StudioSongRow = {
  id: string;
  title: string;
  artist: string;
  appearances: SongAppearance[];
};

export type SongFilter = {
  q?: string;
  /** A tape's id, "nenhuma" (on no tape), or undefined (any). */
  tape?: string;
  notesOnly?: boolean;
  sort?: "recentes" | "musica" | "artista";
  limit?: number;
};

// Subqueries name their columns with their tables: in a single-table select
// Drizzle leaves columns unqualified, which would make "id" ambiguous here.
function onTape(mixtapeId?: string, notesOnly = false): SQL {
  return sql`exists (select 1 from mixtape_tracks mt where mt.song_id = "songs"."id"${
    mixtapeId ? sql` and mt.mixtape_id = ${mixtapeId}` : sql``
  }${notesOnly ? sql` and mt.note <> ''` : sql``})`;
}

function where(filter: SongFilter): SQL | undefined {
  const parts: SQL[] = [];
  const q = filter.q?.trim();
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(
      sql`(${songs.title} ilike ${pattern} or ${songs.artist} ilike ${pattern})`,
    );
  }
  if (filter.tape === "nenhuma") parts.push(sql`not ${onTape()}`);
  else if (filter.tape) parts.push(onTape(filter.tape));
  if (filter.notesOnly) parts.push(onTape(undefined, true));
  return parts.length ? and(...parts) : undefined;
}

/** A page of the catalogue with each song's appearances, and the match count. */
export async function listSongs(
  db: Database,
  filter: SongFilter = {},
): Promise<{ rows: StudioSongRow[]; found: number }> {
  const condition = where(filter);
  const appearances = sql<SongAppearance[]>`coalesce((
    select json_agg(json_build_object(
      'mixtapeId', m.id, 'number', m.number, 'title', m.title,
      'position', mt.position, 'note', mt.note
    ) order by m.number)
    from mixtape_tracks mt
    join mixtapes m on m.id = mt.mixtape_id
    where mt.song_id = "songs"."id"
  ), '[]'::json)`;
  const order =
    filter.sort === "musica"
      ? [asc(sql`lower(${songs.title})`)]
      : filter.sort === "artista"
        ? [asc(sql`lower(${songs.artist})`), asc(sql`lower(${songs.title})`)]
        : [desc(songs.createdAt), asc(songs.title)];

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: songs.id,
        title: songs.title,
        artist: songs.artist,
        appearances,
      })
      .from(songs)
      .where(condition)
      .orderBy(...order)
      .limit(Math.min(Math.max(filter.limit ?? 48, 1), 500)),
    db.select({ n: count() }).from(songs).where(condition),
  ]);
  return { rows, found: total?.n ?? 0 };
}

export async function getSong(db: Database, id: string) {
  const [song] = await db
    .select({ id: songs.id, title: songs.title, artist: songs.artist })
    .from(songs)
    .where(eq(songs.id, id));
  if (!song) return null;
  const appearances = await db
    .select({
      mixtapeId: mixtapes.id,
      number: mixtapes.number,
      title: mixtapes.title,
      position: mixtapeTracks.position,
      note: mixtapeTracks.note,
    })
    .from(mixtapeTracks)
    .innerJoin(mixtapes, eq(mixtapes.id, mixtapeTracks.mixtapeId))
    .where(eq(mixtapeTracks.songId, id))
    .orderBy(asc(mixtapes.number));
  return { ...song, appearances };
}

/** Catalogue totals and the most present artists (by songs in the catalogue). */
export async function getCatalogueStats(db: Database) {
  const songCount = count(songs.id);
  const [[totals], top] = await Promise.all([
    db
      .select({
        songs: count(),
        artists: sql<number>`count(distinct lower(${songs.artist}))`.mapWith(
          Number,
        ),
      })
      .from(songs),
    db
      .select({ artist: songs.artist, count: songCount })
      .from(songs)
      .groupBy(songs.artist)
      .orderBy(desc(songCount), asc(songs.artist))
      .limit(12),
  ]);
  return { songs: totals?.songs ?? 0, artists: totals?.artists ?? 0, top };
}

const DUPLICATE = "essa música já está no catálogo.";

export async function createSong(db: Database, input: SongInput) {
  try {
    const [row] = await db
      .insert(songs)
      .values(input)
      .returning({ id: songs.id });
    return row!.id;
  } catch (error) {
    if (pgCode(error) === "23505") throw new StudioError(DUPLICATE);
    throw error;
  }
}

export async function updateSong(db: Database, id: string, input: SongInput) {
  try {
    const updated = await db
      .update(songs)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(songs.id, id))
      .returning({ id: songs.id });
    if (updated.length === 0) throw new StudioError("essa música não existe.");
  } catch (error) {
    if (pgCode(error) === "23505") throw new StudioError(DUPLICATE);
    throw error;
  }
}

/**
 * Deletes a song and removes it from every tape it is on (their notes for it
 * go too), closing the gaps in those tapes, in one transaction.
 */
export async function deleteSong(db: Database, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(mixtapeTracks)
      .where(eq(mixtapeTracks.songId, id))
      .returning({ mixtapeId: mixtapeTracks.mixtapeId });
    for (const { mixtapeId } of removed) {
      const rest = await tx
        .select({ id: mixtapeTracks.id })
        .from(mixtapeTracks)
        .where(
          and(
            eq(mixtapeTracks.mixtapeId, mixtapeId),
            ne(mixtapeTracks.songId, id),
          ),
        )
        .orderBy(asc(mixtapeTracks.position));
      await setTrackOrder(
        tx,
        mixtapeId,
        rest.map((t) => t.id),
      );
    }
    const deleted = await tx
      .delete(songs)
      .where(eq(songs.id, id))
      .returning({ id: songs.id });
    if (deleted.length === 0) throw new StudioError("essa música não existe.");
  });
}
