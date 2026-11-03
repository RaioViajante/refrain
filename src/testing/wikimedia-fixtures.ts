import { createHash } from "node:crypto";

import { FIXTURE } from "./provider-fixtures";

/**
 * How Commons addresses a thumbnail, written here independently of the
 * application's builder (src/integrations/wikimedia-commons/photo.ts), so a
 * difference between the two fails the tests: the MD5 directories of the
 * name, and the name encoded like PHP's rawurlencode (live:
 * `Nina_Simone_%281965%29.jpg` under `2/25/`).
 */
export function commonsThumbnail(fileName: string, width: number): string {
  const md5 = createHash("md5").update(fileName).digest("hex");
  const encoded = [...Buffer.from(fileName, "utf8")]
    .map((byte) => {
      const character = String.fromCharCode(byte);
      return /[A-Za-z0-9_.~-]/.test(character)
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return `https://thumb.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5.slice(0, 2)}/${encoded}/${width}px-${encoded}`;
}

// Deterministic Wikimedia Commons and Wikidata answers for the tests (M3.3).
// Every file, person, and photographer is synthetic and labelled `[Test]` or
// `Test_`; no real photograph or real metadata is used. The shapes follow the
// live answers recorded in docs/evidence/m3-3.md: `formatversion=2`, pages in
// an array with `index` for search results, `missing: true` for a file that
// does not exist, `thumburl` on thumb.wikimedia.org with a tracking query,
// and extended metadata as `{ value, source }` objects holding HTML.

/** File names, as Commons stores them (underscores for spaces). */
export const PHOTO = {
  /** CC BY-SA 4.0; the creator is a link; a personality-rights warning. */
  onStage: "Test_Ink_Quartet_on_stage.jpg",
  /** CC0, a PNG; plain-text creator. */
  portrait: "Test_Ink_Quartet_portrait.png",
  /** CC BY 4.0 with a designated `Attribution` that replaces the creator. */
  attributed: "Test_Ink_Quartet_with_attribution.jpg",
  /** CC BY-NC-SA 4.0: not accepted. */
  nonCommercial: "Test_Ink_Quartet_noncommercial.jpg",
  /** CC BY-SA 4.0, but the creator is "Unknown author" (the uploader is known). */
  unknownAuthor: "Test_Ink_Quartet_unknown_author.jpg",
  /** The short name says CC BY-SA 4.0, the code CC BY 4.0. */
  mismatch: "Test_Ink_Quartet_license_mismatch.jpg",
  /** The creator field is hostile markup. */
  hostile: "Test_Ink_Quartet_hostile_markup.jpg",
  /** 320 × 400 px. */
  small: "Test_Ink_Quartet_small.jpg",
  /** A GIF. */
  animated: "Test_Ink_Quartet_poster.gif",
  /** A jurisdiction port, CC BY-SA 3.0 de: not accepted. */
  ported: "Test_Ink_Quartet_ported_license.jpg",
  /** Its thumbnail address is on another host. */
  elsewhere: "Test_Ink_Quartet_elsewhere.jpg",
  /** Public domain; found through Wikidata for the paper singer. */
  publicDomain: "Test_Paper_Singer_public_domain.jpg",
  /** A new version on every lookup: approving it is always stale. */
  changing: "Test_Paper_Singer_changing.jpg",
  /** Commons has no such file (deleted). */
  removed: "Test_Ink_Quartet_removed.jpg",
} as const;

/** Wikidata items. */
export const ITEM = {
  inkQuartet: "Q9000001",
  paperSingerA: "Q9000002",
  paperSingerB: "Q9000003",
} as const;

/** Search words that make the mock answer in a particular way. */
export const PHOTO_SCENARIO = {
  /** Commons answers 503 every time. */
  unavailable: "test unreachable photos",
  /** A body that does not match the contract. */
  malformed: "test malformed photos",
  /** No results. */
  nothing: "test no photos",
} as const;

const SHA1 = (seed: number) => seed.toString(16).padStart(40, "a");

interface FileFixture {
  sha1: string;
  width: number;
  height: number;
  mime: string;
  mediatype?: string;
  thumbHost?: string;
  metadata: Record<string, string>;
}

const ccBySa4 = {
  LicenseShortName: "CC BY-SA 4.0",
  License: "cc-by-sa-4.0",
  LicenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  UsageTerms: "Creative Commons Attribution-Share Alike 4.0",
  AttributionRequired: "true",
  Copyrighted: "True",
  Restrictions: "",
};

const FILES: Record<string, FileFixture> = {
  [PHOTO.onStage]: {
    sha1: SHA1(1),
    width: 2000,
    height: 2500,
    mime: "image/jpeg",
    metadata: {
      ...ccBySa4,
      Artist:
        '<a href="//commons.wikimedia.org/wiki/User:Test_Photographer_One" title="User:Test Photographer One">[Test] Photographer One</a>',
      Credit: '<span class="int-own-work" lang="en">Own work</span>',
      Restrictions: "personality",
    },
  },
  [PHOTO.portrait]: {
    sha1: SHA1(2),
    width: 1200,
    height: 1500,
    mime: "image/png",
    metadata: {
      LicenseShortName: "CC0",
      License: "cc0",
      LicenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
      UsageTerms: "Creative Commons Zero, Public Domain Dedication",
      AttributionRequired: "false",
      Copyrighted: "True",
      Artist: "[Test] Photographer Two",
      Credit: "[Test] Archive, item 918",
      Restrictions: "",
    },
  },
  [PHOTO.attributed]: {
    sha1: SHA1(3),
    width: 1600,
    height: 2000,
    mime: "image/jpeg",
    metadata: {
      LicenseShortName: "CC BY 4.0",
      License: "cc-by-4.0",
      LicenseUrl: "https://creativecommons.org/licenses/by/4.0/deed.en",
      UsageTerms: "Creative Commons Attribution 4.0",
      AttributionRequired: "true",
      Copyrighted: "True",
      Artist: "[Test] Photographer Three",
      Attribution: "Photo: [Test] Photographer Three / [Test] Studio Archive",
      Credit: "[Test] Studio Archive",
      Restrictions: "",
    },
  },
  [PHOTO.nonCommercial]: {
    sha1: SHA1(4),
    width: 2000,
    height: 2500,
    mime: "image/jpeg",
    metadata: {
      LicenseShortName: "CC BY-NC-SA 4.0",
      License: "cc-by-nc-sa-4.0",
      LicenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0",
      AttributionRequired: "true",
      Copyrighted: "True",
      Artist: "[Test] Photographer Five",
    },
  },
  [PHOTO.unknownAuthor]: {
    sha1: SHA1(5),
    width: 2000,
    height: 2500,
    mime: "image/jpeg",
    metadata: { ...ccBySa4, Artist: "Unknown author" },
  },
  [PHOTO.mismatch]: {
    sha1: SHA1(6),
    width: 2000,
    height: 2500,
    mime: "image/jpeg",
    metadata: {
      ...ccBySa4,
      License: "cc-by-4.0",
      Artist: "[Test] Photographer Six",
    },
  },
  [PHOTO.hostile]: {
    sha1: SHA1(7),
    width: 2000,
    height: 2500,
    mime: "image/jpeg",
    metadata: {
      ...ccBySa4,
      Artist:
        '<script>alert("x")</script><img src=x onerror=alert(1)>&lt;b onmouseover=alert(2)&gt;[Test] Evil&lt;/b&gt;',
    },
  },
  [PHOTO.small]: {
    sha1: SHA1(8),
    width: 320,
    height: 400,
    mime: "image/jpeg",
    metadata: { ...ccBySa4, Artist: "[Test] Photographer Eight" },
  },
  [PHOTO.animated]: {
    sha1: SHA1(9),
    width: 800,
    height: 1000,
    mime: "image/gif",
    metadata: { ...ccBySa4, Artist: "[Test] Photographer Nine" },
  },
  [PHOTO.ported]: {
    sha1: SHA1(10),
    width: 2000,
    height: 2500,
    mime: "image/jpeg",
    metadata: {
      LicenseShortName: "CC BY-SA 3.0 de",
      License: "cc-by-sa-3.0-de",
      LicenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/de/",
      AttributionRequired: "true",
      Copyrighted: "True",
      Artist: "[Test] Photographer Ten",
    },
  },
  [PHOTO.elsewhere]: {
    sha1: SHA1(11),
    width: 2000,
    height: 2500,
    mime: "image/jpeg",
    thumbHost: "https://images.example.test",
    metadata: { ...ccBySa4, Artist: "[Test] Photographer Eleven" },
  },
  [PHOTO.publicDomain]: {
    sha1: SHA1(12),
    width: 1400,
    height: 1750,
    mime: "image/jpeg",
    metadata: {
      LicenseShortName: "Public domain",
      License: "pd",
      UsageTerms: "Public domain",
      AttributionRequired: "false",
      Copyrighted: "False",
      Artist: "<bdi>[Test] Photographer Twelve</bdi>",
      Restrictions: "",
    },
  },
  [PHOTO.changing]: {
    sha1: SHA1(13),
    width: 1400,
    height: 1750,
    mime: "image/jpeg",
    metadata: {
      LicenseShortName: "Public domain",
      License: "pd",
      AttributionRequired: "false",
      Copyrighted: "False",
      Artist: "[Test] Photographer Thirteen",
    },
  },
};

/** What a stored file's details were when a test made it (for comparisons). */
export function photoFixture(fileName: string): FileFixture | undefined {
  return FILES[fileName];
}

/** The SHA-1 the mock reports for a file now. */
export function photoSha1(fileName: string): string | undefined {
  return FILES[fileName]?.sha1;
}

let changingVersion = 0;

function pageOf(fileName: string, index: number) {
  const fixture = FILES[fileName];
  const title = `File:${fileName.replace(/_/g, " ")}`;
  if (!fixture) {
    return { ns: 6, title, missing: true, imagerepository: "" };
  }
  const sha1 =
    fileName === PHOTO.changing
      ? (changingVersion += 1).toString(16).padStart(40, "c")
      : fixture.sha1;
  const thumb = commonsThumbnail(fileName, 330).replace(
    "https://thumb.wikimedia.org",
    fixture.thumbHost ?? "https://thumb.wikimedia.org",
  );
  const metadata = Object.fromEntries(
    Object.entries(fixture.metadata).map(([field, value]) => [
      field,
      { value, source: "commons-desc-page" },
    ]),
  );
  return {
    pageid: 900000 + index,
    ns: 6,
    title,
    ...(index > 0 ? { index } : {}),
    imagerepository: "local",
    imageinfo: [
      {
        timestamp: "2019-05-04T12:00:00Z",
        size: 1234567,
        width: fixture.width,
        height: fixture.height,
        canonicaltitle: title,
        thumburl: `${thumb}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`,
        thumbwidth: 330,
        thumbheight: Math.round((330 * fixture.height) / fixture.width),
        url: `https://upload.wikimedia.org/wikipedia/commons/x/xx/${encodeURIComponent(fileName)}`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`,
        descriptionshorturl: `https://commons.wikimedia.org/w/index.php?curid=${900000 + index}`,
        sha1,
        extmetadata: metadata,
        mime: fixture.mime,
        mediatype: fixture.mediatype ?? "BITMAP",
      },
    ],
  };
}

const INK_SEARCH = [
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
];

const query = (pages: unknown[]) => ({
  batchcomplete: true,
  ...(pages.length > 0 ? { query: { pages } } : {}),
});

/** A Commons `generator=search` answer for the search text. */
export function commonsSearch(search: string) {
  const text = search.toLowerCase();
  if (text.includes(`haswbstatement:p180=${ITEM.inkQuartet.toLowerCase()}`)) {
    return query(
      [PHOTO.portrait, PHOTO.nonCommercial].map((name, i) =>
        pageOf(name, i + 1),
      ),
    );
  }
  if (text.includes("haswbstatement:")) {
    return query([]);
  }
  if (text.includes("ink")) {
    return query(INK_SEARCH.map((name, i) => pageOf(name, i + 1)));
  }
  if (text.includes("paper")) {
    return query(
      [PHOTO.publicDomain, PHOTO.changing].map((name, i) =>
        pageOf(name, i + 1),
      ),
    );
  }
  return query([]);
}

/** A Commons `titles=` lookup. */
export function commonsLookup(titles: string) {
  return query(
    titles
      .split("|")
      .map((title) => title.replace(/^File:/, "").replace(/ /g, "_"))
      .map((name) => pageOf(name, 0)),
  );
}

/** A Wikidata `haswbstatement:P434=` search. */
export function wikidataSearch(search: string) {
  const id = search.replace(/^haswbstatement:P434=/i, "").toLowerCase();
  const titles =
    id === FIXTURE.inkQuartet
      ? [ITEM.inkQuartet]
      : id === FIXTURE.paperSinger
        ? [ITEM.paperSingerA, ITEM.paperSingerB]
        : [];
  return {
    batchcomplete: true,
    query: {
      searchinfo: { totalhits: titles.length },
      search: titles.map((title, i) => ({ ns: 0, title, pageid: 100 + i })),
    },
  };
}

/** `wbgetclaims` for P18. */
export function wikidataClaims(entity: string) {
  const images =
    entity === ITEM.inkQuartet
      ? [
          { value: PHOTO.onStage.replace(/_/g, " "), rank: "preferred" },
          { value: PHOTO.removed.replace(/_/g, " "), rank: "normal" },
          { value: "Test Ink Quartet logo.svg", rank: "deprecated" },
        ]
      : [];
  return {
    claims: {
      P18: images.map((image) => ({
        mainsnak: {
          snaktype: "value",
          property: "P18",
          datavalue: { value: image.value, type: "string" },
          datatype: "commonsMedia",
        },
        type: "statement",
        rank: image.rank,
      })),
    },
  };
}
