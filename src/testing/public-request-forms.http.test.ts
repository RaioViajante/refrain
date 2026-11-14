// The other ways a request can reach a public address (M3.1 review findings):
// the router's prefetch and segment-prefetch requests, the transport URL forms
// (`.rsc`, `.segments`, `.json`, `/_next/data`), crawler and link-preview user
// agents (the framework renders those on a different path), path and case
// variants, and conditional, range, and `Accept` requests. For a served
// address no response may be cacheable; for an address that is not served,
// every form must answer exactly as it does for an unknown address; with the
// switch off, every surface and method must answer as an unknown address does,
// in status, headers, and body.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// eslint-disable-next-line no-restricted-imports
import { changeEntrySlug } from "@/modules/publication/commands";
import {
  startProductionServer,
  type ProductionServer,
} from "@/testing/production-server";
import {
  comparable,
  corpus,
  request,
  type Snapshot,
} from "@/testing/public-http";
import {
  fixtureDatabase,
  PRIVATE_MARKER_LIST,
  PRIVATE_MARKERS,
  PUBLIC_TEXT,
  removeSeeded,
  runPrefix,
  seedGrace,
  seedSimple,
  type SeededJournal,
} from "@/testing/public-journals";
import { forms, masked, variants } from "@/testing/public-request-forms";
import { assertDisposableTestDatabase } from "@/testing/test-database";

process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const prefix = runPrefix();
const slug = (name: string) => `${prefix}-${name}`;
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();

let client: Client;
let on: ProductionServer;
let off: ProductionServer;
const seeded: SeededJournal[] = [];

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-request-forms",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  seeded.push(await seedGrace(client, { slug: slug("grace") }));
  seeded.push(
    await seedSimple(client, {
      slug: slug("draft"),
      title: "[Test] Draft album",
      status: "draft",
      marker: PRIVATE_MARKERS.draft,
    }),
  );
  const renamed = await seedSimple(client, {
    slug: slug("old"),
    title: "[Test] Renamed album",
    status: "published",
    marker: "[Test] renamed public text",
  });
  seeded.push(renamed);
  await changeEntrySlug(fixtureDatabase(client), renamed.entryId, slug("new"));
  on = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: "true" },
  });
  off = await startProductionServer({ withAuthor: false });
}, 120_000);

afterAll(async () => {
  await on?.stop().catch(() => undefined);
  await off?.stop().catch(() => undefined);
  try {
    await removeSeeded(client, seeded, prefix);
  } finally {
    await client.end();
  }
}, 60_000);

describe("a served address is never cacheable, in any request form", () => {
  it.each(forms(slug("grace"), buildId))("%s", async (name, path, headers) => {
    const got = await request(on.baseURL, path, { headers });
    // Whatever the framework answers to this form, it must not be storable,
    // and it must carry no private writing.
    expect(got.status, name).toBeLessThan(500);
    if (got.status < 400) {
      expect(got.headers["cache-control"], name).toMatch(/no-store/);
      expect(got.headers["cache-control"], name).not.toMatch(
        /public|s-maxage|max-age=[1-9]/,
      );
      expect(got.headers.etag === undefined || got.status !== 304, name).toBe(
        true,
      );
    }
    for (const marker of PRIVATE_MARKER_LIST) {
      expect(got.body.includes(marker), name).toBe(false);
    }
  });

  it("the page's own shell responses are no-store", async () => {
    for (const path of [`/albums/${slug("grace")}`, `/albums/${slug("new")}`]) {
      const sets: Record<string, string>[] = [
        {},
        { rsc: "1" },
        { rsc: "1", "next-router-prefetch": "1" },
      ];
      for (const headers of sets) {
        const got = await request(on.baseURL, `${path}?_rsc=probe`, {
          headers,
        });
        if (got.status === 200) {
          expect(
            got.headers["cache-control"],
            JSON.stringify(headers),
          ).toContain("no-store");
        }
      }
    }
  });
});

describe("an address that is not served answers every request form as an unknown one", () => {
  const unknown = slug("nothing");
  it.each(forms(slug("draft"), buildId).map((f, i) => [f[0], i] as const))(
    "draft, %s",
    async (_name, index) => {
      const hidden = forms(slug("draft"), buildId)[index]!;
      const baseline = forms(unknown, buildId)[index]!;
      const a = comparable(
        await request(on.baseURL, hidden[1], { headers: hidden[2] }),
      );
      const b = comparable(
        await request(on.baseURL, baseline[1], { headers: baseline[2] }),
      );
      expect(a.status).toBe(b.status);
      expect(a.headers).toEqual(b.headers);
      expect(a.body).toEqual(b.body);
    },
  );

  it.each(variants(slug("draft")).map((v, i) => [v[0], i] as const))(
    "draft, %s",
    async (_name, index) => {
      const hidden = variants(slug("draft"))[index]![1];
      const baseline = variants(unknown)[index]![1];
      const slugs = [slug("draft"), unknown];
      expect(masked(await request(on.baseURL, hidden), slugs)).toEqual(
        masked(await request(on.baseURL, baseline), slugs),
      );
    },
  );

  it.each(variants(slug("grace")).map((v) => v[0]))(
    "a served address, %s, never fails and never shows private writing",
    async (name) => {
      const path = variants(slug("grace")).find((v) => v[0] === name)![1];
      const got = await request(on.baseURL, path);
      expect(got.status, name).toBeLessThan(500);
      for (const marker of PRIVATE_MARKER_LIST) {
        expect(got.body.includes(marker), name).toBe(false);
      }
    },
  );
});

describe("crawlers and link-preview bots", () => {
  const bots = [
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  ];

  it.each(bots)(
    "%s: a served page, a redirect, and a hidden address",
    async (agent) => {
      const headers = { "user-agent": agent };
      const page = await request(on.baseURL, `/albums/${slug("grace")}`, {
        headers,
      });
      expect(page.status).toBe(200);
      expect(page.headers["cache-control"]).toContain("no-store");
      expect(page.body).toContain(
        "<title>Grace · Jeff Buckley · refrain</title>",
      );
      expect(page.body).toContain('property="og:title"');
      expect(page.body).toContain(PUBLIC_TEXT.opening);
      for (const marker of PRIVATE_MARKER_LIST) {
        expect(page.body.includes(marker)).toBe(false);
      }

      const moved = await request(on.baseURL, `/albums/${slug("old")}`, {
        headers,
      });
      expect(moved.status).toBe(308);
      expect(moved.headers.location).toBe(`/albums/${slug("new")}`);
      expect(moved.headers["cache-control"]).toBe("no-store");

      const slugs = [slug("nothing"), slug("draft")];
      const unknown = masked(
        await request(on.baseURL, `/albums/${slug("nothing")}`, { headers }),
        slugs,
      );
      expect(unknown.status).toBe(404);
      expect(
        masked(
          await request(on.baseURL, `/albums/${slug("draft")}`, { headers }),
          slugs,
        ),
      ).toEqual(unknown);
      // A hidden address shows a crawler the same noindex view as anyone.
      expect(unknown.body).toContain('content="noindex"');
    },
  );
});

describe("with public reads off, every surface and method is an unknown address", () => {
  const surfaces = [
    `/albums/${slug("grace")}`,
    `/albums/${slug("old")}`,
    `/albums/${slug("draft")}`,
    "/sitemap.xml",
    "/robots.txt",
  ];
  const baseline = `/albums/${slug("nothing")}`;

  it.each(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "%s: identical status, headers, and body",
    async (method) => {
      const expected = comparable(
        await request(off.baseURL, baseline, { method }),
      );
      expect(expected.status).toBe(404);
      for (const path of surfaces) {
        expect(
          comparable(await request(off.baseURL, path, { method })),
          `${method} ${path}`,
        ).toEqual(expected);
      }
    },
  );

  it.each([
    ["RSC", { rsc: "1" }],
    ["prefetch", { rsc: "1", "next-router-prefetch": "1" }],
    ["a bot", { "user-agent": "Googlebot/2.1" }],
    ["Accept: json", { accept: "application/json" }],
  ] as [string, Record<string, string>][])(
    "%s: identical",
    async (_n, headers) => {
      const get = (path: string) =>
        request(off.baseURL, path.includes("?") ? path : `${path}?_rsc=probe`, {
          headers,
        });
      const expected = comparable(await get(baseline));
      for (const path of surfaces) {
        expect(comparable(await get(path)), path).toEqual(expected);
      }
    },
  );

  it("the trailing-slash redirect is the same shape for every address, switch on or off", async () => {
    const slugs = [slug("grace"), slug("draft"), slug("nothing")];
    const shape = (s: Snapshot) => masked(s, slugs);
    for (const server of [on, off]) {
      const answers = [];
      for (const s of [slug("grace"), slug("draft"), slug("nothing")]) {
        const got = await request(server.baseURL, `/albums/${s}/`);
        expect(got.status).toBe(308);
        expect(got.headers.location).toBe(`/albums/${s}`);
        expect(got.headers["cache-control"]).toBe("no-store");
        answers.push(shape(got));
      }
      expect(answers[1], JSON.stringify(answers)).toEqual(answers[0]);
      expect(answers[2], JSON.stringify(answers)).toEqual(answers[0]);
    }
  });
});

// Address normalization (ADR 0006, amendment A2). The framework's own
// trailing-slash `308` ran before the proxy and could not carry `no-store`; the
// proxy now sends the same `308` to the same address, with `no-store`, for
// every address on the site (src/address-normalization.ts). Everything about
// the redirect but its `Cache-Control` is what the framework sent before
// (measured against the previous build: status, `Location`, `Refresh`, body).
describe("address normalization", () => {
  const trailing: [string, string][] = [
    [`/albums/${slug("grace")}/`, `/albums/${slug("grace")}`],
    [`/albums/${slug("draft")}/`, `/albums/${slug("draft")}`],
    [`/albums/${slug("nothing")}/`, `/albums/${slug("nothing")}`],
    [
      `/albums/${slug("nothing")}/?q=1&r=2`,
      `/albums/${slug("nothing")}?q=1&r=2`,
    ],
    ["/albums/", "/albums"],
    ["/albums/x/y/", "/albums/x/y"],
    ["/ALBUMS/X/", "/ALBUMS/X"],
    ["/sitemap.xml/", "/sitemap.xml"],
    ["/robots.txt/", "/robots.txt"],
    ["/studio/", "/studio"],
    ["/studio/journals/", "/studio/journals"],
    ["/api/auth/session/", "/api/auth/session"],
    ["/artwork/refrain-404.webp/", "/artwork/refrain-404.webp"],
    ["/_next/static/chunks/nothing.js/", "/_next/static/chunks/nothing.js"],
  ];

  it.each(trailing)(
    "%s: the framework's 308 to the same address, now no-store, for every method, with the switch on or off",
    async (path, destination) => {
      for (const server of [on, off]) {
        for (const init of [
          { method: "GET" },
          { method: "HEAD" },
          { method: "POST" },
          { method: "GET", headers: { rsc: "1" } },
        ]) {
          const got = await request(server.baseURL, path, init);
          const label = `${init.method} ${JSON.stringify(init.headers ?? {})}`;
          expect(got.status, label).toBe(308);
          expect(got.headers.location, label).toBe(destination);
          expect(got.headers.refresh, label).toBe(`0;url=${destination}`);
          expect(got.headers["cache-control"], label).toBe("no-store");
          expect(got.body, label).toBe(
            init.method === "HEAD" ? "" : destination,
          );
          expect(got.headers["x-nextjs-cache"], label).toBeUndefined();
        }
      }
    },
  );

  // Raw requests: fetch() normalizes `\\` and dot segments, and cannot choose
  // `Host`.
  const raw = (path: string, headers: Record<string, string> = {}) =>
    new Promise<{
      status?: number;
      location?: string;
      refresh?: string;
      cookie?: string[];
      body: string;
    }>((resolve, reject) => {
      const url = new URL(on.baseURL);
      const req = httpRequest(
        { host: url.hostname, port: url.port, path, headers },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              location: res.headers.location,
              refresh: res.headers.refresh as string | undefined,
              cookie: res.headers["set-cookie"],
              body,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });

  it("never reflects a spoofed Host or forwarded host into a trailing-slash 308, anywhere on the site", async () => {
    for (const path of [
      "/studio/journals/",
      "/api/auth/session/",
      `/albums/${slug("draft")}/`,
      "/sitemap.xml/",
    ]) {
      const got = await raw(path, {
        host: "evil.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      });
      expect(got.status, path).toBe(308);
      expect(got.location, path).toBe(path.slice(0, -1));
      expect(got.refresh, path).toBe(`0;url=${path.slice(0, -1)}`);
      expect(JSON.stringify(got), path).not.toContain("evil.example");
    }
  });

  it("is never an open redirect: every target is a path on this site", async () => {
    for (const path of [
      "/%2F%2Fevil.example/",
      "/%5C%5Cevil.example/",
      "/%2F/evil.example/",
      "/%09/evil.example/",
      "//evil.example/",
      "/\\evil.example/",
      "/\\/evil.example/",
      "/.//evil.example/",
    ]) {
      const got = await raw(path);
      expect(got.status, path).toBe(308);
      const location = got.location ?? "";
      // One leading slash, then not a slash or a backslash: a path, never a
      // scheme-relative or absolute address.
      expect(location, path).toMatch(/^\/(?![/\\])/);
      expect(new URL(location, "http://site.test").host, path).toBe(
        "site.test",
      );
    }
  });

  it("sets no cookie, and answers the same with or without a session, on the studio and the auth endpoint", async () => {
    for (const path of [
      "/studio/",
      "/studio/journals/",
      "/api/auth/session/",
    ]) {
      const anonymous = await raw(path);
      const withSession = await raw(path, {
        cookie: "better-auth.session_token=forged.value; other=1",
      });
      expect(anonymous.cookie, path).toBeUndefined();
      expect(withSession, path).toEqual(anonymous);
      expect(anonymous.status, path).toBe(308);
    }
  });

  it("still gives a percent-encoded public address the public decision: switch off, the unknown address; switch on, a hidden one answers as an unknown one", async () => {
    // The framework matches the proxy against the decoded path too, so these
    // reach the proxy; they must not slip past it to a route of their own, and
    // they carry the public security headers like every other public answer.
    const encoded = (s: string) => [
      "/%73itemap.xml",
      "/robots%2Etxt",
      `/%61lbums/${s}`,
      `/albums%2F${s}`,
      `/albums/%${s.charCodeAt(0).toString(16)}${s.slice(1)}`,
    ];
    for (const method of ["GET", "HEAD", "POST"]) {
      // Switch off: every surface, including a served journal's, is unknown.
      const unknown = comparable(
        await request(off.baseURL, `/albums/${slug("nothing")}`, { method }),
      );
      for (const path of [
        ...encoded(slug("grace")),
        ...encoded(slug("draft")),
      ]) {
        expect(
          comparable(await request(off.baseURL, path, { method })),
          `off: ${method} ${path}`,
        ).toEqual(unknown);
      }
      // Switch on: a hidden journal's encoded address answers exactly as an
      // unknown journal's does (a served one is public, and may differ).
      const slugs = [slug("draft"), slug("nothing")];
      const hidden = encoded(slug("draft"));
      const absent = encoded(slug("nothing"));
      for (const [index, path] of hidden.entries()) {
        expect(
          masked(await request(on.baseURL, path, { method }), slugs),
          `on: ${method} ${path}`,
        ).toEqual(
          masked(await request(on.baseURL, absent[index]!, { method }), slugs),
        );
      }
    }
  });

  it("answers the framework's transport forms of a trailing-slash address with no-store, the same for a hidden and an unknown address", async () => {
    // Measured: these answer the not-found view (`404`), not a redirect. What
    // matters is that they are `no-store`, point nowhere else, and cannot tell
    // a hidden address from an unknown one.
    const shapes = (s: string): [string, Record<string, string>][] => [
      [`/_next/data/${buildId}/albums/${s}.json/`, {}],
      [`/_next/data/${buildId}/albums/${s}.json/`, { "x-nextjs-data": "1" }],
      [`/albums/${s}/.segments/_tree.segment.rsc`, {}],
      [`/albums/${s}/?_rsc=abc`, { rsc: "1" }],
    ];
    const hiddenForms = shapes(slug("draft"));
    const unknownForms = shapes(slug("nothing"));
    for (const [index, [path, headers]] of hiddenForms.entries()) {
      const label = `${path} ${JSON.stringify(headers)}`;
      const got = await request(on.baseURL, path, { headers });
      expect(got.headers["cache-control"], label).toMatch(/no-store/);
      const target =
        got.headers.location ?? got.headers["x-nextjs-redirect"] ?? "/";
      expect(target, label).toMatch(/^\/(?![/\\])|^\/$/);
      for (const marker of PRIVATE_MARKER_LIST) {
        expect(got.body.includes(marker), label).toBe(false);
      }
      const [unknownPath, unknownHeaders] = unknownForms[index]!;
      const slugs = [slug("draft"), slug("nothing")];
      expect(masked(got, slugs), label).toEqual(
        masked(
          await request(on.baseURL, unknownPath, { headers: unknownHeaders }),
          slugs,
        ),
      );
    }
  });

  it("leaves the homepage and every address without a trailing slash as they were", async () => {
    const home = await request(on.baseURL, "/");
    expect(home.status).toBe(200);
    // The Home itself (M3.4), not a redirect to anything else.
    expect(home.body).toContain('<h1 id="ph-title"');
    const page = await request(on.baseURL, `/albums/${slug("grace")}`);
    expect(page.status).toBe(200);
    const signIn = await request(off.baseURL, "/studio/sign-in");
    expect(signIn.status).toBe(200);
  });

  it("KNOWN LIMITATION, for the owner: a repeated slash or a backslash still gets the framework's 308 without no-store or the indexing header, the same for every address", async () => {
    // Next.js 16.4.3 answers these at the top of its router, before any header
    // rule, redirect, or proxy runs, with an empty header set
    // (server/lib/router-utils/resolve-routes.js). The application cannot add
    // `no-store` to it. This test fixes its exact shape, so that a change in
    // the framework is noticed, and proves that it is the same whatever the
    // state of the journal it names.
    const shape = (got: Snapshot, s: string) => ({
      status: got.status,
      location: (got.headers.location ?? "").split(s).join("SLUG"),
      cacheControl: got.headers["cache-control"],
      robots: got.headers["x-robots-tag"],
      body: got.body.split(s).join("SLUG"),
    });
    for (const server of [on, off]) {
      const answers = [];
      for (const s of [slug("grace"), slug("draft"), slug("nothing")]) {
        const got = await request(server.baseURL, `/albums//${s}`);
        answers.push(shape(got, s));
      }
      expect(answers[0]).toEqual({
        status: 308,
        location: "/albums/SLUG",
        cacheControl: undefined,
        robots: undefined,
        body: "/albums/SLUG",
      });
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
    }
    // A backslash, which a browser never sends but a raw client can.
    const raw = await new Promise<{
      status?: number;
      location?: string;
      cc?: string;
      robots?: string | string[];
    }>((resolve, reject) => {
      const url = new URL(on.baseURL);
      const req = httpRequest(
        {
          host: url.hostname,
          port: url.port,
          path: `/albums\\${slug("draft")}`,
        },
        (res) => {
          res.resume();
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            cc: res.headers["cache-control"],
            robots: res.headers["x-robots-tag"],
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(raw).toEqual({
      status: 308,
      location: `/albums/${slug("draft")}`,
      cc: undefined,
      // Nor the indexing policy's header (src/testing/indexing.http.test.ts).
      robots: undefined,
    });
  });
});

describe("what every request saw", () => {
  it("contains no private marker", () => {
    expect(corpus.length).toBeGreaterThan(100);
    const all = corpus.join("\n");
    for (const marker of PRIVATE_MARKER_LIST) {
      expect(all.includes(marker), marker).toBe(false);
    }
  });
});
