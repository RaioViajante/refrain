import { z } from "zod";

// The parts of the MusicBrainz web service (WS/2, JSON) that Refrain reads,
// validated at the boundary, and the plain data the adapter returns. Verified
// against https://musicbrainz.org/doc/MusicBrainz_API and a few live
// responses on 2026-11-02 (docs/evidence/m3-2.md): `score` arrived as a
// number although the documentation shows a string, and `joinphrase` and
// `secondary-types` can be absent. Unknown keys are dropped. Strings are
// bounded, so an oversized value is refused rather than stored.

export const MAX_RESULTS = 25;
export const MAX_RELEASES = 100;

const mbid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const shortText = z.string().max(500);
const nullableText = shortText.nullish().transform((value) => value ?? null);
const optionalText = shortText.nullish().transform((value) => value ?? "");

// MusicBrainz dates are partial: "1994", "1994-08", or "1994-08-15".
const partialDate = z
  .string()
  .nullish()
  .transform((value) =>
    value && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value) ? value : null,
  );

const artistCreditItem = z.object({
  name: shortText,
  joinphrase: optionalText,
  artist: z.object({
    id: mbid,
    name: shortText,
    "sort-name": nullableText,
    disambiguation: optionalText,
    type: nullableText,
  }),
});

const artistCredit = z.array(artistCreditItem).max(50);

const score = z.union([z.number(), z.string()]).transform((value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
});

export const releaseGroupSearchResponse = z.object({
  count: z.number().int().nonnegative(),
  "release-groups": z
    .array(
      z.object({
        id: mbid,
        score: score.optional(),
        title: shortText,
        disambiguation: optionalText,
        "primary-type": nullableText,
        "secondary-types": z.array(shortText).max(20).nullish(),
        "first-release-date": partialDate,
        "artist-credit": artistCredit.nullish(),
      }),
    )
    .max(100),
});

export const releaseGroupLookupResponse = z.object({
  id: mbid,
  title: shortText,
  disambiguation: optionalText,
  "primary-type": nullableText,
  "secondary-types": z.array(shortText).max(20).nullish(),
  "first-release-date": partialDate,
  "artist-credit": artistCredit.nullish(),
});

export const artistSearchResponse = z.object({
  count: z.number().int().nonnegative(),
  artists: z
    .array(
      z.object({
        id: mbid,
        score: score.optional(),
        name: shortText,
        "sort-name": nullableText,
        type: nullableText,
        country: nullableText,
        disambiguation: optionalText,
        "life-span": z
          .object({ begin: partialDate, end: partialDate })
          .nullish(),
      }),
    )
    .max(100),
});

const labelInfo = z
  .array(
    z.object({
      label: z.object({ name: shortText }).nullish(),
    }),
  )
  .max(50)
  .nullish();

const coverArtArchiveFlags = z
  .object({ front: z.boolean().nullish(), count: z.number().nullish() })
  .nullish();

export const releaseBrowseResponse = z.object({
  "release-count": z.number().int().nonnegative(),
  releases: z
    .array(
      z.object({
        id: mbid,
        title: shortText,
        status: nullableText,
        date: partialDate,
        country: nullableText,
        disambiguation: optionalText,
        "label-info": labelInfo,
        media: z
          .array(
            z.object({
              format: nullableText,
              "track-count": z.number().int().nonnegative().nullish(),
            }),
          )
          .max(100)
          .nullish(),
        "cover-art-archive": coverArtArchiveFlags,
      }),
    )
    .max(MAX_RELEASES),
});

export const releaseLookupResponse = z.object({
  id: mbid,
  title: shortText,
  status: nullableText,
  date: partialDate,
  country: nullableText,
  disambiguation: optionalText,
  "artist-credit": artistCredit,
  "label-info": labelInfo,
  "cover-art-archive": coverArtArchiveFlags,
  "release-group": z.object({
    id: mbid,
    title: shortText,
    disambiguation: optionalText,
    "primary-type": nullableText,
    "secondary-types": z.array(shortText).max(20).nullish(),
    "first-release-date": partialDate,
  }),
  media: z
    .array(
      z.object({
        position: z.number().int().min(0).max(999),
        format: nullableText,
        title: optionalText,
        tracks: z
          .array(
            z.object({
              position: z.number().int().min(0).max(9999),
              number: optionalText,
              title: shortText,
              length: z.number().int().positive().nullish(),
              "artist-credit": artistCredit.nullish(),
              recording: z.object({
                id: mbid,
                title: shortText,
                length: z.number().int().positive().nullish(),
              }),
            }),
          )
          .max(1000)
          .nullish(),
      }),
    )
    .max(100),
});

export const artistLookupResponse = z.object({
  id: mbid,
  name: shortText,
  "sort-name": nullableText,
  type: nullableText,
  country: nullableText,
  disambiguation: optionalText,
});

// ---------------------------------------------------------------------------
// Plain data returned by the adapter
// ---------------------------------------------------------------------------

/** One credited artist, in credit order (MusicBrainz "artist credit"). */
export interface MusicBrainzCredit {
  artistId: string;
  /** The artist's own name. */
  artistName: string;
  artistSortName: string | null;
  /** "Person", "Group", ... when MusicBrainz says. */
  artistType: string | null;
  artistDisambiguation: string;
  /** The name as printed on this record, which can differ from `artistName`. */
  creditedName: string;
  /** What joins this credit to the next ("", " & ", " feat. "). */
  joinPhrase: string;
}

export interface ReleaseGroupResult {
  id: string;
  title: string;
  disambiguation: string;
  primaryType: string | null;
  secondaryTypes: string[];
  firstReleaseDate: string | null;
  credits: MusicBrainzCredit[];
  score: number;
}

export interface ArtistResult {
  id: string;
  name: string;
  sortName: string | null;
  type: string | null;
  country: string | null;
  disambiguation: string;
  begin: string | null;
  end: string | null;
  score: number;
}

export interface ReleaseSummary {
  id: string;
  title: string;
  status: string | null;
  date: string | null;
  country: string | null;
  disambiguation: string;
  labels: string[];
  formats: string[];
  trackCount: number;
  /** What MusicBrainz says about front artwork; the archive is the authority. */
  hasFrontArtwork: boolean | null;
}

export interface ReleaseTrack {
  /** Position on its medium, as MusicBrainz numbers it. */
  position: number;
  /** The printed track number ("A1", "3"). */
  number: string;
  title: string;
  lengthMs: number | null;
  recordingId: string;
  credits: MusicBrainzCredit[];
}

export interface ReleaseMedium {
  position: number;
  format: string | null;
  title: string;
  tracks: ReleaseTrack[];
}

/** A specific release (an edition) with its release group. */
export interface Release {
  id: string;
  title: string;
  status: string | null;
  date: string | null;
  country: string | null;
  disambiguation: string;
  labels: string[];
  credits: MusicBrainzCredit[];
  hasFrontArtwork: boolean | null;
  releaseGroup: {
    id: string;
    title: string;
    disambiguation: string;
    primaryType: string | null;
    secondaryTypes: string[];
    firstReleaseDate: string | null;
  };
  media: ReleaseMedium[];
}

export interface Artist {
  id: string;
  name: string;
  sortName: string | null;
  type: string | null;
  country: string | null;
  disambiguation: string;
}

export function toCredits(
  credit: z.infer<typeof artistCredit> | null | undefined,
): MusicBrainzCredit[] {
  return (credit ?? []).map((item) => ({
    artistId: item.artist.id,
    artistName: item.artist.name,
    artistSortName: item.artist["sort-name"],
    artistType: item.artist.type,
    artistDisambiguation: item.artist.disambiguation,
    creditedName: item.name,
    joinPhrase: item.joinphrase,
  }));
}

/** The credit as printed: "Simon & Garfunkel", "A feat. B". */
export function creditText(credits: readonly MusicBrainzCredit[]): string {
  return credits
    .map((credit) => `${credit.creditedName}${credit.joinPhrase}`)
    .join("")
    .trim();
}

function distinct(values: (string | null | undefined)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

export function toReleaseGroupResults(
  response: z.infer<typeof releaseGroupSearchResponse>,
): ReleaseGroupResult[] {
  return response["release-groups"].map((group) => ({
    id: group.id,
    title: group.title,
    disambiguation: group.disambiguation,
    primaryType: group["primary-type"],
    secondaryTypes: group["secondary-types"] ?? [],
    firstReleaseDate: group["first-release-date"],
    credits: toCredits(group["artist-credit"]),
    score: group.score ?? 0,
  }));
}

export function toReleaseGroup(
  group: z.infer<typeof releaseGroupLookupResponse>,
): ReleaseGroupResult {
  return {
    id: group.id,
    title: group.title,
    disambiguation: group.disambiguation,
    primaryType: group["primary-type"],
    secondaryTypes: group["secondary-types"] ?? [],
    firstReleaseDate: group["first-release-date"],
    credits: toCredits(group["artist-credit"]),
    score: 100,
  };
}

export function toArtistResults(
  response: z.infer<typeof artistSearchResponse>,
): ArtistResult[] {
  return response.artists.map((artist) => ({
    id: artist.id,
    name: artist.name,
    sortName: artist["sort-name"],
    type: artist.type,
    country: artist.country,
    disambiguation: artist.disambiguation,
    begin: artist["life-span"]?.begin ?? null,
    end: artist["life-span"]?.end ?? null,
    score: artist.score ?? 0,
  }));
}

/**
 * Editions in a stable, readable order: earliest date first (undated last),
 * then country, then identifier. MusicBrainz returns them by identifier.
 */
export function toReleaseSummaries(
  response: z.infer<typeof releaseBrowseResponse>,
): ReleaseSummary[] {
  return response.releases
    .map((release) => ({
      id: release.id,
      title: release.title,
      status: release.status,
      date: release.date,
      country: release.country,
      disambiguation: release.disambiguation,
      labels: distinct(
        (release["label-info"] ?? []).map((info) => info.label?.name),
      ),
      formats: distinct((release.media ?? []).map((medium) => medium.format)),
      trackCount: (release.media ?? []).reduce(
        (sum, medium) => sum + (medium["track-count"] ?? 0),
        0,
      ),
      hasFrontArtwork: release["cover-art-archive"]?.front ?? null,
    }))
    .sort(
      (a, b) =>
        (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
        (a.country ?? "~").localeCompare(b.country ?? "~") ||
        a.id.localeCompare(b.id),
    );
}

export function toRelease(
  response: z.infer<typeof releaseLookupResponse>,
): Release {
  const group = response["release-group"];
  return {
    id: response.id,
    title: response.title,
    status: response.status,
    date: response.date,
    country: response.country,
    disambiguation: response.disambiguation,
    labels: distinct(
      (response["label-info"] ?? []).map((info) => info.label?.name),
    ),
    credits: toCredits(response["artist-credit"]),
    hasFrontArtwork: response["cover-art-archive"]?.front ?? null,
    releaseGroup: {
      id: group.id,
      title: group.title,
      disambiguation: group.disambiguation,
      primaryType: group["primary-type"],
      secondaryTypes: group["secondary-types"] ?? [],
      firstReleaseDate: group["first-release-date"],
    },
    media: [...response.media]
      .sort((a, b) => a.position - b.position)
      .map((medium) => ({
        position: medium.position,
        format: medium.format,
        title: medium.title,
        tracks: [...(medium.tracks ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((track) => ({
            position: track.position,
            number: track.number,
            title: track.title,
            lengthMs: track.length ?? track.recording.length ?? null,
            recordingId: track.recording.id,
            credits: toCredits(track["artist-credit"]),
          })),
      })),
  };
}

export function toArtist(
  response: z.infer<typeof artistLookupResponse>,
): Artist {
  return {
    id: response.id,
    name: response.name,
    sortName: response["sort-name"],
    type: response.type,
    country: response.country,
    disambiguation: response.disambiguation,
  };
}
