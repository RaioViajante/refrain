import { describe, expect, it } from "vitest";

import { USER_AGENT } from "@/integrations/musicbrainz";
import { ProviderError } from "@/integrations/provider";
import { FIXTURE } from "@/testing/provider-fixtures";
import { providerResponse } from "@/testing/provider-mock";
import { json, virtualRuntime } from "@/testing/provider-runtime";
import { ITEM, PHOTO, PHOTO_SCENARIO } from "@/testing/wikimedia-fixtures";

import {
  createWikimediaClient,
  MAX_PHOTO_RESULTS,
  photoSearchTerms,
  WIKIMEDIA_MIN_INTERVAL_MS,
} from "./client";

const COMMONS = "http://127.0.0.1:4010/commons/w/";
const WIKIDATA = "http://127.0.0.1:4010/wikidata/w/";

function client(respond: (url: string) => Response = providerResponse) {
  const fake = virtualRuntime((url) => respond(url));
  return {
    ...fake,
    wm: createWikimediaClient({
      commonsBaseUrl: COMMONS,
      wikidataBaseUrl: WIKIDATA,
      runtime: fake.runtime,
    }),
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

describe("Wikimedia requests", () => {
  it("identifies itself, sends no cookie or referrer, and asks for JSON format 2", async () => {
    const { wm, calls } = client();
    await wm.searchFiles("ink quartet");
    const [call] = calls;
    const url = new URL(call!.url);
    expect(url.origin + url.pathname).toBe(`${COMMONS}api.php`);
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("formatversion")).toBe("2");
    expect(url.searchParams.get("action")).toBe("query");
    expect(new Headers(call!.init.headers).get("user-agent")).toBe(USER_AGENT);
    expect(call!.init).toMatchObject({
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(new Headers(call!.init.headers).get("cookie")).toBeNull();
  });

  it("searches the File namespace for bitmaps, with license metadata and a 330 px thumbnail", async () => {
    const { wm, calls } = client();
    const files = await wm.searchFiles("  Ink   Quartet ");
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("generator")).toBe("search");
    expect(url.searchParams.get("gsrsearch")).toBe(
      "Ink Quartet filetype:bitmap",
    );
    expect(url.searchParams.get("gsrnamespace")).toBe("6");
    expect(url.searchParams.get("gsrlimit")).toBe(String(MAX_PHOTO_RESULTS));
    expect(url.searchParams.get("prop")).toBe("imageinfo");
    expect(url.searchParams.get("iiurlwidth")).toBe("330");
    expect(url.searchParams.get("iiprop")).not.toContain("user");
    expect(url.searchParams.get("iiextmetadatafilter")).toContain(
      "LicenseShortName",
    );
    expect(files.map((file) => file.fileName)).toEqual([
      PHOTO.onStage,
      PHOTO.portrait,
      PHOTO.attributed,
      PHOTO.nonCommercial,
      PHOTO.unknownAuthor,
      PHOTO.mismatch,
      PHOTO.hostile,
      PHOTO.small,
      PHOTO.animated,
      PHOTO.ported,
      PHOTO.elsewhere,
    ]);
    // The tracking query is dropped.
    expect(files[0]!.thumbUrl).not.toContain("?");
    expect(files[0]!.metadata.Artist).toContain("<a href=");
  });

  it("never sends search syntax: keywords, regular expressions, and quotes become spaces", () => {
    expect(
      photoSearchTerms('insource:/a.*b/ haswbstatement:P180=Q1 "x" ~y*'),
    ).toBe("insource a. b haswbstatement P180 Q1 x y");
    expect(photoSearchTerms("[Test] O'Brien & Co., Ação-1")).toBe(
      "Test O'Brien & Co., Ação-1",
    );
    expect(photoSearchTerms("x".repeat(500))).toHaveLength(100);
  });

  it("asks for nothing when no words are left", async () => {
    const { wm, calls } = client();
    expect(await wm.searchFiles(" :: // ** ")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("spaces requests and runs them in series", async () => {
    const { wm, calls } = client();
    await Promise.all([
      wm.searchFiles("ink a"),
      wm.searchFiles("ink b"),
      wm.searchFiles("ink c"),
    ]);
    const times = calls.map((call) => call.time);
    expect(times).toEqual([
      0,
      WIKIMEDIA_MIN_INTERVAL_MS,
      2 * WIKIMEDIA_MIN_INTERVAL_MS,
    ]);
  });

  it("answers again from the cache, and asks again when fresh", async () => {
    const { wm, calls } = client();
    await wm.getFiles([PHOTO.onStage]);
    await wm.getFiles([PHOTO.onStage]);
    expect(calls).toHaveLength(1);
    await wm.getFiles([PHOTO.onStage], { fresh: true });
    expect(calls).toHaveLength(2);
  });

  it("reports an unreachable Commons as unavailable, after retrying with Retry-After", async () => {
    const { wm, calls } = client();
    expect(await failureOf(wm.searchFiles(PHOTO_SCENARIO.unavailable))).toBe(
      "unavailable",
    );
    expect(calls).toHaveLength(3);
  });

  it("refuses a body outside the contract", async () => {
    const { wm } = client();
    expect(await failureOf(wm.searchFiles(PHOTO_SCENARIO.malformed))).toBe(
      "invalid_response",
    );
  });

  it("treats an API error object as unavailable and never caches it", async () => {
    let answer: Response = json({ error: { code: "maxlag", info: "lagged" } });
    const { wm, calls } = client(() => answer);
    expect(await failureOf(wm.getFiles([PHOTO.onStage]))).toBe("unavailable");
    answer = providerResponse(
      `${COMMONS}api.php?action=query&prop=imageinfo&titles=File:${PHOTO.onStage}&format=json&formatversion=2`,
    );
    expect((await wm.getFiles([PHOTO.onStage])).files).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("refuses an over-large answer", async () => {
    const { wm } = client(() =>
      json({ query: { pages: [] }, pad: "x".repeat(3 * 1024 * 1024) }),
    );
    expect(await failureOf(wm.searchFiles("ink"))).toBe("invalid_response");
  });

  it("follows no redirect", async () => {
    const { wm } = client(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/" },
        }),
    );
    expect(await failureOf(wm.searchFiles("ink"))).toBe("unavailable");
  });

  it("refuses an override that is not a loopback mock, without calling anything", async () => {
    const fake = virtualRuntime(() => json({}));
    const wm = createWikimediaClient({
      commonsBaseUrl: "https://commons.example/w/",
      runtime: fake.runtime,
    });
    expect(await failureOf(wm.searchFiles("ink"))).toBe("not_configured");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("file lookups", () => {
  it("reports deleted files as missing and drops invalid names before asking", async () => {
    const { wm, calls } = client();
    const result = await wm.getFiles([
      PHOTO.onStage,
      PHOTO.removed,
      "bad/name.jpg",
      PHOTO.onStage,
    ]);
    expect(result.files.map((file) => file.fileName)).toEqual([PHOTO.onStage]);
    expect(result.missing).toEqual([PHOTO.removed]);
    expect(new URL(calls[0]!.url).searchParams.get("titles")).toBe(
      `File:${PHOTO.onStage}|File:${PHOTO.removed}`,
    );
  });

  it("drops a page that is invalid, from another wiki, or does not match the contract", async () => {
    const good = (await client().wm.getFiles([PHOTO.onStage])).files[0]!;
    const { wm } = client(() =>
      json({
        query: {
          pages: [
            { title: "File:Bad<title>.jpg", invalid: true },
            {
              title: `File:${PHOTO.portrait}`,
              imagerepository: "shared",
              imageinfo: [{}],
            },
            {
              title: `File:${PHOTO.attributed}`,
              imagerepository: "local",
              imageinfo: [{ sha1: "nope" }],
            },
            {
              title: `File:${PHOTO.small}`,
              imagerepository: "local",
              imageinfo: [{ canonicaltitle: "File:Other.jpg" }],
            },
            "not a page",
          ],
        },
      }),
    );
    const result = await wm.getFiles([PHOTO.onStage]);
    expect(result).toEqual({ files: [], missing: [] });
    expect(good.sha1).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("Wikidata suggestions", () => {
  it("finds the one item with the MusicBrainz artist ID", async () => {
    const { wm, calls } = client();
    expect(
      await wm.itemForMusicBrainzArtist(FIXTURE.inkQuartet.toUpperCase()),
    ).toBe(ITEM.inkQuartet);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe(`${WIKIDATA}api.php`);
    expect(url.searchParams.get("srsearch")).toBe(
      `haswbstatement:P434=${FIXTURE.inkQuartet}`,
    );
  });

  it("suggests nothing when two items share the identifier, or none has it", async () => {
    const { wm } = client();
    expect(await wm.itemForMusicBrainzArtist(FIXTURE.paperSinger)).toBeNull();
    expect(await wm.itemForMusicBrainzArtist(FIXTURE.paperMoon)).toBeNull();
  });

  it("never sends something that is not an MBID or an item id", async () => {
    const { wm, calls } = client();
    expect(
      await wm.itemForMusicBrainzArtist("x OR haswbstatement:P31=Q5"),
    ).toBeNull();
    expect(await wm.itemImages("Q1|Q2")).toEqual([]);
    expect(await wm.filesDepicting("Q1 insource:/x/")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("reads the item's images, preferred first, without deprecated ones", async () => {
    const { wm, calls } = client();
    expect(await wm.itemImages(ITEM.inkQuartet)).toEqual([
      PHOTO.onStage,
      PHOTO.removed,
    ]);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("action")).toBe("wbgetclaims");
    expect(url.searchParams.get("property")).toBe("P18");
  });

  it("searches files that depict the item", async () => {
    const { wm, calls } = client();
    const files = await wm.filesDepicting(ITEM.inkQuartet);
    expect(new URL(calls[0]!.url).searchParams.get("gsrsearch")).toBe(
      `haswbstatement:P180=${ITEM.inkQuartet} filetype:bitmap`,
    );
    expect(files.map((file) => file.fileName)).toEqual([
      PHOTO.portrait,
      PHOTO.nonCommercial,
    ]);
  });
});
