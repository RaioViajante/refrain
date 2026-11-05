// The studio's prerendered files in the production build (F-01, issue #63).
//
// Every studio page is partially prerendered, and the host serves these files
// by their own addresses (`/studio.segments/_tree.segment.rsc`,
// `/studio/artists.segments/…`), which the browser's router never asks
// `next start` for. Each must be generic, holding nothing that depends on the
// catalog, the writing, or a session, and each address must be covered by a
// header route that makes it `private, no-store`. The routes are the ones the
// build compiled (`.next/routes-manifest.json`), which `vercel build` turns
// into the platform's routes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const APP = ".next/server/app";
const PRIVATE_NO_STORE = "private, no-store, max-age=0, must-revalidate";

interface Artifact {
  /** The address the host serves it at. */
  address: string;
  body: string;
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// `studio.html` → `/studio`, `studio/artists.segments/_tree.segment.rsc` →
// itself. `.meta` files hold the build's own response metadata, not a body.
function studioArtifacts(): Artifact[] {
  const files = [
    ...walk(join(APP, "studio")),
    join(APP, "studio.html"),
    ...walk(join(APP, "studio.segments")),
  ];
  return files
    .filter((file) => /\.(?:html|rsc)$/.test(file))
    .map((file) => {
      const path = `/${relative(APP, file)}`;
      return {
        address: path.endsWith(".html") ? path.slice(0, -5) : path,
        body: readFileSync(file, "utf8"),
      };
    });
}

function privateHeaderRoutes(): RegExp[] {
  const manifest = JSON.parse(
    readFileSync(".next/routes-manifest.json", "utf8"),
  ) as {
    headers: {
      regex: string;
      headers: { key: string; value: string }[];
    }[];
  };
  return manifest.headers
    .filter((route) =>
      route.headers.some(
        (header) =>
          header.key.toLowerCase() === "cache-control" &&
          header.value === PRIVATE_NO_STORE,
      ),
    )
    .map((route) => new RegExp(route.regex));
}

describe("the studio's prerendered files", () => {
  it("exist for the desk, nested pages, and their segments", () => {
    const addresses = studioArtifacts().map((artifact) => artifact.address);
    expect(addresses).toContain("/studio");
    expect(addresses).toContain("/studio.segments/_tree.segment.rsc");
    expect(addresses).toContain("/studio/artists");
    expect(addresses).toContain("/studio/artists.segments/_tree.segment.rsc");
  });

  it("are each served under a private, no-store header route", () => {
    const routes = privateHeaderRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const { address } of studioArtifacts()) {
      expect(
        routes.some((route) => route.test(address)),
        address,
      ).toBe(true);
    }
    // And nothing outside the studio and authentication gets the policy.
    for (const address of [
      "/",
      "/albums",
      "/studiox",
      "/studio-x",
      "/_next/static/chunks/a.js",
    ]) {
      expect(
        routes.some((route) => route.test(address)),
        address,
      ).toBe(false);
    }
  });

  it("hold no record, no synthetic writing, and no session", () => {
    for (const { address, body } of studioArtifacts()) {
      // Any record id: a prerendered file for a concrete record.
      expect(body, address).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      // Every fixture name and text is labeled `[Test]`.
      expect(body, address).not.toContain("[Test]");
      expect(body, address).not.toMatch(/session_token|__Secure-/);
      expect(body, address).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      // The studio's data appears only behind its `Suspense` boundaries.
      expect(body, address).not.toContain("Everything you are writing");
    }
  });
});
