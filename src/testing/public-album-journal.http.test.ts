// The public album-journal page over real HTTP, against the production build
// (`next start`) and the disposable test database (M3.1, ADR 0006 § 11 and
// § 13 tests 17 and 22, gates G1 and G2). Several servers are started from the
// one build, each with its own value of REFRAIN_PUBLIC_READS_ENABLED, because
// the switch is read at request time and a test must prove that.
//
// Every request is anonymous. The anonymous matrix compares the response of
// every address that is not served with the response of an unknown address:
// the status, the headers, and the body must be identical, and no private
// marker may appear anywhere, in any body, header, RSC payload, or log.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// eslint-disable-next-line no-restricted-imports
import {
  changeEntrySlug,
  unpublishLanguageVersion,
} from "@/modules/publication/commands";
// eslint-disable-next-line no-restricted-imports
import { permanentlyDeleteEntry } from "@/modules/journals/commands";
import {
  startProductionServer,
  type ProductionServer,
} from "@/testing/production-server";
import { testAuthor } from "@/testing/fixtures";
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
import {
  comparable,
  corpus,
  request,
  visibleText,
} from "@/testing/public-http";
import { assertDisposableTestDatabase } from "@/testing/test-database";

// The test process issues confirmation tokens through the real commands to put
// fixtures in a published state; those need the application's configuration.
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const prefix = runPrefix();
const slug = (name: string) => `${prefix}-${name}`;

let client: Client;
const seeded: SeededJournal[] = [];
const servers: ProductionServer[] = [];

async function start(value: string | undefined) {
  const server = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: value },
  });
  servers.push(server);
  return server;
}

let on: ProductionServer;
let off: ProductionServer;
// The gates that are not exactly "true".
const invalidValues = ["TRUE", "1", "yes", "True", "", "true ", "false"];
const invalid: Record<string, ProductionServer> = {};

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-public-tests",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  const db = fixtureDatabase(client);

  seeded.push(await seedGrace(client, { slug: slug("grace") }));
  seeded.push(
    await seedSimple(client, {
      slug: slug("draft"),
      title: "[Test] Draft album",
      status: "draft",
      marker: PRIVATE_MARKERS.draft,
    }),
  );
  seeded.push(
    await seedSimple(client, {
      slug: slug("private"),
      title: "[Test] Private album",
      status: "private",
      marker: PRIVATE_MARKERS.private,
    }),
  );
  seeded.push(
    await seedSimple(client, {
      slug: slug("deleted"),
      title: "[Test] Deleted album",
      status: "published",
      marker: PRIVATE_MARKERS.deleted,
      deletedAt: new Date(),
    }),
  );
  // Published, then re-addressed: the old address redirects.
  const renamed = await seedSimple(client, {
    slug: slug("old"),
    title: "[Test] Renamed album",
    status: "published",
    marker: "[Test] renamed public text",
  });
  seeded.push(renamed);
  await changeEntrySlug(db, renamed.entryId, slug("new"));
  // Published, re-addressed, then unpublished: neither address is served.
  const hidden = await seedSimple(client, {
    slug: slug("hidden-old"),
    title: "[Test] Hidden album",
    status: "published",
    marker: PRIVATE_MARKERS.later,
  });
  seeded.push(hidden);
  await changeEntrySlug(db, hidden.entryId, slug("hidden-new"));
  await unpublishLanguageVersion(
    db,
    testAuthor(),
    hidden.entryId,
    "en",
    "private",
  );
  // Re-addressed while it was a draft: the old address was never public.
  const neverPublic = await seedSimple(client, {
    slug: slug("never-old"),
    title: "[Test] Never public album",
    status: "draft",
    marker: PRIVATE_MARKERS.draft,
  });
  seeded.push(neverPublic);
  await changeEntrySlug(db, neverPublic.entryId, slug("never-new"));
  // Deleted for good: the address stays reserved and answers as unknown.
  const retired = await seedSimple(client, {
    slug: slug("retired"),
    title: "[Test] Retired album",
    status: "published",
    marker: PRIVATE_MARKERS.deleted,
    deletedAt: new Date(),
  });
  seeded.push(retired);
  await permanentlyDeleteEntry(db, retired.entryId);

  on = await start("true");
  off = await start(undefined);
  for (const value of invalidValues) {
    invalid[value] = await start(value);
  }
}, 120_000);

afterAll(async () => {
  for (const server of servers) {
    await server.stop().catch(() => undefined);
  }
  try {
    await removeSeeded(client, seeded, prefix);
  } finally {
    await client.end();
  }
}, 60_000);

// Paths that are not served while public reads are on.
function hiddenAddresses() {
  return [
    ["unknown", slug("unknown")],
    ["draft", slug("draft")],
    ["private", slug("private")],
    ["deleted", slug("deleted")],
    ["previous address of an unpublished journal", slug("hidden-old")],
    ["current address of an unpublished journal", slug("hidden-new")],
    ["previous address that was never public", slug("never-old")],
    ["current address of a never-public journal", slug("never-new")],
    ["retired address of a permanently deleted journal", slug("retired")],
    ["not a slug (uppercase)", slug("GRACE")],
    ["not a slug (underscore)", `${slug("grace")}_x`],
    ["too long", "a".repeat(200)],
  ] as const;
}

describe("public reads enabled: an address that is not served answers as an unknown one", () => {
  it.each(hiddenAddresses())(
    "%s: the same 404, byte for byte",
    async (_n, s) => {
      const unknown = comparable(
        await request(on.baseURL, `/albums/${slug("nothing")}`),
      );
      expect(unknown.status).toBe(404);
      const got = comparable(await request(on.baseURL, `/albums/${s}`));
      expect(got).toEqual(unknown);
    },
  );

  it("has the real 404 status, not a streamed 200", async () => {
    const response = await request(on.baseURL, `/albums/${slug("draft")}`);
    expect(response.status).toBe(404);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toContain('content="noindex"');
    expect(response.body).not.toContain("NEXT_REDIRECT");
  });

  it("answers the same for HEAD, with no body", async () => {
    const unknown = await request(on.baseURL, `/albums/${slug("nothing")}`, {
      method: "HEAD",
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toBe("");
    for (const [, s] of hiddenAddresses()) {
      const got = await request(on.baseURL, `/albums/${s}`, { method: "HEAD" });
      expect(comparable(got)).toEqual(comparable(unknown));
    }
  });

  it("answers the same for the router's own RSC and prefetch requests", async () => {
    const unknown = comparable(
      await request(on.baseURL, `/albums/${slug("nothing")}`, { rsc: true }),
    );
    expect(unknown.status).toBe(404);
    for (const [, s] of hiddenAddresses()) {
      expect(
        comparable(await request(on.baseURL, `/albums/${s}`, { rsc: true })),
      ).toEqual(unknown);
      expect(
        comparable(
          await request(on.baseURL, `/albums/${s}`, {
            rsc: true,
            headers: { "next-router-prefetch": "1" },
          }),
        ),
      ).toEqual(
        comparable(
          await request(on.baseURL, `/albums/${slug("nothing")}`, {
            rsc: true,
            headers: { "next-router-prefetch": "1" },
          }),
        ),
      );
    }
  });

  it("answers a query string and malformed escapes without a difference", async () => {
    const unknown = comparable(
      await request(on.baseURL, `/albums/${slug("nothing")}`),
    );
    expect(
      comparable(
        await request(
          on.baseURL,
          `/albums/${slug("draft")}?preview=1&draft=true`,
        ),
      ),
    ).toEqual(unknown);
    for (const path of [
      "/albums/%E0%A4%A",
      "/albums/%00",
      "/albums/a%2Fb",
      "/albums/..%2F",
    ]) {
      const got = await request(on.baseURL, path);
      expect([400, 404], path).toContain(got.status);
      expect(got.body).not.toContain("Error:");
    }
  });
});

describe("public reads enabled: a published journal", () => {
  it("is served with the real status and no-store", async () => {
    const response = await request(on.baseURL, `/albums/${slug("grace")}`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["cache-control"]).not.toMatch(/public|s-maxage/);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("shows exactly what the approved projection allows", async () => {
    const { body } = await request(on.baseURL, `/albums/${slug("grace")}`);
    // The album, the credit, the facts, the opening, the rating.
    expect(body).toContain(">Grace</h1>");
    expect(body).toContain("Jeff Buckley");
    expect(body).toContain("1994 · Columbia · 6 tracks");
    expect(body).toContain(PUBLIC_TEXT.opening);
    expect(body).toContain("My rating: 4.5 out of 5");
    expect(body).toContain("[4.5] / 5");
    expect(body).toContain("Written in English");
    expect(body).toContain(PUBLIC_TEXT.marginNote);
    // The body, through the allow-list: a subheading, a quote, a hard break.
    expect(body).toContain(`<h2>${PUBLIC_TEXT.heading}</h2>`);
    expect(body).toContain("<blockquote>");
    expect(body).toContain("<br/>");
    expect(body).toContain(
      "<strong><em>[Test] second line, emphasised</em></strong>",
    );
    // Hostile content is text: escaped, never markup, and a link mark is not a link.
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body).not.toContain("<img src=x");
    expect(body).not.toContain('href="javascript:');
    expect(body).toContain("[Test] unknown node text");
    // The reflections that are public, and only those.
    for (const title of ["Mojo Pin", "Grace", "Last Goodbye"]) {
      expect(body).toContain(PUBLIC_TEXT.reflection(title));
    }
    expect(body).toContain("Favourite: ");
    expect(body).toContain("(still writing)");
    // Lilac Wine has a reflection that is not public: the track is listed from
    // the catalog, with its credit, and the page does not say that it exists.
    expect(body).toContain("Lilac Wine");
    expect(body).toContain("by James Shelton");
    expect(
      body.match(/class="pj-track-status">not written yet</g),
    ).toHaveLength(3);
    for (const marker of PRIVATE_MARKER_LIST) {
      expect(body).not.toContain(marker);
    }
    // No author control and no studio link.
    const visible = visibleText(body);
    expect(visible).not.toMatch(/studio|sign in|\bedit\b|\bdraft\b|private/i);
    expect(body).not.toContain('href="/studio');
  });

  it("has the title, description, and Open Graph tags of a public page only", async () => {
    const { body } = await request(on.baseURL, `/albums/${slug("grace")}`);
    expect(body).toContain("<title>Grace · Jeff Buckley · refrain</title>");
    expect(body).toContain(
      `<meta name="description" content="${PUBLIC_TEXT.opening}"/>`,
    );
    expect(body).toContain('property="og:title"');
    expect(body).toContain('property="og:type" content="article"');
    expect(body).not.toContain('content="noindex"');
  });

  it("serves its RSC payload without anything private", async () => {
    const response = await request(on.baseURL, `/albums/${slug("grace")}`, {
      rsc: true,
    });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toContain(PUBLIC_TEXT.opening);
    for (const marker of PRIVATE_MARKER_LIST) {
      expect(response.body).not.toContain(marker);
    }
  });

  it("carries no internal identifier, in the page or in its payload", async () => {
    // Studio-only data that a careless projection could leak: the database ids
    // of the entry, the album, the artist, and the tracks.
    const grace = seeded.find((journal) => journal.slug === slug("grace"))!;
    const ids = [
      grace.entryId,
      grace.albumId,
      grace.artistId,
      ...grace.trackIds,
    ];
    expect(ids.length).toBeGreaterThan(5);
    for (const rsc of [false, true]) {
      const { body } = await request(on.baseURL, `/albums/${slug("grace")}`, {
        rsc,
      });
      for (const id of ids) {
        expect(
          body,
          `${rsc ? "payload" : "page"} contains ${id}`,
        ).not.toContain(id);
      }
    }
  });

  it("answers HEAD like GET, without a body", async () => {
    const get = await request(on.baseURL, `/albums/${slug("grace")}`);
    const head = await request(on.baseURL, `/albums/${slug("grace")}`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["cache-control"]).toBe(get.headers["cache-control"]);
  });

  it("refuses other methods for every address alike, before looking at the address", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const answers = [];
      for (const s of [slug("grace"), slug("draft"), slug("nothing")]) {
        const got = await request(on.baseURL, `/albums/${s}`, { method });
        expect(got.status, `${method} ${s}`).toBe(405);
        expect(got.headers.allow).toBe("GET, HEAD");
        expect(got.headers["cache-control"]).toBe("no-store");
        answers.push(comparable(got));
      }
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
    }
  });

  it("serves only the page for a trailing slash: the same redirect for every address", async () => {
    const shape = (location: string | undefined) =>
      (location ?? "").replace(/\/albums\/[a-z0-9-]+/, "/albums/X");
    const answers = [];
    for (const s of [slug("grace"), slug("draft"), slug("nothing")]) {
      const got = await request(on.baseURL, `/albums/${s}/`);
      expect(got.status).toBe(308);
      expect(got.headers.location).toBe(`/albums/${s}`);
      answers.push(shape(got.headers.location));
    }
    expect(new Set(answers).size).toBe(1);
  });
});

describe("public reads enabled: historical addresses", () => {
  it("redirects the previous address of a public journal with a real 308", async () => {
    const response = await request(on.baseURL, `/albums/${slug("old")}`);
    expect(response.status).toBe(308);
    expect(response.headers.location).toBe(`/albums/${slug("new")}`);
    expect(response.headers["cache-control"]).toBe("no-store");
    // The framework's redirect body is the destination path, nothing else.
    expect(response.body).toBe(`/albums/${slug("new")}`);
    // HEAD and RSC requests see the same redirect.
    expect(
      (await request(on.baseURL, `/albums/${slug("old")}`, { method: "HEAD" }))
        .status,
    ).toBe(308);
    const rsc = await request(on.baseURL, `/albums/${slug("old")}`, {
      rsc: true,
    });
    expect(rsc.status).toBe(308);
    expect(rsc.headers.location).toBe(`/albums/${slug("new")}`);
    // The current address is served.
    const current = await request(on.baseURL, `/albums/${slug("new")}`);
    expect(current.status).toBe(200);
    expect(current.body).toContain("[Test] Renamed album");
  });

  it("never reflects a Host header, a forwarded host, or a query string into the redirect", async () => {
    // fetch() does not let a client choose `Host`, so this is a raw request.
    const { status, location } = await new Promise<{
      status: number | undefined;
      location: string | string[] | undefined;
    }>((resolve, reject) => {
      const url = new URL(on.baseURL);
      const req = httpRequest(
        {
          host: url.hostname,
          port: url.port,
          path: `/albums/${slug("old")}?next=//evil.example`,
          headers: {
            host: "evil.example",
            "x-forwarded-host": "evil.example",
            "x-forwarded-proto": "https",
          },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode, location: res.headers.location });
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(308);
    expect(String(location)).not.toContain("evil.example");
    expect(location).toBe(`/albums/${slug("new")}`);
  });
});

describe("public reads enabled: the sitemap and robots.txt", () => {
  it("lists exactly the addresses that are served", async () => {
    const response = await request(on.baseURL, "/sitemap.xml");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toContain("application/xml");
    const listed = [...response.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]!).pathname,
    );
    const mine = listed.filter((path) => path.startsWith(`/albums/${prefix}-`));
    expect(mine.sort()).toEqual(
      [`/albums/${slug("grace")}`, `/albums/${slug("new")}`].sort(),
    );
    // Every listed address is served, and none is a redirect.
    for (const path of listed) {
      expect((await request(on.baseURL, path)).status, path).toBe(200);
    }
    for (const marker of PRIVATE_MARKER_LIST) {
      expect(response.body).not.toContain(marker);
    }
  });

  it("serves robots.txt with no-store and no private address", async () => {
    const response = await request(on.baseURL, "/robots.txt");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain("Disallow: /studio");
    expect(response.body).toContain(`Sitemap: ${on.baseURL}/sitemap.xml`);
    expect(response.body).not.toContain(prefix);
  });

  it("refuses other methods", async () => {
    for (const path of ["/sitemap.xml", "/robots.txt"]) {
      for (const method of ["POST", "DELETE"]) {
        expect((await request(on.baseURL, path, { method })).status).toBe(405);
      }
    }
  });
});

describe("public reads disabled (unset, or not exactly `true`): nothing is served", () => {
  const servers = () => [
    ["unset", off],
    ...invalidValues.map((value) => [`"${value}"`, invalid[value]!] as const),
  ];

  it.each(["unset", ...invalidValues.map((value) => `"${value}"`)])(
    "%s: every public surface answers the unknown-address 404 to every method",
    async (name) => {
      const server = servers().find(
        ([n]) => n === name,
      )![1] as ProductionServer;
      const unknown = comparable(
        await request(server.baseURL, `/albums/${slug("nothing")}`),
      );
      expect(unknown.status).toBe(404);
      expect(unknown.headers["cache-control"]).toContain("no-store");
      const surfaces = [
        `/albums/${slug("grace")}`,
        `/albums/${slug("old")}`,
        `/albums/${slug("draft")}`,
        `/albums/${slug("nothing")}`,
        `/albums/${slug("grace")}?x=1`,
      ];
      for (const path of surfaces) {
        for (const method of ["GET", "POST", "PUT", "DELETE", "OPTIONS"]) {
          const got = await request(server.baseURL, path, { method });
          expect(got.status, `${method} ${path}`).toBe(404);
          if (method === "GET") {
            expect(comparable(got), path).toEqual(unknown);
          }
        }
        for (const method of ["HEAD"]) {
          expect((await request(server.baseURL, path, { method })).status).toBe(
            404,
          );
        }
        const rsc = await request(server.baseURL, path, { rsc: true });
        expect(rsc.status, `RSC ${path}`).toBe(404);
        expect(rsc.body).not.toContain("Grace");
      }
      // The sitemap and robots.txt answer 404 as well, and say nothing.
      for (const path of ["/sitemap.xml", "/robots.txt"]) {
        const got = await request(server.baseURL, path);
        expect(got.status, path).toBe(404);
        expect(got.headers["cache-control"]).toContain("no-store");
        expect(got.body).not.toContain(prefix);
      }
      // A disabled server shows no part of a published journal.
      const grace = await request(server.baseURL, `/albums/${slug("grace")}`);
      for (const text of [PUBLIC_TEXT.opening, "Jeff Buckley", "Grace</h1>"]) {
        expect(grace.body).not.toContain(text);
      }
    },
  );

  it("the same build serves the page once the switch is exactly `true`", async () => {
    expect((await request(on.baseURL, `/albums/${slug("grace")}`)).status).toBe(
      200,
    );
    expect(
      (await request(off.baseURL, `/albums/${slug("grace")}`)).status,
    ).toBe(404);
  });
});

describe("the switch hides content and never reveals it", () => {
  it("a hidden journal stays hidden with the switch on, as with a non-public state it never was public", async () => {
    // Switch on, and still nothing of a draft, private, or deleted journal.
    for (const name of ["draft", "private", "deleted", "retired"]) {
      const got = await request(on.baseURL, `/albums/${slug(name)}`);
      expect(got.status).toBe(404);
      for (const marker of PRIVATE_MARKER_LIST) {
        expect(got.body).not.toContain(marker);
      }
    }
  });
});

describe("a database failure", () => {
  it("answers a generic 503 with no connection detail, never a 404", async () => {
    const password = `pw-${randomUUID()}`;
    // The server starts without touching the database; only a request does.
    const broken = await startProductionServer({
      withAuthor: false,
      env: {
        REFRAIN_PUBLIC_READS_ENABLED: "true",
        DATABASE_URL: `postgres://nobody:${password}@127.0.0.1:1/none`,
      },
    });
    servers.push(broken);
    const got = await request(broken.baseURL, `/albums/${slug("grace")}`);
    expect(got.status).toBe(503);
    expect(got.headers["cache-control"]).toBe("no-store");
    expect(got.body).toBe("Service unavailable");
    expect(got.body).not.toContain(password);
    expect(readFileSync(broken.serverLog, "utf8")).not.toContain(password);
  });
});

describe("what every request saw", () => {
  it("contains no private marker, no table name, and no stack trace", () => {
    expect(corpus.length).toBeGreaterThan(100);
    const all = corpus.join("\n");
    for (const marker of PRIVATE_MARKER_LIST) {
      expect(all.includes(marker), marker).toBe(false);
    }
    for (const leak of [
      "entry_texts",
      "entry_slugs",
      "track_reflections",
      "PostgresError",
      "at Object.",
      "node_modules",
    ]) {
      expect(all.includes(leak), leak).toBe(false);
    }
  });

  it("left no private marker in any server log", () => {
    for (const server of servers) {
      const log = readFileSync(server.serverLog, "utf8");
      for (const marker of PRIVATE_MARKER_LIST) {
        expect(log.includes(marker), marker).toBe(false);
      }
    }
  });
});
