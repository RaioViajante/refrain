// The public memory page over real HTTP, against the production build and the
// disposable test database (M3.7). Several servers are started from the one
// build, each with its own value of REFRAIN_PUBLIC_READS_ENABLED, because the
// switch is read at request time.
//
// Every request is anonymous. A memory address that is not served (a draft, a
// private, a deleted, an unpublished, a restored, or a retired memory; a
// malformed or unknown address; another kind's address; and every address
// while the switch is off) must answer exactly as an unknown memory address
// does, in status, headers, and body, in every request form; a previous
// address of a public memory redirects, with `no-store`; and no hidden
// memory's title, writing, "when", songs, or existence may appear in any
// response, header, payload, or server log.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// eslint-disable-next-line no-restricted-imports
import {
  restoreDeletedEntry,
  unpublishLanguageVersion,
} from "@/modules/publication/commands";
import { CONTENT_SECURITY_POLICY } from "@/security-headers";
import { testAuthor } from "@/testing/fixtures";
import {
  startProductionServer,
  type ProductionServer,
} from "@/testing/production-server";
import {
  comparable,
  corpus,
  request,
  visibleText,
} from "@/testing/public-http";
import { fixtureDatabase, runPrefix } from "@/testing/public-journals";
import {
  MEMORY_MARKER_LIST,
  PUBLIC_MEMORY,
  removeSeededMemories,
  seedMemories,
  type SeededMemories,
} from "@/testing/public-memories";
import { publishForTest } from "@/testing/publishing";
import { assertDisposableTestDatabase } from "@/testing/test-database";

process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const prefix = runPrefix();
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();

let client: Client;
let seeded: SeededMemories | undefined;
const servers: ProductionServer[] = [];

let on: ProductionServer;
const off: Record<string, ProductionServer> = {};
const OFF_VALUES = ["unset", "TRUE", "true "];

const UNKNOWN = `${prefix}-no-such-memory`;

async function start(value: string | undefined) {
  const server = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: value },
  });
  servers.push(server);
  return server;
}

/** A response, with the address that was asked for masked out. */
function masked(snapshot: Awaited<ReturnType<typeof request>>, slug: string) {
  const view = comparable(snapshot);
  const mask = (text: string) =>
    text
      .split(slug)
      .join("SLUG")
      .replace(/(")[A-Za-z0-9_-]{21,23}(?![A-Za-z0-9_-])/g, "$1ID");
  return {
    status: view.status,
    headers: Object.fromEntries(
      Object.entries(view.headers).map(([name, value]) => [name, mask(value)]),
    ),
    body: mask(view.body),
  };
}

/** Every transport form of one memory address. */
function forms(s: string): [string, string, Record<string, string>][] {
  return [
    ["document", `/memories/${s}`, {}],
    ["HEAD", `/memories/${s}`, { method: "HEAD" }],
    ["RSC", `/memories/${s}?_rsc=probe`, { rsc: "1" }],
    [
      "router prefetch",
      `/memories/${s}?_rsc=probe`,
      { rsc: "1", "next-router-prefetch": "1" },
    ],
    [
      "segment prefetch (tree)",
      `/memories/${s}?_rsc=probe`,
      {
        rsc: "1",
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/_tree",
      },
    ],
    [
      "segment prefetch (page)",
      `/memories/${s}?_rsc=probe`,
      {
        rsc: "1",
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/(memories)/memories/[slug]/__PAGE__",
      },
    ],
    ["segment file", `/memories/${s}.segments/_tree.segment.rsc`, {}],
    [".rsc", `/memories/${s}.rsc`, {}],
    ["next data", `/_next/data/${buildId}/memories/${s}.json`, {}],
    [
      "Accept: application/json",
      `/memories/${s}`,
      { accept: "application/json" },
    ],
    ["If-None-Match: *", `/memories/${s}`, { "if-none-match": "*" }],
    ["Range", `/memories/${s}`, { range: "bytes=0-10" }],
    ["crawler", `/memories/${s}`, { "user-agent": "Googlebot/2.1" }],
  ];
}

async function ask(
  server: ProductionServer,
  path: string,
  headers: Record<string, string>,
) {
  const { method, ...rest } = headers;
  return request(server.baseURL, path, {
    method: method ?? "GET",
    headers: rest,
    rsc: false,
  });
}

/** Every file the build wrote for the memory route and the not-found view. */
function buildFiles(): Map<string, string> {
  const root = ".next/server/app";
  const found = new Map<string, string>();
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        found.set(path, readFileSync(path, "utf8"));
      }
    }
  };
  walk(join(root, "memories"));
  walk(join(root, "(en)", "(memories)"));
  walk(join(root, "_not-found.segments"));
  for (const name of ["_not-found.html", "_not-found.rsc"]) {
    found.set(join(root, name), readFileSync(join(root, name), "utf8"));
  }
  return found;
}
const BUILD_FILES = buildFiles();

/**
 * ADR 0006 A2: the framework's cache marker only on a response that is empty
 * or byte-identical to a file of the build, and `no-store`.
 */
function checkMarker(
  response: { headers: Record<string, string>; body: string },
  name: string,
) {
  if (response.headers["x-nextjs-cache"] === undefined) {
    return;
  }
  expect(response.headers["cache-control"], name).toContain("no-store");
  if (response.body !== "") {
    expect(
      [...BUILD_FILES.values()].includes(response.body),
      `${name}: a marked response that is not a build file`,
    ).toBe(true);
  }
}

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-public-memory-tests",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  seeded = await seedMemories(client, prefix);

  on = await start("true");
  for (const value of OFF_VALUES) {
    off[value] = await start(value === "unset" ? undefined : value);
  }
}, 180_000);

afterAll(async () => {
  for (const server of servers) {
    await server.stop();
  }
  if (client) {
    await removeSeededMemories(client, seeded, prefix);
    await client.end();
  }
});

describe("a public memory's page, with public reads on", () => {
  it("is served complete in the HTML, in the V4.4 order: the label, the title, the writing, then the margin", async () => {
    const page = await request(on.baseURL, `/memories/${seeded!.shown.slug}`);
    expect(page.status).toBe(200);
    // Rendered in one pass: nothing waits in hidden markup for a script.
    expect(page.body).not.toMatch(/<div hidden id="S:/);
    expect(page.body).not.toContain("Loading…");
    expect(page.body).toMatch(
      new RegExp(
        `<h1[^>]*>${PUBLIC_MEMORY.title.replace(/[[\]]/g, "\\$&")}</h1>`,
      ),
    );
    const text = visibleText(page.body);
    const order = [
      "Memory",
      PUBLIC_MEMORY.title,
      PUBLIC_MEMORY.paragraphs[0],
      PUBLIC_MEMORY.paragraphs[1],
      PUBLIC_MEMORY.when,
      "Published October 28, 2026",
      "Written in English",
      "The music",
      PUBLIC_MEMORY.firstSong,
      PUBLIC_MEMORY.secondSong,
    ];
    let at = 0;
    for (const words of order) {
      const found = text.indexOf(words, at);
      expect(found, words).toBeGreaterThan(-1);
      at = found;
    }
    // The music's words: each song's artists and album.
    expect(text).toContain(PUBLIC_MEMORY.albumArtist);
    expect(text).toContain(PUBLIC_MEMORY.albumTitle);
    expect(text).toContain(PUBLIC_MEMORY.secondArtist);
    // The header marks Memories as the current section: since M3.8a its link
    // leads to the Memories archive, as a page inside that section.
    expect(page.body).toMatch(
      /<a class="public-link" (?:aria-current="true" href="\/memories"|href="\/memories" aria-current="true")>Memories<\/a>/,
    );
    // No rating, favourite, artwork, or administrative control.
    expect(text).not.toMatch(
      /My rating|Favourite|Publish…|Unpublish|Writing studio|\bEdit\b/,
    );
    expect(page.body).not.toContain("<img");
    // The untranslated version is never shown or mentioned (INV-3).
    expect(text).not.toMatch(/Português|Brazilian/);
  });

  it("links the album journal and the artist only where their pages are public, and nothing else", async () => {
    const page = await request(on.baseURL, `/memories/${seeded!.shown.slug}`);
    const links = [...page.body.matchAll(/href="(\/[^"]*)"/g)]
      .map((match) => match[1]!)
      .filter((href) => !href.startsWith("/_next/"));
    expect(new Set(links)).toEqual(
      new Set([
        // The navigation's four sections (M3.8a).
        "/",
        "/albums",
        "/artists",
        "/memories",
        `/albums/${seeded!.albumJournal.slug}`,
        "/artists/test-memory-artist",
      ]),
    );
    // The linked pages answer.
    expect(
      (await request(on.baseURL, `/albums/${seeded!.albumJournal.slug}`))
        .status,
    ).toBe(200);
    expect(
      (await request(on.baseURL, "/artists/test-memory-artist")).status,
    ).toBe(200);
    // The second song's artist has no page: a memory opens none.
    const second = await request(
      on.baseURL,
      "/artists/test-second-memory-artist",
    );
    expect(second.status).toBe(404);
    // No internal identifier reaches the page.
    for (const id of [
      seeded!.shown.entryId,
      ...seeded!.tracks,
      ...seeded!.artists,
    ]) {
      expect(page.body).not.toContain(id);
    }
  });

  it("closes a memory with its archive, whatever its songs link to", async () => {
    for (const slug of [seeded!.shown.slug, seeded!.quiet.slug]) {
      const page = await request(on.baseURL, `/memories/${slug}`);
      expect(page.body).toContain('href="/memories"');
      expect(visibleText(page.body)).toContain("All memories");
      expect(visibleText(page.body)).not.toContain("More about");
    }
  });

  it("shows a memory without songs with no music section, and a long title whole", async () => {
    const quiet = await request(on.baseURL, `/memories/${seeded!.quiet.slug}`);
    expect(quiet.status).toBe(200);
    expect(visibleText(quiet.body)).toContain(PUBLIC_MEMORY.quietTitle);
    expect(visibleText(quiet.body)).not.toContain("The music");
    const long = await request(on.baseURL, `/memories/${seeded!.long.slug}`);
    expect(long.status).toBe(200);
    expect(long.body).toContain(`${PUBLIC_MEMORY.longTitle}</h1>`);
  });

  it("is no-store, with the public headers and no cache indicator", async () => {
    for (const slug of [seeded!.shown.slug, UNKNOWN]) {
      const page = await request(on.baseURL, `/memories/${slug}`);
      expect(page.headers["cache-control"], slug).toContain("no-store");
      expect(page.headers["content-security-policy"], slug).toBe(
        CONTENT_SECURITY_POLICY,
      );
      expect(page.headers["x-content-type-options"]).toBe("nosniff");
      expect(page.headers["x-frame-options"]).toBe("DENY");
      expect(page.headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
      for (const indicator of [
        "age",
        "x-cache",
        "x-vercel-cache",
        "cf-cache-status",
      ]) {
        expect(page.headers[indicator], indicator).toBeUndefined();
      }
      if (slug !== UNKNOWN) {
        expect(page.headers["x-nextjs-cache"]).toBeUndefined();
      }
    }
  });

  it("names itself canonically, from the site's own origin, with no image in its preview", async () => {
    const page = await request(on.baseURL, `/memories/${seeded!.shown.slug}`, {
      headers: { host: "evil.example", "x-forwarded-host": "evil.example" },
    });
    expect(page.body).toContain(
      `<link rel="canonical" href="${on.baseURL}/memories/${seeded!.shown.slug}"/>`,
    );
    expect(page.body).toContain(
      `<title>${PUBLIC_MEMORY.title} · refrain</title>`,
    );
    expect(page.body).toContain(
      '<meta name="description" content="A memory in a personal music journal."/>',
    );
    expect(page.body).toContain('<meta property="og:type" content="article"/>');
    expect(page.body).not.toMatch(/og:image|twitter:image/);
    expect(page.body).not.toContain("evil.example");
    // The writing is never copied into the metadata.
    const head = page.body.slice(0, page.body.indexOf("</head>"));
    expect(head).not.toContain(PUBLIC_MEMORY.paragraphs[0]);
    expect(head).not.toContain(PUBLIC_MEMORY.when);
  });

  it("redirects a previous address to the current one with a no-store 308, naming no host", async () => {
    const moved = await request(
      on.baseURL,
      `/memories/${seeded!.shown.previousSlug}`,
      { headers: { host: "evil.example", "x-forwarded-host": "evil.example" } },
    );
    expect(moved.status).toBe(308);
    expect(moved.headers.location).toBe(`/memories/${seeded!.shown.slug}`);
    expect(moved.headers["cache-control"]).toBe("no-store");
    expect(moved.body).not.toContain(PUBLIC_MEMORY.title);
    const head = await request(
      on.baseURL,
      `/memories/${seeded!.shown.previousSlug}`,
      { method: "HEAD" },
    );
    expect(head.status).toBe(308);
    expect(head.headers.location).toBe(`/memories/${seeded!.shown.slug}`);
    // The router's forms get the same redirect, no-store, naming no host.
    for (const headers of [
      { rsc: "1" },
      { rsc: "1", "next-router-prefetch": "1" },
    ] as Record<string, string>[]) {
      const routed = await request(
        on.baseURL,
        `/memories/${seeded!.shown.previousSlug}?_rsc=probe`,
        {
          headers: {
            ...headers,
            host: "evil.example",
            "x-forwarded-host": "evil.example",
          },
        },
      );
      expect(routed.status).toBe(308);
      expect(routed.headers["cache-control"]).toBe("no-store");
      expect(routed.headers.location).toMatch(
        new RegExp(`^/memories/${seeded!.shown.slug}(\\?|$)`),
      );
      expect(JSON.stringify(routed)).not.toContain("evil.example");
    }
  });

  it("answers every transport form without caching it", async () => {
    for (const [name, path, headers] of forms(seeded!.shown.slug)) {
      const response = await ask(on, path, headers);
      checkMarker(response, name);
      expect(response.status, name).toBeLessThan(500);
      expect(response.headers["cache-control"], name).toContain("no-store");
    }
  });

  it("answers 405 with Allow for every other method, the same for every address", async () => {
    const answers = [];
    for (const slug of [seeded!.shown.slug, UNKNOWN]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        const response = await request(on.baseURL, `/memories/${slug}`, {
          method,
        });
        answers.push(comparable(response));
        expect(response.status, method).toBe(405);
        expect(response.headers.allow).toBe("GET, HEAD");
        expect(response.headers["cache-control"]).toBe("no-store");
      }
    }
    expect(answers.slice(0, 5)).toEqual(answers.slice(5));
  });
});

describe("a memory address that is not served", () => {
  it("answers exactly as an unknown address does, for every state that must stay hidden", async () => {
    const unknown = masked(
      await request(on.baseURL, `/memories/${UNKNOWN}`),
      UNKNOWN,
    );
    expect(unknown.status).toBe(404);
    expect(unknown.headers["cache-control"]).toContain("no-store");
    for (const { state, slug } of seeded!.hidden) {
      const hidden = await request(on.baseURL, `/memories/${slug}`);
      expect(masked(hidden, slug), state).toEqual(unknown);
    }
    // A previous address that was never public does not redirect, even to a
    // memory that is public now (INV-5).
    expect(
      masked(
        await request(on.baseURL, `/memories/${seeded!.shown.neverPublicSlug}`),
        seeded!.shown.neverPublicSlug,
      ),
    ).toEqual(unknown);
    // A previous address of a memory that is not public does not redirect.
    expect(
      masked(
        await request(on.baseURL, `/memories/${seeded!.hiddenPreviousSlug}`),
        seeded!.hiddenPreviousSlug,
      ),
    ).toEqual(unknown);
    // Malformed addresses, before the database is asked.
    for (const slug of ["Memory", "qz--qz", "-qzq", "q".repeat(81), "%20"]) {
      const response = await request(on.baseURL, `/memories/${slug}`);
      expect(response.status, slug).toBe(404);
      expect(masked(response, slug).body, slug).toBe(unknown.body);
    }
  });

  it("answers as an unknown one in every transport form, for every hidden state", async () => {
    for (const { state, slug } of seeded!.hidden) {
      for (const [index, [name, path, headers]] of forms(slug).entries()) {
        const [, unknownPath, unknownHeaders] = forms(UNKNOWN)[index]!;
        const raw = await ask(on, path, headers);
        checkMarker(raw, `${state} ${name}`);
        const a = masked(raw, slug);
        const b = masked(await ask(on, unknownPath, unknownHeaders), UNKNOWN);
        expect(a, `${state} ${name}`).toEqual(b);
      }
    }
  });

  it("keeps the kinds apart: a memory's address is no album journal, and the reverse", async () => {
    const unknownAlbum = masked(
      await request(on.baseURL, `/albums/${UNKNOWN}`),
      UNKNOWN,
    );
    expect(
      masked(
        await request(on.baseURL, `/albums/${seeded!.shown.slug}`),
        seeded!.shown.slug,
      ),
    ).toEqual(unknownAlbum);
    const unknownMemory = masked(
      await request(on.baseURL, `/memories/${UNKNOWN}`),
      UNKNOWN,
    );
    expect(
      masked(
        await request(on.baseURL, `/memories/${seeded!.albumJournal.slug}`),
        seeded!.albumJournal.slug,
      ),
    ).toEqual(unknownMemory);
  });

  it("is listed by the Memories archive (M3.8a), which names no hidden memory", async () => {
    const list = await request(on.baseURL, "/memories");
    expect(list.status).toBe(200);
    expect(visibleText(list.body)).toContain(PUBLIC_MEMORY.title);
    expect(list.body).toContain(`href="/memories/${seeded!.shown.slug}"`);
    for (const hidden of seeded!.hidden) {
      expect(list.body).not.toContain(`/memories/${hidden.slug}"`);
    }
  });

  it("gives percent-encoded memory addresses the public decision, with the switch off and on, by every method, for every hidden state", async () => {
    const encoded = (s: string) => [
      `/%6Demories/${s}`,
      `/memories%2F${s}`,
      `/memories/%${s.charCodeAt(0).toString(16)}${s.slice(1)}`,
    ];
    for (const method of ["GET", "HEAD", "POST"]) {
      for (const [value, server] of [
        ["on", on],
        ...OFF_VALUES.map((v) => [v, off[v]!] as const),
      ] as const) {
        const unknownForms = encoded(UNKNOWN);
        // With the switch off a served memory is unknown too.
        const slugs = [
          ...seeded!.hidden.map((hidden) => hidden.slug),
          ...(value === "on" ? [] : [seeded!.shown.slug]),
        ];
        for (const slug of slugs) {
          for (const [index, path] of encoded(slug).entries()) {
            expect(
              masked(await request(server.baseURL, path, { method }), slug),
              `${value} ${method} ${path}`,
            ).toEqual(
              masked(
                await request(server.baseURL, unknownForms[index]!, { method }),
                UNKNOWN,
              ),
            );
          }
        }
      }
    }
  });

  it("answers case, slash, dot, and trailing-slash variants of a hidden address as those of an unknown one", async () => {
    const variants = (s: string) => [
      `/MEMORIES/${s}`,
      `/Memories/${s}`,
      `/memories/./${s}`,
      `/memories/${s}/`,
      `/memories/${s};x`,
      `/memories/${s}%2E`,
      `/memories/${s.toUpperCase()}`,
    ];
    for (const { state, slug } of seeded!.hidden) {
      const absent = variants(UNKNOWN);
      for (const [index, path] of variants(slug).entries()) {
        const a = masked(await request(on.baseURL, path), slug);
        const b = masked(await request(on.baseURL, absent[index]!), UNKNOWN);
        // An upper-case slug is masked by its own spelling.
        const upper = (x: typeof a, s: string) =>
          JSON.parse(JSON.stringify(x).split(s.toUpperCase()).join("SLUG"));
        expect(upper(a, slug), `${state} ${path}`).toEqual(upper(b, UNKNOWN));
        expect(a.headers["cache-control"] ?? "", path).toContain("no-store");
      }
    }
  });

  it("answers percent-encoded and slashed forms as an unknown one", async () => {
    const hidden = seeded!.hidden[0]!.slug;
    const encodedForms = (s: string) => [
      `/%6Demories/${s}`,
      `/memories%2F${s}`,
      `/memories/${s}/.segments/_tree.segment.rsc`,
      `/_next/data/${buildId}/memories/${s}.json/`,
    ];
    const hiddenForms = encodedForms(hidden);
    const unknownForms = encodedForms(UNKNOWN);
    for (const [index, path] of hiddenForms.entries()) {
      const a = masked(await request(on.baseURL, path), hidden);
      const b = masked(
        await request(on.baseURL, unknownForms[index]!),
        UNKNOWN,
      );
      expect(a, path).toEqual(b);
    }
  });
});

describe("with public reads off", () => {
  it.each(OFF_VALUES)(
    "answers every memory address as an unknown one, in every form (%j)",
    async (value) => {
      const server = off[value]!;
      for (const slug of [seeded!.shown.slug, seeded!.shown.previousSlug]) {
        for (const [index, [name, path, headers]] of forms(slug).entries()) {
          const [, unknownPath, unknownHeaders] = forms(UNKNOWN)[index]!;
          const a = masked(await ask(server, path, headers), slug);
          const b = masked(
            await ask(server, unknownPath, unknownHeaders),
            UNKNOWN,
          );
          expect(a, `${slug} ${name}`).toEqual(b);
        }
      }
      // Every method, too: the switch comes before the method.
      const post = await request(
        server.baseURL,
        `/memories/${seeded!.shown.slug}`,
        { method: "POST" },
      );
      const unknownPost = await request(
        server.baseURL,
        `/memories/${UNKNOWN}`,
        { method: "POST" },
      );
      expect(masked(post, seeded!.shown.slug)).toEqual(
        masked(unknownPost, UNKNOWN),
      );
      expect(post.status).toBe(404);
      expect((await request(server.baseURL, "/sitemap.xml")).status).toBe(404);
    },
  );
});

describe("the sitemap", () => {
  it("lists the served memory addresses, and no hidden or previous one", async () => {
    const sitemap = await request(on.baseURL, "/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers["cache-control"]).toBe("no-store");
    const listed = [
      ...sitemap.body.matchAll(/<loc>[^<]*\/memories\/([^<]+)<\/loc>/g),
    ].map((match) => match[1]!);
    for (const slug of [
      seeded!.shown.slug,
      seeded!.quiet.slug,
      seeded!.long.slug,
    ]) {
      expect(listed).toContain(slug);
    }
    for (const slug of listed) {
      expect(
        (await request(on.baseURL, `/memories/${slug}`)).status,
        slug,
      ).toBe(200);
    }
    for (const { slug } of seeded!.hidden) {
      expect(sitemap.body).not.toContain(slug);
    }
    expect(sitemap.body).not.toContain(seeded!.shown.previousSlug);
    expect(sitemap.body).not.toContain(seeded!.hiddenPreviousSlug);
  });
});

// These change the seeded state, so they come last, in order.
describe("a change shows on the next request", () => {
  it("unpublishing, deleting, and restoring hide the page at once; publishing again shows it", async () => {
    const db = fixtureDatabase(client);
    const author = testAuthor();
    const { entryId, slug, previousSlug } = seeded!.shown;
    const page = () => request(on.baseURL, `/memories/${slug}`);
    const unknown = masked(
      await request(on.baseURL, `/memories/${UNKNOWN}`),
      UNKNOWN,
    );
    const sitemap = async () =>
      (await request(on.baseURL, "/sitemap.xml")).body;

    await unpublishLanguageVersion(db, author, entryId, "en", "private");
    expect(masked(await page(), slug)).toEqual(unknown);
    // Its previous address stops redirecting, too.
    expect(
      masked(
        await request(on.baseURL, `/memories/${previousSlug}`),
        previousSlug,
      ),
    ).toEqual(unknown);
    expect(await sitemap()).not.toContain(slug);

    await publishForTest(db, entryId, "en");
    expect((await page()).status).toBe(200);
    expect(await sitemap()).toContain(slug);

    await client.query("update entries set deleted_at = now() where id = $1", [
      entryId,
    ]);
    expect(masked(await page(), slug)).toEqual(unknown);
    await db.transaction((tx) => restoreDeletedEntry(tx, entryId));
    // Restoring publishes nothing.
    expect(masked(await page(), slug)).toEqual(unknown);

    await publishForTest(db, entryId, "en");
    expect((await page()).status).toBe(200);
  });

  it("drops a link on the next request once the album journal it pointed to is unpublished", async () => {
    const db = fixtureDatabase(client);
    await unpublishLanguageVersion(
      db,
      testAuthor(),
      seeded!.albumJournal.entryId,
      "en",
      "private",
    );
    const page = await request(on.baseURL, `/memories/${seeded!.shown.slug}`);
    expect(page.status).toBe(200);
    expect(page.body).not.toContain(`/albums/${seeded!.albumJournal.slug}`);
    // The album journal was the artist's only page: it closes too.
    expect(page.body).not.toContain("/artists/");
    expect(visibleText(page.body)).toContain(PUBLIC_MEMORY.albumTitle);
    expect(visibleText(page.body)).toContain(PUBLIC_MEMORY.albumArtist);
  });
});

describe("the build and what the requests left on disk (ADR 0006 A2)", () => {
  it("prerenders the memory route as one parameterised, empty fallback", () => {
    const manifest = JSON.parse(
      readFileSync(".next/prerender-manifest.json", "utf8"),
    ) as {
      dynamicRoutes: Record<
        string,
        { fallbackRouteParams?: { paramName: string }[] }
      >;
    };
    const route = manifest.dynamicRoutes["/memories/[slug]"];
    expect(route).toBeDefined();
    expect(route!.fallbackRouteParams?.map((p) => p.paramName)).toEqual([
      "slug",
    ]);
    expect(readFileSync(".next/server/app/memories/[slug].html", "utf8")).toBe(
      "",
    );
    const meta = JSON.parse(
      readFileSync(".next/server/app/memories/[slug].meta", "utf8"),
    ) as { routeCache?: { isFallback?: boolean } };
    expect(meta.routeCache?.isFallback).toBe(true);
  });

  it("prerenders no memory address, and nothing about any memory", () => {
    const manifest = JSON.parse(
      readFileSync(".next/prerender-manifest.json", "utf8"),
    ) as { routes: Record<string, unknown> };
    expect(
      Object.keys(manifest.routes).filter((route) =>
        route.startsWith("/memories/"),
      ),
    ).toEqual([]);
    for (const [file, body] of BUILD_FILES) {
      if (!file.includes("memories")) {
        continue;
      }
      for (const needle of [
        "[Test]",
        "The music",
        "Written in",
        ...MEMORY_MARKER_LIST,
      ]) {
        expect(body, `${file} contains ${needle}`).not.toContain(needle);
      }
    }
  });

  it("added no file named for a memory address after every request", () => {
    const names: string[] = [];
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        names.push(name);
        const path = join(directory, name);
        if (statSync(path).isDirectory()) {
          walk(path);
        }
      }
    };
    walk(".next/server/app");
    for (const slug of [
      seeded!.shown.slug,
      seeded!.quiet.slug,
      ...seeded!.hidden.map((hidden) => hidden.slug),
      UNKNOWN,
    ]) {
      expect(
        names.some((name) => name.includes(slug)),
        slug,
      ).toBe(false);
    }
  });
});

describe("everything a reader was sent", () => {
  it("never names a hidden memory, its writing, its when, or its songs, and nor does any log", () => {
    const sent = corpus.join("\n");
    for (const marker of MEMORY_MARKER_LIST) {
      expect(sent, marker).not.toContain(marker);
    }
    for (const server of servers) {
      const log = readFileSync(server.serverLog, "utf8");
      for (const marker of MEMORY_MARKER_LIST) {
        expect(log, marker).not.toContain(marker);
      }
    }
    // Not vacuous: the public memory was sent.
    expect(sent).toContain(PUBLIC_MEMORY.title);
  });
});
