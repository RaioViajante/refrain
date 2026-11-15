// The header routes that next.config.ts gives the framework and, through
// `vercel build`, the hosting platform (F-01). The HTTP tests check the
// responses of `next start`; this checks the configuration itself, which is
// what Vercel's routes are compiled from.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { NextConfig } from "next";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
import { describe, expect, it } from "vitest";

import { canonicalHostRedirects } from "@/canonical-host";

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

  it("never touch the framework's immutable static assets", async () => {
    const routes = await headerRoutes();
    for (const route of routes) {
      expect(route.source.startsWith("/_next"), route.source).toBe(false);
    }
  });
});

describe("the canonical-host redirect (Hosted Launch § 7, item 2)", () => {
  const CANONICAL = "https://refrain.raioviajante.com";
  // The framework's own matcher for a `has` condition, as it runs for
  // `next start`; a change in how it matches hosts fails here.
  const matchesHost = (pattern: string, host: string) =>
    matchHas(
      { headers: { host } } as unknown as Parameters<typeof matchHas>[0],
      {},
      [{ type: "host", value: pattern }],
      [],
    ) !== false;

  it("is off unless hostnames are listed, as in this configuration today", async () => {
    expect(canonicalHostRedirects({})).toEqual([]);
    expect(
      canonicalHostRedirects({ REFRAIN_CANONICAL_REDIRECT_HOSTS: "  " }),
    ).toEqual([]);
    expect(canonicalHostRedirects({ BETTER_AUTH_URL: CANONICAL })).toEqual([]);
    expect(await nextConfig.redirects!()).toEqual(
      canonicalHostRedirects(process.env),
    );
  });

  it("sends each listed host, exactly, to the same path and query on the canonical origin with a 308", () => {
    const rules = canonicalHostRedirects({
      BETTER_AUTH_URL: CANONICAL,
      REFRAIN_CANONICAL_REDIRECT_HOSTS:
        "refrain-chi.vercel.app, Refrain-BryanAlvarenga-5889s-Projects.vercel.app,refrain-chi.vercel.app",
    });
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.source).toBe("/:path*");
      // The destination is configured, never taken from the request.
      expect(rule.destination).toBe(`${CANONICAL}/:path*`);
      expect(rule.permanent).toBe(true);
      expect(rule.has).toHaveLength(1);
      expect(rule.has[0]!.type).toBe("host");
    }
    const first = rules[0]!.has[0]!.value;
    for (const same of [
      "refrain-chi.vercel.app",
      "REFRAIN-CHI.vercel.app",
      "refrain-chi.vercel.app:443",
      // The fully qualified spelling, with its trailing dot.
      "refrain-chi.vercel.app.",
    ]) {
      expect(matchesHost(first, same), same).toBe(true);
    }
    for (const other of [
      "refrain-chiXvercel.app",
      "evil.refrain-chi.vercel.app",
      "refrain-chi.vercel.app.evil.com",
      "refrain-chi.vercel.app..",
      "evil.com:refrain-chi.vercel.app",
      "refrain.raioviajante.com",
      "refrain-v3-rc.vercel.app",
      "refrain-hktp7ar96-raioviajando.vercel.app",
    ]) {
      expect(matchesHost(first, other), other).toBe(false);
    }
    expect(
      matchesHost(
        rules[1]!.has[0]!.value,
        "refrain-bryanalvarenga-5889s-projects.vercel.app",
      ),
    ).toBe(true);
  });

  it.each([
    [{}, "needs BETTER_AUTH_URL"],
    [{ BETTER_AUTH_URL: "http://refrain.raioviajante.com" }, "https origin"],
    [{ BETTER_AUTH_URL: `${CANONICAL}/studio` }, "https origin"],
    [{ BETTER_AUTH_URL: `${CANONICAL}:8443` }, "https origin"],
    [{ BETTER_AUTH_URL: `${CANONICAL}?x=1` }, "https origin"],
  ])(
    "refuses a canonical origin that is not exactly an https origin: %j",
    (env, message) => {
      expect(() =>
        canonicalHostRedirects({
          ...env,
          REFRAIN_CANONICAL_REDIRECT_HOSTS: "refrain-chi.vercel.app",
        }),
      ).toThrow(message);
    },
  );

  it.each([
    "refrain.raioviajante.com",
    "*.vercel.app",
    "refrain-chi.vercel.app/path",
    "refrain-chi.vercel.app:443",
    "https://refrain-chi.vercel.app",
    "a.com,,b.com",
    ".*",
    "localhost",
  ])(
    "refuses %j: only exact hostnames other than the canonical one",
    (hosts) => {
      expect(() =>
        canonicalHostRedirects({
          BETTER_AUTH_URL: CANONICAL,
          REFRAIN_CANONICAL_REDIRECT_HOSTS: hosts,
        }),
      ).toThrow();
    },
  );
});
