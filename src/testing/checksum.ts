import { sql } from "drizzle-orm";

import type { DatabaseExecutor } from "@/db";

// Every table that holds anything a reader could see. A refusal, and a
// preview, must leave the checksum of all of them unchanged (ADR 0006 § 13,
// tests 3 and 12). Imported only by tests.
export const CHECKED_TABLES = [
  "entries",
  "entry_texts",
  "album_journals",
  "artist_journals",
  "memories",
  "memory_music",
  "track_reflections",
  "track_reflection_texts",
  "entry_slugs",
] as const;

export async function rowChecksum(db: DatabaseExecutor): Promise<string[]> {
  const sums: string[] = [];
  for (const table of CHECKED_TABLES) {
    const result = await db.execute<{ sum: string }>(sql`
      select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as sum
        from ${sql.identifier(table)} x`);
    sums.push(result.rows[0]!.sum);
  }
  return sums;
}
