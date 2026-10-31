import { readFileSync } from "node:fs";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "./client";

const catalogTables = [
  "artists",
  "albums",
  "album_artists",
  "album_editions",
  "tracks",
  "track_artists",
  "album_tracks",
  "edition_tracks",
];

const authoredTables = [
  "entries",
  "entry_texts",
  "album_journals",
  "artist_journals",
  "memories",
  "track_reflections",
  "track_reflection_texts",
  "memory_music",
  "entry_slugs",
];

describe("migrations", () => {
  it("applied every migration in the journal, in order", async () => {
    const journal = JSON.parse(
      readFileSync("src/db/migrations/meta/_journal.json", "utf8"),
    ) as { entries: { tag: string; when: number }[] };

    const applied = await getDb().execute<{ created_at: string }>(
      sql`select created_at from drizzle.__drizzle_migrations order by id`,
    );

    expect(applied.rows.map((row) => Number(row.created_at))).toEqual(
      journal.entries.map((entry) => entry.when),
    );
  });

  it("created exactly the catalog and authored tables", async () => {
    const result = await getDb().execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
           where table_schema = 'public' order by table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(
      [...catalogTables, ...authoredTables].sort(),
    );
  });
});

describe("referential protection of authored content", () => {
  // Read from pg_constraint, so the test checks the database that the
  // migrations built, not the TypeScript schema.
  async function foreignKeys() {
    const result = await getDb().execute<{
      name: string;
      from_table: string;
      to_table: string;
      on_delete: string;
    }>(sql`
      select c.conname as name,
             c.conrelid::regclass::text as from_table,
             c.confrelid::regclass::text as to_table,
             c.confdeltype as on_delete
        from pg_constraint c
       where c.contype = 'f'
         and c.connamespace = 'public'::regnamespace
       order by c.conname`);
    return result.rows;
  }

  it("never cascades from a catalog table into an authored table", async () => {
    const writingToCatalog = (await foreignKeys()).filter(
      (fk) =>
        authoredTables.includes(fk.from_table) &&
        catalogTables.includes(fk.to_table),
    );

    // r = RESTRICT (pg_constraint.confdeltype).
    expect(writingToCatalog).toEqual([
      expect.objectContaining({
        name: "album_journals_album_fk",
        on_delete: "r",
      }),
      expect.objectContaining({
        name: "artist_journals_artist_fk",
        on_delete: "r",
      }),
      expect.objectContaining({
        name: "memory_music_album_fk",
        on_delete: "r",
      }),
      expect.objectContaining({
        name: "memory_music_track_fk",
        on_delete: "r",
      }),
      expect.objectContaining({
        name: "track_reflections_album_track_fk",
        on_delete: "r",
      }),
    ]);
  });

  it("has no foreign key from a catalog table to an authored table", async () => {
    const catalogToWriting = (await foreignKeys()).filter(
      (fk) =>
        catalogTables.includes(fk.from_table) &&
        authoredTables.includes(fk.to_table),
    );
    expect(catalogToWriting).toEqual([]);
  });
});
