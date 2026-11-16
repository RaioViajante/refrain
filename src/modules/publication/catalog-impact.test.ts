import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CATALOG_TABLES,
  CatalogImpactError,
  compareRenders,
  isEmptyImpact,
  parseCatalogChange,
  type ServedCatalogRender,
} from "./catalog-impact";

// The pure parts of the public impact (ADR 0013 § 1.2): the change's
// validation, the atom comparison, and a static check that the computation
// can write only to its temporary copies. The database behaviour is in
// catalog-impact.integration.test.ts.

const ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

describe("the change", () => {
  it("accepts each operation in its exact shape", () => {
    expect(
      parseCatalogChange([
        { op: "update_artist", artistId: ID, name: "[Test] A" },
        { op: "update_artist", artistId: ID, archived: true },
        {
          op: "update_album",
          albumId: ID,
          title: "[Test] B",
          firstReleaseYear: null,
          label: null,
          credits: [{ artistId: OTHER }],
        },
        { op: "delete_album", albumId: ID },
        { op: "create_album", albumId: ID, title: "[Test] C" },
        { op: "update_track", trackId: ID, credit: null, artistIds: [] },
        { op: "create_track", trackId: ID, title: "[Test] D" },
        {
          op: "set_tracklist",
          albumId: ID,
          tracks: [{ trackId: OTHER, discNumber: 2 }],
        },
      ]),
    ).toHaveLength(8);
  });

  it.each([
    ["no operation", []],
    ["an unknown operation", [{ op: "rename_everything", artistId: ID }]],
    ["an id that is not a UUID", [{ op: "delete_album", albumId: "x" }]],
    ["an extra field", [{ op: "delete_album", albumId: ID, sql: "drop" }]],
    ["an empty name", [{ op: "update_artist", artistId: ID, name: "  " }]],
    [
      "a track without its disc",
      [{ op: "set_tracklist", albumId: ID, tracks: [{ trackId: ID }] }],
    ],
    ["not a list", { op: "delete_album", albumId: ID }],
  ])("refuses %s", (_name, input) => {
    expect(() => parseCatalogChange(input)).toThrow(CatalogImpactError);
  });
});

function render(
  pages: [string, Record<string, string | null>, string?][],
  addresses: [string, string][] = [],
): ServedCatalogRender {
  return {
    pages: new Map(
      pages.map(([key, atoms, path]) => [
        key,
        {
          surface: key.startsWith("artist:") ? "artist" : "album_journal",
          locale: "en",
          path: path ?? `/albums/${key}`,
          entryId: key.startsWith("artist:") ? null : key,
          artistId: key.startsWith("artist:") ? key.slice(7) : null,
          atoms: new Map(Object.entries(atoms)),
        },
      ]),
    ),
    artistAddresses: new Map(addresses),
  };
}

describe("comparing two renders", () => {
  it("is empty when nothing differs", () => {
    const same = render([["j", { "album.title": "A" }]]);
    expect(isEmptyImpact(compareRenders(same, same))).toBe(true);
  });

  it("lists each changed atom with its value before and after", () => {
    const impact = compareRenders(
      render([["j", { "album.title": "A", "album.year": "2001" }]]),
      render([["j", { "album.title": "B", "album.year": "2001" }]]),
    );
    expect(impact.pages).toHaveLength(1);
    expect(impact.pages[0]!.changes).toEqual([
      { atom: "album.title", before: "A", after: "B" },
    ]);
  });

  it("tells an absent atom from one whose value is null", () => {
    const impact = compareRenders(
      render([["j", { "credits.1.link": null }]]),
      render([["j", {}]]),
    );
    expect(impact.pages[0]!.changes).toEqual([
      { atom: "credits.1.link", before: null, after: null },
    ]);
  });

  it("reports a moved artist page with both addresses, and every moved address", () => {
    const impact = compareRenders(
      render(
        [["artist:a", { name: "A" }, "/artists/a"]],
        [
          ["a", "a"],
          ["n", "name-0123456789"],
        ],
      ),
      render(
        [["artist:a", { name: "B" }, "/artists/b"]],
        [
          ["a", "b"],
          ["n", "name"],
        ],
      ),
    );
    expect(impact.pages[0]).toMatchObject({
      path: "/artists/a",
      pathAfter: "/artists/b",
      artistId: "a",
    });
    expect(impact.artistAddresses).toEqual([
      { artistId: "a", before: "a", after: "b" },
      { artistId: "n", before: "name-0123456789", after: "name" },
    ]);
    expect(impact.opensArtistPage).toBe(false);
  });

  it("flags an artist page that would open, never one that closes", () => {
    const opens = compareRenders(render([], []), render([], [["a", "a"]]));
    expect(opens.opensArtistPage).toBe(true);
    const closes = compareRenders(render([], [["a", "a"]]), render([], []));
    expect(closes.opensArtistPage).toBe(false);
    expect(closes.artistAddresses).toEqual([
      { artistId: "a", before: "a", after: null },
    ]);
  });
});

describe("what the computation may write", () => {
  const source = readFileSync(
    new URL("./catalog-impact.ts", import.meta.url),
    "utf8",
  );

  it("writes only to tables named pg_temp.<table>", () => {
    // Every insert, update, or delete names its table literally in the
    // temporary schema, so no write can reach a permanent table, even if a
    // copy were missing (it would fail instead). Comments are not scanned.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const writes = [
      ...code.matchAll(/\b(insert\s+into|update|delete\s+from)\s+(\S+)/gi),
    ];
    expect(writes.length).toBeGreaterThanOrEqual(15);
    for (const [match, , target] of writes) {
      expect(target, match).toMatch(/^pg_temp\.[a-z_]+$/);
      expect(CATALOG_TABLES, match).toContain(target!.slice("pg_temp.".length));
    }
    expect(code).not.toContain("sql.raw");
  });

  it("copies exactly the catalog tables, each dropped with the transaction", () => {
    expect([...CATALOG_TABLES]).toEqual([
      "artists",
      "albums",
      "album_artists",
      "album_editions",
      "tracks",
      "track_artists",
      "album_tracks",
      "edition_tracks",
    ]);
    const copies = [
      ...source.matchAll(
        /create temporary table (\w+) on commit drop\s+as table public\.(\w+)/g,
      ),
    ];
    expect(copies.map(([, copy]) => copy)).toEqual([...CATALOG_TABLES]);
    for (const [, copy, original] of copies) {
      expect(original).toBe(copy);
    }
  });
});
