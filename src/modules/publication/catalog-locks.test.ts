import { readFileSync } from "node:fs";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { Transaction } from "@/db";

import { LockPlan, lockInOrder } from "./catalog-locks";

// ADR 0013 step 2, the static side of § 4.1's lock order:
// 1. `lockInOrder` always takes entries, then albums, then artists, then
//    tracks, each in ascending id, with the strongest mode asked for a row;
// 2. every catalog command of § 4.1's table, and every entry command of
//    § 4.4, takes its locks through the Publication module's helpers, before
//    it writes and before it decides;
// 3. no other statement in the catalog module locks a catalog row, except the
//    listed ones, which lock a row the helper already holds in the same mode
//    or a row no served page renders.
// The behaviour is in catalog-locks.concurrency.integration.test.ts.

const dialect = new PgDialect();

function recordingTransaction() {
  const statements: { text: string; params: unknown[] }[] = [];
  const tx = {
    execute: async (query: SQL) => {
      const { sql, params } = dialect.sqlToQuery(query);
      statements.push({ text: sql.replace(/\s+/g, " ").trim(), params });
      return { rows: [] };
    },
  } as unknown as Transaction;
  return { tx, statements };
}

const A = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("lockInOrder", () => {
  it("takes entries, then albums, artists, and tracks, each in ascending id", async () => {
    const { tx, statements } = recordingTransaction();
    const plan = new LockPlan()
      .track([A(9), A(3)], "share")
      .artist([A(8), A(2)], "share")
      .album([A(7), A(1)], "share")
      .involve({ journalsOfAlbums: [A(1)], memoriesLinkingTracks: [A(3)] });
    await lockInOrder(tx, plan);
    const kinds = statements.map(({ text }) =>
      text.includes("from entries")
        ? "entries"
        : /from (albums|artists|tracks) where id/.exec(text)![1],
    );
    expect(kinds).toEqual([
      "entries",
      "albums",
      "albums",
      "artists",
      "artists",
      "tracks",
      "tracks",
    ]);
    expect(statements[0]!.text).toMatch(
      /order by "?e"?\.id\s+for share of "?e"?$/,
    );
    expect(statements.slice(1).map(({ params }) => params[0])).toEqual([
      A(1),
      A(7),
      A(2),
      A(8),
      A(3),
      A(9),
    ]);
  });

  it("keeps the strongest mode asked for a row, so it never upgrades a held lock", async () => {
    const { tx, statements } = recordingTransaction();
    await lockInOrder(
      tx,
      new LockPlan()
        .album([A(1)], "update")
        .album([A(1)], "share")
        .artist([A(2)], "share")
        .artist([A(2)], "no key update")
        .track([A(3)], "share"),
    );
    expect(statements.map(({ text }) => text.split(" for ")[1])).toEqual([
      "update",
      "no key update",
      "share",
    ]);
    expect(statements).toHaveLength(3);
  });

  it("takes no entry lock when the plan names none", async () => {
    const { tx, statements } = recordingTransaction();
    await lockInOrder(tx, new LockPlan().album([A(1)], "share"));
    expect(statements.some(({ text }) => text.includes("from entries"))).toBe(
      false,
    );
  });
});

function bodyOf(path: string, name: string): string {
  const code = readFileSync(path, "utf8");
  const start = code.indexOf(`export async function ${name}(`);
  expect(start, `${path}: ${name}`).toBeGreaterThan(-1);
  const next = code.indexOf("\nexport ", start + 1);
  return code.slice(start, next === -1 ? undefined : next);
}

describe("every command of § 4.1 and § 4.4 locks through the helpers, first", () => {
  const CATALOG = "src/modules/catalog/commands.ts";
  const MUSIC = "src/modules/catalog/music.ts";
  const PHOTOS = "src/modules/catalog/photos.ts";
  const JOURNALS = "src/modules/journals/commands.ts";
  const PUBLISH = "src/modules/publication/publish.ts";
  const UNPUBLISH = "src/modules/publication/commands.ts";
  const CHANGE = "src/modules/publication/change.ts";

  // [file, command, the lock call, what must come after it]
  const table: [string, string, string, string[]][] = [
    [
      CATALOG,
      "updateArtist",
      "lockArtistPublicExposure(tx, id)",
      [".update(schema.artists)"],
    ],
    [
      CATALOG,
      "archiveArtist",
      "lockArtistPublicExposure(tx, id)",
      ["update artists"],
    ],
    [
      CATALOG,
      "restoreArtist",
      "lockArtistRestoreExposure(tx, id)",
      ["select archived_at", ".update(schema.artists)"],
    ],
    [
      CATALOG,
      "updateAlbum",
      "lockAlbumCatalogChange(tx, id, {",
      [
        "lockAlbum(tx, id)",
        "artistsNewlyExposedByCredit",
        ".update(schema.albums)",
        "replaceAlbumCredits(",
      ],
    ],
    [
      CATALOG,
      "deleteAlbum",
      "lockAlbumCatalogChange(tx, id)",
      [".delete(schema.albums)"],
    ],
    [
      CATALOG,
      "createTrack",
      "lockAlbumCatalogChange(tx, albumId, { artistIds })",
      [
        "lockAlbumForTracklist(tx, albumId)",
        ".insert(schema.tracks)",
        "rewriteTracklist(",
      ],
    ],
    [
      CATALOG,
      "updateTrack",
      "lockTrackCatalogChange(tx, id, artistIds ?? [])",
      [
        "for update",
        "assertArtistsLinkable(",
        ".update(schema.tracks)",
        "replaceTrackCredits(",
      ],
    ],
    [
      CATALOG,
      "setAlbumTracklist",
      "lockAlbumCatalogChange(tx, id, {",
      ["lockAlbumForTracklist(tx, id)", "rewriteTracklist("],
    ],
    [
      CATALOG,
      "addTrackToAlbum",
      "lockAlbumCatalogChange(tx, id, { addedTrackIds: [track] })",
      ["lockAlbumForTracklist(tx, id)", "rewriteTracklist("],
    ],
    [
      CATALOG,
      "removeTrackFromAlbum",
      "lockAlbumCatalogChange(tx, id)",
      ["lockAlbumForTracklist(tx, id)", "rewriteTracklist("],
    ],
    [
      CATALOG,
      "moveTrackInAlbum",
      "lockAlbumCatalogChange(tx, id)",
      ["lockAlbumForTracklist(tx, id)", "rewriteTracklist("],
    ],
    [
      MUSIC,
      "importMusicRelease",
      "await lockReleaseImport(",
      ["duplicate_identifier", "resolveArtists(tx", ".insert(schema.albums)"],
    ],
    [
      MUSIC,
      "linkAlbumToMusic",
      "lockAlbumCatalogChange(tx, albumId, { journalsOnly: true })",
      ["for update", ".insert(schema.albumEditions)"],
    ],
    [
      MUSIC,
      "setAlbumArtwork",
      "await lockAlbumPublicExposure(tx, albumId)",
      ["albumIdentity(tx, albumId, true)", ".update(schema.albums)"],
    ],
    [
      MUSIC,
      "removeAlbumArtwork",
      "await lockAlbumPublicExposure(tx, albumId)",
      ["albumIdentity(tx, albumId, true)", ".update(schema.albums)"],
    ],
    [
      PHOTOS,
      "setArtistPhoto",
      "await lockArtistPublicExposure(tx, artistId)",
      ["artistRow(tx, artistId, true)", "update artists"],
    ],
    [
      JOURNALS,
      "deleteAlbumJournal",
      "lockAlbumJournalTransition(tx, id)",
      [".update(schema.entries)"],
    ],
    [
      PUBLISH,
      "publishLanguageVersion",
      "lockPublicationCatalog(",
      ["readPublishState(tx", "markVersionPublished("],
    ],
    [
      UNPUBLISH,
      "unpublishLanguageVersion",
      "lockAlbumJournalTransition(tx, entryId)",
      ["update entry_texts"],
    ],
    [
      CHANGE,
      "requirePublicChangeConfirmation",
      'lockAlbumJournalCatalog(tx, binding.entryId, "save")',
      ["changeCatalog(tx", "changeFingerprint("],
    ],
  ];

  it.each(table)("%s: %s", (path, name, lock, after) => {
    const text = bodyOf(path, name);
    const locked = text.indexOf(lock);
    expect(locked, `${name} takes ${lock}`).toBeGreaterThan(-1);
    for (const later of after) {
      const at = text.indexOf(later, 0);
      expect(at, `${name} has ${later}`).toBeGreaterThan(-1);
      expect(at, `${name}: ${lock} before ${later}`).toBeGreaterThan(locked);
    }
  });

  it("an entry command takes its own entry first", () => {
    const publish = bodyOf(PUBLISH, "publishLanguageVersion");
    expect(publish.indexOf("lockEntry(tx, data.entryId)")).toBeLessThan(
      publish.indexOf("lockPublicationCatalog("),
    );
    const unpublish = bodyOf(UNPUBLISH, "unpublishLanguageVersion");
    expect(unpublish.indexOf("lockLiveEntry(tx, entryId)")).toBeLessThan(
      unpublish.indexOf("lockAlbumJournalTransition("),
    );
    const remove = bodyOf(JOURNALS, "deleteAlbumJournal");
    expect(remove.indexOf("lockAlbumJournal(tx, id)")).toBeLessThan(
      remove.indexOf("lockAlbumJournalTransition("),
    );
    const change = bodyOf(CHANGE, "requirePublicChangeConfirmation");
    expect(change).toContain("lockMemoryCatalog(tx, [");
  });
});

describe("no other catalog row lock", () => {
  it("locks catalog rows directly only where the helper already holds the row, or no page renders it", () => {
    // Each listed function re-locks a row its command's helper already holds
    // in the same mode (and checks it exists), or locks an identifier-only
    // row (MusicBrainz links), which no public page renders.
    const allowed: Record<string, string[]> = {
      "src/modules/catalog/commands.ts": [
        "lockAlbum",
        "lockAlbumForTracklist",
        "updateTrack",
      ],
      "src/modules/catalog/music.ts": [
        "albumIdentity",
        "linkAlbumToMusic",
        "linkArtistToMusic",
      ],
      "src/modules/catalog/photos.ts": ["artistRow"],
    };
    for (const [path, functions] of Object.entries(allowed)) {
      const code = readFileSync(path, "utf8");
      const found = new Set<string>();
      for (const match of code.matchAll(
        /for (?:update|share|no key update)/g,
      )) {
        const before = code.slice(0, match.index);
        const fn = [...before.matchAll(/(?:async )?function (\w+)\(/g)].at(
          -1,
        )?.[1];
        found.add(fn ?? "<none>");
      }
      expect([...found].sort(), path).toEqual([...functions].sort());
    }
  });
});
