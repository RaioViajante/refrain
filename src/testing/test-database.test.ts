import { describe, expect, it } from "vitest";

import {
  assertDisposableTestDatabase,
  effectiveTarget,
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
    "postgres://u:p@127.0.0.1:5433/refrain_test?host=db.example.com&port=5432",
    "postgres://u:p@127.0.0.1:5433/refrain_test?host=/var/run/postgresql",
    "postgres://u:p@127.0.0.1:5433/refrain_test?sslmode=disable",
  ])("refuses query parameters, which can override the host: %s", (url) => {
    expectRefusal({ TEST_DATABASE_URL: url }, "must not have query parameters");
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
      "name the same database",
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

describe("readTestDatabaseUrl compares effective targets with DATABASE_URL", () => {
  const test = "postgres://refrain_test:pw@127.0.0.1:5433/refrain_test";

  it.each([
    [
      "the same target with a harmless query parameter",
      "postgres://a:b@localhost:5433/refrain_test?sslmode=disable",
    ],
    [
      "query parameters that redirect a remote URL to the test target",
      "postgres://a:b@db.example.com:5432/refrain_test?host=127.0.0.1&port=5433",
    ],
    [
      "a Unix socket on this machine with the same port and database",
      "postgres:///refrain_test?host=/var/run/postgresql&port=5433",
    ],
    ["an IPv6 loopback spelling", "postgres://a:b@[::1]:5433/refrain_test"],
    [
      "an upper-case loopback name",
      "postgres://a:b@LOCALHOST:5433/refrain_test",
    ],
    [
      "a percent-encoded database name",
      "postgres://a:b@127.0.0.1:5433/refrain%5Ftest",
    ],
  ])("refuses %s", (_label, developmentUrl) => {
    expectRefusal(
      { TEST_DATABASE_URL: test, DATABASE_URL: developmentUrl },
      "name the same database",
    );
  });

  // One server is reachable under many host spellings and through forwarded
  // ports, so any DATABASE_URL naming the same database is refused.
  it.each([
    "postgres://a:b@0.0.0.0:5433/refrain_test",
    "postgres://a:b@127.1:5433/refrain_test",
    "postgres://a:b@2130706433:5433/refrain_test",
    "postgres://a:b@[::ffff:127.0.0.1]:5433/refrain_test",
    "postgres://a:b@localhost.:5433/refrain_test",
    "postgres://a:b@host.docker.internal:5433/refrain_test",
    "postgres://a:b@127.0.0.1:6543/refrain_test",
    "postgres://a:b@db.example.com:5433/refrain_test",
  ])(
    "refuses any DATABASE_URL naming the same database: %s",
    (developmentUrl) => {
      expectRefusal(
        { TEST_DATABASE_URL: test, DATABASE_URL: developmentUrl },
        "name the same database",
      );
    },
  );

  it.each([
    ["not a URL", "refrain-db"],
    [
      "a port that is not a number",
      "postgres://a:b@127.0.0.1:5432/refrain?port=abc",
    ],
    ["another scheme", "mysql://a:b@127.0.0.1:5433/refrain_test"],
    [
      "several hosts",
      "postgres://a:b@127.0.0.1:5432/refrain?host=127.0.0.1,db.example.com",
    ],
  ])(
    "refuses instead of skipping when DATABASE_URL is %s",
    (_label, developmentUrl) => {
      expectRefusal(
        { TEST_DATABASE_URL: test, DATABASE_URL: developmentUrl },
        "cannot be proven distinct",
      );
    },
  );

  it.each([
    [
      "the development database",
      "postgres://refrain:pw@127.0.0.1:5432/refrain",
    ],
    [
      "the development database with query parameters",
      "postgres://refrain:pw@127.0.0.1:5432/refrain?sslmode=disable&application_name=x",
    ],
    [
      "a database with another name on the same server",
      "postgres://a:b@127.0.0.1:5433/refrain_other",
    ],
  ])("accepts a distinct DATABASE_URL: %s", (_label, developmentUrl) => {
    expect(
      readTestDatabaseUrl({
        TEST_DATABASE_URL: test,
        DATABASE_URL: developmentUrl,
      }),
    ).toBe(test);
  });

  it("uses the port node-postgres would use when the URL omits it", () => {
    // Without a port, both resolve to the default port 5432.
    expectRefusal(
      {
        TEST_DATABASE_URL: "postgres://u:p@127.0.0.1/refrain_test",
        DATABASE_URL: "postgres://a:b@localhost:5432/refrain_test",
      },
      "name the same database",
    );
  });

  it("never includes credentials from either URL in its errors", () => {
    const secret = "do-not-leak-this-password";
    for (const env of [
      {
        TEST_DATABASE_URL: test,
        DATABASE_URL: `postgres://admin:${secret}@localhost:5433/refrain_test?sslmode=require`,
      },
      {
        TEST_DATABASE_URL: test,
        DATABASE_URL: `postgres://admin:${secret}@h1,h2/refrain`,
      },
      { TEST_DATABASE_URL: test, DATABASE_URL: `${secret}` },
    ]) {
      try {
        readTestDatabaseUrl(env);
        expect.unreachable("readTestDatabaseUrl should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TestDatabaseSafetyError);
        expect((error as Error).message).not.toContain(secret);
        expect((error as Error).message).not.toContain("admin");
      }
    }
  });
});

describe("effectiveTarget", () => {
  it("resolves query-parameter overrides the way node-postgres connects", () => {
    expect(
      effectiveTarget(
        "postgres://u:p@127.0.0.1:5433/x_test?host=db.example.com&port=6000",
        "URL",
      ),
    ).toEqual({ host: "db.example.com", port: 6000, database: "x_test" });
  });
});
