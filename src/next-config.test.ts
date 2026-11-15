// The header routes that next.config.ts gives the framework and, through
// `vercel build`, the hosting platform (F-01). The HTTP tests check the
// responses of `next start`; this checks the configuration itself, which is
// what Vercel's routes are compiled from.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { NextConfig } from "next";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";

// next.config.ts sits at the repository root, outside the `@/` alias; like
// src/security-headers.test.ts, this test reads it by path.
const { default: nextConfig } = (await import(
  pathToFileURL(resolve("next.config.ts")).href
)) as { default: NextConfig };

const PRIVATE_NO_STORE = "private, no-store, max-age=0, must-revalidate";

async function headerRoutes() {
  const routes = await nextConfig.headers!();
  return routes.map((route) => ({
    source: route.source,
    cacheControl: route.headers.find(
      (header) => header.key.toLowerCase() === "cache-control",
    )?.value,
  }));
}

describe("next.config.ts header routes", () => {
  it("make every studio and authentication response private and not stored (F-01)", async () => {
    const routes = await headerRoutes();
    const privateRoutes = routes.filter(
      (route) =>
        route.source.startsWith("/studio") ||
        route.source.startsWith("/pt/studio") ||
        route.source.startsWith("/api/auth"),
    );
    expect(privateRoutes.map((route) => route.source)).toEqual([
      "/studio/:path*",
      // The desk's transport files beside it: `/studio.rsc`,
      // `/studio.segments/…`.
      "/studio\\.:transport(.*)",
      "/api/auth/:path*",
      // The Portuguese Studio's forms of the same (ADR 0006 A7, item 7).
      "/pt/studio/:path*",
      "/pt/studio\\.:transport(.*)",
    ]);
    for (const route of privateRoutes) {
      expect(route.cacheControl, route.source).toBe(PRIVATE_NO_STORE);
    }
  });

  it("leave every public route `no-store`, as before", async () => {
    const routes = await headerRoutes();
    // The first rule, for every address, sets only the indexing policy
    // (src/indexing-policy.test.ts) and no `Cache-Control`.
    expect(routes[0]).toEqual({ source: "/:path*", cacheControl: undefined });
    const publicRoutes = routes
      .slice(1)
      .filter(
        (route) =>
          !route.source.startsWith("/studio") &&
          !route.source.startsWith("/pt/studio") &&
          !route.source.startsWith("/api/auth"),
      );
    expect(publicRoutes.length).toBeGreaterThan(0);
    for (const route of publicRoutes) {
      expect(route.cacheControl, route.source).toBe("no-store");
    }
  });

  it("have no public rule broad enough to reach the Portuguese Studio (ADR 0006 A7, item 6)", async () => {
    const routes = await headerRoutes();
    for (const route of routes) {
      if (route.cacheControl !== PRIVATE_NO_STORE) {
        expect(route.source, route.source).not.toMatch(
          /^\/pt(\/:path\*|\/:path\+|\/\(\.\*\))$/,
        );
        expect(route.source.startsWith("/pt/studio"), route.source).toBe(false);
      }
    }
  });

  it("make every address that no section rule names `no-store`, except the immutable build files and the data-free assets (G2)", async () => {
    const routes = await headerRoutes();
    // Second, after the indexing policy and before every section rule, so
    // that each section's own value is the last one set and wins.
    const unnamed = routes[1]!;
    expect(unnamed.cacheControl).toBe("no-store");
    // Matched as the framework matches it, with its own path matcher.
    const matches = getPathMatch(unnamed.source, {
      removeUnnamedParams: true,
      strict: true,
    });
    for (const path of [
      "/",
      "/no-such-address",
      "/a/b/c",
      "/no-such-address.rsc",
      "/pt/no-such-address",
      "/_not-found",
      "/_global-error",
      "/albums/a/b",
      "/v3",
      "/artworks/x",
      // A missing promoted file, another spelling of one, or a path beside
      // the optimizer is the not-found view, and never stored either.
      "/v3/missing.jpg",
      "/v3/paper.jpgx",
      "/artwork/missing.webp",
      "/_next/imagex",
      "/_next/images/a",
    ]) {
      expect(matches(path), path).not.toBe(false);
    }
    for (const path of [
      "/_next/static/chunks/main.js",
      "/_next/static/media/font.woff2",
      "/_next/image",
      "/v3/paper.jpg",
      "/v3/favicon.svg",
      "/artwork/refrain-404.webp",
      // The framework matches header rules without regard to case
      // (`caseSensitiveRoutes` is unset), so another case of an exact asset
      // name is excluded too: on the host it is the generic not-found view,
      // recorded in docs/evidence/g2-no-store.md.
      "/V3/paper.jpg",
    ]) {
      expect(matches(path), path).toBe(false);
    }
    // Every private rule comes after it, so the Studio keeps its own value.
    const firstPrivate = routes.findIndex(
      (route) => route.cacheControl === PRIVATE_NO_STORE,
    );
    expect(firstPrivate).toBeGreaterThan(1);
  });

  it("never touch the framework's immutable static assets", async () => {
    const routes = await headerRoutes();
    for (const route of routes) {
      expect(route.source.startsWith("/_next"), route.source).toBe(false);
    }
  });
});
