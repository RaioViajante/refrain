import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor } from "@/db";

export interface AlbumJournalProgress {
  entryId: string;
  albumTitle: string;
  tracksWritten: number;
  trackCount: number;
}

/**
 * Tracks written per album journal, for the Desk ("4 of 10 tracks written").
 * Academic requirement AC-05 (aggregate); the SQL is quoted in
 * docs/data-model.md.
 *
 * A track counts as written when its reflection has non-empty text in the
 * journal's original language and is not flagged "still writing". Empty
 * reflections, reflections written only in a translation, and reflections
 * still in progress do not count. `trackCount` is the length of the album's
 * reference edition, and only reflections on its tracks are counted, so the
 * result never reads "11 of 10" when a reflection is on a recording outside
 * the reference edition. Deleted journals are excluded.
 */
export async function listAlbumJournalProgress(
  db: DatabaseExecutor,
): Promise<AlbumJournalProgress[]> {
  const result = await db.execute<{
    entry_id: string;
    album_title: string;
    tracks_written: number;
    track_count: number;
  }>(sql`
    select e.id as entry_id, al.title as album_title,
           count(trt.track_reflection_id)::int as tracks_written,
           (select count(*)::int
              from edition_tracks et
              join album_editions ed on ed.id = et.edition_id
             where ed.album_id = al.id and ed.is_reference) as track_count
      from album_journals aj
      join entries e      on e.id = aj.entry_id
      join albums al      on al.id = aj.album_id
      join entry_texts o  on o.entry_id = e.id and o.is_original
      left join track_reflections tr       on tr.album_journal_id = aj.entry_id
                                          and tr.track_id in (
                                                select et.track_id
                                                  from edition_tracks et
                                                  join album_editions ed on ed.id = et.edition_id
                                                 where ed.album_id = aj.album_id and ed.is_reference)
      left join track_reflection_texts trt on trt.track_reflection_id = tr.id
                                          and trt.locale = o.locale
                                          and trt.body_text <> ''
                                          and not tr.is_still_writing
     where e.deleted_at is null
     group by e.id, al.id, al.title
     order by al.title, e.id`);

  return result.rows.map((row) => ({
    entryId: row.entry_id,
    albumTitle: row.album_title,
    tracksWritten: row.tracks_written,
    trackCount: row.track_count,
  }));
}
