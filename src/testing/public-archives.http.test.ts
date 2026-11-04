// The public archives over real HTTP, against the production build (`next
// start`) and the disposable test database (M3.8a; ADR 0006 § 11 and D4,
// unchanged). Several servers are started from the one build, each with its
// own value of REFRAIN_PUBLIC_READS_ENABLED, so that their answers can be
// compared.
//
// What is proven:
//
// - With the switch off (unset, or any value other than exactly "true"),
//   `/albums`, `/artists`, and `/memories` answer every request form exactly as
//   an unknown address in the same section does: status, headers, and body.
// - With it on, each archive lists exactly the journals, artists, and memories
//   that have a served page, links each at an address that answers `200`, and
//   never names a draft, private, deleted, restored, unpublished, or retired
//   entry, a hidden artist, or a hidden memory, in any response.
// - Every served album journal is reachable from `/albums`, also when several
//   are about one album.
// - Every response is `no-store`, carries no cache-hit marker, and has the
//   section's own image policy; a state change shows on the next request.
// - The navigation is the same four links in every state, and marks the
//   current section on archives and detail pages.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// eslint-disable-next-line no-restricted-imports
import { unpublishLanguageVersion } from "@/modules/publication/commands";
import { createTestAlbumJournal, testAuthor } from "@/testing/fixtures";
import {
  startProductionServer,
  type ProductionServer,
} from "@/testing/production-server";
import {
  PRIVATE_ARTIST_MARKER_LIST,
  removeSeededArtists,
  seedArtistPages,
  type SeededArtists,
} from "@/testing/public-artists";
import {
  comparable,
  corpus,
  filesContaining,
  request,
  visibleText,
  type Snapshot,
} from "@/testing/public-http";
import {
  fixtureDatabase,
  PRIVATE_MARKER_LIST,
  PRIVATE_MARKERS,
  removeSeeded,
  runPrefix,
  seedSimple,
  type SeededJournal,
} from "@/testing/public-journals";
import {
  MEMORY_MARKER_LIST,
  PUBLIC_MEMORY,
  removeSeededMemories,
  seedMemories,
  type SeededMemories,
} from "@/testing/public-memories";
import { masked } from "@/testing/public-request-forms";
import { assertDisposableTestDatabase } from "@/testing/test-database";
import {
  ARTIST_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY,
} from "@/security-headers";

process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const prefix = runPrefix();
const slug = (name: string) => `${prefix}-${name}`;
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
const author = testAuthor();
const ORIGIN = "https://refrain.example";

const ARCHIVES = ["albums", "artists", "memories"] as const;
type Archive = (typeof ARCHIVES)[number];

let client: Client;
const db = () => fixtureDatabase(client);
const seeded: SeededJournal[] = [];
let artists: SeededArtists;
let memories: SeededMemories;
/** A second, older published journal about Grace's album. */
let secondGrace: string;

let on: ProductionServer;
const offs: ProductionServer[] = [];
const servers: ProductionServer[] = [];

async function start(value: string | undefined) {
  const server = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: value, BETTER_AUTH_URL: ORIGIN },
  });
  servers.push(server);
  return server;
}

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-archives",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  artists = await seedArtistPages(client, prefix);
  memories = await seedMemories(client, prefix);
  for (const [state, status, deletedAt] of [
    ["draft", "draft", undefined],
    ["private", "private", undefined],
    ["deleted", "published", new Date()],
  ] as const) {
    seeded.push(
      await seedSimple(client, {
        slug: slug(state),
        title: `[Test] ARCHIVE-HIDDEN-${state}`,
        status,
        marker: PRIVATE_MARKERS[state],
        deletedAt,
      }),
    );
  }
  secondGrace = await db().transaction((tx) =>
    createTestAlbumJournal(tx, {
      albumId: artists.grace.albumId,
      slug: slug("grace-again"),
      versions: [
        {
          locale: "en",
          status: "published",
          text: "[Test] An earlier journal about the same album.",
          publishedAt: new Date("2020-01-02T00:00:00Z"),
        },
      ],
    }),
  );
  on = await start("true");
  for (const value of [undefined, "TRUE", "1", "true "]) {
    offs.push(await start(value));
  }
}, 240_000);

afterAll(async () => {
  for (const server of servers) {
    await server.stop().catch(() => undefined);
  }
  try {
    await client.query("delete from entry_slugs where entry_id = $1", [
      secondGrace,
    ]);
    await client.query("delete from entries where id = $1", [secondGrace]);
    await removeSeededMemories(client, memories, prefix);
    await removeSeededArtists(client, artists, prefix);
    await removeSeeded(client, seeded, prefix);
  } finally {
    await client.end();
  }
}, 60_000);

/** Every request form of an archive, beside the same form of an unknown address. */
function archiveForms(
  archive: Archive,
): [string, string, RequestInit & { rsc?: boolean }, string][] {
  const unknown = `/${archive}/${slug("nothing")}`;
  const rsc = { rsc: "1", "next-router-prefetch": "1" };
  return [
    ["GET", `/${archive}`, {}, unknown],
    ["HEAD", `/${archive}`, { method: "HEAD" }, unknown],
    ["POST", `/${archive}`, { method: "POST" }, unknown],
    ["PUT", `/${archive}`, { method: "PUT" }, unknown],
    ["DELETE", `/${archive}`, { method: "DELETE" }, unknown],
    ["OPTIONS", `/${archive}`, { method: "OPTIONS" }, unknown],
    // The router's requests, as a browser makes them: `request` adds the
    // `_rsc` parameter and follows the router's redirect to its own hash.
    ["RSC", `/${archive}`, { rsc: true }, unknown],
    ["prefetch", `/${archive}`, { rsc: true, headers: rsc }, unknown],
    [
      "segment prefetch (tree)",
      `/${archive}`,
      {
        rsc: true,
        headers: { ...rsc, "next-router-segment-prefetch": "/_tree" },
      },
      unknown,
    ],
    [
      "segment prefetch (full)",
      `/${archive}`,
      {
        rsc: true,
        headers: { ...rsc, "next-router-segment-prefetch": "/_full" },
      },
      unknown,
    ],
    [
      "segment prefetch (page)",
      `/${archive}`,
      {
        rsc: true,
        headers: {
          ...rsc,
          "next-router-segment-prefetch": `/!KGFyY2hpdmVzKQ/${archive}/__PAGE__`,
        },
      },
      unknown,
    ],
    // A one-segment route's segment files are beside it, not under it: these
    // reach the proxy through the archive's own matcher (M3.8a spike).
    [
      "segment file (tree)",
      `/${archive}.segments/_tree.segment.rsc`,
      {},
      unknown,
    ],
    [
      "segment file (full)",
      `/${archive}.segments/_full.segment.rsc`,
      {},
      unknown,
    ],
    [
      "segment file (page)",
      `/${archive}.segments/!KGFyY2hpdmVzKQ/${archive}/__PAGE__.segment.rsc`,
      {},
      unknown,
    ],
    [".rsc", `/${archive}.rsc`, {}, unknown],
    [".json", `/${archive}.json`, {}, unknown],
    [
      "next data",
      `/_next/data/${buildId}/${archive}.json`,
      {},
      // The framework adds its rewrite header to every data request, so the
      // unknown address is compared in the same form.
      `/_next/data/${buildId}${unknown}.json`,
    ],
    [
      "a bot",
      `/${archive}`,
      { headers: { "user-agent": "Googlebot/2.1" } },
      unknown,
    ],
    [
      "Accept: json",
      `/${archive}`,
      { headers: { accept: "application/json" } },
      unknown,
    ],
    [
      "If-None-Match",
      `/${archive}`,
      { headers: { "if-none-match": "*" } },
      unknown,
    ],
    ["Range", `/${archive}`, { headers: { range: "bytes=0-10" } }, unknown],
    [
      "percent-encoded",
      `/${archive.replace(/^./, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
      {},
      unknown,
    ],
  ];
}

describe("with public reads off, every archive is the unknown address in every request form", () => {
  it.each(
    ARCHIVES.flatMap((archive) =>
      archiveForms(archive).map((form) => [archive, ...form] as const),
    ),
  )(
    "%s, %s: identical status, headers, and body",
    async (_a, name, path, init, baseline) => {
      for (const off of offs) {
        const expected = masked(await request(off.baseURL, baseline, init), [
          slug("nothing"),
        ]);
        const got = masked(await request(off.baseURL, path, init), []);
        expect(expected.status, `${name} baseline`).toBe(
          init.method === "HEAD" ? 404 : 404,
        );
        expect(
          { ...got, body: got.body.replaceAll("SLUG", "") },
          `${name} on a server whose switch is off`,
        ).toEqual({ ...expected, body: expected.body.replaceAll("SLUG", "") });
      }
    },
  );
});

// The listings, read once per test from the server with reads on.
const page = (path: string, init?: Parameters<typeof request>[2]) =>
  request(on.baseURL, path, init);

function markup(snapshot: Snapshot): string {
  return snapshot.body.replace(/<script[\s\S]*?<\/script>/g, "");
}

function hrefs(snapshot: Snapshot, under: string): string[] {
  return [
    ...new Set(
      [...markup(snapshot).matchAll(/href="([^"]+)"/g)]
        .map((match) => match[1]!)
        .filter((href) => href.startsWith(`/${under}/`)),
    ),
  ].sort();
}

async function everyLinkAnswers(addresses: string[]) {
  for (const address of addresses) {
    const answer = await page(address);
    expect(answer.status, address).toBe(200);
  }
}

describe("with public reads off, no alternative request form names anything that was seeded", () => {
  // Public or private: while the switch is off nothing of the journal may be
  // sent, in any form. Every seeded slug starts with this run's prefix, and
  // every seeded title, name, and text with "[Test]" or a catalog fact.
  const seededWords = () => [
    prefix,
    "[Test]",
    "Buckley",
    "Grace",
    "Sketches for My Sweetheart",
    PUBLIC_MEMORY.title,
    PUBLIC_MEMORY.firstSong,
    PUBLIC_MEMORY.paragraphs[0],
    "tracks written",
    "Another journal",
    "Nothing published yet",
  ];

  it.each(
    ARCHIVES.flatMap((archive) =>
      archiveForms(archive).map((form) => [archive, ...form] as const),
    ),
  )(
    "%s, %s: no title, slug, name, text, or metadata of any entry, in the body or a header",
    async (_a, name, path, init) => {
      for (const off of offs) {
        const got = await request(off.baseURL, path, init);
        expect(got.status, name).toBe(404);
        const everything = `${JSON.stringify(got.headers)}\n${got.body}`;
        for (const word of seededWords()) {
          expect(everything.includes(word), `${name}: ${word}`).toBe(false);
        }
        // No archive metadata either: the not-found view's title only.
        expect(got.body).not.toMatch(
          /<title>(Albums|Artists|Memories) · refrain/,
        );
        expect(got.body).not.toMatch(/rel="canonical"/);
      }
    },
  );
});

describe("with public reads on, the Albums archive", () => {
  it("lists each album once and links every served journal, Grace's earlier one too", async () => {
    const albums = await page("/albums");
    expect(albums.status).toBe(200);
    const text = visibleText(albums.body);
    expect(text).toContain("Albums");
    expect(text).toContain(
      "Whole records, written about slowly. Some have every track, some only a few.",
    );
    // Grace once, opening its newest journal, with the earlier one under it.
    expect(text.match(/\bGrace\b/g)?.length).toBeGreaterThanOrEqual(1);
    const linked = hrefs(albums, "albums");
    for (const served of [
      artists.grace.slug,
      artists.sketches.slug,
      artists.long.slug,
      artists.broken.slug,
      memories.albumJournal.slug,
      slug("grace-again"),
    ]) {
      expect(linked, served).toContain(`/albums/${served}`);
    }
    expect(text).toMatch(
      /Another journal, published Jan 2, 2020 \(about Grace\)/,
    );
    for (const hidden of [slug("draft"), slug("private"), slug("deleted")]) {
      expect(linked).not.toContain(`/albums/${hidden}`);
    }
    await everyLinkAnswers(linked);
    expect(albums.headers["content-security-policy"]).toBe(
      CONTENT_SECURITY_POLICY,
    );
  });

  it("stops linking a journal on the next request after it is unpublished", async () => {
    const before = hrefs(await page("/albums"), "albums");
    expect(before).toContain(`/albums/${slug("grace-again")}`);
    await unpublishLanguageVersion(db(), author, secondGrace, "en", "private");
    const after = hrefs(await page("/albums"), "albums");
    expect(after).not.toContain(`/albums/${slug("grace-again")}`);
    expect(after).toContain(`/albums/${artists.grace.slug}`);
  });
});

describe("with public reads on, the Artists archive", () => {
  it("lists exactly the artists with a page, links each to it, and shows no photograph", async () => {
    const list = await page("/artists");
    expect(list.status).toBe(200);
    const text = visibleText(list.body).replaceAll("&#x27;", "'");
    expect(text).toContain("The artists behind the albums I've written about.");
    expect(text).toContain("Jeff Buckley");
    const linked = hrefs(list, "artists");
    expect(linked.length).toBeGreaterThanOrEqual(3);
    await everyLinkAnswers(linked);
    // Never a hidden artist (catalog-only, draft-only, private-only,
    // deleted-only, translation-only), and not the archived one.
    for (const marker of PRIVATE_ARTIST_MARKER_LIST) {
      expect(list.body).not.toContain(marker);
    }
    expect(text).not.toContain("Archived Credit Artist");
    // No artist kind and no photograph on the list.
    expect(text).not.toMatch(/Solo artist|Band\b/);
    expect(markup(list)).not.toMatch(/<img\b/);
    expect(list.body).not.toContain("upload.wikimedia.org");
    expect(markup(list)).not.toContain("thumb.wikimedia.org");
    // Every response under /artists/ keeps the artist pages' policy.
    expect(list.headers["content-security-policy"]).toBe(
      ARTIST_CONTENT_SECURITY_POLICY,
    );
  });
});

describe("with public reads on, the Memories archive", () => {
  it("lists the served memories with their when, title, excerpt, and music, and nothing hidden", async () => {
    const list = await page("/memories");
    expect(list.status).toBe(200);
    const text = visibleText(list.body);
    // The owner's lead (M3.8a review), in place of the screen's.
    expect(text).toContain("Memories and the music woven through them.");
    expect(text).not.toContain("Dated the way I remember");
    expect(text).toContain(PUBLIC_MEMORY.title);
    expect(text).toContain(PUBLIC_MEMORY.when);
    expect(text).toContain(PUBLIC_MEMORY.paragraphs[0]);
    // Only the first paragraph: the page never carries the whole writing.
    expect(list.body).not.toContain(PUBLIC_MEMORY.paragraphs[1]);
    expect(text).toContain(PUBLIC_MEMORY.firstSong);
    expect(text).toContain(PUBLIC_MEMORY.quietTitle);
    const linked = hrefs(list, "memories");
    for (const served of [
      memories.shown.slug,
      memories.quiet.slug,
      memories.long.slug,
    ]) {
      expect(linked).toContain(`/memories/${served}`);
    }
    for (const { slug: hidden } of memories.hidden) {
      expect(linked).not.toContain(`/memories/${hidden}`);
    }
    expect(linked).not.toContain(`/memories/${memories.shown.previousSlug}`);
    await everyLinkAnswers(linked);
    expect(list.headers["content-security-policy"]).toBe(
      CONTENT_SECURITY_POLICY,
    );
    // The writing carries its own language.
    expect(markup(list)).toMatch(/<p class="px-excerpt" lang="en">/);
  });
});

describe("artist namesakes and every artist row", () => {
  it("lead each row to a page that answers and bears the row's name, a different page for each namesake", async () => {
    const list = markup(await page("/artists"));
    const rows = [
      ...list.matchAll(
        /<a class="px-row" href="(\/artists\/[^"]+)"><span class="px-row-name">([^<]+)<\/span>/g,
      ),
    ].map((match) => ({ href: match[1]!, name: match[2]! }));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(new Set(rows.map((row) => row.href)).size).toBe(rows.length);
    for (const row of rows) {
      const artist = await page(row.href);
      expect(artist.status, row.href).toBe(200);
      const heading = markup(artist).match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1];
      expect(visibleText(heading ?? "").trim(), row.href).toBe(row.name);
    }
  });
});

describe("every archive response", () => {
  it.each(
    ARCHIVES.flatMap((archive) =>
      archiveForms(archive).map((form) => [archive, ...form] as const),
    ),
  )(
    "%s, %s: never storable, and only generic build files carry the framework's marker",
    async (_a, name, path, init) => {
      const got = await request(on.baseURL, path, init);
      expect(got.status, name).toBeLessThan(500);
      // The router's own requests reach the archive (not the redirect to the
      // `_rsc` hash), so what is asserted below is what a browser receives. A
      // whole-route prefetch of a page rendered per request is the
      // framework's data-free 404: with partial prefetching the router asks
      // for segments instead.
      if (init.rsc) {
        expect(got.status, name).toBe(name === "prefetch" ? 404 : 200);
      }
      expect(got.headers["cache-control"], name).toMatch(/no-store/);
      expect(got.headers["cache-control"], name).not.toMatch(
        /public|s-maxage|max-age=[1-9]/,
      );
      // Whatever comes from the build (the framework's marker) is generic and
      // data-free (ADR 0006, A2): the segment files of the frame and the
      // not-found fallback, which name no archive content. Anything that
      // lists something is rendered for this request and carries no marker.
      if (got.headers["x-nextjs-cache"] !== undefined) {
        expect(got.body, name).not.toMatch(
          /Whole records|The artists behind|Memories and the music|\[Test\]|px-(album|row|memory)/,
        );
      }
      if (/\[Test\]/.test(got.body)) {
        expect(got.headers["x-nextjs-cache"], name).toBeUndefined();
      }
    },
  );

  it("a trailing slash is the no-store 308 to the archive, the same with the switch on or off", async () => {
    for (const archive of ARCHIVES) {
      const reference = comparable(await request(on.baseURL, `/${archive}/`));
      expect(reference.status).toBe(308);
      expect(reference.headers.location).toBe(`/${archive}`);
      expect(reference.headers["cache-control"]).toBe("no-store");
      for (const off of offs) {
        expect(comparable(await request(off.baseURL, `/${archive}/`))).toEqual(
          reference,
        );
      }
    }
  });

  it("a build file's name, and a case variant, answer the framework's generic 404, data-free, with the switch on or off", async () => {
    for (const archive of ARCHIVES) {
      for (const variant of [
        `${archive}.html`,
        `${archive}.meta`,
        archive.toUpperCase(),
        archive[0]!.toUpperCase() + archive.slice(1),
      ]) {
        const reference = comparable(await request(on.baseURL, `/${variant}`));
        expect(reference.status).toBe(404);
        for (const off of offs) {
          expect(comparable(await request(off.baseURL, `/${variant}`))).toEqual(
            reference,
          );
        }
      }
    }
  });

  it("has the site's own metadata and canonical address, naming no entry", async () => {
    for (const [archive, name] of [
      ["albums", "Albums"],
      ["artists", "Artists"],
      ["memories", "Memories"],
    ] as const) {
      const html = markup(await page(`/${archive}`));
      expect(html).toContain(`<title>${name} · refrain</title>`);
      expect(html).toContain(
        `<link rel="canonical" href="${ORIGIN}/${archive}"/>`,
      );
      expect(html).toContain(
        `<meta property="og:url" content="${ORIGIN}/${archive}"/>`,
      );
      expect(html).not.toMatch(/<meta name="robots"/);
    }
  });
});

describe("the shared navigation", () => {
  const navOf = (snapshot: Snapshot) => {
    const nav = markup(snapshot).match(
      /<nav aria-label="Main">[\s\S]*?<\/nav>/,
    );
    expect(nav).not.toBeNull();
    return [...nav![0].matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((m) => ({
      label: m[2],
      href: m[1]!.match(/href="([^"]*)"/)?.[1],
      current: m[1]!.match(/aria-current="([^"]*)"/)?.[1] ?? null,
    }));
  };
  const links = (current: string | null, value: string | null) =>
    [
      ["Home", "/"],
      ["Albums", "/albums"],
      ["Artists", "/artists"],
      ["Memories", "/memories"],
    ].map(([label, href]) => ({
      label,
      href,
      current: label === current ? value : null,
    }));

  it("is the same four links on every page, with the current section marked", async () => {
    // An artist's address as the archive links it (a namesake committed by
    // another suite would change the bare name's address).
    const artist = hrefs(await page("/artists"), "artists")[0]!;
    const cases: [string, string | null, string | null][] = [
      ["/", "Home", "page"],
      ["/albums", "Albums", "page"],
      ["/artists", "Artists", "page"],
      ["/memories", "Memories", "page"],
      [`/albums/${artists.grace.slug}`, "Albums", "true"],
      [artist, "Artists", "true"],
      [`/memories/${memories.shown.slug}`, "Memories", "true"],
      [`/albums/${slug("nothing")}`, null, null],
    ];
    for (const [path, current, value] of cases) {
      expect(navOf(await page(path)), path).toEqual(links(current, value));
    }
  });

  it("is the same with the switch off, on the Home and on the unknown address", async () => {
    for (const off of offs) {
      expect(navOf(await request(off.baseURL, "/"))).toEqual(
        links("Home", "page"),
      );
      expect(navOf(await request(off.baseURL, "/albums"))).toEqual(
        links(null, null),
      );
    }
  });
});

describe("the sitemap", () => {
  it("lists the archives with every served address while reads are on, and is unknown while they are off", async () => {
    const sitemap = await page("/sitemap.xml");
    expect(sitemap.status).toBe(200);
    for (const archive of ARCHIVES) {
      expect(sitemap.body).toContain(`<loc>${ORIGIN}/${archive}</loc>`);
    }
    const albums = hrefs(await page("/albums"), "albums");
    const listedAlbums = [
      ...sitemap.body.matchAll(/<loc>[^<]*?(\/albums\/[^<]+)<\/loc>/g),
    ].map((m) => m[1]);
    // Every album journal the archive links is in the sitemap, and the other
    // way round, for the rows this test made.
    for (const address of listedAlbums.filter((a) => a!.includes(prefix))) {
      expect(albums).toContain(address);
    }
    for (const address of albums.filter((a) => a.includes(prefix))) {
      expect(listedAlbums).toContain(address);
    }
    for (const off of offs) {
      expect((await request(off.baseURL, "/sitemap.xml")).status).toBe(404);
    }
  });
});

describe("nothing of the journal was written to the build", () => {
  it("after every request of this file, no file under .next names a seeded entry", () => {
    expect(
      filesContaining(".next", [
        prefix,
        PUBLIC_MEMORY.title,
        PUBLIC_MEMORY.paragraphs[0],
        "ARCHIVE-HIDDEN",
        ...PRIVATE_MARKER_LIST,
        ...PRIVATE_ARTIST_MARKER_LIST,
        ...MEMORY_MARKER_LIST,
      ]),
    ).toEqual([]);
  });
});

describe("nothing private was ever sent", () => {
  it("no response of this file named a hidden journal, artist, or memory", () => {
    const everything = corpus.join("\n");
    for (const marker of [
      ...PRIVATE_MARKER_LIST,
      ...PRIVATE_ARTIST_MARKER_LIST,
      ...MEMORY_MARKER_LIST,
      "ARCHIVE-HIDDEN",
    ]) {
      expect(everything.includes(marker), marker).toBe(false);
    }
  });
});
