import { describe, expect, it } from "vitest";

import { commonsThumbnail } from "@/testing/wikimedia-fixtures";

import {
  artistPhotoOf,
  encodePhotoName,
  parsePhotoSourceUrl,
  photoFileName,
  photoFileNameOfTitle,
  photoImageOf,
  photoSourceUrl,
  photoThumbnailUrl,
  type StoredArtistPhoto,
} from "./photo";

const NAME = "Test_Ink_Quartet_on_stage.jpg";

function stored(overrides: Partial<StoredArtistPhoto> = {}): StoredArtistPhoto {
  return {
    photoUrl: photoThumbnailUrl(NAME, 330),
    photoCredit: "[Test] Photographer One",
    photoLicense: "CC BY-SA 4.0",
    photoSourceUrl: photoSourceUrl(NAME),
    photoFileSha1: "a".repeat(40),
    photoFileTimestamp: new Date("2019-05-04T12:00:00Z"),
    photoChosenAt: new Date("2026-11-02T12:00:00Z"),
    ...overrides,
  };
}

describe("photo addresses", () => {
  it("builds thumbnails the way Commons does (checked live)", () => {
    // Seen live on 2026-11-02 (docs/evidence/m3-3.md): the MD5 directories
    // and the parentheses encoded.
    expect(photoThumbnailUrl("Nina_Simone_(1965).jpg", 330)).toBe(
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/25/Nina_Simone_%281965%29.jpg/330px-Nina_Simone_%281965%29.jpg",
    );
    expect(photoThumbnailUrl("Nina_Simone_-1969.jpg", 330)).toContain(
      "/thumb/8/89/Nina_Simone_-1969.jpg/330px-",
    );
  });

  it.each([
    NAME,
    "Tést_Ünïcode_ação.png",
    "O'Brien_&_Co._(live),_2001!.jpeg",
    "Name+with=signs;and@$~.JPG",
  ])("agrees with an independent rawurlencode for %s", (name) => {
    expect(photoFileName(name)).toBe(name);
    for (const width of [330, 500]) {
      expect(photoThumbnailUrl(name, width)).toBe(
        commonsThumbnail(name, width),
      );
    }
    expect(encodePhotoName(name)).not.toMatch(/[!'()*]/);
  });

  it("offers the 330 and 500 px thumbnails only", () => {
    const image = photoImageOf(NAME);
    expect(image.src).toBe(photoThumbnailUrl(NAME, 330));
    expect(image.srcSet).toBe(
      `${photoThumbnailUrl(NAME, 330)} 330w, ${photoThumbnailUrl(NAME, 500)} 500w`,
    );
  });

  it.each([
    "",
    "a.gif",
    "photo.svg",
    "photo.tif",
    "no_extension",
    "two__underscores.jpg",
    "_leading.jpg",
    "with space.jpg",
    "slash/path.jpg",
    "colon:name.jpg",
    "back\\slash.jpg",
    "hash#.jpg",
    "query?.jpg",
    "percent%41.jpg",
    'quote".jpg',
    "angle<b>.jpg",
    "brackets[1].jpg",
    "pipe|.jpg",
    "dots..jpg",
    "control\u0007.jpg",
    "é-decomposed.jpg",
    `${"x".repeat(150)}.jpg`,
  ])("refuses the file name %j", (name) => {
    expect(photoFileName(name)).toBeNull();
  });

  it("reads File: titles", () => {
    expect(photoFileNameOfTitle("File:Test Ink Quartet on stage.jpg")).toBe(
      NAME,
    );
    expect(photoFileNameOfTitle("Image:Test.jpg")).toBeNull();
    expect(photoFileNameOfTitle("Test.jpg")).toBeNull();
    expect(photoFileNameOfTitle(undefined)).toBeNull();
  });

  it("parses only the canonical source address", () => {
    expect(parsePhotoSourceUrl(photoSourceUrl(NAME))).toBe(NAME);
    const name = "Nina_Simone_(1965).jpg";
    expect(parsePhotoSourceUrl(photoSourceUrl(name))).toBe(name);
    for (const value of [
      `https://commons.wikimedia.org/wiki/File:Nina_Simone_(1965).jpg`,
      `http://commons.wikimedia.org/wiki/File:${NAME}`,
      `https://commons.wikimedia.org/wiki/File:${NAME}?x=1`,
      `https://commons.wikimedia.org/wiki/File:${NAME}#top`,
      `https://commons.m.wikimedia.org/wiki/File:${NAME}`,
      `https://evil.example/wiki/File:${NAME}`,
      `https://commons.wikimedia.org/wiki/Image:${NAME}`,
      `https://commons.wikimedia.org/wiki/File:%E0%A4%A.jpg`,
      `https://commons.wikimedia.org/wiki/File:a%2Fb.jpg`,
      `https://commons.wikimedia.org@evil.example/wiki/File:${NAME}`,
      ` ${photoSourceUrl(NAME)}`,
      null,
      42,
    ]) {
      expect(parsePhotoSourceUrl(value)).toBeNull();
    }
  });
});

describe("stored photographs", () => {
  it("reads a stored photograph with its attribution", () => {
    expect(artistPhotoOf(stored())).toEqual({
      ...photoImageOf(NAME),
      fileName: NAME,
      title: "Test Ink Quartet on stage.jpg",
      sourceUrl: photoSourceUrl(NAME),
      credit: "[Test] Photographer One",
      license: expect.objectContaining({
        name: "CC BY-SA 4.0",
        url: "https://creativecommons.org/licenses/by-sa/4.0/",
      }),
      modifications: "Resized, and cropped to fit the frame. No other changes.",
    });
  });

  it.each<[string, Partial<StoredArtistPhoto>]>([
    ["no photograph", { photoUrl: null, photoSourceUrl: null }],
    [
      "another host",
      {
        photoUrl: photoThumbnailUrl(NAME, 330).replace(
          "thumb.wikimedia.org",
          "evil.example",
        ),
      },
    ],
    [
      "the original file",
      {
        photoUrl: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${NAME}`,
      },
    ],
    ["another width", { photoUrl: photoThumbnailUrl(NAME, 500) }],
    ["a query", { photoUrl: `${photoThumbnailUrl(NAME, 330)}?x=1` }],
    [
      "another file's thumbnail",
      { photoUrl: photoThumbnailUrl("Other.jpg", 330) },
    ],
    ["javascript", { photoUrl: "javascript:alert(1)" }],
    ["a data URL", { photoUrl: "data:image/png;base64,AAAA" }],
    ["an unknown license", { photoLicense: "CC BY-NC 4.0" }],
    ["a license in other case", { photoLicense: "cc by-sa 4.0" }],
    ["markup in the credit", { photoCredit: "<b>[Test]</b>" }],
    ["an empty credit", { photoCredit: "" }],
    ["a credit on two lines", { photoCredit: "[Test]\nPhotographer" }],
    ["a long credit", { photoCredit: "x".repeat(301) }],
    ["no SHA-1", { photoFileSha1: null }],
    ["an uppercase SHA-1", { photoFileSha1: "A".repeat(40) }],
    ["no file time", { photoFileTimestamp: null }],
    ["no approval time", { photoChosenAt: null }],
    [
      "a source with no file",
      { photoSourceUrl: "https://commons.wikimedia.org/wiki/Main_Page" },
    ],
  ])("shows the fallback for %s", (_label, overrides) => {
    expect(artistPhotoOf(stored(overrides))).toBeNull();
  });
});
