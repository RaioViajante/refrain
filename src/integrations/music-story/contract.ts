import "server-only";

import { z } from "zod";

// Music Story's API, as its public reference describes it
// (https://doc.music-story.com/api/reference, read 2026-11-15), and the shapes
// Refrain keeps from it. ADR 0012 § 1 (proposed). Every response is validated
// here before anything uses it; a field the reference names but a response
// leaves out is optional, and anything else in a response is ignored.
//
// These shapes come from the documentation, not from a real response: no
// authenticated call has been made (MS-0). They are checked again against a
// sanitized response captured during the trial, if its terms allow (MS-2).
// Lyrics are never requested or kept, though the API offers them.

/** A Music Story identifier: digits, or a short opaque token. */
export const musicStoryId = z
  .union([
    z.number().int().positive(),
    z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  ])
  .transform((value) => String(value));

const text = z.string().trim().min(1).max(500);
const optionalText = text.optional().nullable();
const year = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const match = /^(\d{4})/.exec(String(value));
    const parsed = match ? Number(match[1]) : NaN;
    return parsed >= 1800 && parsed <= 2100 ? parsed : null;
  });

/** "HH:MM:SS" or "MM:SS" to whole seconds, or null. */
export function durationSeconds(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const parts = value.split(":").map((part) => Number(part));
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return null;
  }
  const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
  const total = h! * 3600 + m! * 60 + s!;
  return total > 0 && total < 24 * 3600 ? total : null;
}

const externals = z
  .object({
    musicbrainz: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .nullable(),
    spotify: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .nullable(),
    deezer: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .nullable(),
    apple: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .nullable(),
    discogs: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .nullable(),
  })
  .partial()
  .optional()
  .nullable();

const asList = (value: string | string[] | null | undefined): string[] =>
  value === null || value === undefined
    ? []
    : Array.isArray(value)
      ? value
      : [value];

const MUSICBRAINZ_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The identifiers Refrain may link: MusicBrainz ones, well formed. */
export interface ExternalIds {
  musicbrainz: string[];
}

function toExternals(value: z.infer<typeof externals>): ExternalIds {
  return {
    musicbrainz: asList(value?.musicbrainz).filter((id) =>
      MUSICBRAINZ_ID.test(id),
    ),
  };
}

const ALBUM_FORMATS = ["ALBUM", "EP", "SINGLE", "MCD", "MIXTAPE"] as const;
const ALBUM_TYPES = [
  "ORIGINAL",
  "LIVE",
  "COMPILATION",
  "KARAOKE",
  "RING",
  "OTHER",
] as const;

const album = z.object({
  id: musicStoryId,
  title: text,
  artist: z
    .union([text, z.object({ id: musicStoryId.optional(), name: text })])
    .optional()
    .nullable(),
  original_release_date: year,
  label: optionalText,
  format: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  externals,
});

export const albumSearchResponse = z.object({
  hits: z.array(album).max(200).optional().default([]),
  page: z.number().int().optional(),
  totalPages: z.number().int().optional(),
  totalHits: z.number().int().optional(),
});

export const albumResponse = album;

export const coverArtResponse = z.object({
  path: z.string().url(),
  path_400: z.string().url().optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  source: optionalText,
  copyright: optionalText,
});

const release = z.object({
  id: musicStoryId,
  release_date: year,
  label: optionalText,
  distributor: optionalText,
  barcode: z
    .string()
    .regex(/^\d{8,14}$/)
    .optional()
    .nullable(),
  support: z.string().optional().nullable(),
  externals,
});

export const releasesResponse = z.union([
  z.array(release).max(500),
  z
    .object({ hits: z.array(release).max(500).optional().default([]) })
    .transform((value) => value.hits),
]);

const recording = z.object({
  id: musicStoryId,
  title: text,
  duration: z.string().optional().nullable(),
  isrc: z
    .string()
    .regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/)
    .optional()
    .nullable(),
  externals,
});

export const releaseTracksResponse = z.object({
  hits: z
    .array(
      z.object({
        id: musicStoryId,
        disc_number: z.number().int().positive().optional().nullable(),
        track_number: z.number().int().positive(),
        recording,
      }),
    )
    .max(500)
    .optional()
    .default([]),
  offset: z.number().int().optional(),
  limit: z.number().int().optional(),
  total: z.number().int().optional(),
});

const artist = z.object({
  id: musicStoryId,
  name: text,
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .nullable(),
  externals,
});

export const artistSearchResponse = z.object({
  hits: z.array(artist).max(200).optional().default([]),
});

export const artistResponse = artist;

export const artistPicturesResponse = z.union([
  z.array(z.unknown()).max(200),
  z
    .object({ hits: z.array(z.unknown()).max(200).optional().default([]) })
    .transform((value) => value.hits),
]);

const picture = z.object({
  id: musicStoryId,
  path: z.string().url(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  source: optionalText,
  copyright: optionalText,
  metas: z
    .object({
      credit_line: optionalText,
      license_model: optionalText,
      allowed_use: z
        .object({
          how_can_i_use_it: optionalText,
          usage_restrictions: z.array(text).max(50).optional().nullable(),
        })
        .partial()
        .optional()
        .nullable(),
    })
    .partial()
    .optional()
    .nullable(),
});

export const recordingSearchResponse = z.object({
  hits: z
    .array(
      recording.extend({
        artist: z
          .union([text, z.object({ name: text })])
          .optional()
          .nullable(),
      }),
    )
    .max(200)
    .optional()
    .default([]),
});

// ---- The shapes Refrain keeps ------------------------------------------------

export interface MusicStoryAlbum {
  id: string;
  title: string;
  artist: string | null;
  year: number | null;
  label: string | null;
  /** ALBUM, EP, SINGLE, … or null when the response names another. */
  format: (typeof ALBUM_FORMATS)[number] | null;
  type: (typeof ALBUM_TYPES)[number] | null;
  externals: ExternalIds;
}

export interface MusicStoryCover {
  url: string;
  url400: string | null;
  width: number | null;
  height: number | null;
  source: string | null;
  /** The rights holder the response names; shown with the cover if used. */
  copyright: string | null;
}

export interface MusicStoryRelease {
  id: string;
  year: number | null;
  label: string | null;
  barcode: string | null;
  externals: ExternalIds;
}

export interface MusicStoryTrack {
  disc: number;
  position: number;
  recordingId: string;
  title: string;
  seconds: number | null;
  isrc: string | null;
  externals: ExternalIds;
}

export interface MusicStoryArtist {
  id: string;
  name: string;
  country: string | null;
  externals: ExternalIds;
}

export interface MusicStoryPicture {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  source: string | null;
  copyright: string | null;
  creditLine: string | null;
  licenseModel: string | null;
  /** The provider's own words on how a picture may be used, if given. */
  allowedUse: string | null;
  restrictions: string[];
}

export interface MusicStoryRecording {
  id: string;
  title: string;
  artist: string | null;
  seconds: number | null;
  isrc: string | null;
  externals: ExternalIds;
}

const nameOf = (
  value: string | { name: string } | null | undefined,
): string | null =>
  value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : value.name;

export function toAlbum(value: z.infer<typeof album>): MusicStoryAlbum {
  const format = value.format?.toUpperCase();
  const type = value.type?.toUpperCase();
  return {
    id: value.id,
    title: value.title,
    artist: nameOf(value.artist),
    year: value.original_release_date,
    label: value.label ?? null,
    format: (ALBUM_FORMATS as readonly string[]).includes(format ?? "")
      ? (format as MusicStoryAlbum["format"])
      : null,
    type: (ALBUM_TYPES as readonly string[]).includes(type ?? "")
      ? (type as MusicStoryAlbum["type"])
      : null,
    externals: toExternals(value.externals),
  };
}

export function toCover(
  value: z.infer<typeof coverArtResponse>,
): MusicStoryCover {
  return {
    url: value.path,
    url400: value.path_400 ?? null,
    width: value.width ?? null,
    height: value.height ?? null,
    source: value.source ?? null,
    copyright: value.copyright ?? null,
  };
}

export function toRelease(value: z.infer<typeof release>): MusicStoryRelease {
  return {
    id: value.id,
    year: value.release_date,
    label: value.label ?? null,
    barcode: value.barcode ?? null,
    externals: toExternals(value.externals),
  };
}

export function toTracks(
  value: z.infer<typeof releaseTracksResponse>,
): MusicStoryTrack[] {
  return value.hits
    .map((hit) => ({
      disc: hit.disc_number ?? 1,
      position: hit.track_number,
      recordingId: hit.recording.id,
      title: hit.recording.title,
      seconds: durationSeconds(hit.recording.duration),
      isrc: hit.recording.isrc ?? null,
      externals: toExternals(hit.recording.externals),
    }))
    .sort((a, b) => a.disc - b.disc || a.position - b.position);
}

export function toArtist(value: z.infer<typeof artist>): MusicStoryArtist {
  return {
    id: value.id,
    name: value.name,
    country: value.country ?? null,
    externals: toExternals(value.externals),
  };
}

/** The pictures that validate; one that does not is left out, not guessed. */
export function toPictures(values: unknown[]): MusicStoryPicture[] {
  return values.flatMap((value) => {
    const parsed = picture.safeParse(value);
    if (!parsed.success) return [];
    const p = parsed.data;
    return [
      {
        id: p.id,
        url: p.path,
        width: p.width ?? null,
        height: p.height ?? null,
        source: p.source ?? null,
        copyright: p.copyright ?? null,
        creditLine: p.metas?.credit_line ?? null,
        licenseModel: p.metas?.license_model ?? null,
        allowedUse: p.metas?.allowed_use?.how_can_i_use_it ?? null,
        restrictions: p.metas?.allowed_use?.usage_restrictions ?? [],
      },
    ];
  });
}

export function toRecordings(
  value: z.infer<typeof recordingSearchResponse>,
): MusicStoryRecording[] {
  return value.hits.map((hit) => ({
    id: hit.id,
    title: hit.title,
    artist: nameOf(hit.artist),
    seconds: durationSeconds(hit.duration),
    isrc: hit.isrc ?? null,
    externals: toExternals(hit.externals),
  }));
}
