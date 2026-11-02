import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ProviderError } from "@/integrations/provider";
import { FIXTURE, SCENARIO } from "@/testing/provider-fixtures";
import { providerResponse } from "@/testing/provider-mock";
import { json, virtualRuntime } from "@/testing/provider-runtime";

import {
  APPLICATION_VERSION,
  createMusicBrainzClient,
  luceneTerms,
  USER_AGENT,
} from "./client";
import { creditText } from "./contract";

const MOCK = "http://127.0.0.1:4010/ws/2/";

function client() {
  const fake = virtualRuntime((url) => providerResponse(url));
  return {
    ...fake,
    mb: createMusicBrainzClient({ baseUrl: MOCK, runtime: fake.runtime }),
  };
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) {
      return error.failure;
    }
    throw error;
  }
  throw new Error("expected a ProviderError");
}

describe("MusicBrainz identification", () => {
  it("uses the documented User-Agent form with the application's version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
    };
    expect(APPLICATION_VERSION).toBe(pkg.version);
    expect(USER_AGENT).toMatch(/^Refrain\/\d+\.\d+\.\d+ \( https:\/\/\S+ \)$/);
  });

  it("refuses an override that is not a loopback mock, without calling anything", async () => {
    const fake = virtualRuntime(() => json({}));
    const mb = createMusicBrainzClient({
      baseUrl: "https://example.com/ws/2/",
      runtime: fake.runtime,
    });
    expect(await failureOf(mb.searchArtists("ink"))).toBe("not_configured");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("search", () => {
  it("escapes the words as a Lucene query and never reads them as syntax", () => {
    expect(luceneTerms('Grace AND (live) "1994" OR x:y')).toBe(
      'grace and \\(live\\) \\"1994\\" or x\\:y',
    );
  });

  it("searches release groups with the documented URL and maps the results", async () => {
    const { mb, calls } = client();
    const results = await mb.searchReleaseGroups("  Paper   moon ");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/ws/2/release-group");
    expect(url.searchParams.get("fmt")).toBe("json");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("query")).toBe(
      "(paper moon) OR artist:(paper moon)",
    );
    expect(results.map((r) => r.id)).toEqual([
      FIXTURE.paperMoon,
      FIXTURE.paperMoonDeluxe,
      FIXTURE.paperMoonCover,
    ]);
    // Ambiguous: two release groups share a title; they stay distinct.
    expect(results[0]!.title).toBe(results[2]!.title);
    expect(results[0]!.credits[0]!.joinPhrase).toBe("");
    expect(results[0]!.secondaryTypes).toEqual([]);
    expect(results[1]!.secondaryTypes).toEqual(["Compilation"]);
    expect(results[0]!.score).toBe(100);
  });

  it("returns nothing for a search with no match, and refuses empty words", async () => {
    const { mb, calls } = client();
    await expect(mb.searchReleaseGroups(SCENARIO.nothing)).resolves.toEqual([]);
    expect(await failureOf(mb.searchReleaseGroups("   "))).toBe("not_found");
    expect(await failureOf(mb.searchReleaseGroups("x".repeat(201)))).toBe(
      "not_found",
    );
    expect(calls).toHaveLength(1);
  });

  it("refuses a body that does not match the contract", async () => {
    const { mb } = client();
    expect(await failureOf(mb.searchArtists(SCENARIO.malformed))).toBe(
      "invalid_response",
    );
  });

  it("reports MusicBrainz's 503 as unavailable after bounded retries", async () => {
    const { mb, calls } = client();
    expect(await failureOf(mb.searchReleaseGroups(SCENARIO.unavailable))).toBe(
      "unavailable",
    );
    expect(calls).toHaveLength(3);
  });

  it("caches a successful search, never a failure, and spaces requests 1.1 s apart", async () => {
    const { mb, calls } = client();
    await mb.searchArtists("ink");
    await mb.searchArtists("ink");
    expect(calls).toHaveLength(1);
    await mb.searchArtists("paper");
    expect(calls.map((call) => call.time)).toEqual([0, 1100]);

    const failing = client();
    await failureOf(failing.mb.searchArtists(SCENARIO.unavailable));
    await failureOf(failing.mb.searchArtists(SCENARIO.unavailable));
    expect(failing.calls).toHaveLength(6);
  });
});

describe("release groups and releases", () => {
  it("lists a release group's editions, earliest first and undated last", async () => {
    const { mb, calls } = client();
    const { releases, total } = await mb.listReleases(FIXTURE.paperMoon);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("release-group")).toBe(FIXTURE.paperMoon);
    expect(url.searchParams.get("inc")).toBe("labels media");
    expect(url.search).toContain("inc=labels+media");
    expect(total).toBe(3);
    expect(releases.map((r) => [r.date, r.country])).toEqual([
      ["1994-08-15", "GB"],
      ["2004-08-23", "US"],
      [null, "XW"],
    ]);
    expect(releases[1]!.formats).toEqual(["CD"]);
    expect(releases[1]!.trackCount).toBe(4);
    expect(releases[2]!.hasFrontArtwork).toBe(false);
  });

  it("looks up a release with its release group, media, and credits", async () => {
    const { mb, calls } = client();
    const release = await mb.getRelease(FIXTURE.firstPressing.toUpperCase());
    expect(new URL(calls[0]!.url).pathname).toBe(
      `/ws/2/release/${FIXTURE.firstPressing}`,
    );
    expect(release.id).toBe(FIXTURE.firstPressing);
    expect(release.releaseGroup.id).toBe(FIXTURE.paperMoon);
    expect(release.labels).toEqual(["[Test] Label"]);
    const tracks = release.media[0]!.tracks;
    expect(tracks.map((t) => t.recordingId)).toEqual([
      FIXTURE.recording1,
      FIXTURE.recording2,
      FIXTURE.recording3,
    ]);
    expect(tracks[2]!.lengthMs).toBeNull();
    expect(creditText(tracks[1]!.credits)).toBe(
      "[Test] Ink Quartet feat. [Test] Paper Singer",
    );
    expect(release.credits[0]!.artistType).toBe("Group");
  });

  it("answers not_found for an unknown or malformed identifier", async () => {
    const { mb, calls } = client();
    expect(
      await failureOf(mb.getRelease("00000000-0000-4000-8000-000000000000")),
    ).toBe("not_found");
    expect(await failureOf(mb.getRelease("../../admin"))).toBe("not_found");
    expect(await failureOf(mb.getArtist("not-an-id"))).toBe("not_found");
    expect(calls).toHaveLength(1);
  });

  it("looks up an artist", async () => {
    const { mb } = client();
    const artist = await mb.getArtist(FIXTURE.paperSinger);
    expect(artist).toMatchObject({
      name: "[Test] Paper Singer",
      type: "Person",
      sortName: "Singer, [Test] Paper",
    });
  });
});
