import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getPublicAlbumJournal,
  getPublicHome,
  listPublicAlbumJournalAddresses,
  resolvePublicAlbumJournalSlug,
} from "./public";

// The reading entry point applies the public-reads switch itself (ADR 0006,
// D4), before it touches the database, so a caller that forgot to check it
// still discloses nothing while reads are off. These tests run with no
// database configured: a read that got past the switch would throw for the
// missing connection string, so "returns the empty answer" proves the switch
// stopped it first. The database-backed behavior is in the integration and
// HTTP tests.

const saved = {
  switch: process.env.REFRAIN_PUBLIC_READS_ENABLED,
  url: process.env.DATABASE_URL,
};

beforeEach(() => {
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  for (const [name, value] of [
    ["REFRAIN_PUBLIC_READS_ENABLED", saved.switch],
    ["DATABASE_URL", saved.url],
  ] as const) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

const NOT_ENABLED = [
  undefined,
  "",
  "false",
  "TRUE",
  "True",
  "1",
  "yes",
  " true",
  "true ",
  "on",
];

describe("the reading entry point with reads not enabled", () => {
  it.each(NOT_ENABLED)(
    "answers as if nothing existed (switch: %j)",
    async (value) => {
      if (value === undefined) {
        delete process.env.REFRAIN_PUBLIC_READS_ENABLED;
      } else {
        process.env.REFRAIN_PUBLIC_READS_ENABLED = value;
      }
      expect(await getPublicAlbumJournal("any-entry", "en")).toBeNull();
      expect(await listPublicAlbumJournalAddresses()).toEqual([]);
      // The Home's answer is the one for a site with nothing published
      // (ADR 0006, amendment A4), in either reader language.
      expect(await getPublicHome("en")).toEqual({ recent: [], albums: [] });
      expect(await getPublicHome("pt-BR")).toEqual({ recent: [], albums: [] });
      expect(await resolvePublicAlbumJournalSlug("any-slug")).toEqual({
        outcome: "not_found",
      });
    },
  );

  it("reads only when the switch is exactly true (it then needs the database)", async () => {
    process.env.REFRAIN_PUBLIC_READS_ENABLED = "true";
    // No database is configured, so a read that is allowed fails loudly,
    // which is how this test knows the switch is what stopped the others.
    await expect(resolvePublicAlbumJournalSlug("any-slug")).rejects.toThrow();
    await expect(listPublicAlbumJournalAddresses()).rejects.toThrow();
    await expect(getPublicAlbumJournal("any-entry", "en")).rejects.toThrow();
    await expect(getPublicHome("en")).rejects.toThrow();
  });
});
