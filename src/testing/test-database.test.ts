import { describe, expect, it } from "vitest";

import {
  assertDisposableTestDatabase,
  readTestDatabaseUrl,
  TEST_DATABASE_MARKER,
  TestDatabaseSafetyError,
} from "./test-database";

const testUrl = "postgres://refrain_test:pw@127.0.0.1:5433/refrain_test";
const developmentUrl = "postgres://refrain:pw@127.0.0.1:5432/refrain";

function expectRefusal(env: Record<string, string | undefined>, text: string) {
  expect(() => readTestDatabaseUrl(env)).toThrow(TestDatabaseSafetyError);
  expect(() => readTestDatabaseUrl(env)).toThrow(text);
}

describe("readTestDatabaseUrl", () => {
  it("accepts a local *_test database distinct from DATABASE_URL", () => {
    expect(
      readTestDatabaseUrl({
        TEST_DATABASE_URL: testUrl,
        DATABASE_URL: developmentUrl,
      }),
    ).toBe(testUrl);
    expect(
      readTestDatabaseUrl({
        TEST_DATABASE_URL: "postgresql://u:p@localhost/refrain_test",
      }),
    ).toBe("postgresql://u:p@localhost/refrain_test");
    expect(
      readTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:p@[::1]/x_test" }),
    ).toBe("postgres://u:p@[::1]/x_test");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "  "],
  ])("refuses a %s TEST_DATABASE_URL", (_label, value) => {
    expectRefusal(
      { TEST_DATABASE_URL: value, DATABASE_URL: developmentUrl },
      "never use DATABASE_URL",
    );
  });

  it("never falls back to DATABASE_URL, even if it names a test database", () => {
    expectRefusal(
      { DATABASE_URL: "postgres://u:p@127.0.0.1:5433/refrain_test" },
      "TEST_DATABASE_URL is not set",
    );
  });

  it("refuses a malformed URL or another scheme", () => {
    expectRefusal({ TEST_DATABASE_URL: "refrain_test" }, "not a valid URL");
    expectRefusal(
      { TEST_DATABASE_URL: "mysql://u:p@127.0.0.1/refrain_test" },
      "postgres://",
    );
  });

  it.each([
    "postgres://u:p@db.example.com:5432/refrain_test",
    "postgres://u:p@10.0.0.5:5432/refrain_test",
    "postgres://u:p@postgres-test:5432/refrain_test",
  ])("refuses a non-loopback host: %s", (url) => {
    expectRefusal({ TEST_DATABASE_URL: url }, "on this machine");
  });

  it.each([
    "postgres://u:p@127.0.0.1:5433/refrain",
    "postgres://u:p@127.0.0.1:5433/test",
    "postgres://u:p@127.0.0.1:5433/refrain_testing",
    "postgres://u:p@127.0.0.1:5433/Refrain_Test",
    "postgres://u:p@127.0.0.1:5433/",
  ])("refuses a database not named *_test: %s", (url) => {
    expectRefusal({ TEST_DATABASE_URL: url }, "must end in `_test`");
  });

  it("refuses the same database as DATABASE_URL, across loopback spellings", () => {
    expectRefusal(
      {
        TEST_DATABASE_URL: "postgres://a:b@localhost:5433/refrain_test",
        DATABASE_URL: "postgres://c:d@127.0.0.1:5433/refrain_test",
      },
      "point to the same database",
    );
  });

  it("never includes the connection string in its errors", () => {
    const secret = "do-not-leak-this-password";
    for (const url of [
      `postgres://u:${secret}@db.example.com/refrain_test`,
      `postgres://u:${secret}@127.0.0.1/refrain`,
      `${secret}`,
    ]) {
      try {
        readTestDatabaseUrl({ TEST_DATABASE_URL: url });
        expect.unreachable("readTestDatabaseUrl should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TestDatabaseSafetyError);
        expect((error as Error).message).not.toContain(secret);
      }
    }
  });
});

describe("assertDisposableTestDatabase", () => {
  function serverReporting(row: { name: string; marker: string | null }) {
    return {
      query: async <Row>() => ({ rows: [row] as Row[] }),
    };
  }

  it("accepts a *_test database with the disposable marker", async () => {
    await expect(
      assertDisposableTestDatabase(
        serverReporting({ name: "refrain_test", marker: TEST_DATABASE_MARKER }),
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a database without the marker", async () => {
    await expect(
      assertDisposableTestDatabase(
        serverReporting({ name: "refrain_test", marker: null }),
      ),
    ).rejects.toThrow("not marked");
  });

  it("refuses a marked database that is not named *_test", async () => {
    await expect(
      assertDisposableTestDatabase(
        serverReporting({ name: "refrain", marker: TEST_DATABASE_MARKER }),
      ),
    ).rejects.toThrow("not named like a test database");
  });
});
