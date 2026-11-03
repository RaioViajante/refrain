import { sql } from "drizzle-orm";
import type { Client } from "pg";

import type { Transaction } from "@/db";

import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestTrackReflection,
  type TestVersion,
} from "./fixtures";
import {
  fixtureDatabase,
  seedGrace,
  type SeededJournal,
} from "./public-journals";
import { commonsThumbnail, PHOTO } from "./wikimedia-fixtures";

// Committed synthetic data for the public artist pages (M3.5), over HTTP and in
// a browser. Catalog facts are public (Jeff Buckley, Grace, Sketches for My
// Sweetheart the Drunk); every piece of writing is labelled "[Test]"; every
// photograph is a synthetic Commons file name from the M3.3 fixtures, whose
// image the tests answer with a synthetic picture: no real photograph is used.
//
// The name of every artist that must never have a public page is itself a
// private marker, so a test that scans every response for the markers also
// proves that no such artist is named, linked, or listed anywhere public.

export const ARTIST_MARKERS = {
  catalogOnly: "[Test] PRIVATE-CATALOG-ONLY-ARTIST-MARKER",
  draftOnly: "[Test] PRIVATE-DRAFT-ONLY-ARTIST-MARKER",
  privateOnly: "[Test] PRIVATE-PRIVATE-ONLY-ARTIST-MARKER",
  deletedOnly: "[Test] PRIVATE-DELETED-ONLY-ARTIST-MARKER",
  translationOnly: "[Test] PRIVATE-TRANSLATION-ONLY-ARTIST-MARKER",
  /** A credit on a public album; archived, so its name stays plain text. */
  archived: "[Test] Archived Credit Artist",
  /** The photograph credit of a private artist. */
  privatePhotoCredit: "[Test] PRIVATE-PHOTO-CREDIT-MARKER",
} as const;

/** The names that must never appear in a public response. */
export const PRIVATE_ARTIST_MARKER_LIST: string[] = [
  ARTIST_MARKERS.catalogOnly,
  ARTIST_MARKERS.draftOnly,
  ARTIST_MARKERS.privateOnly,
  ARTIST_MARKERS.deletedOnly,
  ARTIST_MARKERS.translationOnly,
  ARTIST_MARKERS.privatePhotoCredit,
];

/** A band name long enough to test wrapping at every width. */
export const LONG_BAND_NAME =
  "[Test] The Extraordinarily Long-Named Synthetic Chamber Orchestra and Choir of Nowhere in Particular";

export const SKETCHES_TRACKS = [
  "The Sky Is a Landfill",
  "Everybody Here Wants You",
  "Nightmares by the Sea",
] as const;

export interface TestPhoto {
  fileName: string;
  credit: string;
  license: string;
}

/** The Jeff Buckley test photograph: synthetic file, CC BY-SA 4.0. */
export const GRACE_ARTIST_PHOTO: TestPhoto = {
  fileName: PHOTO.onStage,
  credit: "[Test] Photographer One",
  license: "CC BY-SA 4.0",
};

/** A photograph whose thumbnail the browser tests answer with an error. */
export const BROKEN_PHOTO: TestPhoto = {
  fileName: PHOTO.attributed,
  credit: "[Test] Photographer Two",
  license: "CC BY 4.0",
};

/** The description page of a Commons file whose name needs no encoding. */
export function commonsPage(fileName: string): string {
  return `https://commons.wikimedia.org/wiki/File:${fileName}`;
}

/**
 * Writes a photograph in the one stored form Refrain writes (M3.3), built
 * here independently of the application's builder.
 */
export async function setTestArtistPhoto(
  db: Transaction | ReturnType<typeof fixtureDatabase>,
  artistId: string,
  photo: TestPhoto,
): Promise<void> {
  await db.execute(sql`
    update artists
       set photo_url = ${commonsThumbnail(photo.fileName, 330)},
           photo_credit = ${photo.credit},
           photo_license = ${photo.license},
           photo_source_url = ${commonsPage(photo.fileName)},
           photo_file_sha1 = ${"a".repeat(40)},
           photo_file_timestamp = '2020-05-01T10:00:00Z',
           photo_chosen_at = '2026-10-01T10:00:00Z'
     where id = ${artistId}`);
}

export interface SeededArtists {
  /** Grace, by Jeff Buckley, published, with the test photograph. */
  grace: SeededJournal;
  /** A second published album by the same artist. */
  sketches: SeededJournal;
  /** A published album by a band with a very long name and no photograph. */
  long: SeededJournal;
  /** A published album whose artist's thumbnail fails in the browser. */
  broken: SeededJournal;
  /** Journals whose artists must never be public. */
  hidden: SeededJournal[];
  /** Artists with no journal at all. */
  catalogOnlyArtistIds: string[];
  /** Credited on the published Sketches journal, but archived: no page. */
  archivedArtistId: string;
}

async function albumJournal(
  tx: Transaction,
  options: {
    artistIds: string[];
    title: string;
    slug: string;
    year?: number;
    trackTitles?: string[];
    status: "draft" | "private" | "published";
    deletedAt?: Date;
    ptBR?: "draft" | "private" | "published";
    enStatus?: "draft" | "private" | "published";
    publishedAt?: Date;
  },
): Promise<SeededJournal> {
  const album = await createTestAlbum(tx, {
    title: options.title,
    artistIds: options.artistIds,
    firstReleaseYear: options.year,
    trackTitles: options.trackTitles,
  });
  const versions: TestVersion[] = [
    {
      locale: "en",
      status: options.enStatus ?? options.status,
      text: `[Test] A synthetic journal about ${options.title}.`,
      publishedAt: options.publishedAt,
    },
  ];
  if (options.ptBR) {
    versions.push({
      locale: "pt-BR",
      status: options.ptBR,
      text: `[Test] Um diário sintético sobre ${options.title}.`,
      publishedAt: options.publishedAt,
    });
  }
  const entryId = await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    versions,
    slug: options.slug,
    deletedAt: options.deletedAt,
  });
  return {
    entryId,
    albumId: album.albumId,
    artistId: options.artistIds[0]!,
    trackIds: album.trackIds,
    slug: options.slug,
  };
}

/**
 * Every artist state the public artist pages must handle. Slugs start with
 * `prefix`; `removeSeededArtists` removes everything by the ids returned.
 */
export async function seedArtistPages(
  client: Client,
  prefix: string,
): Promise<SeededArtists> {
  const grace = await seedGrace(client, {
    slug: `${prefix}-grace`,
    document: "editorial",
  });
  const db = fixtureDatabase(client);
  return db.transaction(async (tx) => {
    await setTestArtistPhoto(tx, grace.artistId, GRACE_ARTIST_PHOTO);

    // A second album by the same artist, published earlier, with one public
    // reflection, so the page lists two albums and tracks from both.
    const sketches = await albumJournal(tx, {
      artistIds: [grace.artistId],
      title: "Sketches for My Sweetheart the Drunk",
      slug: `${prefix}-sketches`,
      year: 1998,
      trackTitles: [...SKETCHES_TRACKS],
      status: "published",
      publishedAt: new Date("2026-10-15T12:00:00Z"),
    });
    await createTestTrackReflection(tx, {
      albumJournalId: sketches.entryId,
      albumId: sketches.albumId,
      trackId: sketches.trackIds[1]!,
      isPublished: true,
      texts: { en: "[Test] A public reflection on Everybody Here Wants You." },
    });
    // Sketches also credits an archived artist, whose name stays plain text.
    const archivedId = await createTestArtist(tx, ARTIST_MARKERS.archived);
    await tx.execute(sql`
      update artists set archived_at = now() where id = ${archivedId}`);
    await tx.execute(sql`
      insert into album_artists (album_id, artist_id, position)
      values (${sketches.albumId}, ${archivedId}, 2)`);

    const longId = await createTestArtist(tx, LONG_BAND_NAME);
    await tx.execute(
      sql`update artists set kind = 'group' where id = ${longId}`,
    );
    const long = await albumJournal(tx, {
      artistIds: [longId],
      title: "[Test] An Album by a Band with a Long Name",
      slug: `${prefix}-long`,
      year: 2024,
      status: "published",
      publishedAt: new Date("2026-10-10T12:00:00Z"),
    });

    const brokenId = await createTestArtist(tx, "[Test] Broken Thumbnail Trio");
    await setTestArtistPhoto(tx, brokenId, BROKEN_PHOTO);
    const broken = await albumJournal(tx, {
      artistIds: [brokenId],
      title: "[Test] An Album Whose Artist Photo Fails",
      slug: `${prefix}-broken`,
      year: 2020,
      status: "published",
      publishedAt: new Date("2026-10-08T12:00:00Z"),
    });

    // Artists that must answer exactly as an unknown address does. Each has
    // a photograph, so a photograph alone is shown never to make a page.
    const hidden: SeededJournal[] = [];
    const hiddenArtist = async (name: string) => {
      const id = await createTestArtist(tx, name);
      await setTestArtistPhoto(tx, id, {
        ...GRACE_ARTIST_PHOTO,
        credit: ARTIST_MARKERS.privatePhotoCredit,
      });
      return id;
    };
    hidden.push(
      await albumJournal(tx, {
        artistIds: [await hiddenArtist(ARTIST_MARKERS.draftOnly)],
        title: "[Test] PRIVATE-DRAFT-ALBUM-MARKER",
        slug: `${prefix}-draft-only`,
        status: "draft",
      }),
      await albumJournal(tx, {
        artistIds: [await hiddenArtist(ARTIST_MARKERS.privateOnly)],
        title: "[Test] PRIVATE-PRIVATE-ALBUM-MARKER",
        slug: `${prefix}-private-only`,
        status: "private",
      }),
      await albumJournal(tx, {
        artistIds: [await hiddenArtist(ARTIST_MARKERS.deletedOnly)],
        title: "[Test] PRIVATE-DELETED-ALBUM-MARKER",
        slug: `${prefix}-deleted-only`,
        status: "published",
        deletedAt: new Date("2026-10-30T12:00:00Z"),
      }),
      // The translation is published, but the entry's original is a draft: a
      // published Brazilian Portuguese version alone would make it public,
      // so this one keeps both unpublished and says so in its name.
      await albumJournal(tx, {
        artistIds: [await hiddenArtist(ARTIST_MARKERS.translationOnly)],
        title: "[Test] PRIVATE-TRANSLATION-ALBUM-MARKER",
        slug: `${prefix}-translation-only`,
        status: "draft",
        ptBR: "private",
      }),
    );
    const catalogOnlyArtistIds = [
      await hiddenArtist(ARTIST_MARKERS.catalogOnly),
    ];
    return {
      grace,
      sketches,
      long,
      broken,
      hidden,
      catalogOnlyArtistIds,
      archivedArtistId: archivedId,
    };
  });
}

/** Removes what `seedArtistPages` created. Safe to call more than once. */
export async function removeSeededArtists(
  client: Client,
  seeded: SeededArtists | undefined,
  prefix: string,
): Promise<void> {
  await client.query("delete from entry_slugs where slug like $1", [
    `${prefix}%`,
  ]);
  if (!seeded) {
    return;
  }
  const journals = [
    seeded.grace,
    seeded.sketches,
    seeded.long,
    seeded.broken,
    ...seeded.hidden,
  ];
  const entries = [...new Set(journals.map((s) => s.entryId))];
  const albums = [...new Set(journals.map((s) => s.albumId))];
  const artists = [
    ...new Set([
      ...journals.map((s) => s.artistId),
      ...seeded.catalogOnlyArtistIds,
      seeded.archivedArtistId,
    ]),
  ];
  await client.query("delete from entries where id = any($1)", [entries]);
  await client.query("delete from albums where id = any($1)", [albums]);
  await client.query(
    "delete from tracks where id in (select unnest($1::uuid[]))",
    [journals.flatMap((s) => s.trackIds)],
  );
  await client.query("delete from artists where id = any($1)", [artists]);
}
