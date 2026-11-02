import "server-only";

import { z } from "zod";

import {
  createLimiter,
  ProviderError,
  requestJson,
  resolveBaseUrl,
  systemRuntime,
  TtlCache,
  type ProviderRuntime,
} from "@/integrations/provider";
import { cleanText } from "@/validation";

import {
  artistLookupResponse,
  artistSearchResponse,
  MAX_RELEASES,
  MAX_RESULTS,
  releaseBrowseResponse,
  releaseGroupLookupResponse,
  releaseGroupSearchResponse,
  releaseLookupResponse,
  toArtist,
  toArtistResults,
  toRelease,
  toReleaseGroup,
  toReleaseGroupResults,
  toReleaseSummaries,
  type Artist,
  type ArtistResult,
  type Release,
  type ReleaseGroupResult,
  type ReleaseSummary,
} from "./contract";

// The MusicBrainz adapter. Server-only; it returns plain, validated data and
// never writes anything (docs/architecture.md § Integrations). The Catalog
// module decides what to persist, after the call, in its own transaction.
//
// - Identification: every request sends `Refrain/<version> ( <contact> )`, the
//   format MusicBrainz asks for.
// - Rate: one request per 1.1 s for the whole process, below the documented
//   one call per second.
// - Time: 8 s per attempt, 20 s in all, at most two retries, and only after a
//   503 (MusicBrainz's throttling answer), 429, 502, 504, or a network error.
// - Cache: successful, validated responses only, in memory, bounded: searches
//   for 10 minutes, lookups for an hour. Failures are never cached.

/** Kept equal to package.json's version by a unit test. */
export const APPLICATION_VERSION = "0.1.0";
export const APPLICATION_CONTACT = "https://github.com/RaioViajante/refrain";
export const USER_AGENT = `Refrain/${APPLICATION_VERSION} ( ${APPLICATION_CONTACT} )`;

export const MUSICBRAINZ_BASE_URL = "https://musicbrainz.org/ws/2/";
export const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 8_000;
const DEADLINE_MS = 20_000;
const RETRIES = 2;
const MAX_BYTES = 5 * 1024 * 1024;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const LOOKUP_TTL_MS = 60 * 60 * 1000;
const CACHE_ENTRIES = 200;

/** Words typed into the search: 1 to 200 characters on one line. */
export const searchText = z
  .string()
  .transform((value) => cleanText(value).replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(200));

/** An MBID: 36 hexadecimal characters and hyphens, stored in lowercase. */
export const musicBrainzId = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  );

// Every character with a meaning in Lucene's query syntax is escaped, and the
// words are lowercased so AND, OR, and NOT are never read as operators: what
// the author typed is only ever searched for, never interpreted.
const LUCENE_SPECIAL = /[+\-&|!(){}[\]^"~*?:\\/]/g;

export function luceneTerms(text: string): string {
  return text
    .toLowerCase()
    .replace(LUCENE_SPECIAL, (character) => `\\${character}`);
}

export interface MusicBrainzClient {
  searchReleaseGroups(query: string): Promise<ReleaseGroupResult[]>;
  searchArtists(query: string): Promise<ArtistResult[]>;
  getReleaseGroup(releaseGroupId: string): Promise<ReleaseGroupResult>;
  /** A release group's editions (one page of up to 100) and the total count. */
  listReleases(
    releaseGroupId: string,
  ): Promise<{ releases: ReleaseSummary[]; total: number }>;
  getRelease(releaseId: string): Promise<Release>;
  getArtist(artistId: string): Promise<Artist>;
}

export interface MusicBrainzOptions {
  baseUrl?: string;
  runtime?: ProviderRuntime;
  minIntervalMs?: number;
}

export function createMusicBrainzClient(
  options: MusicBrainzOptions = {},
): MusicBrainzClient {
  const runtime = options.runtime ?? systemRuntime;
  const base = resolveBaseUrl(options.baseUrl, MUSICBRAINZ_BASE_URL);
  const limiter = createLimiter(
    options.minIntervalMs ?? MIN_INTERVAL_MS,
    runtime,
  );
  const cache = new TtlCache<unknown>(CACHE_ENTRIES, runtime.now);

  async function get<Result>(
    path: string,
    params: Record<string, string>,
    parse: (body: unknown) => Result,
    ttlMs: number,
  ): Promise<Result> {
    if (!base) {
      throw new ProviderError("musicbrainz", "not_configured");
    }
    const url = new URL(path, base);
    for (const [key, value] of Object.entries({ ...params, fmt: "json" })) {
      url.searchParams.set(key, value);
    }
    const key = url.toString();
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached as Result;
    }
    const body = await requestJson({
      provider: "musicbrainz",
      url,
      userAgent: USER_AGENT,
      runtime,
      limiter,
      timeoutMs: TIMEOUT_MS,
      deadlineMs: DEADLINE_MS,
      retries: RETRIES,
      maxBytes: MAX_BYTES,
    });
    const result = parse(body);
    cache.set(key, result, ttlMs);
    return result;
  }

  function validated<Schema extends z.ZodType, Result>(
    schema: Schema,
    map: (data: z.output<Schema>) => Result,
  ) {
    return (body: unknown): Result => {
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new ProviderError("musicbrainz", "invalid_response");
      }
      return map(parsed.data);
    };
  }

  function idOf(value: string): string {
    const parsed = musicBrainzId.safeParse(value);
    if (!parsed.success) {
      throw new ProviderError("musicbrainz", "not_found");
    }
    return parsed.data;
  }

  function termsOf(value: string): string {
    const parsed = searchText.safeParse(value);
    if (!parsed.success) {
      throw new ProviderError("musicbrainz", "not_found");
    }
    return luceneTerms(parsed.data);
  }

  return {
    async searchReleaseGroups(query) {
      const terms = termsOf(query);
      // Unfielded words search the release group's title; the artist clause
      // lets "grace jeff buckley" rank Jeff Buckley's Grace first.
      return get(
        "release-group",
        {
          query: `(${terms}) OR artist:(${terms})`,
          limit: String(MAX_RESULTS),
        },
        validated(releaseGroupSearchResponse, toReleaseGroupResults),
        SEARCH_TTL_MS,
      );
    },
    async searchArtists(query) {
      return get(
        "artist",
        { query: termsOf(query), limit: String(MAX_RESULTS) },
        validated(artistSearchResponse, toArtistResults),
        SEARCH_TTL_MS,
      );
    },
    async getReleaseGroup(releaseGroupId) {
      return get(
        `release-group/${idOf(releaseGroupId)}`,
        { inc: "artist-credits" },
        validated(releaseGroupLookupResponse, toReleaseGroup),
        LOOKUP_TTL_MS,
      );
    },
    async listReleases(releaseGroupId) {
      return get(
        "release",
        {
          "release-group": idOf(releaseGroupId),
          // Spaces are sent as "+", the separator MusicBrainz expects.
          inc: "labels media",
          limit: String(MAX_RELEASES),
        },
        validated(releaseBrowseResponse, (data) => ({
          releases: toReleaseSummaries(data),
          total: data["release-count"],
        })),
        LOOKUP_TTL_MS,
      );
    },
    async getRelease(releaseId) {
      return get(
        `release/${idOf(releaseId)}`,
        { inc: "recordings artist-credits labels release-groups" },
        validated(releaseLookupResponse, toRelease),
        LOOKUP_TTL_MS,
      );
    },
    async getArtist(artistId) {
      return get(
        `artist/${idOf(artistId)}`,
        {},
        validated(artistLookupResponse, toArtist),
        LOOKUP_TTL_MS,
      );
    },
  };
}

let shared: MusicBrainzClient | undefined;

/**
 * The process-wide client, so every request shares one limiter and one
 * cache. `REFRAIN_MUSICBRAINZ_BASE_URL` is read once; it may only point at a
 * loopback mock (the tests), otherwise the real service is used.
 */
export function musicBrainz(): MusicBrainzClient {
  shared ??= createMusicBrainzClient({
    baseUrl: process.env.REFRAIN_MUSICBRAINZ_BASE_URL,
  });
  return shared;
}
