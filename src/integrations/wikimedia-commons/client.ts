import "server-only";

import {
  createLimiter,
  ProviderError,
  requestJson,
  resolveBaseUrl,
  systemRuntime,
  TtlCache,
  type ProviderRuntime,
} from "@/integrations/provider";
import { USER_AGENT } from "@/integrations/musicbrainz";
import { cleanText } from "@/validation";

import {
  claimsResponse,
  METADATA_FIELDS,
  pageResultOf,
  queryResponse,
  searchResponse,
  type CommonsFile,
} from "./contract";
import {
  photoFileName,
  photoFileNameOfTitle,
  STORED_THUMBNAIL_WIDTH,
} from "./photo";

// The Wikimedia adapter (M3.3): Wikimedia Commons for files and their
// license metadata, and Wikidata only to suggest candidates for an artist
// linked to MusicBrainz. Server-only; it returns validated data and never
// writes anything. The official Action API is used throughout; nothing is
// scraped. Documentation read on 2026-11-02 (docs/evidence/m3-3.md).
//
// - Identification: the same `Refrain/<version> ( <contact> )` User-Agent as
//   MusicBrainz, which is the form the Wikimedia User-Agent policy asks for.
// - Rate: requests in series, one start per 500 ms for the whole process
//   (API:Etiquette: "make your requests in series"; the 2026 limit for an
//   identified client is 200 a minute).
// - Time: 8 s per attempt, 15 s in all, two retries after 429, 502, 503, 504,
//   or a network error, honouring `Retry-After`. No redirect is followed.
// - Size: answers over 2 MB are refused. Searches ask for 12 files at most
//   (extended metadata is "expensive"; ask for "a few results at a time").
// - Cache: validated answers only, in memory, bounded: searches 10 minutes,
//   lookups an hour. Failures are never cached. `fresh` asks again.
// - Requests carry only the words the author typed, a file name, a Wikidata
//   item id, or a MusicBrainz artist id. No cookie, no referrer, nothing of
//   the author's writing.

export const COMMONS_API_BASE_URL = "https://commons.wikimedia.org/w/";
export const WIKIDATA_API_BASE_URL = "https://www.wikidata.org/w/";
export const WIKIMEDIA_MIN_INTERVAL_MS = 500;
const TIMEOUT_MS = 8_000;
const DEADLINE_MS = 15_000;
const RETRIES = 2;
const MAX_BYTES = 2 * 1024 * 1024;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const LOOKUP_TTL_MS = 60 * 60 * 1000;
const CACHE_ENTRIES = 200;

/** The most files a search or a suggestion lists. */
export const MAX_PHOTO_RESULTS = 12;
/** The most Wikidata images (P18) read for one item. */
const MAX_ITEM_IMAGES = 5;

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WIKIDATA_ITEM = /^Q[1-9][0-9]{0,11}$/;

/**
 * The words of a photograph search, safe to hand to CirrusSearch: letters,
 * marks, digits, spaces, and `' & . , -` only. Everything else, including
 * the `:` of a search keyword (`insource:`, `haswbstatement:`) and the
 * quotes, slashes, and wildcards of regular expressions, becomes a space, so
 * what the author typed is only ever searched for, never interpreted.
 */
export function photoSearchTerms(text: string): string {
  return cleanText(text)
    .replace(/[^\p{L}\p{M}\p{N}\s'&.,-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
}

export interface Freshness {
  fresh?: boolean;
}

export interface WikimediaClient {
  /** Bitmap files whose text matches the words, in Commons' order. */
  searchFiles(words: string): Promise<CommonsFile[]>;
  /**
   * Files by name. A name Commons does not have is listed in `missing`.
   * At most `MAX_PHOTO_RESULTS` names.
   */
  getFiles(
    fileNames: string[],
    options?: Freshness,
  ): Promise<{ files: CommonsFile[]; missing: string[] }>;
  /** Bitmap files whose structured data says they depict the item (P180). */
  filesDepicting(itemId: string): Promise<CommonsFile[]>;
  /**
   * The Wikidata item with this MusicBrainz artist ID (P434), or null when
   * there is none or more than one.
   */
  itemForMusicBrainzArtist(mbArtistId: string): Promise<string | null>;
  /** The file names of the item's image statements (P18), best first. */
  itemImages(itemId: string): Promise<string[]>;
}

export interface WikimediaOptions {
  commonsBaseUrl?: string;
  wikidataBaseUrl?: string;
  runtime?: ProviderRuntime;
  minIntervalMs?: number;
}

const IMAGE_PARAMS = {
  prop: "imageinfo",
  iiprop: "url|size|mime|sha1|timestamp|extmetadata|canonicaltitle|mediatype",
  iiurlwidth: String(STORED_THUMBNAIL_WIDTH),
  iiextmetadatafilter: METADATA_FIELDS.join("|"),
  iiextmetadatalanguage: "en",
};

export function createWikimediaClient(
  options: WikimediaOptions = {},
): WikimediaClient {
  const runtime = options.runtime ?? systemRuntime;
  const commons = resolveBaseUrl(options.commonsBaseUrl, COMMONS_API_BASE_URL);
  const wikidata = resolveBaseUrl(
    options.wikidataBaseUrl,
    WIKIDATA_API_BASE_URL,
  );
  const limiter = createLimiter(
    options.minIntervalMs ?? WIKIMEDIA_MIN_INTERVAL_MS,
    runtime,
  );
  const cache = new TtlCache<unknown>(CACHE_ENTRIES, runtime.now);

  async function get<Result>(
    base: URL | null,
    params: Record<string, string>,
    parse: (body: unknown) => Result,
    ttlMs: number,
    fresh = false,
  ): Promise<Result> {
    if (!base) {
      throw new ProviderError("wikimedia", "not_configured");
    }
    const url = new URL("api.php", base);
    for (const [name, value] of Object.entries({
      action: "query",
      ...params,
      format: "json",
      formatversion: "2",
    })) {
      url.searchParams.set(name, value);
    }
    const key = url.toString();
    const cached = fresh ? undefined : (cache.get(key) as Result | undefined);
    if (cached !== undefined) {
      return cached;
    }
    const body = await requestJson({
      provider: "wikimedia",
      url,
      userAgent: USER_AGENT,
      runtime,
      limiter,
      timeoutMs: TIMEOUT_MS,
      deadlineMs: DEADLINE_MS,
      retries: RETRIES,
      maxBytes: MAX_BYTES,
    });
    // An API error (bad parameters, a lagged database) arrives as 200 with
    // an `error` object; nothing from such an answer is used.
    if (
      typeof body === "object" &&
      body !== null &&
      ("error" in body || "errors" in body)
    ) {
      throw new ProviderError("wikimedia", "unavailable");
    }
    const result = parse(body);
    cache.set(key, result, ttlMs);
    return result;
  }

  function filesOf(body: unknown): { files: CommonsFile[]; missing: string[] } {
    const parsed = queryResponse.safeParse(body);
    if (!parsed.success) {
      throw new ProviderError("wikimedia", "invalid_response");
    }
    const files: CommonsFile[] = [];
    const missing: string[] = [];
    for (const page of parsed.data.query?.pages ?? []) {
      const result = pageResultOf(page);
      if (result?.kind === "file") {
        files.push(result.file);
      } else if (result?.kind === "missing") {
        missing.push(result.fileName);
      }
    }
    files.sort((a, b) => a.index - b.index);
    return { files: files.slice(0, MAX_PHOTO_RESULTS), missing };
  }

  function searchFilesFor(search: string): Promise<CommonsFile[]> {
    return get(
      commons,
      {
        generator: "search",
        gsrsearch: search,
        gsrnamespace: "6",
        gsrlimit: String(MAX_PHOTO_RESULTS),
        ...IMAGE_PARAMS,
      },
      (body) => filesOf(body).files,
      SEARCH_TTL_MS,
    );
  }

  return {
    async searchFiles(words) {
      const terms = photoSearchTerms(words);
      if (terms === "") {
        return [];
      }
      return searchFilesFor(`${terms} filetype:bitmap`);
    },

    async getFiles(fileNames, options = {}) {
      const names = [
        ...new Set(fileNames.filter((name) => photoFileName(name) !== null)),
      ].slice(0, MAX_PHOTO_RESULTS);
      if (names.length === 0) {
        return { files: [], missing: [] };
      }
      return get(
        commons,
        {
          titles: names.map((name) => `File:${name}`).join("|"),
          ...IMAGE_PARAMS,
        },
        filesOf,
        LOOKUP_TTL_MS,
        options.fresh,
      );
    },

    async filesDepicting(itemId) {
      if (!WIKIDATA_ITEM.test(itemId)) {
        return [];
      }
      return searchFilesFor(`haswbstatement:P180=${itemId} filetype:bitmap`);
    },

    async itemForMusicBrainzArtist(mbArtistId) {
      const id = mbArtistId.trim().toLowerCase();
      if (!MBID.test(id)) {
        return null;
      }
      return get(
        wikidata,
        {
          list: "search",
          srsearch: `haswbstatement:P434=${id}`,
          srnamespace: "0",
          srlimit: "2",
          srprop: "",
        },
        (body) => {
          const parsed = searchResponse.safeParse(body);
          if (!parsed.success) {
            throw new ProviderError("wikimedia", "invalid_response");
          }
          const items = parsed.data.query.search.map((hit) => hit.title);
          // One item, or nothing: two items with one identifier are not a
          // reliable identity.
          return items.length === 1 && WIKIDATA_ITEM.test(items[0]!)
            ? items[0]!
            : null;
        },
        LOOKUP_TTL_MS,
      );
    },

    async itemImages(itemId) {
      if (!WIKIDATA_ITEM.test(itemId)) {
        return [];
      }
      return get(
        wikidata,
        { action: "wbgetclaims", entity: itemId, property: "P18" },
        (body) => {
          const parsed = claimsResponse.safeParse(body);
          if (!parsed.success) {
            throw new ProviderError("wikimedia", "invalid_response");
          }
          const statements = parsed.data.claims.P18 ?? [];
          const ranked = [
            ...statements.filter((claim) => claim.rank === "preferred"),
            ...statements.filter((claim) => claim.rank === "normal"),
          ];
          const names: string[] = [];
          for (const claim of ranked) {
            const value = claim.mainsnak.datavalue?.value;
            const name =
              claim.mainsnak.snaktype === "value" && typeof value === "string"
                ? photoFileNameOfTitle(`File:${value}`)
                : null;
            if (name && !names.includes(name)) {
              names.push(name);
            }
          }
          return names.slice(0, MAX_ITEM_IMAGES);
        },
        LOOKUP_TTL_MS,
      );
    },
  };
}

let shared: WikimediaClient | undefined;

/**
 * The process-wide client. `REFRAIN_WIKIMEDIA_COMMONS_BASE_URL` and
 * `REFRAIN_WIKIDATA_BASE_URL` may only point at a loopback mock (the tests);
 * pages always load images from Commons' own addresses, rebuilt from the
 * stored file name (./photo.ts).
 */
export function wikimedia(): WikimediaClient {
  shared ??= createWikimediaClient({
    commonsBaseUrl: process.env.REFRAIN_WIKIMEDIA_COMMONS_BASE_URL,
    wikidataBaseUrl: process.env.REFRAIN_WIKIDATA_BASE_URL,
  });
  return shared;
}
