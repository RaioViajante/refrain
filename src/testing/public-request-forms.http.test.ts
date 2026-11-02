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

// What a response says about the request itself and nothing about any journal:
// the slug it was asked for, which a redirect repeats in its `Location`,
// `Refresh`, and body, and the random key that the framework puts in the Flight
// data of a page it renders for a crawler. Both are masked before two answers
// are compared.
function masked(snapshot: Snapshot, slugs: string[]) {
  const mask = (text: string) =>
    slugs
      .reduce((out, slug) => out.split(slug).join("SLUG"), text)
      .replace(/(")[A-Za-z0-9_-]{21,23}(?![A-Za-z0-9_-])/g, "$1ID");
  const view = comparable(snapshot);
  return {
    status: view.status,
    headers: Object.fromEntries(
      Object.entries(view.headers).map(([name, value]) => [name, mask(value)]),
    ),
    body: mask(view.body),
  };
}

// Every transport form of one public address.
function forms(s: string): [string, string, Record<string, string>][] {
  return [
    [
      "router prefetch",
      `/albums/${s}?_rsc=probe`,
      { rsc: "1", "next-router-prefetch": "1" },
    ],
    [
      "segment prefetch (tree)",
      `/albums/${s}?_rsc=probe`,
      {
        rsc: "1",
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/_tree",
      },
    ],
    [
      "segment prefetch (page)",
      `/albums/${s}?_rsc=probe`,
      {
        rsc: "1",
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/albums/[slug]/__PAGE__",
      },
    ],
    ["segment file", `/albums/${s}.segments/_tree.segment.rsc`, {}],
    [
      "page segment file",
      `/albums/${s}.segments/albums/$d$slug/__PAGE__.segment.rsc`,
      {},
    ],
    [".rsc", `/albums/${s}.rsc`, {}],
    [".json", `/albums/${s}.json`, {}],
    ["next data", `/_next/data/${buildId}/albums/${s}.json`, {}],
    [
      "Accept: application/json",
      `/albums/${s}`,
      { accept: "application/json" },
    ],
    ["Accept: text/plain", `/albums/${s}`, { accept: "text/plain" }],
    ["If-None-Match: *", `/albums/${s}`, { "if-none-match": "*" }],
    ["If-None-Match: a validator", `/albums/${s}`, { "if-none-match": '"x"' }],
    [
      "If-Modified-Since",
      `/albums/${s}`,
      { "if-modified-since": "Wed, 21 Oct 2037 07:28:00 GMT" },
    ],
    ["Range", `/albums/${s}`, { range: "bytes=0-10" }],
  ];
}

const variants = (s: string): [string, string][] => [
  ["uppercase path", `/ALBUMS/${s}`],
  ["capitalized path", `/Albums/${s}`],
  ["double slash before", `//albums/${s}`],
  ["double slash inside", `/albums//${s}`],
  ["dot segment", `/albums/./${s}`],
  ["encoded slash", `/albums%2F${s}`],
  ["encoded dot", `/albums/%2e/${s}`],
  ["semicolon", `/albums/${s};x=1`],
  ["fragment-like", `/albums/${s}%23x`],
];

describe("a served address is never cacheable, in any request form", () => {
  it.each(forms(slug("grace")))("%s", async (name, path, headers) => {
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
  it.each(forms(slug("draft")).map((f, i) => [f[0], i] as const))(
    "draft, %s",
    async (_name, index) => {
      const hidden = forms(slug("draft"))[index]!;
      const baseline = forms(unknown)[index]!;
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

  it("leaves the homepage and every address without a trailing slash as they were", async () => {
    const home = await request(on.baseURL, "/");
    expect(home.status).toBe(200);
    expect(home.body).toContain("Development build");
    const page = await request(on.baseURL, `/albums/${slug("grace")}`);
    expect(page.status).toBe(200);
    const signIn = await request(off.baseURL, "/studio/sign-in");
    expect(signIn.status).toBe(200);
  });

  it("KNOWN LIMITATION, for the owner: a repeated slash or a backslash still gets the framework's 308 without no-store, the same for every address", async () => {
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
