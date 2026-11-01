import { z } from "zod";

import { artistKinds } from "@/db";
import { cleanText } from "@/validation";

// Input schemas for the catalog commands. They run inside the commands, so no
// caller can skip them. Unknown keys are dropped, so a client cannot reach a
// column the schema does not name (`archived_at`, timestamps, ids).

const singleLine = (value: string) =>
  cleanText(value)
    .replace(/\s*\n\s*/g, " ")
    .trim();

/** Required single-line text of 1 to `max` characters. */
const requiredText = (max: number) =>
  z
    .string()
    .transform(singleLine)
    .pipe(z.string().min(1).max(max));

/** Optional single-line text; blank becomes `null`. */
const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((value) => (value == null ? null : singleLine(value)))
    .pipe(z.string().max(max).nullable())
    .transform((value) => (value === "" ? null : value));

/** An optional MusicBrainz identifier, stored in lowercase. */
const optionalMusicBrainzId = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim().toLowerCase();
    return trimmed ? trimmed : null;
  })
  .pipe(z.uuid().nullable());

const optionalInteger = (min: number, max: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((value) => value ?? null);

const optionalDate = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  })
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
        return (
          !Number.isNaN(parsed.getTime()) &&
          parsed.toISOString().startsWith(value)
        );
      })
      .nullable(),
  );

const optionalCountry = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim().toUpperCase();
    return trimmed ? trimmed : null;
  })
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
  );

function uniqueBy<Item>(key: (item: Item) => string) {
  return (items: Item[]) => new Set(items.map(key)).size === items.length;
}

export const MAX_CREDITS = 20;
export const MAX_ALBUM_TRACKS = 200;

export const artistInput = z.object({
  name: requiredText(200),
  sortName: optionalText(200),
  kind: z.enum(artistKinds),
  mbArtistId: optionalMusicBrainzId,
});
export type ArtistInput = z.input<typeof artistInput>;

const creditInput = z.object({
  artistId: z.uuid(),
  creditedAs: optionalText(200),
});

const editionInput = z.object({
  label: optionalText(200),
  releaseDate: optionalDate,
  country: optionalCountry,
});

export const albumInput = z.object({
  title: requiredText(300),
  firstReleaseYear: optionalInteger(1800, 2100),
  mbReleaseGroupId: optionalMusicBrainzId,
  credits: z
    .array(creditInput)
    .min(1)
    .max(MAX_CREDITS)
    .refine(uniqueBy((credit: { artistId: string }) => credit.artistId)),
  // The reference edition (ADR 0002, D2): the only edition in v1.
  edition: editionInput
    .nullish()
    .transform((edition) => edition ?? editionInput.parse({})),
});
export type AlbumInput = z.input<typeof albumInput>;

const trackFields = {
  title: requiredText(300),
  lengthMs: optionalInteger(1, 24 * 60 * 60 * 1000),
  credit: optionalText(300),
  mbRecordingId: optionalMusicBrainzId,
  artistIds: z
    .array(z.uuid())
    .max(MAX_CREDITS)
    .refine(uniqueBy((artistId: string) => artistId))
    .nullish()
    .transform((artistIds) => artistIds ?? []),
};

export const trackInput = z.object(trackFields);
export type TrackInput = z.input<typeof trackInput>;

/** A new track, optionally appended to an album's tracklist. */
export const newTrackInput = z.object({
  ...trackFields,
  albumId: z
    .uuid()
    .nullish()
    .transform((albumId) => albumId ?? null),
});
export type NewTrackInput = z.input<typeof newTrackInput>;

export const tracklistInput = z.object({
  tracks: z
    .array(
      z.object({
        trackId: z.uuid(),
        discNumber: z
          .number()
          .int()
          .min(1)
          .max(99)
          .nullish()
          .transform((discNumber) => discNumber ?? 1),
      }),
    )
    .max(MAX_ALBUM_TRACKS)
    .refine(uniqueBy((track: { trackId: string }) => track.trackId)),
});
export type TracklistInput = z.input<typeof tracklistInput>;

export const catalogId = z.uuid();
export const moveDirection = z.enum(["up", "down"]);
export type MoveDirection = z.infer<typeof moveDirection>;
