import { describe, expect, it } from "vitest";

import { ProviderError } from "@/integrations/provider";
import { FIXTURE } from "@/testing/provider-fixtures";
import { providerResponse } from "@/testing/provider-mock";
import { virtualRuntime } from "@/testing/provider-runtime";

import {
  canonicalCoverUrl,
  COVER_ART_SOURCE,
  coverArtworkOf,
  parseCoverUrl,
} from "./artwork";
import { createCoverArtArchiveClient } from "./client";

const RELEASE = FIXTURE.firstPressing;
const STORED = `https://coverartarchive.org/release/${RELEASE}/${FIXTURE.frontImage}`;

describe("the stored cover address", () => {
  it("round-trips the one canonical form", () => {
    const reference = parseCoverUrl(STORED);
    expect(reference).toEqual({
      releaseId: RELEASE,
      imageId: FIXTURE.frontImage,
    });
    expect(canonicalCoverUrl(reference!)).toBe(STORED);
  });

  it.each([
    ["http, not https", STORED.replace("https:", "http:")],
    ["another host", STORED.replace("coverartarchive.org", "evil.example")],
    [
      "a look-alike host",
      STORED.replace("coverartarchive.org", "coverartarchive.org.evil.example"),
    ],
    [
      "a subdomain",
      STORED.replace("coverartarchive.org", "x.coverartarchive.org"),
    ],
    ["a size suffix", `${STORED}-500`],
    ["an extension", `${STORED}.jpg`],
    ["a trailing slash", `${STORED}/`],
    ["a query", `${STORED}?x=1`],
    ["a fragment", `${STORED}#x`],
    [
      "front instead of an id",
      `https://coverartarchive.org/release/${RELEASE}/front`,
    ],
    [
      "a release group",
      `https://coverartarchive.org/release-group/${RELEASE}/${FIXTURE.frontImage}`,
    ],
    ["uppercase MBID", STORED.replace(RELEASE, RELEASE.toUpperCase())],
    ["a leading zero", `https://coverartarchive.org/release/${RELEASE}/0123`],
    [
      "path traversal",
      `https://coverartarchive.org/release/${RELEASE}/../../x`,
    ],
    ["credentials", STORED.replace("https://", "https://user@")],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:image/png;base64,AAAA"],
    ["leading space", ` ${STORED}`],
    ["a newline", `${STORED}\n`],
    ["empty", ""],
  ])("is not artwork with %s", (_, value) => {
    expect(parseCoverUrl(value)).toBeNull();
    expect(coverArtworkOf(value, COVER_ART_SOURCE)).toBeNull();
  });

  it("builds HTTPS thumbnails from the parts, never from stored text", () => {
    const artwork = coverArtworkOf(STORED, COVER_ART_SOURCE);
    expect(artwork).toEqual({
      src: `https://coverartarchive.org/release/${RELEASE}/${FIXTURE.frontImage}-500.jpg`,
      srcSet: [250, 500, 1200]
        .map(
          (size) =>
            `https://coverartarchive.org/release/${RELEASE}/${FIXTURE.frontImage}-${size}.jpg ${size}w`,
        )
        .join(", "),
      coverUrl: STORED,
    });
  });

  it("needs the recorded source as well", () => {
    expect(coverArtworkOf(STORED, null)).toBeNull();
    expect(coverArtworkOf(STORED, "somewhere else")).toBeNull();
    expect(coverArtworkOf(null, COVER_ART_SOURCE)).toBeNull();
  });

  it("refuses to build an address from invalid parts", () => {
    expect(
      canonicalCoverUrl({ releaseId: "x/../y", imageId: FIXTURE.frontImage }),
    ).toBeNull();
    expect(
      canonicalCoverUrl({ releaseId: RELEASE, imageId: "12a" }),
    ).toBeNull();
  });
});

describe("the archive listing", () => {
  const MOCK = "http://127.0.0.1:4010/caa/";

  function archive() {
    const fake = virtualRuntime((url) => providerResponse(url));
    return {
      ...fake,
      caa: createCoverArtArchiveClient({
        baseUrl: MOCK,
        runtime: fake.runtime,
      }),
    };
  }

  it("follows the redirect to the listing and returns validated images", async () => {
    const { caa, calls } = archive();
    const images = await caa.listReleaseImages(RELEASE);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      `/caa/release/${RELEASE}`,
      `/caa/download/release/${RELEASE}/index.json`,
    ]);
    expect(images).toEqual([
      expect.objectContaining({
        releaseId: RELEASE,
        imageId: FIXTURE.frontImage,
        front: true,
      }),
      expect.objectContaining({
        imageId: FIXTURE.backImage,
        front: false,
        back: true,
      }),
    ]);
    // A numeric id larger than 32 bits survives as digits.
    const legacy = await caa.listReleaseImages(FIXTURE.legacyEdition);
    expect(legacy[0]!.imageId).toBe(FIXTURE.legacyFrontImage);
  });

  it("treats no artwork as an empty answer, cached for a while", async () => {
    const { caa, calls } = archive();
    await expect(
      caa.listReleaseImages(FIXTURE.digitalEdition),
    ).resolves.toEqual([]);
    await expect(
      caa.listReleaseImages(FIXTURE.digitalEdition),
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("lists again when a fresh answer is required", async () => {
    const { caa, calls } = archive();
    await caa.listReleaseImages(RELEASE);
    await caa.listReleaseImages(RELEASE);
    expect(calls).toHaveLength(2); // the listing and its redirect
    await caa.listReleaseImages(RELEASE, { fresh: true });
    expect(calls).toHaveLength(4);
  });

  it("names the release each image of a release group belongs to", async () => {
    const { caa } = archive();
    const images = await caa.listReleaseGroupImages(FIXTURE.paperMoon);
    expect(images[0]!.releaseId).toBe(RELEASE);
  });

  it("follows redirects only over HTTPS to the archive's hosts", async () => {
    const real = (location: string) =>
      createCoverArtArchiveClient({
        runtime: virtualRuntime((url) =>
          url.startsWith("https://coverartarchive.org/")
            ? new Response(null, { status: 307, headers: { location } })
            : new Response(
                JSON.stringify({
                  images: [],
                  release: `https://musicbrainz.org/release/${RELEASE}`,
                }),
              ),
        ).runtime,
      });
    await expect(
      real("https://archive.org/download/x/index.json").listReleaseImages(
        RELEASE,
      ),
    ).resolves.toEqual([]);
    await expect(
      real(
        "https://dn710600.ca.archive.org/0/items/x/index.json",
      ).listReleaseImages(RELEASE),
    ).resolves.toEqual([]);
    for (const location of [
      "http://archive.org/download/x/index.json",
      "https://archive.org.evil.example/x",
      "https://evil.example/archive.org/x",
      "http://127.0.0.1:5432/",
    ]) {
      const error = await real(location)
        .listReleaseImages(RELEASE)
        .catch((caught: unknown) => caught);
      expect(error, location).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).failure).toBe("invalid_response");
    }
  });

  it("refuses a listing for another release", async () => {
    const caa = createCoverArtArchiveClient({
      runtime: virtualRuntime(
        () =>
          new Response(
            JSON.stringify({
              images: [],
              release: `https://musicbrainz.org/release/${FIXTURE.legacyEdition}`,
            }),
          ),
      ).runtime,
    });
    const error = await caa
      .listReleaseImages(RELEASE)
      .catch((caught: unknown) => caught);
    expect((error as ProviderError).failure).toBe("invalid_response");
  });

  it("checks the identifier before calling", async () => {
    const { caa, calls } = archive();
    const error = await caa
      .listReleaseImages("../release/x")
      .catch((caught: unknown) => caught);
    expect((error as ProviderError).failure).toBe("not_found");
    expect(calls).toHaveLength(0);
  });
});
