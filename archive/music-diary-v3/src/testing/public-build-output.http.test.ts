// What the production build prerenders for the public routes (ADR 0006 § 11,
// "no static generation ... nothing journal-related is rendered at build
// time", and the spike's "no static shell or journal data in the build
// output"; M3.1 owner review). The build needs no database (CI builds without
// `DATABASE_URL`), so nothing in its output can come from a journal. These
// tests read the build's own files, not the source, and fix what is there:
//
// - which routes under `/albums` and `/_not-found` are prerendered, and that
//   no concrete address is among them;
// - that the album route prerenders an empty fallback and no shell: since
//   issue #44 it renders per request in one pass (`instant = false`), as the
//   memory and artist pages do, so the build holds no page of it at all, and
//   its transport payloads name the parameter and no value;
// - that the not-found view is the same for every address and names none.
//
// Until issue #44 the route prerendered a generic shell (navigation, a
// loading line, the footer), which ADR 0006 A2 allowed; it no longer does
// (docs/evidence/m3-1.md, docs/evidence/v3-rc.md).
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
    const concrete = Object.keys(manifest.routes).filter(
      (route) =>
        route.startsWith("/albums/") || route.startsWith("/pt/albums/"),
    );
    expect(concrete).toEqual([]);
    expect(readdirSync(join(APP, "pt/albums")).sort()).toEqual([
      "[slug].html",
      "[slug].meta",
      "[slug].segments",
    ]);
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

  it("prerenders no page of the album route: its fallback is empty, so it needs no client JavaScript (issue #44)", () => {
    // The memory and artist routes' property: the route renders per request
    // in one pass, and the build holds an empty document for it, so no frame,
    // loading line, metadata, or data can be served from the build.
    expect(text(join(APP, "albums/[slug].html"))).toBe("");
    expect(text(join(APP, "pt/albums/[slug].html"))).toBe("");
    for (const route of ["/albums/[slug]", "/pt/albums/[slug]"]) {
      const entry = manifest.dynamicRoutes[route] as unknown as {
        response?: string;
        compute?: string;
        htmlSize?: number;
      };
      expect(entry, route).toBeDefined();
      expect(entry.response, route).toBe("empty");
      expect(entry.compute, route).toBe("blocking");
      expect(entry.htmlSize, route).toBe(0);
    }
  });

  it("has transport payloads (segments, RSC, postponed state) that carry the parameter name and no value", () => {
    const payloads = [
      ...files(join(APP, "albums")),
      ...files(join(APP, "pt/albums")),
    ].filter((file) => /\.(rsc|meta|html)$/.test(file));
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
      // ADR 0008 § 8: the v3 skipping record in English, the same message in
      // Portuguese after it, and the frame (languages in header and footer).
      /^Not found · refrain Skip to content refrain Albums Artists Memories EN \/ PT ERROR 404 · SIDE B this track skipped there’s nothing on this part of the record\. The link may be old, or the page moved\. Pick the record up somewhere else: Back to the start Albums Artists Memories ERRO 404 · LADO B essa faixa pulou: não tem nada nessa parte do disco\. Voltar pro começo 404 SIDE B it skips here some songs take you back\. Albums Artists Memories About sound EN \/ PT refrain is written by raioviajante$/,
    );
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).toContain("<title>Not found · refrain</title>");
    // v3: the skipping record is drawn in CSS; the only image is the
    // footer's torn edge, decorative, from the promoted assets, and nothing
    // from `reference/`.
    const images = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(images).toHaveLength(1);
    expect(images[0]).toContain('src="/v3/torn-top.png"');
    expect(images[0]).toContain('alt=""');
    expect(html).toContain('class="disc"');
    expect(html).not.toContain("/_next/image");
    expect(html).not.toContain("srcSet");
    expect(html).not.toContain("reference/");
    // It carries no request-specific text: no path, no slug, no entry.
    expect(html).not.toMatch(/albums\//);
    expect(html).not.toContain("__refrain-unknown-address");
  });

  // The Home (M3.4; ADR 0006, amendment A4). It is rendered on the server per
  // request, in one pass (`instant = false`), so the build prerenders nothing
  // of it: its entry is empty and blocking, and its segment files are the
  // framework's generic not-found fallback. What it lists, and whether it says
  // "Nothing published yet.", is decided per request.
  it("prerenders nothing of the Home: an empty, blocking entry", () => {
    const route = manifest.routes["/"] as unknown as {
      response?: string;
      compute?: string;
      htmlSize?: number;
    };
    expect(route).toBeDefined();
    expect(route.response).toBe("empty");
    expect(route.compute).toBe("blocking");
    expect(route.htmlSize).toBe(0);
    expect(text(join(APP, "index.html"))).toBe("");
    // The segments, and the postponed state and headers the server resumes
    // from (`index.meta`).
    for (const file of [
      ...files(join(APP, "index.segments")),
      join(APP, "index.meta"),
    ]) {
      const body = text(file);
      for (const needle of [
        "/albums/",
        "A personal music journal",
        "refrain-home-character",
        "Nothing published yet",
        "Most recent",
        "Recently written",
        "[Test]",
        "Grace",
        "Buckley",
      ]) {
        expect(body, `${file} contains ${needle}`).not.toContain(needle);
      }
    }
  });

  // The archives (M3.8a). Each is rendered on the server per request, in one
  // pass (`instant = false`), so the build prerenders nothing of it, as for the
  // Home: an empty, blocking entry, whose segments and postponed state are the
  // framework's generic frame and not-found fallback.
  it.each(["albums", "artists", "memories"])(
    "prerenders nothing of the %s archive: an empty, blocking entry",
    (archive) => {
      const route = manifest.routes[`/${archive}`] as unknown as {
        response?: string;
        compute?: string;
        htmlSize?: number;
      };
      expect(route).toBeDefined();
      expect(route.response).toBe("empty");
      expect(route.compute).toBe("blocking");
      expect(route.htmlSize).toBe(0);
      expect(text(join(APP, `${archive}.html`))).toBe("");
      for (const file of [
        ...files(join(APP, `${archive}.segments`)),
        join(APP, `${archive}.meta`),
      ]) {
        const body = text(file);
        // The route is named by its own segments, never by an address in it.
        const named = [
          ...body.matchAll(/\/(albums|artists|memories)\/([^/"\\\s,]+)/g),
        ]
          .map((match) => match[2]!)
          .filter((name) => !["__PAGE__", "layout", "page"].includes(name));
        expect(named, file).toEqual([]);
        for (const needle of [
          "Whole records",
          "The artists behind",
          "Memories and the music",
          "Nothing published yet",
          "could not be loaded",
          "tracks written",
          "Another journal",
          "[Test]",
          "Grace",
          "Buckley",
        ]) {
          expect(body, `${file} contains ${needle}`).not.toContain(needle);
        }
      }
    },
  );

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
