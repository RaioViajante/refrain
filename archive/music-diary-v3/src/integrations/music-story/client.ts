import "server-only";

import type { ZodType } from "zod";

import {
  createLimiter,
  ProviderError,
  requestJson,
  resolveBaseUrl,
  systemRuntime,
  TtlCache,
  type ProviderRuntime,
} from "@/integrations/provider";

import {
  albumResponse,
  albumSearchResponse,
  artistPicturesResponse,
  artistResponse,
  artistSearchResponse,
  coverArtResponse,
  recordingSearchResponse,
  releasesResponse,
  releaseTracksResponse,
  toAlbum,
  toArtist,
  toCover,
  toPictures,
  toRecordings,
  toRelease,
  toTracks,
  type MusicStoryAlbum,
  type MusicStoryArtist,
  type MusicStoryCover,
  type MusicStoryPicture,
  type MusicStoryRecording,
  type MusicStoryRelease,
  type MusicStoryTrack,
} from "./contract";

// The Music Story adapter (ADR 0012 § 1, proposed). Server only, for the
// authenticated author only (its callers authorize first), bounded in time and
// size, every response validated, never inside a database transaction, and its
// failure never blocks writing: a search that fails is a fixed failure code,
// and the Studio offers "fill it in by hand".
//
// What it sends is fixed by its signatures: search words (cleaned, at most 200
// characters) and Music Story identifiers. It has no way to send writing, a
// rating, a memory, or a note. The token is read from the server's
// environment, sent only as the `Authorization` header to Music Story's own
// address (never to a redirect), and never logged, returned, or stored.
//
// Not wired to any screen yet, and no live call has been made (MS-0, MS-1):
// displaying Music Story artwork on a hosted page needs a written licence
// first.

export const MUSIC_STORY_BASE_URL = "https://api.v2.music-story.com/";
/** The trial allows 200 calls a day; spacing keeps bursts polite. */
export const MIN_INTERVAL_MS = 400;
const TIMEOUT_MS = 8_000;
const DEADLINE_MS = 20_000;
const RETRIES = 1;
const MAX_BYTES = 2 * 1024 * 1024;
const SEARCH_TTL_MS = 10 * 60 * 1000;
export const MAX_QUERY_LENGTH = 200;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface MusicStoryOptions {
  /** The API token (`MUSIC_STORY_API_TOKEN`); none means not configured. */
  token: string | undefined;
  /** A loopback override for tests (`REFRAIN_MUSIC_STORY_BASE_URL`). */
  baseUrl?: string | undefined;
  runtime?: ProviderRuntime;
  userAgent?: string;
}

export interface MusicStoryClient {
  /** Whether a token is configured. Says nothing about whether it works. */
  readonly configured: boolean;
  searchAlbums(query: string): Promise<MusicStoryAlbum[]>;
  album(id: string): Promise<MusicStoryAlbum>;
  coverArt(albumId: string): Promise<MusicStoryCover>;
  releases(albumId: string): Promise<MusicStoryRelease[]>;
  releaseTracks(releaseId: string): Promise<MusicStoryTrack[]>;
  searchArtists(query: string): Promise<MusicStoryArtist[]>;
  artist(id: string): Promise<MusicStoryArtist>;
  artistPictures(artistId: string): Promise<MusicStoryPicture[]>;
  searchRecordings(query: string): Promise<MusicStoryRecording[]>;
}

/** Search words as they may be sent: one line, trimmed, bounded. */
export function searchWords(query: string): string {
  const words = query
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (words.length === 0 || words.length > MAX_QUERY_LENGTH) {
    throw new ProviderError("music_story", "not_found");
  }
  return words;
}

function identifier(id: string): string {
  if (!ID.test(id)) {
    throw new ProviderError("music_story", "not_found");
  }
  return id;
}

export function createMusicStoryClient(
  options: MusicStoryOptions,
): MusicStoryClient {
  const runtime = options.runtime ?? systemRuntime;
  const token = options.token?.trim() || undefined;
  const base = resolveBaseUrl(options.baseUrl, MUSIC_STORY_BASE_URL);
  const limiter = createLimiter(MIN_INTERVAL_MS, runtime);
  const searches = new TtlCache<unknown>(200, runtime.now);

  async function get<T>(
    path: string,
    params: Record<string, string>,
    schema: ZodType<T>,
  ): Promise<T> {
    if (!token || !base) {
      throw new ProviderError("music_story", "not_configured");
    }
    const url = new URL(path.replace(/^\//, ""), base);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    const body = await requestJson({
      provider: "music_story",
      url,
      userAgent: options.userAgent ?? "Refrain",
      runtime,
      limiter,
      timeoutMs: TIMEOUT_MS,
      deadlineMs: DEADLINE_MS,
      retries: RETRIES,
      maxBytes: MAX_BYTES,
      authorization: `Bearer ${token}`,
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ProviderError("music_story", "invalid_response");
    }
    return parsed.data;
  }

  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = searches.get(key) as T | undefined;
    if (hit !== undefined) return hit;
    const value = await load();
    searches.set(key, value, SEARCH_TTL_MS);
    return value;
  }

  return {
    configured: Boolean(token && base),
    searchAlbums: async (query) => {
      const words = searchWords(query);
      return cached(`album:${words.toLowerCase()}`, async () =>
        (
          await get("api/album", { query: words }, albumSearchResponse)
        ).hits.map(toAlbum),
      );
    },
    album: async (id) =>
      toAlbum(await get(`api/album/${identifier(id)}`, {}, albumResponse)),
    coverArt: async (albumId) =>
      toCover(
        await get(
          `api/album/${identifier(albumId)}/coverart`,
          {},
          coverArtResponse,
        ),
      ),
    releases: async (albumId) =>
      (
        await get(
          `api/album/${identifier(albumId)}/releases`,
          {},
          releasesResponse,
        )
      ).map(toRelease),
    releaseTracks: async (releaseId) =>
      toTracks(
        await get(
          `api/release/${identifier(releaseId)}/tracks`,
          { offset: "0", limit: "200" },
          releaseTracksResponse,
        ),
      ),
    searchArtists: async (query) => {
      const words = searchWords(query);
      return cached(`artist:${words.toLowerCase()}`, async () =>
        (
          await get("api/artist", { query: words }, artistSearchResponse)
        ).hits.map(toArtist),
      );
    },
    artist: async (id) =>
      toArtist(await get(`api/artist/${identifier(id)}`, {}, artistResponse)),
    artistPictures: async (artistId) =>
      toPictures(
        await get(
          `api/artist/${identifier(artistId)}/pictures`,
          {},
          artistPicturesResponse,
        ),
      ),
    searchRecordings: async (query) => {
      const words = searchWords(query);
      return cached(`recording:${words.toLowerCase()}`, async () =>
        toRecordings(
          await get("api/recording", { query: words }, recordingSearchResponse),
        ),
      );
    },
  };
}

let shared: MusicStoryClient | null = null;

/** The server's client, from its environment. */
export function musicStory(): MusicStoryClient {
  shared ??= createMusicStoryClient({
    token: process.env.MUSIC_STORY_API_TOKEN,
    baseUrl: process.env.REFRAIN_MUSIC_STORY_BASE_URL,
  });
  return shared;
}
