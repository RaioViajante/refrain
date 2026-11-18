import { describe, expect, it } from "vitest";

import {
  PUBLIC_READS_VARIABLE,
  publicReadsEnabled,
  publicSiteOrigin,
} from "./public-reads";

describe("the public-reads switch", () => {
  it("is named as ADR 0006 names it, with no public prefix", () => {
    expect(PUBLIC_READS_VARIABLE).toBe("REFRAIN_PUBLIC_READS_ENABLED");
    expect(PUBLIC_READS_VARIABLE.startsWith("NEXT_PUBLIC_")).toBe(false);
  });

  it("is disabled when unset", () => {
    expect(publicReadsEnabled({})).toBe(false);
    expect(
      publicReadsEnabled({ REFRAIN_PUBLIC_READS_ENABLED: undefined }),
    ).toBe(false);
  });

  it("is enabled by exactly `true` and by nothing else", () => {
    const enabled = (value: string) =>
      publicReadsEnabled({ REFRAIN_PUBLIC_READS_ENABLED: value });
    expect(enabled("true")).toBe(true);
    for (const value of [
      "",
      " ",
      "TRUE",
      "True",
      "tRue",
      " true",
      "true ",
      "true\n",
      "true;",
      "1",
      "yes",
      "on",
      "enabled",
      "false",
      "0",
      "null",
      "undefined",
      "truee",
      "tru",
      "t",
      '"true"',
      "'true'",
      "true,true",
    ]) {
      expect(enabled(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("reads no other variable", () => {
    expect(
      publicReadsEnabled({
        NEXT_PUBLIC_REFRAIN_PUBLIC_READS_ENABLED: "true",
        PUBLIC_READS_ENABLED: "true",
        refrain_public_reads_enabled: "true",
      }),
    ).toBe(false);
  });

  it("reads the process environment when no environment is given", () => {
    const before = process.env.REFRAIN_PUBLIC_READS_ENABLED;
    try {
      delete process.env.REFRAIN_PUBLIC_READS_ENABLED;
      expect(publicReadsEnabled()).toBe(false);
      process.env.REFRAIN_PUBLIC_READS_ENABLED = "true";
      expect(publicReadsEnabled()).toBe(true);
      process.env.REFRAIN_PUBLIC_READS_ENABLED = "TRUE";
      expect(publicReadsEnabled()).toBe(false);
    } finally {
      if (before === undefined) {
        delete process.env.REFRAIN_PUBLIC_READS_ENABLED;
      } else {
        process.env.REFRAIN_PUBLIC_READS_ENABLED = before;
      }
    }
  });
});

describe("the site origin", () => {
  const origin = (value: string | undefined) =>
    publicSiteOrigin({ BETTER_AUTH_URL: value });

  it("is the origin of the application's own URL", () => {
    expect(origin("https://example.test")).toBe("https://example.test");
    expect(origin("http://localhost:3000/studio?x=1")).toBe(
      "http://localhost:3000",
    );
  });

  it("is refused when it is missing or not a plain http(s) origin", () => {
    expect(origin(undefined)).toBeNull();
    expect(origin("")).toBeNull();
    expect(origin("not a url")).toBeNull();
    expect(origin("javascript:alert(1)")).toBeNull();
    expect(origin("ftp://example.test")).toBeNull();
    expect(origin("https://user:pass@example.test")).toBeNull();
  });
});
