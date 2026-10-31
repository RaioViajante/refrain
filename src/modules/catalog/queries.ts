import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor } from "@/db";

export interface AlbumCredit {
  albumId: string;
  title: string;
  firstReleaseYear: number | null;
  artistName: string;
  creditPosition: number;
}

/**
 * Albums with their credited artists, one row per credit, for the Catalog
 * and the Albums listing. Academic requirement AC-04 (JOIN); the SQL is
 * quoted in docs/data-model.md. Archived albums are excluded.
 */
export async function listAlbumsWithArtists(
  db: DatabaseExecutor,
): Promise<AlbumCredit[]> {
  const result = await db.execute<{
    id: string;
    title: string;
    first_release_year: number | null;
    artist_name: string;
    position: number;
  }>(sql`
    select al.id, al.title, al.first_release_year,
           coalesce(aa.credited_as, ar.name) as artist_name, aa.position
      from albums al
      join album_artists aa on aa.album_id = al.id
      join artists ar       on ar.id = aa.artist_id
     where al.archived_at is null
     order by al.title, al.id, aa.position`);

  return result.rows.map((row) => ({
    albumId: row.id,
    title: row.title,
    firstReleaseYear: row.first_release_year,
    artistName: row.artist_name,
    creditPosition: row.position,
  }));
}

export interface AlbumUsage {
  albumId: string;
  title: string;
  usedIn: number;
}

/**
 * How many entries use each album ("used in 2 entries"): album journals about
 * it and memories that link it. Deleted entries are not counted. Academic
 * requirement AC-05 (subquery); the SQL is quoted in docs/data-model.md.
 * It reads the authored tables with SQL rather than through the Journals
 * module (docs/architecture.md, dependency rule 3).
 */
export async function listAlbumUsage(
  db: DatabaseExecutor,
): Promise<AlbumUsage[]> {
  const result = await db.execute<{
    id: string;
    title: string;
    used_in: number;
  }>(sql`
    select al.id, al.title,
           (select count(*)::int
              from entries e
             where e.deleted_at is null
               and (   e.id in (select aj.entry_id  from album_journals aj where aj.album_id = al.id)
                    or e.id in (select mm.memory_id from memory_music mm  where mm.album_id = al.id))
           ) as used_in
      from albums al
     where al.archived_at is null
     order by al.title, al.id`);

  return result.rows.map((row) => ({
    albumId: row.id,
    title: row.title,
    usedIn: row.used_in,
  }));
}
