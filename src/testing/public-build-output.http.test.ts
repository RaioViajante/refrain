// What the production build prerenders for the public routes (ADR 0006 § 11,
// "no static generation ... nothing journal-related is rendered at build
// time", and the spike's "no static shell or journal data in the build
// output"; M3.1 owner review). The build needs no database (CI builds without
// `DATABASE_URL`), so nothing in its output can come from a journal. These
// tests read the build's own files, not the source, and fix what is there:
//
// - which routes under `/albums` and `/_not-found` are prerendered, and that
//   no concrete address is among them;
// - that the one prerendered page of the album route is a generic fallback
//   shell, and that its visible text, links, metadata, and transport payloads
//   hold only the frame (navigation, a loading line, the footer);
// - that the not-found view is the same for every address and names none.
//
// The shell is a prerendered response, so it is a "static shell" in the
// literal sense; the test states exactly what it holds, so that the owner's
// decision on the ADR's wording rests on facts (docs/evidence/m3-1.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const APP = ".next/server/app";

interface Manifest {
  routes: Record<string, { renderingMode: string }>;
  dynamicRoutes: Record<
    string,
    {
      renderingMode: string;
      fallback?: string | null;
      fallbackRouteParams?: { paramName: string }[];
      dataRoute?: string | null;
    }
  >;
}

const manifest = JSON.parse(
  readFileSync(".next/prerender-manifest.json", "utf8"),
) as Manifest;

function files(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .map((file) => join(directory, file))
    .filter(
      (file) => statSync(file).isFile() && !/\.(map|nft\.json)$/.test(file),
    );
}

const text = (file: string) => readFileSync(file, "utf8");

/** The words a reader of the shell would see. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("what the build prerenders for the public routes", () => {
  it("prerenders no concrete album address", () => {
    const concrete = Object.keys(manifest.routes).filter((route) =>
      route.startsWith("/albums/"),
    );
    expect(concrete).toEqual([]);
    // Nothing under the build's album directory but the one parameterised
    // fallback and its segments: a file per address would be named for it.
    const names = readdirSync(join(APP, "albums"));
    expect(names.sort()).toEqual([
      "[slug].html",
      "[slug].meta",
      "[slug].segments",
    ]);
  });

  it("prerenders the album route as one parameterised fallback, not as data", () => {
    const route = manifest.dynamicRoutes["/albums/[slug]"];
    expect(route).toBeDefined();
    expect(route!.renderingMode).toBe("PARTIALLY_STATIC");
    // The fallback is keyed on the parameter itself, never on a value of it.
    expect(route!.fallbackRouteParams).toEqual([
      { paramName: "slug", paramType: "dynamic" },
    ]);
    const meta = JSON.parse(text(join(APP, "albums/[slug].meta"))) as {
      routeCache?: { isFallback?: boolean };
    };
    expect(meta.routeCache?.isFallback).toBe(true);
  });

  it("has a shell that is the frame only: navigation, a loading line, and the footer", () => {
    const html = text(join(APP, "albums/[slug].html"));
    expect(visibleText(html)).toBe(
      "Skip to content Home Albums Loading… some songs take you back.",
    );
    // Links: the skip link and the homepage only. A link to an album would be
    // entry data.
    expect(
      [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]),
    ).toEqual(["#main", "/"]);
    // The loading state says nothing about whether anything exists.
    expect(html).toContain('aria-busy="true"');
    // No metadata that a journal could fill: the title and the description of
    // an entry, and its social-preview tags.
    expect(html).not.toMatch(/<title/);
    expect(html).not.toMatch(
      /<meta[^>]+(?:name|property)="(?:description|og:|twitter:)/,
    );
    expect(html).not.toMatch(/<link[^>]+rel="canonical"/);
    // No data island: nothing the page would hydrate from but the framework's
    // own streaming placeholders (`B:n` templates).
    expect(html).not.toMatch(/application\/(?:ld\+)?json/);
  });

  it("has transport payloads (segments, RSC, postponed state) that carry the parameter name and no value", () => {
    const album = join(APP, "albums");
    const payloads = files(album).filter((file) =>
      /\.(rsc|meta|html)$/.test(file),
    );
    expect(payloads.length).toBeGreaterThanOrEqual(4);
    for (const file of payloads) {
      const body = text(file);
      // The route is named by its pattern (`[slug]`, `$d$slug`) and its
      // file conventions, never by an address.
      const named = [...body.matchAll(/\/albums\/([^/"\\\s,]+)/g)].map(
        (match) => match[1],
      );
      expect(
        named.filter(
          (name) => !["[slug]", "$d$slug", "layout", "page"].includes(name!),
        ),
        file,
      ).toEqual([]);
      expect(body, file).not.toContain("[Test]");
      expect(body, file).not.toContain("Grace");
      expect(body, file).not.toContain("Buckley");
    }
  });

  it("has one not-found view, the same for every address, and it names none", () => {
    const html = text(join(APP, "_not-found.html"));
    expect(visibleText(html)).toMatch(
      /^Not found · refrain Skip to content Home Nothing here This page is not available\. Back to the start some songs take you back\.$/,
    );
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).toContain("<title>Not found · refrain</title>");
    // Its one image is the approved 404 drawing, served as the original file:
    // no optimizer URL, no resized copy, and nothing from `reference/`.
    const images = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(images).toHaveLength(1);
    expect(images[0]).toContain('src="/artwork/refrain-404.png"');
    expect(images[0]).toMatch(/alt="[^"]{40,}"/);
    expect(html).not.toContain("/_next/image");
    expect(html).not.toContain("srcSet");
    expect(html).not.toContain("reference/");
    // It carries no request-specific text: no path, no slug, no entry.
    expect(html).not.toMatch(/albums\//);
    expect(html).not.toContain("__refrain-unknown-address");
  });

  it("contains no journal text anywhere in the album or not-found output", () => {
    const everything = [
      ...files(join(APP, "albums")),
      ...files(join(APP, "_not-found.segments")),
      join(APP, "_not-found.html"),
      join(APP, "_not-found.rsc"),
    ];
    for (const file of everything) {
      const body = text(file);
      for (const needle of ["[Test]", "Grace", "Buckley", "Hallelujah"]) {
        expect(body, `${file} contains ${needle}`).not.toContain(needle);
      }
    }
  });
});
