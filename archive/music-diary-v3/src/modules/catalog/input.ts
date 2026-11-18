import { z } from "zod";

import { artistKinds } from "@/db";
import { cleanText } from "@/validation";

// Input schemas for the catalog commands. They run inside the commands, so no
// caller can skip them. Unknown keys are dropped, so a client cannot reach a
// column the schema does not name (`archived_at`, timestamps, ids).
//
// The update contract, the same for every record:
//
// - A CREATE takes the whole record. An optional field left out is empty.
// - An UPDATE is a patch. A field left out is unchanged. A field that is
//   present is validated and replaces the stored value. Clearing is
//   intentional: `null`, or a blank string, for an optional field. A required
//   field (a name or a title) can be replaced but never cleared.
// - A patch with no field at all is refused (`invalid_input`) rather than
//   treated as a silent no-op.
// - A list that is present (credits, a track's artists, a tracklist) replaces
//   the whole list, and must be a complete valid list. An item inside a
//   replaced list that leaves out an optional field keeps that field's stored
//   value, so reordering credits never erases a "credited as".

const singleLine = (value: string) =>
  cleanText(value)
    .replace(/\s*\n\s*/g, " ")
    .trim();

/** Required single-line text of 1 to `max` characters. */
const requiredText = (max: number) =>
  z.string().transform(singleLine).pipe(z.string().min(1).max(max));

/** Optional single-line text: a string, or `null`. Blank becomes `null`. */
const nullableText = (max: number) =>
  z
    .string()
    .transform(singleLine)
    .pipe(z.string().max(max))
    .transform((value) => (value === "" ? null : value))
    .nullable();

/** An optional MusicBrainz identifier, stored in lowercase. Blank is `null`. */
const nullableMusicBrainzId = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .transform((value) => (value === "" ? null : value))
  .pipe(z.uuid().nullable())
  .nullable();

const nullableInteger = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullable();

const nullableDate = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value === "" ? null : value))
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
  )
  .nullable();

const nullableCountry = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .transform((value) => (value === "" ? null : value))
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
  )
  .nullable();

function uniqueBy<Item>(key: (item: Item) => string) {
  return (items: Item[]) => new Set(items.map(key)).size === items.length;
}

/** For a create: an optional field left out is empty. */
function emptyIfOmitted<Schema extends z.ZodType>(schema: Schema) {
  return schema.optional().transform((value) => value ?? null);
}

/** For a patch: at least one field must be present. */
function hasAField(patch: Record<string, unknown>): boolean {
  return Object.values(patch).some((value) => value !== undefined);
}

export const MAX_CREDITS = 20;
export const MAX_ALBUM_TRACKS = 200;

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

const artistFields = {
  name: requiredText(200),
  sortName: nullableText(200),
  kind: z.enum(artistKinds),
  mbArtistId: nullableMusicBrainzId,
};

export const artistInput = z.object({
  name: artistFields.name,
  kind: artistFields.kind,
  sortName: emptyIfOmitted(artistFields.sortName),
  mbArtistId: emptyIfOmitted(artistFields.mbArtistId),
});
export type ArtistInput = z.input<typeof artistInput>;

export const artistPatch = z.object(artistFields).partial().refine(hasAField);
export type ArtistPatch = z.input<typeof artistPatch>;

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

const creditFields = {
  artistId: z.uuid(),
  creditedAs: nullableText(200),
};

const editionFields = {
  label: nullableText(200),
  releaseDate: nullableDate,
  country: nullableCountry,
};

const albumFields = {
  title: requiredText(300),
  firstReleaseYear: nullableInteger(1800, 2100),
  mbReleaseGroupId: nullableMusicBrainzId,
};

const creditsList = <Item extends z.ZodType<{ artistId: string }>>(
  item: Item,
) =>
  z
    .array(item)
    .min(1)
    .max(MAX_CREDITS)
    .refine(uniqueBy((credit: { artistId: string }) => credit.artistId));

export const albumInput = z.object({
  title: albumFields.title,
  firstReleaseYear: emptyIfOmitted(albumFields.firstReleaseYear),
  mbReleaseGroupId: emptyIfOmitted(albumFields.mbReleaseGroupId),
  credits: creditsList(
    z.object({
      artistId: creditFields.artistId,
      creditedAs: emptyIfOmitted(creditFields.creditedAs),
    }),
  ),
  // The reference edition (ADR 0002, D2): the only edition in v1.
  edition: z
    .object({
      label: emptyIfOmitted(editionFields.label),
      releaseDate: emptyIfOmitted(editionFields.releaseDate),
      country: emptyIfOmitted(editionFields.country),
    })
    .optional()
    .transform(
      (edition) => edition ?? { label: null, releaseDate: null, country: null },
    ),
});
export type AlbumInput = z.input<typeof albumInput>;

export const albumPatch = z
  .object({
    ...albumFields,
    // A list that is present replaces the whole list. An item that leaves out
    // `creditedAs` keeps the stored one (see the contract above).
    credits: creditsList(z.object(creditFields).partial({ creditedAs: true })),
    edition: z.object(editionFields).partial(),
  })
  .partial()
  // `edition: {}` names nothing, so it does not count as a field.
  .refine(
    ({ edition, ...rest }) =>
      hasAField(rest) || (edition !== undefined && hasAField(edition)),
  );
export type AlbumPatch = z.input<typeof albumPatch>;

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

const artistIdList = z
  .array(z.uuid())
  .max(MAX_CREDITS)
  .refine(uniqueBy((artistId: string) => artistId));

const trackFields = {
  title: requiredText(300),
  lengthMs: nullableInteger(1, 24 * 60 * 60 * 1000),
  credit: nullableText(300),
  mbRecordingId: nullableMusicBrainzId,
};

/** A new track, optionally appended to an album's tracklist. */
export const newTrackInput = z.object({
  title: trackFields.title,
  lengthMs: emptyIfOmitted(trackFields.lengthMs),
  credit: emptyIfOmitted(trackFields.credit),
  mbRecordingId: emptyIfOmitted(trackFields.mbRecordingId),
  artistIds: artistIdList.optional().transform((artistIds) => artistIds ?? []),
  albumId: z
    .uuid()
    .nullish()
    .transform((albumId) => albumId ?? null),
});
export type NewTrackInput = z.input<typeof newTrackInput>;

export const trackPatch = z
  .object({ ...trackFields, artistIds: artistIdList })
  .partial()
  .refine(hasAField);
export type TrackPatch = z.input<typeof trackPatch>;

// ---------------------------------------------------------------------------
// Tracklists
// ---------------------------------------------------------------------------

/**
 * The complete tracklist. `tracks` is required, so an incomplete
 * representation is refused. A track that leaves out `discNumber` keeps the
 * disc it is on now (disc 1 for a track new to the album).
 */
export const tracklistInput = z.object({
  tracks: z
    .array(
      z.object({
        trackId: z.uuid(),
        discNumber: z.number().int().min(1).max(99).optional(),
      }),
    )
    .max(MAX_ALBUM_TRACKS)
    .refine(uniqueBy((track: { trackId: string }) => track.trackId)),
});
export type TracklistInput = z.input<typeof tracklistInput>;

export const catalogId = z.uuid();
export const moveDirection = z.enum(["up", "down"]);
export type MoveDirection = z.infer<typeof moveDirection>;
