import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ADR 0013 step 4: every catalog writer is classified, and the test fails
// when one is missing, changes its guard, or appears outside the Catalog
// module. The classes:
//
// - confirm: it can change a served page, so it goes through the
//   `catalog_change` gate (`confirmCatalogChange`) when it does;
// - refuse: in its protected case it is refused outright (A3, A5, or ADR
//   0013 § 1.3's permanent refusals), and otherwise harmless;
// - reduction: it only takes something away from a page, which ADR 0006 A5
//   and ADR 0013 § 1.3 allow without a confirmation (the takedown paths);
// - harmless: nothing a served page renders changes, for the reason given;
// - reader: it writes nothing.
//
// The behaviour behind each class is tested on PostgreSQL in
// catalog-confirmation.integration.test.ts and the step 1–4 suites.

type Class = "confirm" | "refuse" | "reduction" | "harmless" | "reader";

interface Entry {
  class: Class;
  /** Text the function must contain, in this order. */
  evidence?: string[];
  /** Why it is classified so (required for harmless and reduction). */
  reason?: string;
}

const CATALOG = "src/modules/catalog";

const INVENTORY: Record<string, Record<string, Entry>> = {
  "commands.ts": {
    createArtist: {
      class: "harmless",
      reason: "a new artist is on no served page",
    },
    updateArtist: {
      class: "confirm",
      evidence: [
        "lockArtistPublicExposure(",
        "confirmCatalogChange(",
        ".update(schema.artists)",
        "advanceArtist(",
      ],
    },
    previewArtistChange: { class: "reader" },
    archiveArtist: {
      class: "reduction",
      evidence: ["lockArtistPublicExposure("],
      reason:
        "A5: archiving only closes an artist page; its credits become plain text",
    },
    restoreArtist: {
      class: "refuse",
      evidence: [
        "lockArtistRestoreExposure(",
        'throw new CatalogError("public_page")',
        ".update(schema.artists)",
      ],
      reason:
        "refused when it would open a page; otherwise the artist stays on no served page",
    },
    deleteArtist: {
      class: "harmless",
      reason:
        "the RESTRICT foreign keys refuse an artist any credit or journal uses",
    },
    createAlbum: {
      class: "harmless",
      reason: "a new album has no journal and no memory link",
    },
    updateAlbum: {
      class: "confirm",
      evidence: [
        "lockAlbumCatalogChange(",
        "artistsNewlyExposedByCredit(",
        "confirmCatalogChange(",
        ".update(schema.albums)",
        "advanceAlbum(",
      ],
    },
    previewAlbumChange: { class: "reader" },
    archiveAlbum: {
      class: "harmless",
      reason: "no public read selects albums.archived_at",
    },
    restoreAlbum: {
      class: "harmless",
      reason: "no public read selects albums.archived_at",
    },
    deleteAlbum: {
      class: "refuse",
      evidence: [
        "lockAlbumCatalogChange(",
        "albumHasTrackInServedMemory(",
        'throw new CatalogError("public_page")',
        ".delete(schema.albums)",
      ],
      reason:
        "a served journal or memory album link is RESTRICT; a served memory's track is refused",
    },
    createTrack: {
      class: "confirm",
      evidence: [
        "lockAlbumCatalogChange(",
        "confirmCatalogChange(",
        ".insert(schema.tracks)",
        "rewriteTracklist(",
        "advanceAlbum(",
      ],
      reason: "without an album, a new track is on no page",
    },
    updateTrack: {
      class: "confirm",
      evidence: [
        "lockTrackCatalogChange(",
        "confirmCatalogChange(",
        ".update(schema.tracks)",
        "advanceTrack(",
      ],
    },
    previewTrackChange: { class: "reader" },
    archiveTrack: {
      class: "harmless",
      reason: "no public read selects tracks.archived_at",
    },
    restoreTrack: {
      class: "harmless",
      reason: "no public read selects tracks.archived_at",
    },
    deleteTrack: {
      class: "harmless",
      reason:
        "the RESTRICT foreign keys refuse a track any album, credit, reflection, or memory uses",
    },
    setAlbumTracklist: {
      class: "confirm",
      evidence: [
        "lockAlbumCatalogChange(",
        "desiredTracklist(",
        "confirmCatalogChange(",
        "rewriteTracklist(",
        "advanceAlbum(",
      ],
    },
    addTrackToAlbum: { class: "confirm", evidence: ["applyTracklistEdit("] },
    removeTrackFromAlbum: {
      class: "confirm",
      evidence: ["applyTracklistEdit("],
    },
    moveTrackInAlbum: { class: "confirm", evidence: ["applyTracklistEdit("] },
    editTracklist: {
      class: "confirm",
      evidence: [
        "addTrackToAlbum(",
        "removeTrackFromAlbum(",
        "moveTrackInAlbum(",
        "setAlbumTracklist(",
        "createTrack(",
      ],
    },
    previewTracklistChange: { class: "reader" },
    translateCatalogFailure: { class: "reader" },
  },
  "music.ts": {
    searchMusic: { class: "reader" },
    listMusicEditions: { class: "reader" },
    reviewMusicRelease: { class: "reader" },
    importMusicRelease: {
      class: "refuse",
      evidence: [
        "lockReleaseImport(",
        "catalogChangeAltersServedPages(",
        'throw new CatalogError("public_page")',
        ".insert(schema.albums)",
      ],
      reason:
        "refused when a reused recording would change a served memory's named album; otherwise only new records",
    },
    linkAlbumToMusic: {
      class: "harmless",
      evidence: ["lockAlbumCatalogChange("],
      reason:
        "fills identifiers only; a created reference edition has no label and no tracks, which the page renders as before",
    },
    reviewMusicArtist: { class: "reader" },
    importMusicArtist: {
      class: "harmless",
      reason: "a new artist is on no served page",
    },
    linkArtistToMusic: {
      class: "harmless",
      reason: "fills a MusicBrainz identifier, which no page renders",
    },
    listAlbumArtworkChoices: { class: "reader" },
    defaultProviders: { class: "reader" },
    reviewOf: { class: "reader" },
    artistKindOf: { class: "reader" },
    planReleaseImport: { class: "reader" },
    linkPlanOf: { class: "reader" },
    artistPlanOf: { class: "reader" },
    coverStateOf: { class: "reader" },
    setAlbumArtwork: {
      class: "refuse",
      evidence: [
        "lockAlbumPublicExposure(",
        'throw new CatalogError("public_page")',
      ],
      reason: "A3",
    },
    removeAlbumArtwork: {
      class: "refuse",
      evidence: [
        "lockAlbumPublicExposure(",
        'throw new CatalogError("public_page")',
      ],
      reason: "A3 (A8, #102, would make it a reduction)",
    },
  },
  "photos.ts": {
    listArtistPhotoChoices: { class: "reader" },
    reviewArtistPhoto: { class: "reader" },
    defaultPhotoProviders: { class: "reader" },
    photoStateOf: { class: "reader" },
    storedPhotoView: { class: "reader" },
    setArtistPhoto: {
      class: "refuse",
      evidence: [
        "lockArtistPublicExposure(",
        'throw new CatalogError("public_page")',
      ],
      reason: "A5",
    },
    removeArtistPhoto: {
      class: "reduction",
      reason:
        "A5: removing a photograph only takes it away; the page shows its fallback",
    },
  },
};

const WRITE =
  /\.(insert|update|delete)\(schema\.|\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b|rewriteTracklist\(|replace(Album|Track)Credits\(|resolve(Artists|Tracks)\(|applyTracklistEdit\(/i;

function exportedFunctions(code: string): Map<string, string> {
  const found = new Map<string, string>();
  const starts = [
    ...code.matchAll(
      /^export (?:async function (\w+)\(|function (\w+)\(|const (\w+) = async)/gm,
    ),
  ].map((match) =>
    Object.assign(match, { 1: match[1] ?? match[2] ?? match[3] }),
  );
  for (const match of starts) {
    // A top-level function ends at the first line that is only "}".
    const close = code.indexOf("\n}\n", match.index);
    const end = close === -1 ? code.length : close + 3;
    found.set(match[1]!, code.slice(match.index, end));
  }
  return found;
}

describe("every catalog writer is classified", () => {
  for (const [file, entries] of Object.entries(INVENTORY)) {
    const code = readFileSync(join(CATALOG, file), "utf8");
    const functions = exportedFunctions(code);

    it(`${file}: the inventory names exactly its exported commands`, () => {
      expect([...functions.keys()].sort()).toEqual(Object.keys(entries).sort());
    });

    it.each(Object.entries(entries))(`${file}: %s`, (name, entry) => {
      const body = functions.get(name)!;
      expect(body, name).toBeDefined();
      if (entry.class === "reader") {
        expect(WRITE.test(body), `${name} writes`).toBe(false);
        return;
      }
      if (entry.class === "harmless" || entry.class === "reduction") {
        expect(entry.reason, `${name} needs a reason`).toBeTruthy();
      }
      let from = 0;
      for (const text of entry.evidence ?? []) {
        const at = body.indexOf(text, from);
        expect(at, `${name}: ${text}`).toBeGreaterThanOrEqual(from);
        from = at + text.length;
      }
    });
  }

  it("no other file of the Catalog module writes", () => {
    const listed = new Set(Object.keys(INVENTORY));
    const others = readdirSync(CATALOG).filter(
      (name) =>
        /\.ts$/.test(name) &&
        !/\.(test|integration\.test)\.ts$/.test(name) &&
        !listed.has(name),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const name of others) {
      expect(WRITE.test(readFileSync(join(CATALOG, name), "utf8")), name).toBe(
        false,
      );
    }
  });

  it("a confirm-class helper gates before it writes", () => {
    const code = readFileSync(join(CATALOG, "commands.ts"), "utf8");
    const helper = code.slice(
      code.indexOf("async function applyTracklistEdit("),
    );
    const body = helper.slice(0, helper.indexOf("\n}\n"));
    expect(body.indexOf("confirmCatalogChange(")).toBeGreaterThan(-1);
    expect(body.indexOf("confirmCatalogChange(")).toBeLessThan(
      body.indexOf("rewriteTracklist("),
    );
  });
});

describe("no catalog table is written outside the Catalog module", () => {
  const CATALOG_TABLES = [
    "artists",
    "albums",
    "album_artists",
    "album_editions",
    "tracks",
    "track_artists",
    "album_tracks",
    "edition_tracks",
  ];
  const DRIZZLE = [
    "artists",
    "albums",
    "albumArtists",
    "albumEditions",
    "tracks",
    "trackArtists",
    "albumTracks",
    "editionTracks",
  ];

  function production(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return production(path);
      }
      return /\.(ts|tsx)$/.test(name) &&
        !/\.(test|integration\.test|http\.test|spec)\.tsx?$/.test(name)
        ? [path]
        : [];
    });
  }

  it("finds writes only in the catalog commands and the impact's temporary copies", () => {
    const offenders: string[] = [];
    for (const path of production("src")) {
      if (
        path.startsWith(`${CATALOG}/`) ||
        path.startsWith("src/testing/") ||
        path === "src/db/schema.ts" ||
        path.startsWith("src/db/migrations/")
      ) {
        continue;
      }
      const code = readFileSync(path, "utf8");
      for (const table of CATALOG_TABLES) {
        const sqlWrite = new RegExp(
          `\\b(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?"?${table}"?\\b`,
          "i",
        );
        if (sqlWrite.test(code)) {
          offenders.push(`${path}: ${table}`);
        }
      }
      for (const table of DRIZZLE) {
        if (
          new RegExp(
            `\\.(insert|update|delete)\\((schema\\.)?${table}\\)`,
          ).test(code)
        ) {
          offenders.push(`${path}: schema.${table}`);
        }
      }
    }
    // The impact writes only its own pg_temp copies (checked by its own
    // static test); nothing else in the application writes the catalog.
    expect(offenders).toEqual([]);
  });

  it("the Studio reaches the catalog only through the module's entry point", () => {
    const offenders = production("src/app").filter((path) =>
      /from "@\/modules\/catalog\//.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
