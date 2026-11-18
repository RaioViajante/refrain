import { describe, expect, it } from "vitest";

import { DatabaseConfigError, readDatabaseUrl } from "./env";

describe("readDatabaseUrl", () => {
  it("accepts postgres:// and postgresql:// connection strings", () => {
    const urls = [
      "postgres://user:pass@127.0.0.1:5432/refrain",
      "postgresql://user:pass@db.internal/refrain?sslmode=require",
    ];
    for (const url of urls) {
      expect(readDatabaseUrl({ DATABASE_URL: url })).toBe(url);
    }
  });

  it("trims surrounding whitespace", () => {
    expect(
      readDatabaseUrl({ DATABASE_URL: "  postgres://u:p@localhost/db\n" }),
    ).toBe("postgres://u:p@localhost/db");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])("rejects a %s value", (_label, value) => {
    expect(() => readDatabaseUrl({ DATABASE_URL: value })).toThrow(
      DatabaseConfigError,
    );
  });

  it("rejects a value that is not a URL", () => {
    expect(() => readDatabaseUrl({ DATABASE_URL: "refrain-db" })).toThrow(
      "not a valid URL",
    );
  });

  it("rejects a non-PostgreSQL scheme", () => {
    expect(() =>
      readDatabaseUrl({ DATABASE_URL: "mysql://user:pass@localhost/db" }),
    ).toThrow("postgres:// or postgresql://");
  });

  it("never includes the connection string in the error", () => {
    const secret = "do-not-leak-this-password";
    for (const value of [`mysql://user:${secret}@localhost/db`, `${secret}`]) {
      try {
        readDatabaseUrl({ DATABASE_URL: value });
        expect.unreachable("readDatabaseUrl should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseConfigError);
        expect(String((error as Error).message)).not.toContain(secret);
      }
    }
  });
});
