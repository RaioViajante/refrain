import { describe, expect, it } from "vitest";

import { databaseErrorOf, isReferencedRowRefusal, SqlState } from "./errors";

// The shapes node-postgres reports for each foreign-key failure, as PostgreSQL
// 17.11 and 18.6 send them (reproduced on both servers for issue #61).
const pg17RestrictedDelete = {
  code: "23503",
  constraint: "album_artists_artist_fk",
  detail:
    'Key (id)=(00000000-0000-4000-8000-000000000001) is still referenced from table "album_artists".',
};
const pg18RestrictedDelete = {
  code: "23001",
  constraint: "album_artists_artist_fk",
  detail:
    'Key (id)=(00000000-0000-4000-8000-000000000001) is referenced from table "album_artists".',
};
const missingParent = {
  code: "23503",
  constraint: "album_artists_artist_fk",
  detail:
    'Key (artist_id)=(00000000-0000-4000-8000-000000000001) is not present in table "artists".',
};

describe("isReferencedRowRefusal", () => {
  it("recognizes a delete refused by a RESTRICT key on PostgreSQL 17 (23503)", () => {
    expect(isReferencedRowRefusal(pg17RestrictedDelete)).toBe(true);
  });

  it("recognizes a delete refused by a RESTRICT key on PostgreSQL 18 (23001)", () => {
    expect(isReferencedRowRefusal(pg18RestrictedDelete)).toBe(true);
  });

  it("does not take a missing parent for a referenced row, on either version", () => {
    expect(isReferencedRowRefusal(missingParent)).toBe(false);
  });

  it("is false for every other SQLSTATE", () => {
    for (const code of [
      SqlState.notNullViolation,
      SqlState.uniqueViolation,
      SqlState.checkViolation,
      "40001",
      "40P01",
      "XX000",
    ]) {
      expect(isReferencedRowRefusal({ code, constraint: "x" })).toBe(false);
    }
  });
});

describe("databaseErrorOf", () => {
  it("finds the PostgreSQL error behind a wrapped query error", () => {
    const wrapped = new Error("Failed query", {
      cause: Object.assign(new Error("restrict"), pg18RestrictedDelete),
    });
    expect(databaseErrorOf(wrapped)).toEqual(pg18RestrictedDelete);
  });

  it("returns undefined for an error that is not from PostgreSQL", () => {
    expect(databaseErrorOf(new Error("not a database error"))).toBeUndefined();
  });
});
