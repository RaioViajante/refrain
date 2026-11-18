import { describe, expect, it } from "vitest";

import {
  DatabaseConfigError,
  readDatabaseUrl,
  readLocalDatabaseUrl,
} from "./env";

const LOCAL = "postgres://user:s3cret@127.0.0.1:5442/refrain_mixtapes";

function expectRefusal(read: () => string, message: RegExp) {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseConfigError);
    expect((error as Error).message).toMatch(message);
    // The connection string can hold a password; no message may repeat it.
    expect((error as Error).message).not.toContain("s3cret");
    return;
  }
  throw new Error("expected a DatabaseConfigError");
}

describe("readDatabaseUrl", () => {
  it("returns a trimmed postgres URL", () => {
    expect(readDatabaseUrl({ DATABASE_URL: `  ${LOCAL}  ` })).toBe(LOCAL);
    expect(
      readDatabaseUrl({
        DATABASE_URL: LOCAL.replace("postgres:", "postgresql:"),
      }),
    ).toMatch(/^postgresql:/);
  });

  it("refuses a missing, malformed, or non-PostgreSQL URL", () => {
    expectRefusal(() => readDatabaseUrl({}), /not set/);
    expectRefusal(() => readDatabaseUrl({ DATABASE_URL: " " }), /not set/);
    expectRefusal(
      () => readDatabaseUrl({ DATABASE_URL: "not a url s3cret" }),
      /not a valid URL/,
    );
    expectRefusal(
      () => readDatabaseUrl({ DATABASE_URL: "mysql://u:s3cret@127.0.0.1/db" }),
      /scheme/,
    );
  });
});

describe("readLocalDatabaseUrl", () => {
  it("accepts this application's database on any loopback host", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      const url = LOCAL.replace("127.0.0.1", host);
      expect(readLocalDatabaseUrl({ DATABASE_URL: url })).toBe(url);
    }
  });

  it("refuses any host other than this machine", () => {
    for (const host of [
      "ep-example-123456.sa-east-1.aws.neon.tech",
      "db.example.com",
      "10.0.0.5",
      "127.0.0.2",
    ]) {
      expectRefusal(
        () =>
          readLocalDatabaseUrl({
            DATABASE_URL: LOCAL.replace("127.0.0.1", host),
          }),
        /local database/,
      );
    }
  });

  it("refuses the archived music diary's local databases", () => {
    for (const path of ["refrain", "refrain_test", "%72efrain"]) {
      expectRefusal(
        () =>
          readLocalDatabaseUrl({
            DATABASE_URL: `postgres://refrain:s3cret@127.0.0.1:5432/${path}`,
          }),
        /archived music diary/,
      );
    }
  });
});
