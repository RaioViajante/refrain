import { createServer, type Server } from "node:http";

import {
  artistLookup,
  artistSearch,
  coverGroupListing,
  coverListing,
  releaseBrowse,
  releaseGroupLookup,
  releaseGroupSearch,
  releaseLookup,
  SCENARIO,
} from "./provider-fixtures";

// A local stand-in for MusicBrainz (under /ws/2/) and the Cover Art Archive
// (under /caa/), for the unit, HTTP, and browser tests. The production build is
// pointed at it with REFRAIN_MUSICBRAINZ_BASE_URL and
// REFRAIN_COVER_ART_ARCHIVE_BASE_URL (loopback only, src/integrations/provider.ts),
// so no test reaches the real services. It answers from ./provider-fixtures.ts,
// follows the archive's redirect pattern (one hop before the listing), and the
// server records each request's path, User-Agent, and time at /__requests, so
// a test can check identification and spacing.

export interface MockAnswer {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** The words of a Lucene query, as the adapter escapes and lowercases them. */
function wordsOf(url: URL): string {
  return (url.searchParams.get("query") ?? "").replace(/\\/g, "").toLowerCase();
}

function musicBrainzAnswer(path: string, url: URL): MockAnswer {
  if (url.searchParams.get("fmt") !== "json") {
    return { status: 406 };
  }
  if (path === "release-group" || path === "artist") {
    const words = wordsOf(url);
    if (words.includes(SCENARIO.unavailable)) {
      return {
        status: 503,
        body: {
          error:
            "The MusicBrainz web server is currently busy. Please try again later.",
        },
        headers: { "retry-after": "0" },
      };
    }
    if (words.includes(SCENARIO.malformed)) {
      return { status: 200, body: { count: "many", artists: "no" } };
    }
    if (words.includes(SCENARIO.nothing)) {
      return {
        status: 200,
        body: {
          created: "2026-11-02T00:00:00.000Z",
          count: 0,
          offset: 0,
          [path === "artist" ? "artists" : "release-groups"]: [],
        },
      };
    }
    return {
      status: 200,
      body: path === "artist" ? artistSearch(words) : releaseGroupSearch(words),
    };
  }
  if (path === "release" && url.searchParams.has("release-group")) {
    return {
      status: 200,
      body: releaseBrowse(url.searchParams.get("release-group") ?? ""),
    };
  }
  const lookup = /^(release|release-group|artist)\/([^/]+)$/.exec(path);
  if (lookup) {
    const found =
      lookup[1] === "release"
        ? releaseLookup(lookup[2]!)
        : lookup[1] === "release-group"
          ? releaseGroupLookup(lookup[2]!)
          : artistLookup(lookup[2]!);
    return found
      ? { status: 200, body: found }
      : { status: 404, body: { error: "Not Found" } };
  }
  return { status: 400, body: { error: "Invalid request" } };
}

function listingOf(kind: string, id: string) {
  return kind === "release" ? coverListing(id) : coverGroupListing(id);
}

/** The mock's answer to a GET of `url`, whatever its origin. */
export function providerAnswer(url: URL): MockAnswer {
  const musicBrainz = /^\/ws\/2\/(.*)$/.exec(url.pathname);
  if (musicBrainz) {
    return musicBrainzAnswer(musicBrainz[1]!, url);
  }
  // The archive answers a listing with a redirect, then the JSON.
  const archive = /^\/caa\/(release|release-group)\/([^/]+)$/.exec(
    url.pathname,
  );
  if (archive) {
    return listingOf(archive[1]!, archive[2]!)
      ? {
          status: 307,
          headers: {
            location: `/caa/download/${archive[1]}/${archive[2]}/index.json`,
          },
        }
      : { status: 404 };
  }
  const download =
    /^\/caa\/download\/(release|release-group)\/([^/]+)\/index\.json$/.exec(
      url.pathname,
    );
  if (download) {
    const listing = listingOf(download[1]!, download[2]!);
    return listing ? { status: 200, body: listing } : { status: 404 };
  }
  return { status: 404 };
}

/** The same answer as a fetch `Response`, for unit tests. */
export function providerResponse(url: string): Response {
  const answer = providerAnswer(new URL(url));
  return new Response(
    answer.body === undefined ? null : JSON.stringify(answer.body),
    {
      status: answer.status,
      headers: { "content-type": "application/json", ...answer.headers },
    },
  );
}

export interface ProviderMock {
  origin: string;
  musicBrainzBaseUrl: string;
  coverArtArchiveBaseUrl: string;
  stop: () => Promise<void>;
}

export async function startProviderMock(): Promise<ProviderMock> {
  const recorded: { path: string; userAgent: string; at: number }[] = [];

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__requests") {
      const text = JSON.stringify(recorded);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(text);
      return;
    }
    recorded.push({
      path: `${url.pathname}${url.search}`,
      userAgent: String(request.headers["user-agent"] ?? ""),
      at: Date.now(),
    });
    const answer: MockAnswer =
      request.method === "GET" ? providerAnswer(url) : { status: 405 };
    const text = answer.body === undefined ? "" : JSON.stringify(answer.body);
    response.writeHead(answer.status, {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(text)),
      ...answer.headers,
    });
    response.end(text);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("The provider mock did not get a port.");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    musicBrainzBaseUrl: `${origin}/ws/2/`,
    coverArtArchiveBaseUrl: `${origin}/caa/`,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
