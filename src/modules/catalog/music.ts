import "server-only";

import { createHash } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  databaseErrorOf,
  schema,
  SqlState,
  type ArtistKind,
  type DatabaseExecutor,
  type Transaction,
} from "@/db";
import {
  canonicalCoverUrl,
  COVER_ART_SOURCE,
  coverArtArchive,
  coverArtworkFor,
  coverArtworkOf,
  frontThumbnailFor,
  type ArtworkImage,
  type CoverArtArchiveClient,
  type CoverArtwork,
} from "@/integrations/cover-art-archive";
import {
  creditText,
  musicBrainz,
  musicBrainzId,
  searchText,
  type Artist,
  type ArtistResult,
  type MusicBrainzClient,
  type Release,
  type ReleaseGroupResult,
  type ReleaseSummary,
} from "@/integrations/musicbrainz";
import { ProviderError } from "@/integrations/provider";
import type { AuthorizedAuthor } from "@/modules/identity";
import {
  isAlbumOnPublicPage,
  lockAlbumPublicExposure,
} from "@/modules/publication";
import { cleanText, fieldErrorsOf } from "@/validation";

import { CatalogError } from "./errors";
import { MAX_ALBUM_TRACKS, MAX_CREDITS } from "./input";
import { rankAlbumResults } from "./music-ranking";

// Adding music from MusicBrainz, and album artwork from the Cover Art Archive
// (M3.2; docs/data-model.md § Transaction boundaries, boundary 1).
//
// The rules, in the order a request meets them:
//
// 1. The author picks an exact record: a release group, then one of its
//    releases (an edition), or an artist. Nothing is guessed.
// 2. The studio shows a review of exactly what would be written, with a
//    fingerprint of it (`review`, a SHA-256 of the plan; not a secret).
// 3. On approval the command fetches the record again, before any
//    transaction opens (never inside one), rebuilds the plan, and writes only
//    if its fingerprint is the one the author reviewed. Otherwise
//    `review_stale`, and nothing is written.
// 4. Existing catalog records are never changed: an artist or a recording
//    already in the catalog (by its MusicBrainz identifier) is reused as it
//    is; an album or an edition already there is refused as a duplicate.
//    Linking fills only an identifier that is still empty.
// 5. Artwork is set only to an image the archive lists as a front cover of a
//    release of the album's own release group, only if the stored artwork is
//    still what the author saw, and never while the album is on a public page
//    (ADR 0006 D5, gate G8).
//
// Provider data is untrusted: the adapters validate it, and every text is
// cleaned and checked against the catalog's own limits before it is written.

export interface MusicProviders {
  musicBrainz: MusicBrainzClient;
  coverArt: CoverArtArchiveClient;
}

export function defaultProviders(): MusicProviders {
  return { musicBrainz: musicBrainz(), coverArt: coverArtArchive() };
}

/** Runs a provider call; its failure becomes a fixed catalog failure. */
async function provided<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ProviderError) {
      throw new CatalogError(
        error.failure === "not_found"
          ? "provider_not_found"
          : "provider_unavailable",
      );
    }
    throw error;
  }
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new CatalogError("invalid_input", {
      fields: fieldErrorsOf(result.error),
    });
  }
  return result.data;
}

/** The fingerprint of a plan the author reviewed. Deterministic. */
export function reviewOf(plan: unknown): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

const reviewToken = z.string().regex(/^[0-9a-f]{64}$/);
const imageIdInput = z.string().regex(/^[1-9][0-9]{0,19}$/);

/** One line of text as the catalog stores it, or null if over `max`. */
function catalogText(value: string, max: number): string | null {
  const text = cleanText(value)
    .replace(/\s*\n\s*/g, " ")
    .trim();
  return text.length >= 1 && text.length <= max ? text : null;
}

/**
 * MusicBrainz's artist type as the catalog's kind. "Person" and "Character"
 * are people; "Group", "Orchestra", and "Choir" are groups. Anything else
 * ("Other", or no type) is added as a person, and the review says so; the
 * author can change it in the catalog.
 */
export function artistKindOf(type: string | null): {
  kind: ArtistKind;
  fromProvider: boolean;
} {
  switch (type) {
    case "Person":
    case "Character":
      return { kind: "person", fromProvider: true };
    case "Group":
    case "Orchestra":
    case "Choir":
      return { kind: "group", fromProvider: true };
    default:
      return { kind: "person", fromProvider: false };
  }
}

// ---------------------------------------------------------------------------
// The import plan: exactly what a release would add to the catalog
// ---------------------------------------------------------------------------

export interface PlannedArtist {
  mbArtistId: string;
  name: string;
  sortName: string | null;
  kind: ArtistKind;
  kindFromProvider: boolean;
}

export interface PlannedTrack {
  discNumber: number;
  position: number;
  /** As printed ("A1", "3"); shown in the review, not stored. */
  number: string;
  title: string;
  lengthMs: number | null;
  mbRecordingId: string;
  /** The track's credited artists, in order. */
  artistMbIds: string[];
  credit: string;
}

export interface ImportPlan {
  releaseGroupId: string;
  releaseId: string;
  /** The release group's title: the album is the release group. */
  title: string;
  firstReleaseYear: number | null;
  /** The release, which becomes the reference edition. */
  edition: {
    label: string | null;
    releaseDate: string | null;
    country: string | null;
  };
  /** The release's artist credit, in order. */
  credits: { mbArtistId: string; creditedAs: string | null }[];
  credit: string;
  artists: PlannedArtist[];
  tracks: PlannedTrack[];
}

export type UnsupportedReason =
  | "no_tracks"
  | "too_many_tracks"
  | "repeated_recording"
  | "no_credits"
  | "too_many_credits"
  | "text_too_long";

class Unsupported extends Error {
  constructor(readonly reason: UnsupportedReason) {
    super(reason);
  }
}

function required(value: string, max: number): string {
  const text = catalogText(value, max);
  if (text === null) {
    throw new Unsupported("text_too_long");
  }
  return text;
}

function optional(value: string | null, max: number): string | null {
  if (value === null || cleanText(value).trim() === "") {
    return null;
  }
  return required(value, max);
}

function yearOf(date: string | null): number | null {
  const year = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isInteger(year) && year >= 1800 && year <= 2100 ? year : null;
}

/** Only a complete, real date is stored; "1994" and "1994-08" are not. */
function fullDateOf(date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().startsWith(date) &&
    yearOf(date) !== null
    ? date
    : null;
}

/**
 * What importing `release` would write, or why it cannot be imported as one
 * album. Pure: the same release always gives the same plan.
 */
export function planReleaseImport(
  release: Release,
): { ok: true; plan: ImportPlan } | { ok: false; reason: UnsupportedReason } {
  try {
    return { ok: true, plan: buildPlan(release) };
  } catch (error) {
    if (error instanceof Unsupported) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}

function buildPlan(release: Release): ImportPlan {
  const artists = new Map<string, PlannedArtist>();
  const addArtist = (credit: Release["credits"][number]) => {
    if (!artists.has(credit.artistId)) {
      const { kind, fromProvider } = artistKindOf(credit.artistType);
      artists.set(credit.artistId, {
        mbArtistId: credit.artistId,
        name: required(credit.artistName, 200),
        sortName: optional(credit.artistSortName, 200),
        kind,
        kindFromProvider: fromProvider,
      });
    }
  };

  // The album's credits: each artist once, in credit order.
  const credits: ImportPlan["credits"] = [];
  for (const credit of release.credits) {
    if (credits.some((c) => c.mbArtistId === credit.artistId)) {
      continue;
    }
    addArtist(credit);
    const name = artists.get(credit.artistId)!.name;
    const credited = required(credit.creditedName, 200);
    credits.push({
      mbArtistId: credit.artistId,
      creditedAs: credited === name ? null : credited,
    });
  }
  if (credits.length === 0) {
    throw new Unsupported("no_credits");
  }
  if (credits.length > MAX_CREDITS) {
    throw new Unsupported("too_many_credits");
  }

  const tracks: PlannedTrack[] = [];
  const recordings = new Set<string>();
  release.media.forEach((medium, mediumIndex) => {
    const discNumber =
      medium.position >= 1 && medium.position <= 99
        ? medium.position
        : mediumIndex + 1;
    if (discNumber > 99) {
      throw new Unsupported("too_many_tracks");
    }
    medium.tracks.forEach((track, trackIndex) => {
      if (recordings.has(track.recordingId)) {
        // The catalog holds a recording once per album (album_tracks).
        throw new Unsupported("repeated_recording");
      }
      recordings.add(track.recordingId);
      const artistMbIds: string[] = [];
      for (const credit of track.credits) {
        if (!artistMbIds.includes(credit.artistId)) {
          addArtist(credit);
          artistMbIds.push(credit.artistId);
        }
      }
      if (artistMbIds.length > MAX_CREDITS) {
        throw new Unsupported("too_many_credits");
      }
      tracks.push({
        discNumber,
        // Renumbered from 1 on each disc, in MusicBrainz's order.
        position: trackIndex + 1,
        number: catalogText(track.number, 20) ?? String(trackIndex + 1),
        title: required(track.title, 300),
        lengthMs:
          track.lengthMs !== null && track.lengthMs <= 24 * 60 * 60 * 1000
            ? track.lengthMs
            : null,
        mbRecordingId: track.recordingId,
        artistMbIds,
        credit: creditText(track.credits),
      });
    });
  });
  if (tracks.length === 0) {
    throw new Unsupported("no_tracks");
  }
  if (tracks.length > MAX_ALBUM_TRACKS) {
    throw new Unsupported("too_many_tracks");
  }

  const country =
    release.country && /^[A-Z]{2}$/.test(release.country)
      ? release.country
      : null;
  return {
    releaseGroupId: release.releaseGroup.id,
    releaseId: release.id,
    title: required(release.releaseGroup.title, 300),
    firstReleaseYear: yearOf(release.releaseGroup.firstReleaseDate),
    edition: {
      label: release.labels[0] ? optional(release.labels[0], 200) : null,
      releaseDate: fullDateOf(release.date),
      country,
    },
    credits,
    credit: creditText(release.credits),
    artists: [...artists.values()],
    tracks,
  };
}

/** What linking to a release asserts: its identity, title, and credit. */
export function linkPlanOf(release: Release) {
  return {
    releaseGroupId: release.releaseGroup.id,
    releaseId: release.id,
    title: release.releaseGroup.title,
    credit: creditText(release.credits),
  };
}

export function artistPlanOf(artist: Artist) {
  const { kind, fromProvider } = artistKindOf(artist.type);
  return {
    mbArtistId: artist.id,
    name: catalogText(artist.name, 200),
    sortName: artist.sortName ? catalogText(artist.sortName, 200) : null,
    kind,
    kindFromProvider: fromProvider,
  };
}

function isFront(image: ArtworkImage): boolean {
  return image.front || image.types.includes("Front");
}

export interface ArtworkChoice {
  releaseId: string;
  imageId: string;
  artwork: CoverArtwork;
  types: string[];
  approved: boolean;
}

function choicesOf(images: ArtworkImage[]): ArtworkChoice[] {
  return images.filter(isFront).flatMap((image) => {
    const artwork = coverArtworkFor(image);
    return artwork
      ? [
          {
            releaseId: image.releaseId,
            imageId: image.imageId,
            artwork,
            types: image.types,
            approved: image.approved,
          },
        ]
      : [];
  });
}

// ---------------------------------------------------------------------------
// Reading the catalog for the review
// ---------------------------------------------------------------------------

/** `ILIKE` text that matches `words` literally. */
function containing(words: string): string {
  return `%${words.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export interface LocalAlbumMatch {
  id: string;
  title: string;
  credit: string;
  firstReleaseYear: number | null;
  label: string | null;
  mbReleaseGroupId: string | null;
}

async function localAlbums(
  db: DatabaseExecutor,
  where: ReturnType<typeof sql>,
  limit: number,
): Promise<LocalAlbumMatch[]> {
  const result = await db.execute<{
    id: string;
    title: string;
    credit: string;
    first_release_year: number | null;
    label: string | null;
    mb_release_group_id: string | null;
  }>(sql`
    select a.id, a.title, a.first_release_year, a.mb_release_group_id,
           ed.label,
           coalesce((select string_agg(coalesce(aa.credited_as, ar.name), ', '
                                       order by aa.position)
                       from album_artists aa
                       join artists ar on ar.id = aa.artist_id
                      where aa.album_id = a.id), '') as credit
      from albums a
      left join album_editions ed on ed.album_id = a.id and ed.is_reference
     where a.archived_at is null and ${where}
     order by a.title, a.id
     limit ${limit}`);
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    credit: row.credit,
    firstReleaseYear: row.first_release_year,
    label: row.label,
    mbReleaseGroupId: row.mb_release_group_id,
  }));
}

export interface LocalArtistMatch {
  id: string;
  name: string;
  kind: ArtistKind;
  mbArtistId: string | null;
  archived: boolean;
}

async function localArtists(
  db: DatabaseExecutor,
  where: ReturnType<typeof sql>,
  limit: number,
): Promise<LocalArtistMatch[]> {
  const result = await db.execute<{
    id: string;
    name: string;
    kind: ArtistKind;
    mb_artist_id: string | null;
    archived: boolean;
  }>(sql`
    select id, name, kind, mb_artist_id, archived_at is not null as archived
      from artists
     where ${where}
     order by name, id
     limit ${limit}`);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    mbArtistId: row.mb_artist_id,
    archived: row.archived,
  }));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const musicSearchKinds = ["albums", "artists"] as const;
export type MusicSearchKind = (typeof musicSearchKinds)[number];

export type MusicSearch =
  | {
      kind: "albums";
      local: LocalAlbumMatch[];
      results: (ReleaseGroupResult & {
        credit: string;
        catalogAlbumId: string | null;
      })[];
    }
  | {
      kind: "artists";
      local: LocalArtistMatch[];
      results: (ArtistResult & { catalogArtistId: string | null })[];
    };

const musicSearchInput = z.object({
  kind: z.enum(musicSearchKinds),
  query: searchText,
});

/**
 * Searches MusicBrainz, and the catalog for what is already there. Only the
 * words typed are sent to MusicBrainz.
 */
export async function searchMusic(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
  providers: MusicProviders = defaultProviders(),
): Promise<MusicSearch> {
  const { kind, query } = parse(musicSearchInput, input);
  const like = containing(query);
  if (kind === "albums") {
    const results = await provided(() =>
      providers.musicBrainz.searchReleaseGroups(query),
    );
    // Every word must be in the title or a credited artist, in any order, so
    // "grace jeff buckley" finds Grace by Jeff Buckley.
    const words = query.split(/\s+/).filter(Boolean);
    const local = await localAlbums(
      db,
      sql.join(
        words.map((word) => {
          const wordLike = containing(word);
          return sql`(a.title ilike ${wordLike} or exists (
            select 1 from album_artists aa
              join artists ar on ar.id = aa.artist_id
             where aa.album_id = a.id
               and (ar.name ilike ${wordLike} or aa.credited_as ilike ${wordLike})))`;
        }),
        sql` and `,
      ),
      5,
    );
    const ids = results.map((result) => result.id);
    const known =
      ids.length === 0
        ? []
        : await db
            .select({
              id: schema.albums.id,
              mbReleaseGroupId: schema.albums.mbReleaseGroupId,
            })
            .from(schema.albums)
            .where(inArray(schema.albums.mbReleaseGroupId, ids));
    const byGroup = new Map(known.map((row) => [row.mbReleaseGroupId, row.id]));
    return {
      kind,
      local,
      results: rankAlbumResults(
        query,
        results.map((result) => ({
          ...result,
          credit: creditText(result.credits),
          catalogAlbumId: byGroup.get(result.id) ?? null,
        })),
      ),
    };
  }
  const results = await provided(() =>
    providers.musicBrainz.searchArtists(query),
  );
  const local = await localArtists(
    db,
    sql`archived_at is null and name ilike ${like}`,
    5,
  );
  const ids = results.map((result) => result.id);
  const known =
    ids.length === 0
      ? []
      : await db
          .select({
            id: schema.artists.id,
            mbArtistId: schema.artists.mbArtistId,
          })
          .from(schema.artists)
          .where(inArray(schema.artists.mbArtistId, ids));
  const byArtist = new Map(known.map((row) => [row.mbArtistId, row.id]));
  return {
    kind,
    local,
    results: results.map((result) => ({
      ...result,
      catalogArtistId: byArtist.get(result.id) ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// A release group's editions
// ---------------------------------------------------------------------------

export interface MusicEditions {
  group: ReleaseGroupResult & { credit: string };
  releases: (ReleaseSummary & {
    catalogAlbumId: string | null;
    /** A preview of the front cover; null when none is listed. */
    artwork: { src: string; srcSet: string } | null;
  })[];
  /** How many editions MusicBrainz has; at most 100 are listed. */
  total: number;
  /** The album that already has this release group, if any. */
  catalogAlbum: { id: string; title: string } | null;
}

export async function listMusicEditions(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  releaseGroupId: unknown,
  providers: MusicProviders = defaultProviders(),
): Promise<MusicEditions> {
  const id = parse(musicBrainzId, releaseGroupId);
  const group = await provided(() => providers.musicBrainz.getReleaseGroup(id));
  const { releases, total } = await provided(() =>
    providers.musicBrainz.listReleases(group.id),
  );
  const [album] = await db
    .select({ id: schema.albums.id, title: schema.albums.title })
    .from(schema.albums)
    .where(eq(schema.albums.mbReleaseGroupId, group.id));
  const ids = releases.map((release) => release.id);
  const editions =
    ids.length === 0
      ? []
      : await db
          .select({
            albumId: schema.albumEditions.albumId,
            mbReleaseId: schema.albumEditions.mbReleaseId,
          })
          .from(schema.albumEditions)
          .where(inArray(schema.albumEditions.mbReleaseId, ids));
  const byRelease = new Map(
    editions.map((row) => [row.mbReleaseId, row.albumId]),
  );
  return {
    group: { ...group, credit: creditText(group.credits) },
    releases: releases.map((release) => ({
      ...release,
      catalogAlbumId: byRelease.get(release.id) ?? null,
      // Only an edition MusicBrainz says has a front cover asks for one.
      artwork:
        release.hasFrontArtwork === true ? frontThumbnailFor(release.id) : null,
    })),
    total,
    catalogAlbum: album ?? null,
  };
}

// ---------------------------------------------------------------------------
// The review of one release
// ---------------------------------------------------------------------------

export interface ReleaseReview {
  release: Release & { credit: string };
  /** What importing would write, or null when it cannot be imported. */
  plan: ImportPlan | null;
  unsupported: UnsupportedReason | null;
  /** The fingerprint to approve the import with. */
  review: string | null;
  /** The fingerprint to approve a link with. */
  linkReview: string;
  /** An album already in the catalog with this release group. */
  existingAlbum: { id: string; title: string } | null;
  /** An album whose edition is already this release. */
  existingEdition: { albumId: string; title: string } | null;
  /** Each artist the import would credit, new or already in the catalog. */
  artists: (PlannedArtist & {
    existing: { id: string; name: string; archived: boolean } | null;
  })[];
  /** Recordings already in the catalog (by MusicBrainz id), kept as they are. */
  existingTracks: Record<
    string,
    { id: string; title: string; archived: boolean }
  >;
  /** Albums with the same title and no MusicBrainz identity: link instead? */
  sameTitle: LocalAlbumMatch[];
  /** Front covers the author may choose; none is chosen by default. */
  artwork: ArtworkChoice[];
  artworkUnavailable: boolean;
}

export async function reviewMusicRelease(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  releaseId: unknown,
  providers: MusicProviders = defaultProviders(),
): Promise<ReleaseReview> {
  const id = parse(musicBrainzId, releaseId);
  const release = await provided(() => providers.musicBrainz.getRelease(id));
  const planned = planReleaseImport(release);
  const plan = planned.ok ? planned.plan : null;

  let artwork: ArtworkChoice[] = [];
  let artworkUnavailable = false;
  if (release.hasFrontArtwork !== false) {
    try {
      artwork = choicesOf(
        await providers.coverArt.listReleaseImages(release.id),
      );
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        throw error;
      }
      artworkUnavailable = true;
    }
  }

  const [album] = await db
    .select({ id: schema.albums.id, title: schema.albums.title })
    .from(schema.albums)
    .where(eq(schema.albums.mbReleaseGroupId, release.releaseGroup.id));
  const [edition] = await db
    .select({
      albumId: schema.albumEditions.albumId,
      title: schema.albums.title,
    })
    .from(schema.albumEditions)
    .innerJoin(
      schema.albums,
      eq(schema.albums.id, schema.albumEditions.albumId),
    )
    .where(eq(schema.albumEditions.mbReleaseId, release.id));

  const plannedArtists = plan?.artists ?? [];
  const known =
    plannedArtists.length === 0
      ? []
      : await localArtists(
          db,
          sql`mb_artist_id in (${sql.join(
            plannedArtists.map((artist) => sql`${artist.mbArtistId}`),
            sql`, `,
          )})`,
          plannedArtists.length,
        );
  const recordingIds = (plan?.tracks ?? []).map((track) => track.mbRecordingId);
  const tracks =
    recordingIds.length === 0
      ? []
      : await db
          .select({
            id: schema.tracks.id,
            title: schema.tracks.title,
            mbRecordingId: schema.tracks.mbRecordingId,
            archivedAt: schema.tracks.archivedAt,
          })
          .from(schema.tracks)
          .where(inArray(schema.tracks.mbRecordingId, recordingIds));

  const title = release.releaseGroup.title;
  const sameTitle = await localAlbums(
    db,
    sql`a.mb_release_group_id is null and lower(a.title) = lower(${title})`,
    10,
  );

  return {
    release: { ...release, credit: creditText(release.credits) },
    plan,
    unsupported: planned.ok ? null : planned.reason,
    review: plan ? reviewOf(plan) : null,
    linkReview: reviewOf(linkPlanOf(release)),
    existingAlbum: album ?? null,
    existingEdition: edition ?? null,
    artists: plannedArtists.map((artist) => {
      const found = known.find((row) => row.mbArtistId === artist.mbArtistId);
      return {
        ...artist,
        existing: found
          ? { id: found.id, name: found.name, archived: found.archived }
          : null,
      };
    }),
    existingTracks: Object.fromEntries(
      tracks.map((track) => [
        track.mbRecordingId!,
        {
          id: track.id,
          title: track.title,
          archived: track.archivedAt !== null,
        },
      ]),
    ),
    sameTitle,
    artwork,
    artworkUnavailable,
  };
}

// ---------------------------------------------------------------------------
// Import (boundary 1)
// ---------------------------------------------------------------------------

const importInput = z.object({
  releaseId: musicBrainzId,
  review: reviewToken,
  coverImageId: imageIdInput.nullish().transform((value) => value ?? null),
});

function translate(error: unknown): unknown {
  if (error instanceof CatalogError) {
    return error;
  }
  const failure = databaseErrorOf(error);
  if (failure?.code === SqlState.uniqueViolation) {
    // Another request added the same identity meanwhile.
    return new CatalogError("duplicate_identifier");
  }
  if (failure?.code === SqlState.checkViolation) {
    return new CatalogError("unsupported_release");
  }
  return error;
}

async function guarded<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    throw translate(error);
  }
}

/**
 * Adds a reviewed release to the catalog as a new album: the album (the
 * release group), its reference edition (the release), its credits, its
 * tracks, and the tracklist, in one transaction. Artists and recordings
 * already in the catalog are reused unchanged; an archived one is refused.
 * The cover is set only if the author chose one of the release's front
 * images. Nothing is published.
 */
export async function importMusicRelease(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
  providers: MusicProviders = defaultProviders(),
): Promise<{ id: string }> {
  const { releaseId, review, coverImageId } = parse(importInput, input);

  // Every external call happens before the transaction (docs/data-model.md).
  const release = await provided(() =>
    providers.musicBrainz.getRelease(releaseId, { fresh: true }),
  );
  const planned = planReleaseImport(release);
  if (!planned.ok) {
    throw new CatalogError("unsupported_release");
  }
  const plan = planned.plan;
  if (reviewOf(plan) !== review) {
    throw new CatalogError("review_stale");
  }
  let coverUrl: string | null = null;
  if (coverImageId !== null) {
    const images = await provided(() =>
      providers.coverArt.listReleaseImages(plan.releaseId, { fresh: true }),
    );
    const chosen = images.find(
      (image) => image.imageId === coverImageId && isFront(image),
    );
    coverUrl = chosen ? canonicalCoverUrl(chosen) : null;
    if (!coverUrl) {
      throw new CatalogError("review_stale");
    }
  }

  return guarded(() =>
    db.transaction(async (tx) => {
      const [album] = await tx
        .select({ id: schema.albums.id })
        .from(schema.albums)
        .where(eq(schema.albums.mbReleaseGroupId, plan.releaseGroupId));
      const [edition] = await tx
        .select({ id: schema.albumEditions.id })
        .from(schema.albumEditions)
        .where(eq(schema.albumEditions.mbReleaseId, plan.releaseId));
      if (album || edition) {
        throw new CatalogError("duplicate_identifier");
      }

      const artistIds = await resolveArtists(tx, plan.artists);

      const [created] = await tx
        .insert(schema.albums)
        .values({
          title: plan.title,
          firstReleaseYear: plan.firstReleaseYear,
          mbReleaseGroupId: plan.releaseGroupId,
          coverUrl,
          coverSource: coverUrl ? COVER_ART_SOURCE : null,
        })
        .returning({ id: schema.albums.id });
      const albumId = created!.id;
      const [createdEdition] = await tx
        .insert(schema.albumEditions)
        .values({
          albumId,
          isReference: true,
          label: plan.edition.label,
          releaseDate: plan.edition.releaseDate,
          country: plan.edition.country,
          mbReleaseId: plan.releaseId,
        })
        .returning({ id: schema.albumEditions.id });
      await tx.insert(schema.albumArtists).values(
        plan.credits.map((credit, index) => ({
          albumId,
          artistId: artistIds.get(credit.mbArtistId)!,
          position: index + 1,
          creditedAs: credit.creditedAs,
        })),
      );

      const trackIds = await resolveTracks(tx, plan.tracks, artistIds);
      await tx.insert(schema.albumTracks).values(
        plan.tracks.map((track) => ({
          albumId,
          trackId: trackIds.get(track.mbRecordingId)!,
        })),
      );
      await tx.insert(schema.editionTracks).values(
        plan.tracks.map((track) => ({
          editionId: createdEdition!.id,
          albumId,
          trackId: trackIds.get(track.mbRecordingId)!,
          discNumber: track.discNumber,
          position: track.position,
        })),
      );
      return { id: albumId };
    }),
  );
}

/** Reuses each artist already in the catalog, unchanged; adds the rest. */
async function resolveArtists(
  tx: Transaction,
  artists: PlannedArtist[],
): Promise<Map<string, string>> {
  const existing = await tx
    .select({
      id: schema.artists.id,
      mbArtistId: schema.artists.mbArtistId,
      archivedAt: schema.artists.archivedAt,
    })
    .from(schema.artists)
    .where(
      inArray(
        schema.artists.mbArtistId,
        artists.map((artist) => artist.mbArtistId),
      ),
    );
  if (existing.some((artist) => artist.archivedAt !== null)) {
    throw new CatalogError("archived_reference");
  }
  const ids = new Map(existing.map((row) => [row.mbArtistId!, row.id]));
  const missing = artists.filter((artist) => !ids.has(artist.mbArtistId));
  if (missing.length > 0) {
    const inserted = await tx
      .insert(schema.artists)
      .values(
        missing.map((artist) => ({
          name: artist.name,
          sortName: artist.sortName,
          kind: artist.kind,
          mbArtistId: artist.mbArtistId,
        })),
      )
      .returning({
        id: schema.artists.id,
        mbArtistId: schema.artists.mbArtistId,
      });
    for (const row of inserted) {
      ids.set(row.mbArtistId!, row.id);
    }
  }
  return ids;
}

/** Reuses each recording already in the catalog, unchanged; adds the rest. */
async function resolveTracks(
  tx: Transaction,
  tracks: PlannedTrack[],
  artistIds: Map<string, string>,
): Promise<Map<string, string>> {
  const existing = await tx
    .select({
      id: schema.tracks.id,
      mbRecordingId: schema.tracks.mbRecordingId,
      archivedAt: schema.tracks.archivedAt,
    })
    .from(schema.tracks)
    .where(
      inArray(
        schema.tracks.mbRecordingId,
        tracks.map((track) => track.mbRecordingId),
      ),
    );
  if (existing.some((track) => track.archivedAt !== null)) {
    throw new CatalogError("archived_reference");
  }
  const ids = new Map(existing.map((row) => [row.mbRecordingId!, row.id]));
  for (const track of tracks) {
    if (ids.has(track.mbRecordingId)) {
      continue;
    }
    const [inserted] = await tx
      .insert(schema.tracks)
      .values({
        title: track.title,
        lengthMs: track.lengthMs,
        mbRecordingId: track.mbRecordingId,
      })
      .returning({ id: schema.tracks.id });
    ids.set(track.mbRecordingId, inserted!.id);
    if (track.artistMbIds.length > 0) {
      await tx.insert(schema.trackArtists).values(
        track.artistMbIds.map((mbArtistId, index) => ({
          trackId: inserted!.id,
          artistId: artistIds.get(mbArtistId)!,
          position: index + 1,
        })),
      );
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Linking an album that is already in the catalog
// ---------------------------------------------------------------------------

const linkAlbumInput = z.object({
  albumId: z.uuid(),
  releaseId: musicBrainzId,
  review: reviewToken,
});

/**
 * Records that a catalog album is a MusicBrainz release group, and its
 * reference edition that release. Only identifiers that are still empty are
 * filled; a different identity already there is refused (`already_linked`).
 * The album's title, credits, tracklist, edition details, and artwork are not
 * touched, and nothing a page shows changes.
 */
export async function linkAlbumToMusic(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
  providers: MusicProviders = defaultProviders(),
): Promise<void> {
  const { albumId, releaseId, review } = parse(linkAlbumInput, input);
  const release = await provided(() =>
    providers.musicBrainz.getRelease(releaseId, { fresh: true }),
  );
  const link = linkPlanOf(release);
  if (reviewOf(link) !== review) {
    throw new CatalogError("review_stale");
  }
  await guarded(() =>
    db.transaction(async (tx) => {
      const locked = await tx.execute<{
        archived: boolean;
        mb_release_group_id: string | null;
      }>(sql`
        select archived_at is not null as archived, mb_release_group_id
          from albums where id = ${albumId} for update`);
      const album = locked.rows[0];
      if (!album) {
        throw new CatalogError("not_found");
      }
      if (album.archived) {
        throw new CatalogError("archived_reference");
      }
      if (
        album.mb_release_group_id !== null &&
        album.mb_release_group_id !== link.releaseGroupId
      ) {
        throw new CatalogError("already_linked");
      }
      const [edition] = await tx
        .select({
          id: schema.albumEditions.id,
          mbReleaseId: schema.albumEditions.mbReleaseId,
        })
        .from(schema.albumEditions)
        .where(
          and(
            eq(schema.albumEditions.albumId, albumId),
            eq(schema.albumEditions.isReference, true),
          ),
        );
      if (edition?.mbReleaseId && edition.mbReleaseId !== link.releaseId) {
        throw new CatalogError("already_linked");
      }
      if (album.mb_release_group_id === null) {
        await tx
          .update(schema.albums)
          .set({ mbReleaseGroupId: link.releaseGroupId })
          .where(
            and(
              eq(schema.albums.id, albumId),
              isNull(schema.albums.mbReleaseGroupId),
            ),
          );
      }
      if (!edition) {
        await tx.insert(schema.albumEditions).values({
          albumId,
          isReference: true,
          mbReleaseId: link.releaseId,
        });
      } else if (edition.mbReleaseId === null) {
        await tx
          .update(schema.albumEditions)
          .set({ mbReleaseId: link.releaseId })
          .where(
            and(
              eq(schema.albumEditions.id, edition.id),
              isNull(schema.albumEditions.mbReleaseId),
            ),
          );
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

export interface ArtistReview {
  artist: Artist;
  plan: ReturnType<typeof artistPlanOf>;
  /** Null when a name is over the catalog's limit. */
  review: string | null;
  existing: LocalArtistMatch | null;
  /** Artists with the same name and no MusicBrainz identity: link instead? */
  sameName: LocalArtistMatch[];
}

export async function reviewMusicArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  mbArtistId: unknown,
  providers: MusicProviders = defaultProviders(),
): Promise<ArtistReview> {
  const id = parse(musicBrainzId, mbArtistId);
  const artist = await provided(() => providers.musicBrainz.getArtist(id));
  const plan = artistPlanOf(artist);
  const [existing] = await localArtists(
    db,
    sql`mb_artist_id = ${artist.id}`,
    1,
  );
  const sameName = await localArtists(
    db,
    sql`archived_at is null and mb_artist_id is null and lower(name) = lower(${artist.name})`,
    10,
  );
  return {
    artist,
    plan,
    review: plan.name === null ? null : reviewOf(plan),
    existing: existing ?? null,
    sameName,
  };
}

const importArtistInput = z.object({
  mbArtistId: musicBrainzId,
  review: reviewToken,
});

/** Adds a reviewed MusicBrainz artist to the catalog. */
export async function importMusicArtist(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
  providers: MusicProviders = defaultProviders(),
): Promise<{ id: string }> {
  const { mbArtistId, review } = parse(importArtistInput, input);
  const artist = await provided(() =>
    providers.musicBrainz.getArtist(mbArtistId, { fresh: true }),
  );
  const plan = artistPlanOf(artist);
  if (plan.name === null) {
    throw new CatalogError("unsupported_release");
  }
  if (reviewOf(plan) !== review) {
    throw new CatalogError("review_stale");
  }
  return guarded(async () => {
    const [created] = await db
      .insert(schema.artists)
      .values({
        name: plan.name!,
        sortName: plan.sortName,
        kind: plan.kind,
        mbArtistId: plan.mbArtistId,
      })
      .returning({ id: schema.artists.id });
    return { id: created!.id };
  });
}

const linkArtistInput = z.object({
  artistId: z.uuid(),
  mbArtistId: musicBrainzId,
  review: reviewToken,
});

/**
 * Records that a catalog artist is this MusicBrainz artist. Only an empty
 * identifier is filled; the name, sort name, and kind are not touched.
 */
export async function linkArtistToMusic(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
  providers: MusicProviders = defaultProviders(),
): Promise<void> {
  const { artistId, mbArtistId, review } = parse(linkArtistInput, input);
  const artist = await provided(() =>
    providers.musicBrainz.getArtist(mbArtistId, { fresh: true }),
  );
  if (reviewOf(artistPlanOf(artist)) !== review) {
    throw new CatalogError("review_stale");
  }
  await guarded(() =>
    db.transaction(async (tx) => {
      const locked = await tx.execute<{
        archived: boolean;
        mb_artist_id: string | null;
      }>(sql`
        select archived_at is not null as archived, mb_artist_id
          from artists where id = ${artistId} for update`);
      const row = locked.rows[0];
      if (!row) {
        throw new CatalogError("not_found");
      }
      if (row.archived) {
        throw new CatalogError("archived_reference");
      }
      if (row.mb_artist_id !== null) {
        if (row.mb_artist_id !== artist.id) {
          throw new CatalogError("already_linked");
        }
        return;
      }
      await tx
        .update(schema.artists)
        .set({ mbArtistId: artist.id })
        .where(
          and(
            eq(schema.artists.id, artistId),
            isNull(schema.artists.mbArtistId),
          ),
        );
    }),
  );
}

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------

interface AlbumIdentity {
  title: string;
  archived: boolean;
  mbReleaseGroupId: string | null;
  mbReleaseId: string | null;
  coverUrl: string | null;
  coverSource: string | null;
}

async function albumIdentity(
  db: DatabaseExecutor,
  albumId: string,
  lock: boolean,
): Promise<AlbumIdentity | null> {
  const result = await db.execute<{
    title: string;
    archived: boolean;
    mb_release_group_id: string | null;
    mb_release_id: string | null;
    cover_url: string | null;
    cover_source: string | null;
  }>(sql`
    select a.title, a.archived_at is not null as archived,
           a.mb_release_group_id, a.cover_url, a.cover_source,
           (select ed.mb_release_id from album_editions ed
             where ed.album_id = a.id and ed.is_reference) as mb_release_id
      from albums a
     where a.id = ${albumId}
     ${lock ? sql`for no key update of a` : sql``}`);
  const row = result.rows[0];
  return row
    ? {
        title: row.title,
        archived: row.archived,
        mbReleaseGroupId: row.mb_release_group_id,
        mbReleaseId: row.mb_release_id,
        coverUrl: row.cover_url,
        coverSource: row.cover_source,
      }
    : null;
}

export interface AlbumArtworkChoices {
  title: string;
  archived: boolean;
  linked: boolean;
  /** The artwork shown now, if any. */
  current: CoverArtwork | null;
  /** The stored value, to send back as `expectedCoverUrl`. */
  currentCoverUrl: string | null;
  /** True: artwork changes are refused (gate G8). */
  onPublicPage: boolean;
  /** Where the choices come from. */
  source: "release" | "release_group" | null;
  choices: ArtworkChoice[];
  unavailable: boolean;
}

export async function listAlbumArtworkChoices(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  albumId: unknown,
  providers: MusicProviders = defaultProviders(),
): Promise<AlbumArtworkChoices | null> {
  const parsed = z.uuid().safeParse(albumId);
  if (!parsed.success) {
    return null;
  }
  const album = await albumIdentity(db, parsed.data, false);
  if (!album) {
    return null;
  }
  const onPublicPage = await isAlbumOnPublicPage(db, parsed.data);
  const base = {
    title: album.title,
    archived: album.archived,
    linked: album.mbReleaseGroupId !== null || album.mbReleaseId !== null,
    current: coverArtworkOf(album.coverUrl, album.coverSource),
    currentCoverUrl: album.coverUrl,
    onPublicPage,
  };
  const source = album.mbReleaseId
    ? ("release" as const)
    : album.mbReleaseGroupId
      ? ("release_group" as const)
      : null;
  if (!source || album.archived) {
    return { ...base, source, choices: [], unavailable: false };
  }
  try {
    const images =
      source === "release"
        ? await providers.coverArt.listReleaseImages(album.mbReleaseId!)
        : await providers.coverArt.listReleaseGroupImages(
            album.mbReleaseGroupId!,
          );
    return { ...base, source, choices: choicesOf(images), unavailable: false };
  } catch (error) {
    if (!(error instanceof ProviderError)) {
      throw error;
    }
    return { ...base, source, choices: [], unavailable: true };
  }
}

const expectedCover = z.string().max(500).nullable();

const setArtworkInput = z.object({
  albumId: z.uuid(),
  releaseId: musicBrainzId,
  imageId: imageIdInput,
  expectedCoverUrl: expectedCover,
});

/**
 * Sets an album's artwork to one front image of a release of the album's own
 * release group (or its reference edition's release). Refused if the album's
 * identity or artwork changed since the author looked (`review_stale`), and
 * while the album is on a public page (`public_page`, gate G8).
 */
export async function setAlbumArtwork(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
  providers: MusicProviders = defaultProviders(),
): Promise<void> {
  const { albumId, releaseId, imageId, expectedCoverUrl } = parse(
    setArtworkInput,
    input,
  );
  const before = await albumIdentity(db, albumId, false);
  if (!before) {
    throw new CatalogError("not_found");
  }
  if (!before.mbReleaseGroupId && !before.mbReleaseId) {
    throw new CatalogError("not_linked");
  }
  // The release must be the album's own edition, or of its release group.
  if (releaseId !== before.mbReleaseId) {
    const release = await provided(() =>
      providers.musicBrainz.getRelease(releaseId, { fresh: true }),
    );
    if (
      !before.mbReleaseGroupId ||
      release.releaseGroup.id !== before.mbReleaseGroupId
    ) {
      throw new CatalogError("review_stale");
    }
  }
  const images = await provided(() =>
    providers.coverArt.listReleaseImages(releaseId, { fresh: true }),
  );
  const chosen = images.find(
    (image) => image.imageId === imageId && isFront(image),
  );
  const coverUrl = chosen ? canonicalCoverUrl(chosen) : null;
  if (!coverUrl) {
    throw new CatalogError("review_stale");
  }

  await guarded(() =>
    db.transaction(async (tx) => {
      // The entries first, then the album (ADR 0006 § 7, L3: catalog locks
      // come after the entry lock): every journal entry about the album is
      // locked FOR SHARE and the predicate decides, so a publish waits for
      // this change, or this change sees the publish.
      if (await lockAlbumPublicExposure(tx, albumId)) {
        throw new CatalogError("public_page");
      }
      const album = await albumIdentity(tx, albumId, true);
      if (!album) {
        throw new CatalogError("not_found");
      }
      if (album.archived) {
        throw new CatalogError("archived_reference");
      }
      if (
        album.mbReleaseGroupId !== before.mbReleaseGroupId ||
        album.mbReleaseId !== before.mbReleaseId ||
        album.coverUrl !== expectedCoverUrl
      ) {
        throw new CatalogError("review_stale");
      }
      if (
        album.coverUrl === coverUrl &&
        album.coverSource === COVER_ART_SOURCE
      ) {
        return;
      }
      await tx
        .update(schema.albums)
        .set({ coverUrl, coverSource: COVER_ART_SOURCE })
        .where(eq(schema.albums.id, albumId));
    }),
  );
}

const removeArtworkInput = z.object({
  albumId: z.uuid(),
  expectedCoverUrl: expectedCover,
});

/** Removes an album's artwork, under the same conditions. */
export async function removeAlbumArtwork(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<void> {
  const { albumId, expectedCoverUrl } = parse(removeArtworkInput, input);
  await guarded(() =>
    db.transaction(async (tx) => {
      // The entries first, then the album (ADR 0006 § 7, L3: catalog locks
      // come after the entry lock): every journal entry about the album is
      // locked FOR SHARE and the predicate decides, so a publish waits for
      // this change, or this change sees the publish.
      if (await lockAlbumPublicExposure(tx, albumId)) {
        throw new CatalogError("public_page");
      }
      const album = await albumIdentity(tx, albumId, true);
      if (!album) {
        throw new CatalogError("not_found");
      }
      if (album.archived) {
        throw new CatalogError("archived_reference");
      }
      if (album.coverUrl !== expectedCoverUrl) {
        throw new CatalogError("review_stale");
      }
      if (album.coverUrl === null && album.coverSource === null) {
        return;
      }
      await tx
        .update(schema.albums)
        .set({ coverUrl: null, coverSource: null })
        .where(eq(schema.albums.id, albumId));
    }),
  );
}
