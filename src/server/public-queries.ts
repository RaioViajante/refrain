// Reads for public pages. Each one goes through the visibility predicates in
// ./visibility.ts and returns only the columns the pages use.
import "server-only";

import {
  asc,
  count,
  countDistinct,
  eq,
  inArray,
  isNotNull,
  and,
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

import { publicImageJoin, publicMixtape } from "./visibility";

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
    url: table.url,
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
  const [row] = await db
    .select({
      id: mixtapes.id,
      number: mixtapes.number,
      slug: mixtapes.slug,
      title: mixtapes.title,
      theme: mixtapes.theme,
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

  const { id, cover, detailImage, ...mixtape } = row;
  void id;
  return {
    ...mixtape,
    cover: toPublicImage(cover),
    detailImage: toPublicImage(detailImage),
    tracks,
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
    .where(inArray(siteTexts.key, [...keys]));
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
