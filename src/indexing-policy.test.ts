// The initial indexing policy as configuration (docs/security.md#indexing):
// one constant, repeated in next.config.ts, set on every header rule, on
// every response the proxy makes itself, and in both root layouts and the
// not-found metadata, and never read from the environment. The HTTP tests
// check the responses themselves (src/testing/indexing.http.test.ts).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

import { ROBOTS_DIRECTIVE, ROBOTS_HEADER } from "./indexing-policy";

const { default: nextConfig } = (await import(
  pathToFileURL(resolve("next.config.ts")).href
)) as { default: NextConfig };

describe("the indexing policy", () => {
  it("is exactly `noindex, nofollow`, a constant that reads nothing", () => {
    expect(ROBOTS_DIRECTIVE).toBe("noindex, nofollow");
    expect(ROBOTS_HEADER).toBe("X-Robots-Tag");
    const source = readFileSync("src/indexing-policy.ts", "utf8");
    expect(source).not.toMatch(/process\.env|^import /m);
  });

  it("is the same value in next.config.ts, which takes it from no environment variable", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain(
      `const ROBOTS_DIRECTIVE = ${JSON.stringify(ROBOTS_DIRECTIVE)};`,
    );
    expect(config).not.toMatch(/process\.env/);
  });

  it("is on every header rule, and a rule for every address comes first", async () => {
    const routes = await nextConfig.headers!();
    expect(routes[0]).toEqual({
      source: "/:path*",
      headers: [{ key: ROBOTS_HEADER, value: ROBOTS_DIRECTIVE }],
    });
    for (const route of routes) {
      const values = route.headers
        .filter((header) => header.key.toLowerCase() === "x-robots-tag")
        .map((header) => header.value);
      expect(values, route.source).toEqual([ROBOTS_DIRECTIVE]);
    }
  });

  it("is on every response the proxy makes itself", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain(
      'import { ROBOTS_DIRECTIVE, ROBOTS_HEADER } from "./indexing-policy";',
    );
    // The not-found headers of the three header sets (the artist set spreads
    // the public one).
    for (const name of ["PUBLIC_SECURITY_HEADERS", "STUDIO_SECURITY_HEADERS"]) {
      const start = proxy.indexOf(`const ${name} = {`);
      const block = proxy.slice(start, proxy.indexOf("} as const;", start));
      expect(block, name).toContain("...ROBOTS,");
    }
    expect(proxy).toMatch(
      /const ARTIST_SECURITY_HEADERS = \{\s*\.\.\.PUBLIC_SECURITY_HEADERS,/,
    );
    // Every response it builds: each 308, the 405, and the 503 carry it, and
    // every rewrite uses one of the header sets above.
    const built = proxy.match(/NextResponse\.redirect\(|new Response\(/g) ?? [];
    const withPolicy =
      proxy.match(
        /"Cache-Control": NO_STORE, \.\.\.ROBOTS|NO_STORE,\n\s+\.\.\.ROBOTS/g,
      ) ?? [];
    expect(built).toHaveLength(4);
    expect(withPolicy).toHaveLength(built.length);
    for (const rewrite of proxy.match(/NextResponse\.rewrite\([^]*?\}\);/g) ??
      []) {
      expect(rewrite).toMatch(/_SECURITY_HEADERS/);
    }
  });

  it("is in both root layouts and in the not-found metadata", () => {
    for (const file of [
      "src/app/(en)/layout.tsx",
      "src/app/pt/layout.tsx",
      "src/app/(public)/_components/page-metadata.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).toContain(
        `robots: ${JSON.stringify(ROBOTS_DIRECTIVE)},`,
      );
    }
  });
});
