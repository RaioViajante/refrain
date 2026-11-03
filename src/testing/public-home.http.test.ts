// The public Home over real HTTP, against the production build (`next start`)
// and the disposable test database (M3.4; ADR 0006 § 11, D4, and amendment
// A4). Several servers are started from the one build, each with its own value
// of REFRAIN_PUBLIC_READS_ENABLED, and all with one site origin, so that their
// answers can be compared.
//
// What is proven:
//
// - With the switch off (unset, or any value other than exactly "true"), the
//   Home is what a site with nothing published answers, whatever the database
//   holds: the same status, headers, visible text, and markup, in every
//   request form (A4).
// - With it on, the Home lists exactly the album journals a reader may open,
//   each at its current address, and never names a draft, a private, a
//   deleted, a restored, an unpublished, or a re-addressed journal.
// - Every response is `no-store`; a state change shows on the next request.
//
// Two requests to the same server already differ in one random key that the
// framework writes into its Flight data, and a streamed answer can arrive in
// a different order; so a page is compared as a reader receives it (status,
// headers, visible text, every tag with its attributes), with that key masked
// (`masked`, the helper the album-journal tests use).
import { randomBytes } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// eslint-disable-next-line no-restricted-imports
import {
  deleteAlbumJournal,
  restoreAlbumJournal,
} from "@/modules/journals/commands";
// eslint-disable-next-line no-restricted-imports
import {
  changeEntrySlug,
  unpublishLanguageVersion,
} from "@/modules/publication/commands";
import { testAuthor } from "@/testing/fixtures";
import {
  startProductionServer,
  type ProductionServer,
} from "@/testing/production-server";
import {
  corpus,
  request,
  visibleText,
  type Snapshot,
} from "@/testing/public-http";
import {
  fixtureDatabase,
  HOME_SHELF,
  PRIVATE_MARKER_LIST,
  removeSeeded,
  runPrefix,
  seedGrace,
  seedHomeShelf,
  seedSimple,
  type SeededJournal,
} from "@/testing/public-journals";
import { masked } from "@/testing/public-request-forms";
import { publishForTest } from "@/testing/publishing";
import { assertDisposableTestDatabase } from "@/testing/test-database";
import { CONTENT_SECURITY_POLICY } from "@/security-headers";

// The test process publishes fixtures through the real commands, which need
// the application's configuration.
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const prefix = runPrefix();
const slug = (name: string) => `${prefix}-${name}`;
const author = testAuthor();

// One origin for every server, so the canonical address and og:url agree.
const ORIGIN = "https://refrain.example";

let client: Client;
const db = () => fixtureDatabase(client);
const seeded: SeededJournal[] = [];
const servers: ProductionServer[] = [];

async function start(value: string | undefined) {
  const server = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: value, BETTER_AUTH_URL: ORIGIN },
  });
  servers.push(server);
  return server;
}

let on: ProductionServer;
let off: ProductionServer;
// Values that are not exactly "true".
const NEAR_MISSES = ["TRUE", "1", "true "];
const nearMiss: ProductionServer[] = [];

// The titles of journals a reader may never see on the Home. Each is unique to
// this run, so finding one anywhere is a leak.
const HIDDEN = {
  draft: "[Test] HOME-HIDDEN-draft",
  private: "[Test] HOME-HIDDEN-private",
  deleted: "[Test] HOME-HIDDEN-deleted",
  restored: "[Test] HOME-HIDDEN-restored",
  unpublished: "[Test] HOME-HIDDEN-unpublished",
} as const;
const HIDDEN_TITLES: string[] = Object.values(HIDDEN);
// Addresses a reader may never be sent to from the Home.
const hiddenSlugs: string[] = [];

/** What a reader receives, with the framework's per-request key masked. */
function readerView(snapshot: Snapshot) {
  const view = masked(snapshot, []);
  const markup = view.body.replace(/<script[\s\S]*?<\/script>/g, "");
  return {
    status: view.status,
    headers: view.headers,
    text: visibleText(view.body).trim(),
    tags: [...markup.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0]).sort(),
  };
}

/** The album-journal addresses a page links to, in the markup. */
function addressesIn(body: string): string[] {
  const markup = body.replace(/<script[\s\S]*?<\/script>/g, "");
  return [
    ...new Set(
      [...markup.matchAll(/href="(\/albums\/[^"]+)"/g)].map((m) => m[1]!),
    ),
  ].sort();
}

const home = (server: ProductionServer, init?: Parameters<typeof request>[2]) =>
  request(server.baseURL, "/", init);

/** The page of a journal whose current address is shown, as a reader opens it. */
const albumAddress = (name: string) => `/albums/${slug(name)}`;

// Every way a reader or the router asks for the Home.
const FORMS: [string, Parameters<typeof request>[2]][] = [
  ["GET", {}],
  ["HEAD", { method: "HEAD" }],
  ["RSC", { rsc: true }],
  ["router prefetch", { rsc: true, headers: { "next-router-prefetch": "1" } }],
  [
    "segment prefetch (tree)",
    {
      rsc: true,
      headers: {
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/_tree",
      },
    },
  ],
  [
    "segment prefetch (page)",
    {
      rsc: true,
      headers: {
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/__PAGE__",
      },
    },
  ],
  ["If-None-Match", { headers: { "if-none-match": "*" } }],
  [
    "If-Modified-Since",
    { headers: { "if-modified-since": "Wed, 21 Oct 2037 07:28:00 GMT" } },
  ],
  ["Range", { headers: { range: "bytes=0-10" } }],
  ["Accept: application/json", { headers: { accept: "application/json" } }],
  ["a cookie", { headers: { cookie: "refrain=1; theme=dark" } }],
];

const CACHE_INDICATORS = [
  "age",
  "x-cache",
  "cf-cache-status",
  "x-vercel-cache",
];

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-home-tests",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  [off, on] = [await start(undefined), await start("true")];
  for (const value of NEAR_MISSES) {
    nearMiss.push(await start(value));
  }
}, 180_000);

afterAll(async () => {
  for (const server of servers) {
    await server.stop().catch(() => undefined);
  }
  try {
    await removeSeeded(client, seeded, prefix);
  } finally {
    await client.end();
  }
  // Nothing private, and no hidden journal, was ever sent: not in a body, a
  // header, or an RSC payload, in any test above.
  const all = corpus.join("\n");
  for (const marker of [...PRIVATE_MARKER_LIST, ...HIDDEN_TITLES]) {
    expect(all, marker).not.toContain(marker);
  }
  for (const hidden of hiddenSlugs) {
    expect(all, hidden).not.toContain(`/albums/${hidden}"`);
  }
}, 60_000);

// The views of the Home before anything is published, kept for comparison.
let emptyOn: ReturnType<typeof readerView>;
let emptyOff: ReturnType<typeof readerView>;

describe("with nothing published", () => {
  beforeAll(async () => {
    // An independent account of the publication predicate (docs/security.md
    // § Publication predicate): a version is visible when it is published and
    // its entry is not deleted. This comparison needs a database with none.
    const visible = await client.query<{ count: string }>(`
      select count(*) from entry_texts t join entries e on e.id = t.entry_id
       where e.deleted_at is null and t.status = 'published'`);
    expect(
      Number(visible.rows[0]!.count),
      "the test database already holds a public journal; reset it (pnpm db:test:down && pnpm db:test:up)",
    ).toBe(0);
  });

  it("answers 200 with the public headers, switch on or off", async () => {
    for (const server of [off, on, ...nearMiss]) {
      const page = await home(server);
      expect(page.status).toBe(200);
      expect(page.headers["cache-control"]).toBe("no-store");
      expect(page.headers["content-security-policy"]).toBe(
        CONTENT_SECURITY_POLICY,
      );
      expect(page.headers["x-frame-options"]).toBe("DENY");
      expect(page.headers["x-content-type-options"]).toBe("nosniff");
      expect(page.headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
      for (const name of [...CACHE_INDICATORS, "x-nextjs-cache"]) {
        expect(page.headers[name], name).toBeUndefined();
      }
    }
  });

  it("shows the drawing, the introduction, and one quiet line, and nothing else", async () => {
    const page = await home(on);
    const text = visibleText(page.body);
    expect(text).toContain(
      "A personal music journal about albums, songs, and the memories attached to them.",
    );
    expect(text).toContain("Nothing published yet.");
    expect(text).not.toContain("Recently written");
    expect(text).not.toContain("Most recent");
    expect(page.body).toContain('src="/artwork/refrain-home-character.webp"');
    expect(page.body).toContain('width="1536" height="1024"');
    expect(addressesIn(page.body)).toEqual([]);
  });

  it("is the same page with the switch off as with nothing published (A4)", async () => {
    emptyOn = readerView(await home(on));
    emptyOff = readerView(await home(off));
    expect(emptyOff).toEqual(emptyOn);
    for (const server of nearMiss) {
      expect(readerView(await home(server))).toEqual(emptyOn);
    }
  });
});

describe("with journals in every state", () => {
  let grace: SeededJournal;
  let shelf: SeededJournal[];

  beforeAll(async () => {
    grace = await seedGrace(client, { slug: slug("grace") });
    seeded.push(grace);
    shelf = await seedHomeShelf(client, prefix);
    seeded.push(...shelf);

    for (const [name, status] of [
      ["draft", "draft"],
      ["private", "private"],
    ] as const) {
      seeded.push(
        await seedSimple(client, {
          slug: slug(name),
          title: HIDDEN[name],
          status,
          marker: `[Test] PRIVATE-${name}`,
        }),
      );
      hiddenSlugs.push(slug(name));
    }
    seeded.push(
      await seedSimple(client, {
        slug: slug("deleted"),
        title: HIDDEN.deleted,
        status: "published",
        marker: "[Test] PRIVATE-deleted",
        deletedAt: new Date(),
      }),
    );
    hiddenSlugs.push(slug("deleted"));

    // Published, deleted, then restored: a restore never republishes.
    const restored = await seedSimple(client, {
      slug: slug("restored"),
      title: HIDDEN.restored,
      status: "published",
      marker: "[Test] PRIVATE-restored",
    });
    seeded.push(restored);
    await deleteAlbumJournal(db(), author, restored.entryId);
    await restoreAlbumJournal(db(), author, restored.entryId);
    hiddenSlugs.push(slug("restored"));

    // Published, re-addressed, then unpublished: neither address is shown.
    const unpublished = await seedSimple(client, {
      slug: slug("unpublished-old"),
      title: HIDDEN.unpublished,
      status: "published",
      marker: "[Test] PRIVATE-unpublished",
    });
    seeded.push(unpublished);
    await changeEntrySlug(db(), unpublished.entryId, slug("unpublished-new"));
    await unpublishLanguageVersion(
      db(),
      author,
      unpublished.entryId,
      "en",
      "private",
    );
    hiddenSlugs.push(slug("unpublished-old"), slug("unpublished-new"));

    // Published and re-addressed: only the current address is shown.
    const renamed = await seedSimple(client, {
      slug: slug("renamed-old"),
      title: "[Test] Renamed album",
      status: "published",
      marker: "[Test] renamed public text",
    });
    seeded.push(renamed);
    await changeEntrySlug(db(), renamed.entryId, slug("renamed-new"));
    hiddenSlugs.push(slug("renamed-old"));
  }, 60_000);

  it("still answers, with the switch off, exactly what a site with nothing published answers", async () => {
    expect(readerView(await home(off))).toEqual(emptyOff);
    for (const server of nearMiss) {
      expect(readerView(await home(server))).toEqual(emptyOff);
    }
  });

  it("lists exactly the journals a reader may open, each at its current address", async () => {
    const page = await home(on);
    expect(page.status).toBe(200);
    expect(addressesIn(page.body)).toEqual(
      [
        albumAddress("grace"),
        albumAddress("renamed-new"),
        ...HOME_SHELF.map((album) => albumAddress(album.name)),
      ].sort(),
    );
    // Every link answers 200, never a redirect or a 404.
    for (const address of addressesIn(page.body)) {
      const opened = await request(on.baseURL, address);
      expect(opened.status, address).toBe(200);
    }
    const text = visibleText(page.body);
    expect(text).toContain("Recently written");
    expect(text).toContain("Most recent: Grace · Album journal · Oct 20, 2026");
    expect(text).toContain("Albums");
    for (const title of HIDDEN_TITLES) {
      expect(page.body, title).not.toContain(title);
    }
  });

  it("answers every request form with no-store, and with the switch off as an empty site does", async () => {
    for (const [name, init] of FORMS) {
      const enabled = await home(on, init);
      const disabled = await home(off, init);
      for (const [label, snapshot] of [
        ["on", enabled],
        ["off", disabled],
      ] as const) {
        expect(snapshot.headers["cache-control"], `${name} ${label}`).toBe(
          "no-store",
        );
        for (const header of CACHE_INDICATORS) {
          expect(snapshot.headers[header], `${name} ${label}`).toBeUndefined();
        }
      }
      // The framework's marker appears only on a generic build artifact
      // (A2): one that is the same whatever the database holds.
      if (disabled.headers["x-nextjs-cache"] !== undefined) {
        expect(masked(disabled, []), name).toEqual(masked(enabled, []));
      }
      for (const title of HIDDEN_TITLES) {
        expect(enabled.body, `${name}: ${title}`).not.toContain(title);
      }
      // Nothing about any journal reaches a reader while reads are off.
      for (const listed of [
        "Grace",
        ...HOME_SHELF.map((album) => album.title),
      ]) {
        expect(disabled.body, `${name} off: ${listed}`).not.toContain(listed);
      }
      expect(disabled.body, name).not.toContain(prefix);
    }
  });

  it("refuses every other method, the same with the switch on or off", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const enabled = await home(on, { method });
      const disabled = await home(off, { method });
      expect(enabled.status, method).toBe(405);
      expect(enabled.headers["cache-control"], method).toBe("no-store");
      expect(masked(disabled, [])).toEqual(masked(enabled, []));
      expect(enabled.body).not.toContain(prefix);
    }
  });

  it("describes the Home and no journal in its metadata, the same with the switch off", async () => {
    // The metadata is streamed with the page (React places it in the head in
    // a browser), so it is read from the whole markup, outside scripts.
    const markup = (body: string) =>
      body.replace(/<script[\s\S]*?<\/script>/g, "");
    const enabled = markup((await home(on)).body);
    const disabled = markup((await home(off)).body);
    for (const html of [enabled, disabled]) {
      expect(html).toContain("<title>refrain</title>");
      expect(html).toContain(
        '<meta name="description" content="A personal music journal about albums, songs, and the memories attached to them."/>',
      );
      expect(html).toContain(`<link rel="canonical" href="${ORIGIN}"/>`);
      expect(html).toContain('<meta property="og:type" content="website"/>');
      expect(html).toContain(`<meta property="og:url" content="${ORIGIN}"/>`);
    }
    // The switch-off page names no journal anywhere, and the enabled page's
    // metadata is the same as it: no title, description, or address of any
    // journal reaches the metadata.
    expect(disabled).not.toContain(prefix);
    expect(disabled).not.toContain("Grace");
    const metaTags = (html: string) =>
      [...html.matchAll(/<(meta|link|title)[^>]*>/g)]
        .map((m) => m[0])
        .filter((tag) => !/rel="(preload|stylesheet|expect)"|as="/.test(tag))
        .sort();
    expect(metaTags(disabled)).toEqual(metaTags(enabled));
  });

  it("shows each change on the next request", async () => {
    const pinkMoon = shelf[0]!;
    const listed = async () => addressesIn((await home(on)).body);

    await unpublishLanguageVersion(
      db(),
      author,
      pinkMoon.entryId,
      "en",
      "private",
    );
    expect(await listed()).not.toContain(albumAddress("pink-moon"));
    await publishForTest(db(), pinkMoon.entryId, "en");
    expect(await listed()).toContain(albumAddress("pink-moon"));

    await deleteAlbumJournal(db(), author, pinkMoon.entryId);
    expect(await listed()).not.toContain(albumAddress("pink-moon"));
    // A restore keeps it private: still not on the Home.
    await restoreAlbumJournal(db(), author, pinkMoon.entryId);
    expect(await listed()).not.toContain(albumAddress("pink-moon"));
    await publishForTest(db(), pinkMoon.entryId, "en");
    expect(await listed()).toContain(albumAddress("pink-moon"));

    // A new address replaces the old one at once; the old one is never linked.
    await changeEntrySlug(db(), grace.entryId, slug("grace-moved"));
    const after = await listed();
    expect(after).toContain(albumAddress("grace-moved"));
    expect(after).not.toContain(albumAddress("grace"));

    // And with the switch off, none of it ever showed.
    expect(readerView(await home(off))).toEqual(emptyOff);
  });

  it("is in the sitemap, first, only while reads are on", async () => {
    const sitemap = await request(on.baseURL, "/sitemap.xml");
    expect(sitemap.status).toBe(200);
    const locations = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => m[1],
    );
    expect(locations[0]).toBe(`${ORIGIN}/`);
    expect(locations.filter((loc) => loc === `${ORIGIN}/`)).toHaveLength(1);
    expect((await request(off.baseURL, "/sitemap.xml")).status).toBe(404);
  });
});
