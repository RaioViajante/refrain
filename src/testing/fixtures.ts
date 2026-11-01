// Synthetic fixtures for integration tests. Every name and text is labeled
// "[Test]". They are not the author's writing, ratings, or memories, and they
// exist only inside rolled-back test transactions.
import { eq } from "drizzle-orm";

import type { AuthorizedAuthor } from "@/modules/identity";
import {
  schema,
  type EntryKind,
  type Locale,
  type Transaction,
  type VisibilityStatus,
} from "@/db";

/**
 * A stand-in for the proof that Identity creates after authorizing a request.
 * Commands under test take it, but never read it, so a test can pass this
 * value; the real authorization is tested through Identity and over HTTP.
 */
export function testAuthor(): AuthorizedAuthor {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
  } as AuthorizedAuthor;
}

/** A Tiptap document with one paragraph. */
export function testDocument(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

export async function createTestArtist(
  tx: Transaction,
  name = "[Test] Artist",
): Promise<string> {
  const [artist] = await tx
    .insert(schema.artists)
    .values({ name, kind: "person" })
    .returning({ id: schema.artists.id });
  return artist!.id;
}

export interface TestAlbum {
  albumId: string;
  editionId: string;
  /** Track ids in reference-edition order. */
  trackIds: string[];
}

/**
 * An album with a reference edition whose tracks are ordered as given, and
 * optional credited artists (in credit order).
 */
export async function createTestAlbum(
  tx: Transaction,
  options: {
    title?: string;
    trackTitles?: string[];
    artistIds?: string[];
    firstReleaseYear?: number;
  } = {},
): Promise<TestAlbum> {
  const {
    title = "[Test] Album",
    trackTitles = ["[Test] Track 1", "[Test] Track 2", "[Test] Track 3"],
    artistIds = [],
    firstReleaseYear,
  } = options;

  const [album] = await tx
    .insert(schema.albums)
    .values({ title, firstReleaseYear })
    .returning({ id: schema.albums.id });
  const albumId = album!.id;

  for (const [index, artistId] of artistIds.entries()) {
    await tx
      .insert(schema.albumArtists)
      .values({ albumId, artistId, position: index + 1 });
  }

  const [edition] = await tx
    .insert(schema.albumEditions)
    .values({ albumId, isReference: true, label: "[Test] Label" })
    .returning({ id: schema.albumEditions.id });
  const editionId = edition!.id;

  const trackIds: string[] = [];
  for (const [index, trackTitle] of trackTitles.entries()) {
    const [track] = await tx
      .insert(schema.tracks)
      .values({ title: trackTitle })
      .returning({ id: schema.tracks.id });
    const trackId = track!.id;
    await tx.insert(schema.albumTracks).values({ albumId, trackId });
    await tx
      .insert(schema.editionTracks)
      .values({ editionId, albumId, trackId, position: index + 1 });
    trackIds.push(trackId);
  }

  return { albumId, editionId, trackIds };
}

export interface TestVersion {
  locale: Locale;
  isOriginal?: boolean;
  status?: VisibilityStatus;
  publishedAt?: Date;
  title?: string;
  text?: string;
}

interface TestEntryOptions {
  /** Language versions; the first is the original unless stated. */
  versions?: TestVersion[];
  slug?: string;
  deletedAt?: Date;
}

const defaultPublishedAt = new Date("2026-01-01T00:00:00Z");

async function createTestEntry(
  tx: Transaction,
  kind: EntryKind,
  { versions = [{ locale: "en" }], slug, deletedAt }: TestEntryOptions,
): Promise<string> {
  const [entry] = await tx
    .insert(schema.entries)
    .values({ kind, deletedAt })
    .returning({ id: schema.entries.id });
  const entryId = entry!.id;

  const firstPublications: Date[] = [];
  for (const [index, version] of versions.entries()) {
    const status = version.status ?? "draft";
    const text = version.text ?? "[Test] Body";
    const publishedAt =
      status === "published"
        ? (version.publishedAt ?? defaultPublishedAt)
        : null;
    if (publishedAt) {
      firstPublications.push(publishedAt);
    }
    await tx.insert(schema.entryTexts).values({
      entryId,
      locale: version.locale,
      isOriginal: version.isOriginal ?? index === 0,
      status,
      publishedAt,
      // A fixture's published version was first published when it was
      // published; tests of publication history set their own values.
      firstPublishedAt: publishedAt,
      title: version.title ?? (kind === "memory" ? "[Test] Memory" : null),
      body: testDocument(text),
      bodyText: text,
    });
  }

  const firstPublishedAt =
    firstPublications.length > 0
      ? new Date(Math.min(...firstPublications.map((date) => date.getTime())))
      : null;
  if (firstPublishedAt) {
    await tx
      .update(schema.entries)
      .set({ firstPublishedAt })
      .where(eq(schema.entries.id, entryId));
  }

  if (slug) {
    await tx.insert(schema.entrySlugs).values({
      kind,
      slug,
      entryId,
      isCurrent: true,
      wasPublished: firstPublishedAt !== null,
    });
  }

  return entryId;
}

export async function createTestAlbumJournal(
  tx: Transaction,
  options: TestEntryOptions & {
    albumId: string;
    isFeatured?: boolean;
    ratingHalfSteps?: number | null;
  },
): Promise<string> {
  const entryId = await createTestEntry(tx, "album_journal", options);
  await tx.insert(schema.albumJournals).values({
    entryId,
    albumId: options.albumId,
    isFeatured: options.isFeatured ?? false,
    ratingHalfSteps: options.ratingHalfSteps ?? null,
  });
  return entryId;
}

export async function createTestArtistJournal(
  tx: Transaction,
  options: TestEntryOptions & { artistId: string; isFeatured?: boolean },
): Promise<string> {
  const entryId = await createTestEntry(tx, "artist_journal", options);
  await tx.insert(schema.artistJournals).values({
    entryId,
    artistId: options.artistId,
    isFeatured: options.isFeatured ?? false,
  });
  return entryId;
}

export async function createTestMemory(
  tx: Transaction,
  options: TestEntryOptions & {
    music?: ({ trackId: string } | { albumId: string })[];
  } = {},
): Promise<string> {
  const entryId = await createTestEntry(tx, "memory", options);
  await tx.insert(schema.memories).values({ entryId });
  for (const [index, item] of (options.music ?? []).entries()) {
    await tx
      .insert(schema.memoryMusic)
      .values({ memoryId: entryId, position: index + 1, ...item });
  }
  return entryId;
}

export async function createTestTrackReflection(
  tx: Transaction,
  options: {
    albumJournalId: string;
    albumId: string;
    trackId: string;
    isPublished?: boolean;
    isStillWriting?: boolean;
    isFavourite?: boolean;
    ratingHalfSteps?: number | null;
    /** Reflection text per language; an empty string stores an empty text. */
    texts?: Partial<Record<Locale, string>>;
  },
): Promise<string> {
  const [reflection] = await tx
    .insert(schema.trackReflections)
    .values({
      albumJournalId: options.albumJournalId,
      albumId: options.albumId,
      trackId: options.trackId,
      isPublished: options.isPublished ?? false,
      isStillWriting: options.isStillWriting ?? false,
      isFavourite: options.isFavourite ?? false,
      ratingHalfSteps: options.ratingHalfSteps ?? null,
    })
    .returning({ id: schema.trackReflections.id });
  const trackReflectionId = reflection!.id;

  for (const [locale, text] of Object.entries(options.texts ?? {})) {
    await tx.insert(schema.trackReflectionTexts).values({
      trackReflectionId,
      locale: locale as Locale,
      body: text === "" ? null : testDocument(text),
      bodyText: text,
    });
  }
  return trackReflectionId;
}
