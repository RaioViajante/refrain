// The initial indexing policy over real HTTP (docs/security.md#indexing),
// against the production build and the disposable test database: every
// response the application controls carries `X-Robots-Tag: noindex,
// nofollow`, with public reads on and off, in English and Portuguese, in every
// request form, for a page, a not-found answer for any reason, a redirect, a
// refusal, a failure, the Studio with and without a session, the
// authentication endpoints, a Server Action, and the static files; every
// document carries the same `robots` meta tag; `robots.txt` names no sitemap
// and disallows no content; the sitemap answers as before. The value is the
// same everywhere, so it says nothing about any address. The one response
// that lacks it is the framework's own repeated-slash `308`, which runs before
// any application header, for a repeated slash or a backslash (a recorded
// limitation, fixed in shape below).
//
// Synthetic data only: every row is labelled "[Test]" and removed at the end.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// eslint-disable-next-line no-restricted-imports
import { changeEntrySlug } from "@/modules/publication/commands";
import { ROBOTS_DIRECTIVE } from "@/indexing-policy";
import {
  mintAuthorSession,
  removeMintedSessions,
  type MintedSession,
} from "@/testing/http-session";
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
  removeSeeded,
  runPrefix,
  seedGrace,
  seedSimple,
  type SeededJournal,
} from "@/testing/public-journals";
import {
  removeSeededArtists,
  seedArtistPages,
  type SeededArtists,
} from "@/testing/public-artists";
import {
  MEMORY_MARKER_LIST,
  removeSeededMemories,
  seedMemories,
  type SeededMemories,
} from "@/testing/public-memories";
import { forms } from "@/testing/public-request-forms";
import { assertDisposableTestDatabase } from "@/testing/test-database";

process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

const offBase = inject("studioBaseURL");
const commandEnv = inject("studioCommandEnv");
const databaseUrl = commandEnv.DATABASE_URL!;
const prefix = runPrefix();
const slug = (name: string) => `${prefix}-${name}`;
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
const META = `<meta name="robots" content="${ROBOTS_DIRECTIVE}"/>`;

let client: Client;
let on: ProductionServer;
let author: MintedSession;
const servers: ProductionServer[] = [];
const seeded: SeededJournal[] = [];
let artists: SeededArtists;
let memories: SeededMemories;
let artistAddress = "";

/**
 * Every value of the header seen, keyed by the whole request that received it
 * (method, server, path, and headers), so no two requests share an entry.
 */
const seen = new Map<string, { path: string; value: string | undefined }>();

function remember(
  base: string,
  path: string,
  init: Parameters<typeof request>[2],
  value: string | undefined,
) {
  const headers = { ...(init?.headers as Record<string, string> | undefined) };
  if (headers.cookie && headers.cookie === author?.cookie) {
    headers.cookie = "<the author's session>";
  }
  const key = JSON.stringify([
    init?.method ?? "GET",
    base,
    path,
    init?.rsc ?? false,
    headers,
  ]);
  seen.set(key, { path, value });
}

async function got(
  base: string,
  path: string,
  init: Parameters<typeof request>[2] = {},
): Promise<Snapshot> {
  const response = await request(base, path, init);
  // The author's own Studio shows the author's drafts: those answers are not
  // part of what a reader was sent, so they leave the scanned corpus. Only
  // the author's session does; any other cookie stays a reader's request.
  const cookie = (init.headers as Record<string, string> | undefined)?.cookie;
  if (cookie !== undefined && cookie === author?.cookie) {
    corpus.splice(corpus.length - 2, 2);
  }
  remember(base, path, init, response.headers["x-robots-tag"]);
  return response;
}

/**
 * A request sent as written: fetch() normalizes a backslash, so the
 * framework's backslash answer needs a raw request.
 */
function raw(
  base: string,
  path: string,
): Promise<{ status?: number; location?: string; robots?: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(base);
    const req = httpRequest(
      { host: url.hostname, port: url.port, path },
      (res) => {
        res.resume();
        const robots = res.headers["x-robots-tag"];
        remember(
          base,
          path,
          {},
          Array.isArray(robots) ? robots.join() : robots,
        );
        resolve({
          status: res.statusCode,
          location: res.headers.location,
          robots: Array.isArray(robots) ? robots.join() : robots,
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function expectPolicy(response: Snapshot, what: string) {
  expect(response.headers["x-robots-tag"], what).toBe(ROBOTS_DIRECTIVE);
}

/** The Portuguese form of an English path. */
function portuguese(path: string): string {
  if (path.startsWith(`/_next/data/${buildId}/`)) {
    return path.replace(
      `/_next/data/${buildId}/`,
      `/_next/data/${buildId}/pt/`,
    );
  }
  return path === "/" ? "/pt" : `/pt${path}`;
}

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-indexing-tests",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  const db = fixtureDatabase(client);

  seeded.push(await seedGrace(client, { slug: slug("grace") }));
  for (const status of ["draft", "private"] as const) {
    seeded.push(
      await seedSimple(client, {
        slug: slug(status),
        title: `[Test] ${status} album`,
        status,
        marker: PRIVATE_MARKERS[status],
      }),
    );
  }
  seeded.push(
    await seedSimple(client, {
      slug: slug("deleted"),
      title: "[Test] Deleted album",
      status: "published",
      marker: PRIVATE_MARKERS.deleted,
      deletedAt: new Date(),
    }),
  );
  const renamed = await seedSimple(client, {
    slug: slug("old"),
    title: "[Test] Renamed album",
    status: "published",
    marker: "[Test] renamed album",
  });
  seeded.push(renamed);
  await changeEntrySlug(db, renamed.entryId, slug("new"));
  artists = await seedArtistPages(client, `${prefix}a`);
  memories = await seedMemories(client, `${prefix}m`);
  author = await mintAuthorSession(client, commandEnv.BETTER_AUTH_SECRET!);

  on = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: "true" },
  });
  servers.push(on);
  const archive = (await request(on.baseURL, "/artists")).body;
  artistAddress = /href="\/artists\/([^"]+)"/.exec(archive)![1]!;
}, 180_000);

afterAll(async () => {
  for (const server of servers) {
    await server.stop().catch(() => undefined);
  }
  try {
    await removeMintedSessions(client);
    await removeSeededMemories(client, memories, `${prefix}m`);
    await removeSeededArtists(client, artists, `${prefix}a`);
    await removeSeeded(client, seeded, prefix);
  } finally {
    await client.end();
  }
}, 120_000);

/** Every public address of the sections, in the states the rules name. */
function addresses(): Record<string, string> {
  return {
    home: "/",
    albums: "/albums",
    artists: "/artists",
    memories: "/memories",
    grace: `/albums/${slug("grace")}`,
    draft: `/albums/${slug("draft")}`,
    private: `/albums/${slug("private")}`,
    deleted: `/albums/${slug("deleted")}`,
    renamedOld: `/albums/${slug("old")}`,
    renamedNew: `/albums/${slug("new")}`,
    unknownAlbum: `/albums/${slug("nothing")}`,
    artist: `/artists/${artistAddress}`,
    unknownArtist: `/artists/${slug("nobody")}`,
    memory: `/memories/${memories.shown.slug}`,
    memoryPrevious: `/memories/${memories.shown.previousSlug}`,
    memoryHidden: `/memories/${memories.hidden[0]!.slug}`,
    unknownMemory: `/memories/${slug("nothing")}`,
    unknownSection: `/${slug("nowhere")}`,
  };
}

describe("public addresses, with public reads on and off, in both languages", () => {
  it("carry the policy on every answer: 200, 308, and 404 alike", async () => {
    const statuses: Record<string, number> = {};
    for (const [state, base] of [
      ["on", on.baseURL],
      ["off", offBase],
    ] as const) {
      for (const [name, english] of Object.entries(addresses())) {
        for (const path of [english, portuguese(english)]) {
          const response = await got(base, path);
          expectPolicy(response, `${state} ${path}`);
          statuses[`${state} ${path === english ? "en" : "pt"} ${name}`] =
            response.status;
        }
      }
    }
    // The answers are the ones the other HTTP tests define; the policy did
    // not change any of them.
    for (const language of ["en", "pt"]) {
      expect(statuses[`on ${language} home`]).toBe(200);
      expect(statuses[`on ${language} grace`]).toBe(200);
      expect(statuses[`on ${language} artist`]).toBe(200);
      expect(statuses[`on ${language} memory`]).toBe(200);
      expect(statuses[`on ${language} renamedOld`]).toBe(308);
      expect(statuses[`on ${language} memoryPrevious`]).toBe(308);
      for (const hidden of [
        "draft",
        "private",
        "deleted",
        "unknownAlbum",
        "memoryHidden",
        "unknownSection",
      ]) {
        expect(statuses[`on ${language} ${hidden}`], hidden).toBe(404);
      }
      // Switched off: the Home answers (A4), everything else is unknown.
      expect(statuses[`off ${language} home`]).toBe(200);
      for (const name of ["grace", "albums", "artist", "memory"]) {
        expect(statuses[`off ${language} ${name}`], name).toBe(404);
      }
    }
  });

  it("carry it in every transport form of a page, a hidden address, and an unknown one", async () => {
    for (const base of [on.baseURL, offBase]) {
      for (const s of [slug("grace"), slug("draft"), slug("nothing")]) {
        for (const [form, english, headers] of forms(s, buildId)) {
          for (const path of [english, portuguese(english)]) {
            const response = await got(base, path, { headers });
            expectPolicy(response, `${form} ${path}`);
          }
        }
      }
      for (const path of ["/", "/pt", "/albums", "/pt/albums"]) {
        expectPolicy(await got(base, path, { rsc: true }), `_rsc ${path}`);
      }
    }
  });

  it("keep a hidden address and an unknown one identical, header included", async () => {
    const view = (response: Snapshot, s: string) => {
      const { status, headers, body } = comparable(response);
      return {
        status,
        headers: JSON.stringify(headers).split(s).join("SLUG"),
        body: body.split(s).join("SLUG"),
      };
    };
    const pairs: [string, string, string[]][] = [
      [
        "albums",
        slug("nothing"),
        [slug("draft"), slug("private"), slug("deleted")],
      ],
      [
        "memories",
        slug("nothing"),
        memories.hidden.map((hidden) => hidden.slug),
      ],
    ];
    for (const [section, nothing, hiddenSlugs] of pairs) {
      for (const language of ["", "/pt"]) {
        const unknown = view(
          await got(on.baseURL, `${language}/${section}/${nothing}`),
          nothing,
        );
        for (const hidden of hiddenSlugs) {
          const path = `${language}/${section}/${hidden}`;
          expect(view(await got(on.baseURL, path), hidden), path).toEqual(
            unknown,
          );
        }
      }
    }
    // Switched off, a served journal answers as an unknown address too.
    for (const english of [`/albums/${slug("grace")}`]) {
      for (const path of [english, portuguese(english)]) {
        const grace = view(await got(offBase, path), slug("grace"));
        const nothing = view(
          await got(offBase, path.replace(slug("grace"), slug("nothing"))),
          slug("nothing"),
        );
        expect(grace, path).toEqual(nothing);
      }
    }
  });

  it("carry it on the proxy's own answers: redirects, refusals, encoded spellings", async () => {
    const grace = `/albums/${slug("grace")}`;
    const cases: [string, string, RequestInit?][] = [
      // The trailing slash's 308, from the proxy.
      ["trailing slash", `${grace}/`],
      ["trailing slash, pt", `/pt${grace}/`],
      ["Studio trailing slash", "/studio/"],
      // A refused method: 405.
      ["POST", grace, { method: "POST" }],
      ["DELETE, pt", `/pt${grace}`, { method: "DELETE" }],
      ["POST archive", "/albums", { method: "POST" }],
      ["POST sitemap", "/sitemap.xml", { method: "POST" }],
      ["POST robots", "/robots.txt", { method: "POST" }],
      // Encoded spellings, which the header rules do not match.
      ["encoded section", `/%61lbums/${slug("grace")}`],
      ["encoded sitemap", "/%73itemap.xml"],
      ["encoded prefix", `/%70t/albums/${slug("grace")}`],
      ["encoded Studio", "/%73tudio"],
      ["encoded Studio inside", "/st%75dio/journals"],
      ["encoded Portuguese Studio", "/pt/st%75dio"],
    ];
    for (const base of [on.baseURL, offBase]) {
      for (const [name, path, init] of cases) {
        const response = await got(base, path, init);
        expectPolicy(response, `${name} ${path}`);
      }
    }
    expect((await got(on.baseURL, `${grace}/`)).status).toBe(308);
    expect((await got(on.baseURL, grace, { method: "POST" })).status).toBe(405);
  });

  it("carry it on the generic 503 of a database failure", async () => {
    const broken = await startProductionServer({
      withAuthor: false,
      env: {
        REFRAIN_PUBLIC_READS_ENABLED: "true",
        DATABASE_URL: `postgres://nobody:pw-${randomUUID()}@127.0.0.1:1/none`,
      },
    });
    servers.push(broken);
    for (const path of [
      `/albums/${slug("grace")}`,
      `/pt/memories/${slug("grace")}`,
    ]) {
      const response = await got(broken.baseURL, path);
      expect(response.status, path).toBe(503);
      expectPolicy(response, path);
    }
  });

  it("KNOWN LIMITATION: the framework's repeated-slash and backslash 308 has no application header at all, and its target has the policy", async () => {
    // Next.js answers a repeated slash or a backslash before any header rule
    // or proxy runs (see the same limitation for `no-store` in
    // public-request-forms.http.test.ts), so the application cannot add the
    // header there. A 308 has no content to index; the address it names
    // carries the policy. This fixes the documented shape, not a header the
    // framework does not allow.
    for (const base of [on.baseURL, offBase]) {
      for (const [path, destination] of [
        [`/albums//${slug("grace")}`, `/albums/${slug("grace")}`],
        [`/pt//albums/${slug("grace")}`, `/pt/albums/${slug("grace")}`],
        [`//albums/${slug("grace")}`, `/albums/${slug("grace")}`],
      ] as const) {
        const response = await got(base, path);
        expect(response.status, path).toBe(308);
        expect(response.headers.location, path).toBe(destination);
        expect(response.headers["x-robots-tag"], path).toBeUndefined();
        const target = await got(base, destination);
        expectPolicy(target, `the target of ${path}`);
      }
      // A backslash, which a browser never sends but a raw client can.
      for (const [path, destination] of [
        [`/albums\\${slug("grace")}`, `/albums/${slug("grace")}`],
        [`/pt\\albums\\${slug("grace")}`, `/pt/albums/${slug("grace")}`],
      ] as const) {
        const response = await raw(base, path);
        expect(response, path).toEqual({
          status: 308,
          location: destination,
          robots: undefined,
        });
        const target = await got(base, destination);
        expectPolicy(target, `the target of ${path}`);
      }
    }
  });
});

describe("robots.txt and the sitemap", () => {
  it("robots.txt names no sitemap and disallows only the Studio and the API", async () => {
    const response = await got(on.baseURL, "/robots.txt");
    expect(response.status).toBe(200);
    expectPolicy(response, "robots.txt");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe(
      [
        "User-agent: *",
        "Disallow: /studio",
        "Disallow: /pt/studio",
        "Disallow: /api/",
        "",
      ].join("\n"),
    );
    expect(response.body).not.toMatch(/sitemap/i);
  });

  it("the sitemap still lists the served addresses, as before", async () => {
    const response = await got(on.baseURL, "/sitemap.xml");
    expect(response.status).toBe(200);
    expectPolicy(response, "sitemap");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain(`/albums/${slug("grace")}</loc>`);
  });

  it("switched off, both answer as an unknown address the proxy decides does", async () => {
    const unknown = comparable(
      await got(offBase, `/albums/${slug("nothing")}`),
    );
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      const response = comparable(await got(offBase, path));
      expect(response, path).toEqual(unknown);
      expect(response.headers["x-robots-tag"]).toBe(ROBOTS_DIRECTIVE);
    }
  });
});

describe("the Studio and the authentication endpoints", () => {
  it("carry the policy without a session and with the author's", async () => {
    const paths = [
      "/studio",
      "/studio/sign-in",
      "/studio/journals",
      "/pt/studio",
      "/pt/studio/sign-in",
      "/pt/studio/journals",
    ];
    for (const path of paths) {
      const visitor = await got(offBase, path);
      expectPolicy(visitor, `visitor ${path}`);
      expect(visitor.headers["cache-control"], path).toBe(
        "private, no-store, max-age=0, must-revalidate",
      );
      const signedIn = await got(offBase, path, {
        headers: { cookie: author.cookie },
      });
      expectPolicy(signedIn, `author ${path}`);
      const prefetch = await got(offBase, path, {
        rsc: true,
        headers: { cookie: author.cookie },
      });
      expectPolicy(prefetch, `author _rsc ${path}`);
    }
    // The author's session still opens the Studio, and a visitor is still
    // sent to sign-in: the policy changed no access.
    for (const language of ["", "/pt"]) {
      const own = await got(offBase, `${language}/studio/journals`, {
        headers: { cookie: author.cookie },
      });
      expect(own.status).toBe(200);
      expect(own.body).not.toContain("NEXT_REDIRECT;replace;");
      const visitor = await got(offBase, `${language}/studio/journals`);
      expect(visitor.body).toContain(
        `NEXT_REDIRECT;replace;${language}/studio/sign-in;307;`,
      );
    }
  });

  it("carry it on the authentication endpoints", async () => {
    for (const [path, cookie] of [
      ["/api/auth/get-session", undefined],
      ["/api/auth/get-session", author.cookie],
      [`/api/auth/${slug("nothing")}`, undefined],
    ] as const) {
      const response = await got(offBase, path, {
        headers: cookie ? { cookie } : {},
      });
      expectPolicy(response, `${path} ${cookie ? "author" : "visitor"}`);
    }
  });

  it("carry it on a Server Action's answer, which still refuses a visitor", async () => {
    const manifest = JSON.parse(
      readFileSync(".next/server/server-reference-manifest.json", "utf8"),
    ) as { node: Record<string, { exportedName: string }> };
    const [id] = Object.entries(manifest.node).find(
      ([, entry]) => entry.exportedName === "createArtistAction",
    )!;
    const name = `[Test] Indexing ${prefix}`;
    for (const path of ["/studio/artists/new", "/pt/studio/artists/new"]) {
      const response = await got(offBase, path, {
        method: "POST",
        headers: {
          origin: offBase,
          accept: "text/x-component",
          "content-type": "text/plain;charset=UTF-8",
          "next-action": id,
        },
        body: JSON.stringify([{ name }]),
      });
      expectPolicy(response, `Server Action ${path}`);
      expect(response.body).toContain('"code":"unauthorized"');
    }
    const written = await client.query(
      "select count(*)::int as n from artists where name = $1",
      [name],
    );
    expect(written.rows[0].n).toBe(0);
  });
});

describe("static files and images", () => {
  it("carry the policy, and keep their own cache headers", async () => {
    const home = await got(on.baseURL, "/");
    const script = /src="(\/_next\/static\/[^"]+\.js)"/.exec(home.body)![1]!;
    const style = /href="(\/_next\/static\/[^"]+\.css)"/.exec(home.body)![1]!;
    for (const path of [script, style]) {
      const response = await got(on.baseURL, path);
      expect(response.status, path).toBe(200);
      expectPolicy(response, path);
      expect(response.headers["cache-control"], path).toBe(
        "public, max-age=31536000, immutable",
      );
    }
    for (const path of [
      "/artwork/refrain-404.webp",
      "/artwork/refrain-home-character.webp",
      "/_next/image?url=%2Fartwork%2Frefrain-404.webp&w=640&q=75",
    ]) {
      const response = await got(on.baseURL, path);
      expect(response.status, path).toBe(200);
      expectPolicy(response, path);
    }
  });
});

describe("the robots meta tag", () => {
  it("is in every document, in both languages, served or not", async () => {
    const documents: [string, string][] = [
      [on.baseURL, "/"],
      [on.baseURL, "/albums"],
      [on.baseURL, `/albums/${slug("grace")}`],
      [on.baseURL, `/artists/${artistAddress}`],
      [on.baseURL, `/memories/${memories.shown.slug}`],
      [on.baseURL, `/albums/${slug("draft")}`],
      [on.baseURL, `/${slug("nowhere")}`],
      [offBase, "/"],
      [offBase, `/albums/${slug("grace")}`],
      [offBase, "/studio/sign-in"],
    ];
    for (const [base, english] of documents) {
      for (const path of [english, portuguese(english)]) {
        const response = await got(base, path);
        expect(response.body, path).toContain(META);
        expect(response.body, path).not.toMatch(
          /<meta name="robots" content="(?!noindex)/,
        );
      }
    }
  });
});

describe("the policy as a whole", () => {
  it("is one value on every response that has the header, and only the framework's repeated-slash and backslash 308 lacks it", () => {
    const values = new Set([...seen.values()].map(({ value }) => value));
    values.delete(undefined);
    expect([...values]).toEqual([ROBOTS_DIRECTIVE]);
    const missing = [...seen.values()]
      .filter(({ value }) => value === undefined)
      .map(({ path }) => path);
    expect(new Set(missing)).toEqual(
      new Set([
        `/albums//${slug("grace")}`,
        `/pt//albums/${slug("grace")}`,
        `//albums/${slug("grace")}`,
        `/albums\\${slug("grace")}`,
        `/pt\\albums\\${slug("grace")}`,
      ]),
    );
  });

  it("sent no private marker in anything any request received", () => {
    const everything = corpus.join("\n");
    for (const marker of [...PRIVATE_MARKER_LIST, ...MEMORY_MARKER_LIST]) {
      expect(everything).not.toContain(marker);
    }
  });
});
