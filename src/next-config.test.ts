// The header routes that next.config.ts gives the framework and, through
// `vercel build`, the hosting platform (F-01). The HTTP tests check the
// responses of `next start`; this checks the configuration itself, which is
// what Vercel's routes are compiled from.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { NextConfig } from "next";
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
        route.source.startsWith("/api/auth"),
    );
    expect(privateRoutes.map((route) => route.source)).toEqual([
      "/studio/:path*",
      // The desk's transport files beside it: `/studio.rsc`,
      // `/studio.segments/…`.
      "/studio\\.:transport(.*)",
      "/api/auth/:path*",
    ]);
    for (const route of privateRoutes) {
      expect(route.cacheControl, route.source).toBe(PRIVATE_NO_STORE);
    }
  });

  it("leave every public route `no-store`, as before", async () => {
    const routes = await headerRoutes();
    const publicRoutes = routes.filter(
      (route) =>
        !route.source.startsWith("/studio") &&
        !route.source.startsWith("/api/auth"),
    );
    expect(publicRoutes.length).toBeGreaterThan(0);
    for (const route of publicRoutes) {
      expect(route.cacheControl, route.source).toBe("no-store");
    }
  });

  it("never touch the framework's immutable static assets", async () => {
    const routes = await headerRoutes();
    for (const route of routes) {
      expect(route.source.startsWith("/_next"), route.source).toBe(false);
    }
  });
});
