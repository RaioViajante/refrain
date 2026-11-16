import { describe, expect, it, vi } from "vitest";

import { ProviderError, type ProviderRuntime } from "@/integrations/provider";

import { createMusicStoryClient, durationSeconds, searchWords } from "./index";

vi.mock("server-only", () => ({}));

// Synthetic responses in the shapes the public reference documents. No call
// reaches Music Story: every request goes to a fake fetch that records it.

const MB = "0b6f0e44-6c4f-4f6c-9d6c-6c4f6c9d6c4f";

interface Seen {
  url: string;
  headers: Record<string, string>;
}

function fakeRuntime(
  answer: (url: URL) => {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  },
) {
  const seen: Seen[] = [];
  let clock = 0;
  const runtime: ProviderRuntime = {
    fetch: async (url, init) => {
      seen.push({
        url,
        headers: { ...(init.headers as Record<string, string>) },
      });
      const { status = 200, body = {}, headers = {} } = answer(new URL(url));
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    },
    now: () => (clock += 1000),
    sleep: async () => {},
  };
  return { runtime, seen };
}

const albumHit = {
  id: 1234,
  title: "[Test] Album",
  artist: { id: 9, name: "[Test] Artist" },
  original_release_date: "1994-08-23",
  label: "[Test] Label",
  format: "ep",
  type: "ORIGINAL",
  externals: { musicbrainz: [MB, "not-an-id"] },
  lyrics: "never kept",
};

describe("the Music Story adapter", () => {
  it("is not configured without a token, and makes no request", async () => {
    const { runtime, seen } = fakeRuntime(() => ({ body: {} }));
    const client = createMusicStoryClient({ token: undefined, runtime });
    expect(client.configured).toBe(false);
    await expect(client.searchAlbums("grace")).rejects.toMatchObject({
      failure: "not_configured",
    });
    expect(seen).toHaveLength(0);
  });

  it("sends the token only as a Bearer header, and only search words in the address", async () => {
    const { runtime, seen } = fakeRuntime(() => ({
      body: { hits: [albumHit] },
    }));
    const client = createMusicStoryClient({ token: "secret-token", runtime });
    const albums = await client.searchAlbums("  grace \n jeff   buckley ");
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]!.url);
    expect(url.origin + url.pathname).toBe(
      "https://api.v2.music-story.com/api/album",
    );
    expect(url.searchParams.get("query")).toBe("grace jeff buckley");
    expect(seen[0]!.url).not.toContain("secret-token");
    expect(seen[0]!.headers.Authorization).toBe("Bearer secret-token");
    expect(albums).toEqual([
      {
        id: "1234",
        title: "[Test] Album",
        artist: "[Test] Artist",
        year: 1994,
        label: "[Test] Label",
        format: "EP",
        type: "ORIGINAL",
        externals: { musicbrainz: [MB] },
      },
    ]);
    // Nothing the response carries beyond the contract is kept.
    expect(JSON.stringify(albums)).not.toContain("never kept");
  });

  it("caches a search, so editing the same record again costs no call", async () => {
    const { runtime, seen } = fakeRuntime(() => ({
      body: { hits: [albumHit] },
    }));
    const client = createMusicStoryClient({ token: "t", runtime });
    await client.searchAlbums("Grace");
    await client.searchAlbums("grace");
    expect(seen).toHaveLength(1);
  });

  it("refuses empty or overlong words and malformed identifiers before any request", async () => {
    const { runtime, seen } = fakeRuntime(() => ({ body: {} }));
    const client = createMusicStoryClient({ token: "t", runtime });
    await expect(client.searchAlbums("   ")).rejects.toBeInstanceOf(
      ProviderError,
    );
    await expect(client.searchAlbums("x".repeat(201))).rejects.toBeInstanceOf(
      ProviderError,
    );
    await expect(client.album("../../user")).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(seen).toHaveLength(0);
    expect(searchWords("a\u0000b")).toBe("a b");
  });

  it("calls a response that breaks the contract invalid, and keeps nothing from it", async () => {
    const { runtime } = fakeRuntime(() => ({
      body: { hits: [{ id: "x y", title: "" }] },
    }));
    const client = createMusicStoryClient({ token: "t", runtime });
    await expect(client.searchAlbums("grace")).rejects.toMatchObject({
      failure: "invalid_response",
    });
  });

  it("reads a cover with its rights holder, and tracks in disc and track order with durations", async () => {
    const { runtime } = fakeRuntime((url) =>
      url.pathname.endsWith("/coverart")
        ? {
            body: {
              path: "https://pictures.example/cover.jpg",
              path_400: "https://pictures.example/cover-400.jpg",
              width: 1400,
              height: 1400,
              copyright: "©Copyright [Test]",
            },
          }
        : {
            body: {
              hits: [
                {
                  id: 2,
                  disc_number: 1,
                  track_number: 2,
                  recording: {
                    id: 20,
                    title: "[Test] Two",
                    duration: "00:05:03",
                  },
                },
                {
                  id: 1,
                  disc_number: 1,
                  track_number: 1,
                  recording: {
                    id: 10,
                    title: "[Test] One",
                    duration: "04:12",
                    isrc: "USSM19400001",
                  },
                },
              ],
            },
          },
    );
    const client = createMusicStoryClient({ token: "t", runtime });
    expect(await client.coverArt("1234")).toMatchObject({
      url400: "https://pictures.example/cover-400.jpg",
      copyright: "©Copyright [Test]",
    });
    const tracks = await client.releaseTracks("77");
    expect(
      tracks.map((track) => [track.position, track.seconds, track.isrc]),
    ).toEqual([
      [1, 252, "USSM19400001"],
      [2, 303, null],
    ]);
  });

  it("keeps a picture's credit and allowed use, and leaves out one that does not validate", async () => {
    const { runtime } = fakeRuntime(() => ({
      body: [
        {
          id: 5,
          path: "https://pictures.example/a.jpg",
          metas: {
            credit_line: "[Test] Photographer / Agency",
            license_model: "RM",
            allowed_use: {
              how_can_i_use_it: "Available for Editorial uses.",
              usage_restrictions: ["No merchandising"],
            },
          },
        },
        { id: 6, path: "not a url" },
      ],
    }));
    const client = createMusicStoryClient({ token: "t", runtime });
    expect(await client.artistPictures("9")).toEqual([
      {
        id: "5",
        url: "https://pictures.example/a.jpg",
        width: null,
        height: null,
        source: null,
        copyright: null,
        creditLine: "[Test] Photographer / Agency",
        licenseModel: "RM",
        allowedUse: "Available for Editorial uses.",
        restrictions: ["No merchandising"],
      },
    ]);
  });

  it("reports a rate limit as unavailable, so only search stops", async () => {
    const { runtime } = fakeRuntime(() => ({
      status: 429,
      headers: { "retry-after": "1" },
    }));
    const client = createMusicStoryClient({ token: "t", runtime });
    await expect(client.searchArtists("nick drake")).rejects.toMatchObject({
      failure: "unavailable",
    });
  });

  it("never follows a redirect, so the token cannot leave Music Story's address", async () => {
    const { runtime, seen } = fakeRuntime(() => ({
      status: 302,
      headers: { location: "https://elsewhere.example/x" },
    }));
    const client = createMusicStoryClient({ token: "t", runtime });
    await expect(client.album("1")).rejects.toBeInstanceOf(ProviderError);
    expect(
      seen.every(
        (request) => new URL(request.url).host === "api.v2.music-story.com",
      ),
    ).toBe(true);
  });

  it("accepts only a loopback override of its address", () => {
    expect(
      createMusicStoryClient({ token: "t", baseUrl: "https://evil.example/" })
        .configured,
    ).toBe(false);
    expect(
      createMusicStoryClient({ token: "t", baseUrl: "http://127.0.0.1:9/" })
        .configured,
    ).toBe(true);
  });

  it("reads durations, and refuses nonsense", () => {
    expect(durationSeconds("01:02:03")).toBe(3723);
    expect(durationSeconds("3:30")).toBe(210);
    expect(durationSeconds("abc")).toBeNull();
    expect(durationSeconds("00:00")).toBeNull();
  });
});
