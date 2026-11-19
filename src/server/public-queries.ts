// Reads for public pages. Each one goes through the visibility predicates in
// ./visibility.ts and returns only the columns the pages use.
import "server-only";

import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNotNull,
  min,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  images,
  mixtapes,
  mixtapeTracks,
  siteImages,
  siteTexts,
  songs,
} from "@/db/schema";
import type { Database } from "@/db/types";

import { publicImageJoin, publicMixtape, publicSiteText } from "./visibility";

export type PublicImage = {
  url: string;
  alt: string;
  width: number;
  height: number;
  focus: number;
  treatment: "mood" | "original";
};

export type MixtapeSummary = {
  number: number;
  slug: string;
  title: string;
  theme: string;
  feeling: string;
  description: string;
  year: number | null;
  featuredRank: number | null;
  cover: PublicImage | null;
  trackCount: number;
  noteCount: number;
};

export type PublicTrack = {
  position: number;
  title: string;
  artist: string;
  note: string;
  noteSide: "left" | "right";
};

export type PublicMixtape = Omit<MixtapeSummary, "trackCount" | "noteCount"> & {
  reflection: string;
  pullQuote: string;
  pullQuoteCredit: string;
  playlistUrl: string | null;
  detailImage: PublicImage | null;
  detailCaption: string;
  tracks: PublicTrack[];
};

/** An artist and how many of a tape's tracks credit them. */
export type ArtistCount = { artist: string; count: number };

/** Everything the mixtape page shows. */
export type MixtapePage = {
  mixtape: PublicMixtape;
  noteCount: number;
  artists: ArtistCount[];
  /** The neighbouring published tapes, wrapping around; null if alone. */
  previous: MixtapeSummary | null;
  next: MixtapeSummary | null;
};

export type ArchiveStats = {
  mixtapes: number;
  tracks: number;
  artists: number;
  since: number | null;
};

// The cover is `images`; the detail photograph is the same table, aliased.
const detailImages = alias(images, "detail_image");
type ImageTable = typeof images | typeof detailImages;

function imageColumns(table: ImageTable) {
  return {
    // The application's URL for the photo (null when the join found none).
    url: sql<string | null>`'/fotos/' || ${table.id}`,
    alt: table.alt,
    width: table.width,
    height: table.height,
    focus: table.focus,
    treatment: table.treatment,
  };
}

type ImageRow = {
  [K in keyof ReturnType<typeof imageColumns>]: unknown;
};

/** A left-joined image row, or null when the join found no public image. */
function toPublicImage(row: ImageRow | null): PublicImage | null {
  if (!row || typeof row.url !== "string") return null;
  return {
    url: row.url,
    alt: String(row.alt),
    width: Number(row.width),
    height: Number(row.height),
    focus: Number(row.focus),
    treatment: row.treatment === "original" ? "original" : "mood",
  };
}

function withCover<T extends { cover: ImageRow | null }>(
  row: T,
): Omit<T, "cover"> & { cover: PublicImage | null } {
  return { ...row, cover: toPublicImage(row.cover) };
}

/** Track and note counts per mixtape, as a subquery to join against. */
function trackStats(db: Database) {
  return db
    .select({
      mixtapeId: mixtapeTracks.mixtapeId,
      trackCount: count().as("track_count"),
      noteCount:
        sql<number>`count(*) filter (where ${mixtapeTracks.note} <> '')`
          .mapWith(Number)
          .as("note_count"),
    })
    .from(mixtapeTracks)
    .groupBy(mixtapeTracks.mixtapeId)
    .as("track_stats");
}

function summarySelection(stats: ReturnType<typeof trackStats>) {
  return {
    number: mixtapes.number,
    slug: mixtapes.slug,
    title: mixtapes.title,
    theme: mixtapes.theme,
    feeling: mixtapes.feeling,
    description: mixtapes.description,
    year: mixtapes.year,
    featuredRank: mixtapes.featuredRank,
    cover: imageColumns(images),
    trackCount: sql<number>`coalesce(${stats.trackCount}, 0)`.mapWith(Number),
    noteCount: sql<number>`coalesce(${stats.noteCount}, 0)`.mapWith(Number),
  };
}

/** Every published mixtape, by catalogue number, with its counts. */
export async function listPublishedMixtapes(
  db: Database,
): Promise<MixtapeSummary[]> {
  const stats = trackStats(db);
  const rows = await db
    .select(summarySelection(stats))
    .from(mixtapes)
    .leftJoin(stats, eq(stats.mixtapeId, mixtapes.id))
    .leftJoin(images, publicImageJoin(images, mixtapes.coverImageId))
    .where(publicMixtape)
    .orderBy(asc(mixtapes.number));
  return rows.map(withCover);
}

/** The published mixtapes the home page features, in their featured order. */
export async function listFeaturedMixtapes(
  db: Database,
): Promise<MixtapeSummary[]> {
  const stats = trackStats(db);
  const rows = await db
    .select(summarySelection(stats))
    .from(mixtapes)
    .leftJoin(stats, eq(stats.mixtapeId, mixtapes.id))
    .leftJoin(images, publicImageJoin(images, mixtapes.coverImageId))
    .where(and(publicMixtape, isNotNull(mixtapes.featuredRank)))
    .orderBy(asc(mixtapes.featuredRank));
  return rows.map(withCover);
}

/** One published mixtape with its ordered tracklist, or null. */
export async function getPublishedMixtape(
  db: Database,
  slug: string,
): Promise<PublicMixtape | null> {
  const found = await findPublishedMixtape(db, slug);
  if (!found) return null;
  const { id, ...mixtape } = found;
  void id;
  return mixtape;
}

async function findPublishedMixtape(
  db: Database,
  slug: string,
): Promise<(PublicMixtape & { id: string }) | null> {
  const [row] = await db
    .select({
      id: mixtapes.id,
      number: mixtapes.number,
      slug: mixtapes.slug,
      title: mixtapes.title,
      theme: mixtapes.theme,
      feeling: mixtapes.feeling,
      description: mixtapes.description,
      reflection: mixtapes.reflection,
      pullQuote: mixtapes.pullQuote,
      pullQuoteCredit: mixtapes.pullQuoteCredit,
      playlistUrl: mixtapes.playlistUrl,
      year: mixtapes.year,
      featuredRank: mixtapes.featuredRank,
      cover: imageColumns(images),
      detailImage: imageColumns(detailImages),
      detailCaption: mixtapes.detailCaption,
    })
    .from(mixtapes)
    .leftJoin(images, publicImageJoin(images, mixtapes.coverImageId))
    .leftJoin(
      detailImages,
      publicImageJoin(detailImages, mixtapes.detailImageId),
    )
    .where(and(publicMixtape, eq(mixtapes.slug, slug)))
    .limit(1);
  if (!row) return null;

  const tracks = await db
    .select({
      position: mixtapeTracks.position,
      title: songs.title,
      artist: songs.artist,
      note: mixtapeTracks.note,
      noteSide: sql<PublicTrack["noteSide"]>`${mixtapeTracks.noteSide}`,
    })
    .from(mixtapeTracks)
    .innerJoin(songs, eq(songs.id, mixtapeTracks.songId))
    .where(eq(mixtapeTracks.mixtapeId, row.id))
    .orderBy(asc(mixtapeTracks.position));

  const { cover, detailImage, ...mixtape } = row;
  return {
    ...mixtape,
    cover: toPublicImage(cover),
    detailImage: toPublicImage(detailImage),
    tracks,
  };
}

/**
 * How many of a published tape's tracks credit each artist, most frequent
 * first. A credit is counted as written ("Zach Bryan, Lana Del Rey" is its
 * own credit), so band names with commas stay whole.
 */
export async function getArtistCounts(
  db: Database,
  slug: string,
): Promise<ArtistCount[]> {
  const trackCount = count(mixtapeTracks.id);
  return db
    .select({ artist: songs.artist, count: trackCount })
    .from(mixtapeTracks)
    .innerJoin(songs, eq(songs.id, mixtapeTracks.songId))
    .innerJoin(
      mixtapes,
      and(eq(mixtapes.id, mixtapeTracks.mixtapeId), publicMixtape),
    )
    .where(eq(mixtapes.slug, slug))
    .groupBy(songs.artist)
    .orderBy(desc(trackCount), asc(songs.artist));
}

/** The mixtape page: the tape, its counts, and its neighbours. */
export async function getMixtapePage(
  db: Database,
  slug: string,
): Promise<MixtapePage | null> {
  const [mixtape, artists, all] = await Promise.all([
    getPublishedMixtape(db, slug),
    getArtistCounts(db, slug),
    listPublishedMixtapes(db),
  ]);
  if (!mixtape) return null;

  const index = all.findIndex((m) => m.slug === slug);
  const alone = all.length < 2 || index < 0;
  return {
    mixtape,
    noteCount: mixtape.tracks.filter((t) => t.note !== "").length,
    artists,
    previous: alone ? null : all[(index - 1 + all.length) % all.length]!,
    next: alone ? null : all[(index + 1) % all.length]!,
  };
}

/** Totals across published mixtapes only ("117 faixas · desde 2024 · …"). */
export async function getArchiveStats(db: Database): Promise<ArchiveStats> {
  const [row] = await db
    .select({
      mixtapes: countDistinct(mixtapes.id),
      tracks: count(mixtapeTracks.id),
      artists: countDistinct(songs.artist),
      since: min(mixtapes.year),
    })
    .from(mixtapes)
    .leftJoin(mixtapeTracks, eq(mixtapeTracks.mixtapeId, mixtapes.id))
    .leftJoin(songs, eq(songs.id, mixtapeTracks.songId))
    .where(publicMixtape);
  return row ?? { mixtapes: 0, tracks: 0, artists: 0, since: null };
}

/** The owner's texts for the given keys; a missing key is absent. */
export async function getSiteTexts<K extends string>(
  db: Database,
  keys: readonly K[],
): Promise<Partial<Record<K, string>>> {
  if (keys.length === 0) return {};
  const rows = await db
    .select({ key: siteTexts.key, body: siteTexts.body })
    .from(siteTexts)
    .where(and(publicSiteText, inArray(siteTexts.key, [...keys])));
  return Object.fromEntries(rows.map((r) => [r.key, r.body])) as Partial<
    Record<K, string>
  >;
}

/** The publishable image in each requested slot; a slot without one is absent. */
export async function getSiteImages<K extends string>(
  db: Database,
  slots: readonly K[],
): Promise<Partial<Record<K, PublicImage>>> {
  if (slots.length === 0) return {};
  const rows = await db
    .select({ slot: siteImages.slot, image: imageColumns(images) })
    .from(siteImages)
    .innerJoin(images, publicImageJoin(images, siteImages.imageId))
    .where(inArray(siteImages.slot, [...slots]));
  return Object.fromEntries(
    rows.map((r) => [r.slot, toPublicImage(r.image)]),
  ) as Partial<Record<K, PublicImage>>;
}
