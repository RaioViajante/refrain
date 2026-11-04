import { sql } from "drizzle-orm";
import type { Client } from "pg";

import { schema } from "@/db";

import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestMemory,
} from "./fixtures";
import { fixtureDatabase } from "./public-journals";

// Committed synthetic memories for the tests that read the public memory page
// over HTTP and in a browser (M3.7). The server has its own connections, so
// the rows are committed and removed afterwards. Every piece of writing is
// labelled "[Test]" and is not the author's: no invented memory, date, or
// biographical claim that could pass for real (AGENTS.md § 5). Song, album,
// and artist names are synthetic too.
//
// Every memory that must stay hidden carries a marker in its title, its
// writing, and its "when", and links a recording whose title is a marker, so
// a test can scan every response for anything that must never be served.

export const MEMORY_MARKERS = {
  draft: "[Test] PRIVATE-MEMORY-DRAFT-MARKER",
  private: "[Test] PRIVATE-MEMORY-PRIVATE-MARKER",
  deleted: "[Test] PRIVATE-MEMORY-DELETED-MARKER",
  unpublished: "[Test] PRIVATE-MEMORY-UNPUBLISHED-MARKER",
  restored: "[Test] PRIVATE-MEMORY-RESTORED-MARKER",
  retired: "[Test] PRIVATE-MEMORY-RETIRED-MARKER",
  translation: "[Test] PRIVATE-MEMORY-TRANSLATION-MARKER",
  song: "[Test] PRIVATE-MEMORY-SONG-MARKER",
} as const;

export const MEMORY_MARKER_LIST: string[] = Object.values(MEMORY_MARKERS);

/** The public memory's words: synthetic, labelled. */
export const PUBLIC_MEMORY = {
  title: "[Test] The summer a song arrived",
  when: "[Test] A summer, some years ago",
  paragraphs: [
    "[Test] The first paragraph of a synthetic memory.",
    "[Test] A second paragraph, so the column holds more than one.",
  ],
  albumTitle: "[Test] Memory Album",
  albumArtist: "[Test] Memory Artist",
  firstSong: "[Test] First Memory Song",
  secondSong: "[Test] Second Memory Song",
  secondArtist: "[Test] Second Memory Artist",
  quietTitle: "[Test] A memory without songs",
  longTitle:
    "[Test] A memory with a very long title that has to wrap across several lines without pushing anything sideways",
  longSong:
    "[Test] A recording whose title runs on for a long while, as some do (Live in a Small Room, Very Late)",
} as const;

export interface SeededMemories {
  /** The public memory with two songs. */
  shown: {
    entryId: string;
    slug: string;
    previousSlug: string;
    /** A previous address chosen while the memory was never public. */
    neverPublicSlug: string;
  };
  /** A public memory with no songs. */
  quiet: { entryId: string; slug: string };
  /** A public memory with a long title and one song. */
  long: { entryId: string; slug: string };
  /** The album journal the first song's album has, published. */
  albumJournal: { entryId: string; slug: string };
  /** Memories that must answer as unknown addresses, by state. */
  hidden: { state: keyof typeof MEMORY_MARKERS; slug: string }[];
  /** A previous address of a memory that is not public now. */
  hiddenPreviousSlug: string;
  entries: string[];
  albums: string[];
  tracks: string[];
  artists: string[];
}

const document = (paragraphs: readonly string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  })),
});

export async function seedMemories(
  client: Client,
  prefix: string,
): Promise<SeededMemories> {
  const db = fixtureDatabase(client);
  return db.transaction(async (tx) => {
    const albumArtist = await createTestArtist(tx, PUBLIC_MEMORY.albumArtist);
    const secondArtist = await createTestArtist(tx, PUBLIC_MEMORY.secondArtist);
    const album = await createTestAlbum(tx, {
      title: PUBLIC_MEMORY.albumTitle,
      trackTitles: [PUBLIC_MEMORY.firstSong, "[Test] Another album song"],
      artistIds: [albumArtist],
      firstReleaseYear: 2001,
    });
    const albumJournalSlug = `${prefix}-memory-album`;
    const albumJournal = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      slug: albumJournalSlug,
      versions: [
        {
          locale: "en",
          status: "published",
          text: "[Test] A synthetic album journal.",
        },
      ],
    });
    await tx.insert(schema.trackArtists).values({
      trackId: album.trackIds[0]!,
      artistId: albumArtist,
      position: 1,
    });
    const [second] = await tx
      .insert(schema.tracks)
      .values({ title: PUBLIC_MEMORY.secondSong })
      .returning({ id: schema.tracks.id });
    const [longSong] = await tx
      .insert(schema.tracks)
      .values({ title: PUBLIC_MEMORY.longSong })
      .returning({ id: schema.tracks.id });
    await tx.insert(schema.trackArtists).values({
      trackId: longSong!.id,
      artistId: secondArtist,
      position: 1,
    });
    const [song] = await tx
      .insert(schema.tracks)
      .values({ title: MEMORY_MARKERS.song })
      .returning({ id: schema.tracks.id });
    await tx.insert(schema.trackArtists).values({
      trackId: second!.id,
      artistId: secondArtist,
      position: 1,
    });

    const entries: string[] = [albumJournal];
    const publishedAt = new Date("2026-10-28T12:00:00Z");

    const shownSlug = `${prefix}-memory-shown`;
    const shown = await createTestMemory(tx, {
      slug: shownSlug,
      versions: [
        {
          locale: "en",
          status: "published",
          title: PUBLIC_MEMORY.title,
          publishedAt,
        },
        // A translation that is not public: never shown, never mentioned.
        {
          locale: "pt-BR",
          status: "private",
          title: MEMORY_MARKERS.translation,
          text: MEMORY_MARKERS.translation,
        },
      ],
      music: [{ trackId: album.trackIds[0]! }, { trackId: second!.id }],
    });
    entries.push(shown);
    await tx.execute(sql`
      update entry_texts
         set body = ${JSON.stringify(document(PUBLIC_MEMORY.paragraphs))}::jsonb,
             body_text = ${PUBLIC_MEMORY.paragraphs.join("\n\n")}
       where entry_id = ${shown} and locale = 'en'`);
    await tx.execute(sql`
      update memories set remembered_when = ${PUBLIC_MEMORY.when}
       where entry_id = ${shown}`);
    const previousSlug = `${prefix}-memory-before`;
    await tx.insert(schema.entrySlugs).values({
      kind: "memory",
      slug: previousSlug,
      entryId: shown,
      isCurrent: false,
      wasPublished: true,
    });

    const neverPublicSlug = `${prefix}-memory-never-public`;
    await tx.insert(schema.entrySlugs).values({
      kind: "memory",
      slug: neverPublicSlug,
      entryId: shown,
      isCurrent: false,
      wasPublished: false,
    });

    const quietSlug = `${prefix}-memory-quiet`;
    const quiet = await createTestMemory(tx, {
      slug: quietSlug,
      versions: [
        {
          locale: "en",
          status: "published",
          title: PUBLIC_MEMORY.quietTitle,
          text: "[Test] A memory with no songs linked to it.",
          publishedAt,
        },
      ],
    });
    entries.push(quiet);

    const longSlug = `${prefix}-memory-long`;
    const long = await createTestMemory(tx, {
      slug: longSlug,
      versions: [
        {
          locale: "en",
          status: "published",
          title: PUBLIC_MEMORY.longTitle,
          text: "[Test] A memory whose title is long.",
          publishedAt,
        },
      ],
      music: [{ trackId: longSong!.id }],
    });
    entries.push(long);

    const hidden: SeededMemories["hidden"] = [];
    const states: [
      keyof typeof MEMORY_MARKERS,
      "draft" | "private" | "published",
      { deleted?: boolean; wasPublic?: boolean },
    ][] = [
      ["draft", "draft", {}],
      ["private", "private", {}],
      ["deleted", "published", { deleted: true }],
      ["unpublished", "private", { wasPublic: true }],
      // A restored memory returns as private, its address marked as once
      // public (ADR 0005): the same rows as an unpublished one, by its own
      // marker.
      ["restored", "private", { wasPublic: true }],
    ];
    for (const [state, status, options] of states) {
      const marker = MEMORY_MARKERS[state];
      const slug = `${prefix}-memory-${state}`;
      const entryId = await createTestMemory(tx, {
        slug,
        versions: [{ locale: "en", status, title: marker, text: marker }],
        deletedAt: options.deleted
          ? new Date("2026-10-30T00:00:00Z")
          : undefined,
        music: [{ trackId: song!.id }],
      });
      entries.push(entryId);
      await tx.execute(sql`
        update memories set remembered_when = ${marker}
         where entry_id = ${entryId}`);
      if (options.wasPublic) {
        await tx.execute(sql`
          update entry_slugs set was_published = true
           where entry_id = ${entryId}`);
        await tx.execute(sql`
          update entry_texts set first_published_at = ${publishedAt}
           where entry_id = ${entryId}`);
      }
      hidden.push({ state, slug });
    }
    const hiddenPreviousSlug = `${prefix}-memory-hidden-before`;
    await tx.insert(schema.entrySlugs).values({
      kind: "memory",
      slug: hiddenPreviousSlug,
      entryId: entries[entries.length - 1]!,
      isCurrent: false,
      wasPublished: true,
    });

    // A memory that was public and then deleted for good: its address is
    // retired, kept so that it never leads anywhere else.
    const retiredSlug = `${prefix}-memory-retired`;
    await tx.insert(schema.entrySlugs).values({
      kind: "memory",
      slug: retiredSlug,
      entryId: null,
      isCurrent: false,
      wasPublished: true,
    });
    hidden.push({ state: "retired", slug: retiredSlug });

    return {
      shown: { entryId: shown, slug: shownSlug, previousSlug, neverPublicSlug },
      quiet: { entryId: quiet, slug: quietSlug },
      long: { entryId: long, slug: longSlug },
      albumJournal: { entryId: albumJournal, slug: albumJournalSlug },
      hidden,
      hiddenPreviousSlug,
      entries,
      albums: [album.albumId],
      tracks: [...album.trackIds, second!.id, longSong!.id, song!.id],
      artists: [albumArtist, secondArtist],
    };
  });
}

/** Removes everything `seedMemories` created. Safe to call more than once. */
export async function removeSeededMemories(
  client: Client,
  seeded: SeededMemories | undefined,
  prefix: string,
): Promise<void> {
  await client.query("delete from entry_slugs where slug like $1", [
    `${prefix}%`,
  ]);
  if (!seeded) {
    return;
  }
  await client.query("delete from entry_slugs where entry_id = any($1)", [
    seeded.entries,
  ]);
  await client.query("delete from entries where id = any($1)", [
    seeded.entries,
  ]);
  await client.query("delete from albums where id = any($1)", [seeded.albums]);
  await client.query("delete from tracks where id = any($1)", [seeded.tracks]);
  await client.query("delete from artists where id = any($1)", [
    seeded.artists,
  ]);
}
