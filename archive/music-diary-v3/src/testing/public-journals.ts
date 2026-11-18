import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import type { Client } from "pg";

import { schema, type Database } from "@/db";

import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestTrackReflection,
  type TestVersion,
} from "./fixtures";

// Committed synthetic data for the tests that read public pages over HTTP and
// in a browser (the server has its own connections, so the rows are committed
// and removed afterwards). The catalog facts are public (Grace, Jeff Buckley,
// 1994, its track titles). Every piece of *writing* is labelled "[Test]" and is
// not the author's: no invented memories, reflections, ratings, or opinions
// that could pass for real (AGENTS.md § 5).
//
// Every private text carries a marker, so a test can scan every response for
// content that must never be served.

/** The text that must never appear in any public response. */
export const PRIVATE_MARKERS = {
  reflection: "[Test] PRIVATE-REFLECTION-MARKER",
  translation: "[Test] PRIVATE-TRANSLATION-MARKER",
  draft: "[Test] PRIVATE-DRAFT-MARKER",
  private: "[Test] PRIVATE-PRIVATE-MARKER",
  deleted: "[Test] PRIVATE-DELETED-MARKER",
  later: "[Test] PRIVATE-LATER-MARKER",
} as const;

export const PRIVATE_MARKER_LIST: string[] = Object.values(PRIVATE_MARKERS);

export const PUBLIC_TEXT = {
  opening: "[Test] The opening sentence of the synthetic journal.",
  paragraph: "[Test] A paragraph of the public synthetic journal.",
  heading: "[Test] A subheading",
  quote: "[Test] A quoted line.",
  marginNote: "[Test] A margin note.",
  reflection: (title: string) => `[Test] A public reflection on ${title}.`,
} as const;

/** Grace (Jeff Buckley, 1994): public catalog facts. */
export const GRACE_TRACKS = [
  "Mojo Pin",
  "Grace",
  "Last Goodbye",
  "Lilac Wine",
  "So Real",
  "Hallelujah",
] as const;

export type FixtureDatabase = Database;

export function fixtureDatabase(client: Client): FixtureDatabase {
  return drizzle({ client, schema });
}

/** Ids to remove afterwards. */
export interface SeededJournal {
  entryId: string;
  albumId: string;
  artistId: string;
  trackIds: string[];
  slug: string;
}

const hostileDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: PUBLIC_TEXT.paragraph }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: PUBLIC_TEXT.heading }],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: PUBLIC_TEXT.quote }],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "[Test] first line" },
        { type: "hardBreak" },
        {
          type: "text",
          text: "[Test] second line, emphasised",
          marks: [{ type: "italic" }, { type: "bold" }],
        },
      ],
    },
    {
      // Hostile markup is text, and React escapes it.
      type: "paragraph",
      content: [
        { type: "text", text: "<img src=x onerror=alert(1)> [Test] markup" },
        {
          type: "text",
          text: " [Test] link text",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
      ],
    },
    {
      // A node the renderer does not know: its text only, never its markup.
      type: "script",
      content: [{ type: "text", text: "[Test] unknown node text" }],
    },
  ],
};

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

/** Synthetic writing shaped like a real essay, for layout and screenshots. */
export const editorialDocument = {
  type: "doc",
  content: [
    paragraph(
      "[Test] This is synthetic writing, only to judge the layout. The column holds about sixty-two characters per line, so a long essay stays comfortable to read across several screens, and the rhythm of its paragraphs can be judged by eye.",
    ),
    paragraph(
      "[Test] A second synthetic paragraph. Paragraphs can be as long as the thought needs, or very short.",
    ),
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "[Test] A subheading" }],
    },
    paragraph(
      "[Test] Text under the subheading, to see the space between a heading and the paragraph that follows it.",
    ),
    {
      type: "blockquote",
      content: [
        paragraph("[Test] A quoted line, to see the quote's rule and size."),
      ],
    },
    paragraph("[Test] A closing synthetic paragraph before the tracks."),
  ],
};

export interface GraceOptions {
  slug: string;
  /** Rating of the journal in half steps. Default 9 (4.5). */
  ratingHalfSteps?: number | null;
  /** Statuses of the English version and of a Brazilian Portuguese one. */
  en?: "draft" | "private" | "published";
  ptBR?: "draft" | "private" | "published" | null;
  deletedAt?: Date;
  /** Seed the track reflections (default true). */
  reflections?: boolean;
  /** The text of the English version's body (a plain paragraph) when set. */
  plainBody?: string;
  /** "hostile" (default) tests escaping; "editorial" reads like an essay. */
  document?: "hostile" | "editorial";
}

/**
 * The synthetic Grace journal. By default the English version is published, a
 * Brazilian Portuguese translation exists as a draft with a marker, and the
 * reflections are:
 *
 * - Mojo Pin: public, with a rating;
 * - Grace: public, still writing;
 * - Last Goodbye: public, the favourite;
 * - Lilac Wine (credit "James Shelton"): NOT public (flag off), with a
 *   marker, and a flagged Portuguese text that is private because its version
 *   is a draft;
 * - So Real and Hallelujah: none.
 */
export async function seedGrace(
  client: Client,
  options: GraceOptions,
): Promise<SeededJournal> {
  const db = fixtureDatabase(client);
  const {
    ratingHalfSteps = 9,
    en = "published",
    ptBR = "draft",
    deletedAt,
    reflections = true,
  } = options;

  return db.transaction(async (tx) => {
    const artistId = await createTestArtist(tx, "Jeff Buckley");
    const album = await createTestAlbum(tx, {
      title: "Grace",
      trackTitles: [...GRACE_TRACKS],
      artistIds: [artistId],
      firstReleaseYear: 1994,
    });
    const versions: TestVersion[] = [
      {
        locale: "en",
        status: en,
        text: PUBLIC_TEXT.paragraph,
        publishedAt: new Date("2026-10-20T12:00:00Z"),
      },
    ];
    if (ptBR !== null) {
      versions.push({
        locale: "pt-BR",
        status: ptBR,
        text: PRIVATE_MARKERS.translation,
        publishedAt: new Date("2026-10-21T12:00:00Z"),
      });
    }
    const entryId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      versions,
      slug: options.slug,
      ratingHalfSteps,
      deletedAt,
    });
    await tx.execute(sql`
      update album_editions set label = 'Columbia'
       where id = ${album.editionId}`);
    await tx.execute(sql`
      update tracks set credit = 'James Shelton'
       where id = ${album.trackIds[3]!}`);
    const document = options.plainBody
      ? {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: options.plainBody }],
            },
          ],
        }
      : options.document === "editorial"
        ? editorialDocument
        : hostileDocument;
    await tx.execute(sql`
      update entry_texts
         set opening = ${PUBLIC_TEXT.opening},
             margin_note = ${PUBLIC_TEXT.marginNote},
             body = ${JSON.stringify(document)}::jsonb,
             body_text = ${options.plainBody ?? "[Test] public body text"}
       where entry_id = ${entryId} and locale = 'en'`);
    if (ptBR !== null) {
      await tx.execute(sql`
        update entry_texts
           set opening = ${PRIVATE_MARKERS.translation},
               margin_note = ${PRIVATE_MARKERS.translation}
         where entry_id = ${entryId} and locale = 'pt-BR'`);
    }

    if (reflections) {
      const [mojoPin, grace, lastGoodbye, lilacWine] = album.trackIds;
      await createTestTrackReflection(tx, {
        albumJournalId: entryId,
        albumId: album.albumId,
        trackId: mojoPin!,
        isPublished: true,
        ratingHalfSteps: 8,
        texts: { en: PUBLIC_TEXT.reflection("Mojo Pin") },
      });
      await createTestTrackReflection(tx, {
        albumJournalId: entryId,
        albumId: album.albumId,
        trackId: grace!,
        isPublished: true,
        isStillWriting: true,
        ratingHalfSteps: 9,
        texts: { en: PUBLIC_TEXT.reflection("Grace") },
      });
      await createTestTrackReflection(tx, {
        albumJournalId: entryId,
        albumId: album.albumId,
        trackId: lastGoodbye!,
        isPublished: true,
        isFavourite: true,
        ratingHalfSteps: 7,
        texts: { en: PUBLIC_TEXT.reflection("Last Goodbye") },
      });
      await createTestTrackReflection(tx, {
        albumJournalId: entryId,
        albumId: album.albumId,
        trackId: lilacWine!,
        // No explicit flag: this reflection must not be public.
        isPublished: false,
        isFavourite: true,
        ratingHalfSteps: 8,
        texts: {
          en: PRIVATE_MARKERS.reflection,
          ...(ptBR !== null ? { "pt-BR": PRIVATE_MARKERS.translation } : {}),
        },
      });
    }

    return {
      entryId,
      albumId: album.albumId,
      artistId,
      trackIds: album.trackIds,
      slug: options.slug,
    };
  });
}

/**
 * A small journal in one state, for the cases that must all answer as an
 * unknown address does. Its text is the given marker.
 */
export async function seedSimple(
  client: Client,
  options: {
    slug: string;
    title: string;
    status: "draft" | "private" | "published";
    marker: string;
    deletedAt?: Date;
  },
): Promise<SeededJournal> {
  const db = fixtureDatabase(client);
  return db.transaction(async (tx) => {
    const artistId = await createTestArtist(tx, "[Test] Artist");
    const album = await createTestAlbum(tx, {
      title: options.title,
      artistIds: [artistId],
    });
    const entryId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      versions: [
        { locale: "en", status: options.status, text: options.marker },
      ],
      slug: options.slug,
      deletedAt: options.deletedAt,
    });
    await tx.execute(sql`
      update entry_texts set opening = ${options.marker}
       where entry_id = ${entryId} and locale = 'en'`);
    return {
      entryId,
      albumId: album.albumId,
      artistId,
      trackIds: album.trackIds,
      slug: options.slug,
    };
  });
}

/**
 * Three more published album journals for the Home (M3.4), beside Grace:
 * public catalog facts (title, artist, year) and synthetic "[Test]" writing,
 * each published on its own day, all before Grace (2026-10-20), and none
 * rated, so the Home shows a rated and an unrated card.
 */
export const HOME_SHELF = [
  {
    name: "pink-moon",
    title: "Pink Moon",
    artist: "Nick Drake",
    year: 1972,
    publishedAt: new Date("2026-10-18T12:00:00Z"),
  },
  {
    name: "twin-fantasy",
    title: "Twin Fantasy",
    artist: "Car Seat Headrest",
    year: 2018,
    publishedAt: new Date("2026-10-12T12:00:00Z"),
  },
  {
    name: "cleopatra",
    title: "Cleopatra",
    artist: "The Lumineers",
    year: 2016,
    publishedAt: new Date("2026-10-05T12:00:00Z"),
  },
] as const;

export async function seedHomeShelf(
  client: Client,
  slugPrefix: string,
): Promise<SeededJournal[]> {
  const db = fixtureDatabase(client);
  const seeded: SeededJournal[] = [];
  for (const album of HOME_SHELF) {
    seeded.push(
      await db.transaction(async (tx) => {
        const artistId = await createTestArtist(tx, album.artist);
        const created = await createTestAlbum(tx, {
          title: album.title,
          artistIds: [artistId],
          firstReleaseYear: album.year,
        });
        const slug = `${slugPrefix}-${album.name}`;
        const entryId = await createTestAlbumJournal(tx, {
          albumId: created.albumId,
          versions: [
            {
              locale: "en",
              status: "published",
              text: `[Test] A synthetic journal about ${album.title}.`,
              publishedAt: album.publishedAt,
            },
          ],
          slug,
        });
        return {
          entryId,
          albumId: created.albumId,
          artistId,
          trackIds: created.trackIds,
          slug,
        };
      }),
    );
  }
  return seeded;
}

/** A run-unique prefix for slugs, so concurrent runs never collide. */
export function runPrefix(): string {
  return `t${randomUUID().slice(0, 8)}`;
}

/** Removes everything the seeds created. Safe to call more than once. */
export async function removeSeeded(
  client: Client,
  seeded: SeededJournal[],
  slugPrefix: string,
): Promise<void> {
  const entries = seeded.map((s) => s.entryId);
  const albums = seeded.map((s) => s.albumId);
  const artists = seeded.map((s) => s.artistId);
  // Slugs retired by a permanent deletion belong to no entry; the prefix
  // finds them.
  await client.query("delete from entry_slugs where slug like $1", [
    `${slugPrefix}%`,
  ]);
  if (entries.length > 0) {
    await client.query("delete from entry_slugs where entry_id = any($1)", [
      entries,
    ]);
    await client.query("delete from entries where id = any($1)", [entries]);
  }
  if (albums.length > 0) {
    await client.query("delete from albums where id = any($1)", [albums]);
    await client.query(
      "delete from tracks where id in (select unnest($1::uuid[]))",
      [seeded.flatMap((s) => s.trackIds)],
    );
  }
  if (artists.length > 0) {
    await client.query("delete from artists where id = any($1)", [artists]);
  }
}
