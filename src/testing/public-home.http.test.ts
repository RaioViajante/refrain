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
// - Since M3.8b (A6): memories and artists are listed too, and the same holds
//   in a database that holds only hidden writing (the switch on, too, then
//   answers the empty site) and in one with public memories and artists; a
//   memory's whole writing, an identifier, or a photograph never appears.
//
// Two requests to the same server already differ in one random key that the
// framework writes into its Flight data, and a streamed answer can arrive in
// a different order; so a page is compared as a reader receives it (status,
// headers, visible text, every tag with its attributes), with that key masked
// (`masked`, the helper the album-journal tests use).
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// eslint-disable-next-line no-restricted-imports
import {
  deleteAlbumJournal,
  restoreAlbumJournal,
} from "@/modules/journals/commands";
// eslint-disable-next-line no-restricted-imports
import { archiveArtist } from "@/modules/catalog/commands";
// eslint-disable-next-line no-restricted-imports
import { artistAddressSuffix } from "@/modules/publication/artist-address";
// eslint-disable-next-line no-restricted-imports
import { deleteMemory, restoreMemory } from "@/modules/journals/memories";
// eslint-disable-next-line no-restricted-imports
import {
  changeEntrySlug,
  restoreDeletedEntry,
  unpublishLanguageVersion,
} from "@/modules/publication/commands";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestArtistJournal,
  createTestMemory,
  testAuthor,
} from "@/testing/fixtures";
import {
  ARTIST_MARKERS,
  GRACE_ARTIST_PHOTO,
  LONG_BAND_NAME,
  PRIVATE_ARTIST_MARKER_LIST,
  removeSeededArtists,
  seedArtistPages,
  setTestArtistPhoto,
  type SeededArtists,
} from "@/testing/public-artists";
import {
  MEMORY_MARKER_LIST,
  PUBLIC_MEMORY,
  removeSeededMemories,
  seedMemories,
  type SeededMemories,
} from "@/testing/public-memories";
import {
  startProductionServer,
  type ProductionServer,
} from "@/testing/production-server";
import {
  corpus,
  filesContaining,
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

// M3.8b: the hidden-only phase's records. Each name is a marker that must
// never be sent, in any response, with the switch on or off.
const HIDDEN_ONLY = {
  draftJournal: "[Test] A6-HIDDEN-DRAFT-JOURNAL",
  draftMemory: "[Test] A6-HIDDEN-DRAFT-MEMORY",
  privateMemory: "[Test] A6-HIDDEN-PRIVATE-MEMORY",
  deletedMemory: "[Test] A6-HIDDEN-DELETED-MEMORY",
  restoredMemory: "[Test] A6-HIDDEN-RESTORED-MEMORY",
  unpublishedMemory: "[Test] A6-HIDDEN-UNPUBLISHED-MEMORY",
  translationMemory: "[Test] A6-HIDDEN-TRANSLATION-MEMORY",
  memorySong: "[Test] A6-HIDDEN-MEMORY-SONG",
  catalogArtist: "[Test] A6-HIDDEN-CATALOG-ARTIST",
  draftArtist: "[Test] A6-HIDDEN-DRAFT-ARTIST",
  journalArtist: "[Test] A6-HIDDEN-ARTIST-JOURNAL-ARTIST",
  photoArtist: "[Test] A6-HIDDEN-PHOTO-ARTIST",
  artistJournal: "[Test] A6-HIDDEN-ARTIST-JOURNAL",
} as const;
const HIDDEN_ONLY_LIST: string[] = Object.values(HIDDEN_ONLY);
const hiddenOnly = {
  entries: [] as string[],
  albums: [] as string[],
  tracks: [] as string[],
  artists: [] as string[],
};
let artists: SeededArtists | undefined;
let memories: SeededMemories | undefined;
const artistPrefix = `${prefix}-art`;
const memoryPrefix = `${prefix}-mem`;

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

/**
 * The Flight rows a response carries, sorted: the payload of every
 * `self.__next_f.push([1, "…"])` in a document, or the body of an RSC
 * response, split into rows.
 */
function flightRows(body: string): string[] {
  const pushes = [
    ...body.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g),
  ];
  const payload =
    pushes.length > 0
      ? pushes.map((m) => JSON.parse(m[1]!) as string).join("")
      : body;
  return payload
    .split("\n")
    .filter((row) => row !== "")
    .sort();
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
  // M3.8b review: the framework renders for a known bot by another path.
  [
    "a bot",
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      },
    },
  ],
];

// The build's own addresses for the Home, and its data route (M3.8b review):
// with the switch off each must answer, in every phase, what it answered
// before anything was published.
const INDEX_PATHS = [
  "/index",
  "/index.html",
  "/index.rsc",
  "/index.segments/_tree.segment.rsc",
  "/index.segments/__PAGE__.segment.rsc",
  `/_next/data/${readFileSync(".next/BUILD_ID", "utf8").trim()}/index.json`,
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
    await removeSeededMemories(client, memories, memoryPrefix);
    await removeSeededArtists(client, artists, artistPrefix);
    await client.query("delete from entry_slugs where entry_id = any($1)", [
      hiddenOnly.entries,
    ]);
    await client.query("delete from entries where id = any($1)", [
      hiddenOnly.entries,
    ]);
    await client.query("delete from albums where id = any($1)", [
      hiddenOnly.albums,
    ]);
    await client.query("delete from tracks where id = any($1)", [
      hiddenOnly.tracks,
    ]);
    await client.query("delete from artists where id = any($1)", [
      hiddenOnly.artists,
    ]);
    await removeSeeded(client, seeded, prefix);
  } finally {
    await client.end();
  }
  // Nothing private, and no hidden journal, memory, or artist, was ever sent:
  // not in a body, a header, or an RSC payload, in any test above.
  const all = corpus.join("\n");
  for (const marker of [
    ...PRIVATE_MARKER_LIST,
    ...HIDDEN_TITLES,
    ...HIDDEN_ONLY_LIST,
    ...MEMORY_MARKER_LIST,
    ...PRIVATE_ARTIST_MARKER_LIST,
  ]) {
    expect(all, marker).not.toContain(marker);
  }
  for (const hidden of hiddenSlugs) {
    expect(all, hidden).not.toContain(`/albums/${hidden}"`);
    expect(all, hidden).not.toContain(`/memories/${hidden}"`);
  }
}, 60_000);

// The views of the Home before anything is published, kept for comparison.
let emptyOn: ReturnType<typeof readerView>;
let emptyOff: ReturnType<typeof readerView>;
// Every request form, answered by every server whose switch is off, before
// anything is published: the whole response, Flight data included, with only
// the framework's per-request key masked.
const offBaseline = new Map<string, ReturnType<typeof masked>>();
// The same, from the server whose switch is on, before anything is published:
// the empty site itself.
const onBaseline = new Map<string, ReturnType<typeof masked>>();
const offPathBaseline = new Map<string, ReturnType<typeof masked>>();
const offServers = () => [off, ...nearMiss];

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
    // Recorded for the evidence: the framework's own headers on the document.
    const framework = Object.entries((await home(on)).headers).filter(
      ([name]) => name.startsWith("x-nextjs"),
    );
    console.log(`framework headers on /: ${JSON.stringify(framework)}`);
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
    // No section and no archive link (A6, item 6); the header's four links
    // are the only mention of the archives.
    for (const absent of [
      'id="ph-recent"',
      'id="ph-albums"',
      'id="ph-artists"',
      'id="ph-memories"',
      "All album journals",
      "All artists",
      "All memories",
    ]) {
      expect(page.body, absent).not.toContain(absent);
    }
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

  it("records every request form with the switch off, the same on every such server", async () => {
    for (const [name, init] of FORMS) {
      const reference = masked(await home(off, init), []);
      for (const [index, server] of offServers().entries()) {
        const answer = masked(await home(server, init), []);
        expect(answer, `${name}, server ${index}`).toEqual(reference);
        offBaseline.set(`${index}:${name}`, answer);
      }
    }
    expect(offBaseline.size).toBe(FORMS.length * (1 + NEAR_MISSES.length));
    for (const [name, init] of FORMS) {
      onBaseline.set(name, masked(await home(on, init), []));
    }
    for (const path of INDEX_PATHS) {
      for (const [index, server] of offServers().entries()) {
        offPathBaseline.set(
          `${index}:${path}`,
          masked(await request(server.baseURL, path), []),
        );
      }
    }
  });

  // The switch-on server awaits its (empty) read, so the framework chunks and
  // orders the same stream differently from the switch-off server, which
  // reads nothing: the comparison is of the content, not the chunking. Every
  // header, the reader's view, and the Flight rows as a sorted multiset.
  it("is, with the switch off, the empty site itself, Flight included, in every request form", async () => {
    for (const [name] of FORMS) {
      const disabled = offBaseline.get(`0:${name}`)!;
      const enabled = onBaseline.get(name)!;
      expect(disabled.status, name).toBe(enabled.status);
      expect(disabled.headers, name).toEqual(enabled.headers);
      expect(flightRows(disabled.body), name).toEqual(flightRows(enabled.body));
      // A document is also compared as a reader receives it; an RSC answer
      // is Flight rows only, compared above.
      if (/<html/.test(enabled.body)) {
        const reader = (body: string) =>
          visibleText(body.replace(/<script[\s\S]*?<\/script>/g, ""));
        expect(reader(disabled.body), name).toEqual(reader(enabled.body));
      }
    }
  });
});

/**
 * Every server whose switch is off still answers, in every request form and
 * at the build's own addresses, exactly what it answered before anything was
 * published: the whole response, Flight data included.
 */
async function expectEmptySiteWhileOff() {
  for (const [name, init] of FORMS) {
    for (const [index, server] of offServers().entries()) {
      expect(
        masked(await home(server, init), []),
        `${name}, server ${index}`,
      ).toEqual(offBaseline.get(`${index}:${name}`));
    }
  }
  for (const path of INDEX_PATHS) {
    for (const [index, server] of offServers().entries()) {
      expect(
        masked(await request(server.baseURL, path), []),
        `${path}, server ${index}`,
      ).toEqual(offPathBaseline.get(`${index}:${path}`));
    }
  }
}

// M3.8b (A6, item 6): a database that holds only writing a reader may not see
// renders the empty site, with the switch on as well as off, in every request
// form, Flight data included.
describe("with only hidden writing (A6)", () => {
  beforeAll(async () => {
    await fixtureDatabase(client).transaction(async (tx) => {
      const artist = async (name: string) => {
        const id = await createTestArtist(tx, name);
        hiddenOnly.artists.push(id);
        return id;
      };
      const catalogArtist = await artist(HIDDEN_ONLY.catalogArtist);
      const draftArtist = await artist(HIDDEN_ONLY.draftArtist);
      const journalArtist = await artist(HIDDEN_ONLY.journalArtist);
      const photoArtist = await artist(HIDDEN_ONLY.photoArtist);
      await setTestArtistPhoto(tx, photoArtist, GRACE_ARTIST_PHOTO);
      expect(catalogArtist).toBeTruthy();

      const album = await createTestAlbum(tx, {
        title: HIDDEN_ONLY.draftJournal,
        trackTitles: [HIDDEN_ONLY.memorySong],
        artistIds: [draftArtist],
      });
      hiddenOnly.albums.push(album.albumId);
      hiddenOnly.tracks.push(...album.trackIds);
      hiddenOnly.entries.push(
        await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          slug: slug("a6-draft-journal"),
          versions: [{ locale: "en", status: "draft" }],
        }),
      );
      // A published artist journal: artist journals have no public reading
      // contract, so it makes nothing public.
      hiddenOnly.entries.push(
        await createTestArtistJournal(tx, {
          artistId: journalArtist,
          slug: slug("a6-artist-journal"),
          versions: [
            {
              locale: "en",
              status: "published",
              title: HIDDEN_ONLY.artistJournal,
              text: HIDDEN_ONLY.artistJournal,
            },
          ],
        }),
      );
      const music = [{ trackId: album.trackIds[0]! }];
      const memoryIn = async (
        name: string,
        title: string,
        versions: {
          locale: "en" | "pt-BR";
          status: "draft" | "private" | "published";
        }[],
        deletedAt?: Date,
      ) => {
        const entryId = await createTestMemory(tx, {
          slug: slug(name),
          deletedAt,
          music,
          versions: versions.map((version) => ({
            ...version,
            title,
            text: title,
          })),
        });
        await tx.execute(sql`
          update memories set remembered_when = ${title}
           where entry_id = ${entryId}`);
        hiddenOnly.entries.push(entryId);
        return entryId;
      };
      await memoryIn("a6-draft", HIDDEN_ONLY.draftMemory, [
        { locale: "en", status: "draft" },
      ]);
      await memoryIn("a6-private", HIDDEN_ONLY.privateMemory, [
        { locale: "en", status: "private" },
      ]);
      await memoryIn(
        "a6-deleted",
        HIDDEN_ONLY.deletedMemory,
        [{ locale: "en", status: "published" }],
        new Date(),
      );
      const restored = await memoryIn(
        "a6-restored",
        HIDDEN_ONLY.restoredMemory,
        [{ locale: "en", status: "published" }],
        new Date(),
      );
      await restoreDeletedEntry(tx, restored);
      const unpublished = await memoryIn(
        "a6-unpublished",
        HIDDEN_ONLY.unpublishedMemory,
        [{ locale: "en", status: "published" }],
      );
      await unpublishLanguageVersion(tx, author, unpublished, "en", "private");
      await memoryIn("a6-translation", HIDDEN_ONLY.translationMemory, [
        { locale: "en", status: "draft" },
        { locale: "pt-BR", status: "private" },
      ]);
    });
    hiddenSlugs.push(
      ...[
        "a6-draft",
        "a6-private",
        "a6-deleted",
        "a6-restored",
        "a6-unpublished",
        "a6-translation",
      ].map(slug),
    );
  }, 60_000);

  it("answers, with the switch on, exactly what the empty site answered, in every request form", async () => {
    expect(readerView(await home(on))).toEqual(emptyOn);
    for (const [name, init] of FORMS) {
      expect(masked(await home(on, init), []), name).toEqual(
        onBaseline.get(name),
      );
    }
  });

  it("answers, with the switch off or a near miss, exactly the empty-site baseline, in every request form", async () => {
    await expectEmptySiteWhileOff();
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
    // In every request form, on every server whose switch is off, the whole
    // response (Flight data included) is what it was before anything was
    // published.
    for (const [name, init] of FORMS) {
      for (const [index, server] of offServers().entries()) {
        expect(
          masked(await home(server, init), []),
          `${name}, server ${index}`,
        ).toEqual(offBaseline.get(`${index}:${name}`));
      }
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

  // The framework lets a POST that could be a Server Action through to the
  // page (a form body, or a `Next-Action` header), where the album addresses'
  // proxy answers `405` to every POST. The Home's answer to these is recorded
  // here: the same with the switch on or off, `no-store`, and with the switch
  // off nothing about any journal.
  it("answers a POST that could be a Server Action the same with the switch on or off", async () => {
    const shapes: [string, RequestInit][] = [
      [
        "a form body",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "name=x",
        },
      ],
      [
        "a multipart body",
        {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data; boundary=refrain",
          },
          body: '--refrain\r\nContent-Disposition: form-data; name="x"\r\n\r\ny\r\n--refrain--\r\n',
        },
      ],
      [
        "an unknown action",
        {
          method: "POST",
          headers: {
            "next-action": "0".repeat(42),
            "content-type": "text/plain;charset=UTF-8",
          },
          body: "[]",
        },
      ],
    ];
    for (const [name, init] of shapes) {
      const enabled = await home(on, init);
      const disabled = await home(off, init);
      console.log(`POST / with ${name}: ${enabled.status}`);
      expect(enabled.headers["cache-control"], name).toContain("no-store");
      expect(disabled.status, name).toBe(enabled.status);
      expect(disabled.body, name).not.toContain(prefix);
      for (const listed of [
        "Grace",
        ...HOME_SHELF.map((album) => album.title),
      ]) {
        expect(disabled.body, `${name}: ${listed}`).not.toContain(listed);
      }
      for (const title of HIDDEN_TITLES) {
        expect(enabled.body, `${name}: ${title}`).not.toContain(title);
      }
    }
  });

  // The build's own files for the Home are named `index…`; on `next start`
  // they are not addresses (a hosted platform's minimal mode may differ, a G2
  // check). Each answers the same with the switch on or off, `no-store`, and
  // names no journal.
  it("answers the build's index addresses the same with the switch on or off", async () => {
    for (const path of [
      "/index",
      "/index.html",
      "/index.rsc",
      "/index.segments/_tree.segment.rsc",
      "/index.segments/__PAGE__.segment.rsc",
    ]) {
      const enabled = await request(on.baseURL, path);
      const disabled = await request(off.baseURL, path);
      console.log(`${path}: ${enabled.status}`);
      expect(masked(disabled, []), path).toEqual(masked(enabled, []));
      expect(enabled.headers["cache-control"], path).toContain("no-store");
      expect(enabled.body, path).not.toContain(prefix);
      expect(enabled.body, path).not.toContain("Pink Moon");
    }
  });

  // ADR 0006 A2: the framework's cache marker only on a generic build
  // artifact, and nothing about a journal written to the server's disk.
  it("carries the cache marker only on the Home's own build files, and writes no journal to disk", async () => {
    const app = ".next/server/app";
    const built = [
      readFileSync(join(app, "index.html"), "utf8"),
      ...readdirSync(join(app, "index.segments"), { recursive: true })
        .map((name) => join(app, "index.segments", String(name)))
        .filter((file) => /\.rsc$/.test(file))
        .map((file) => readFileSync(file, "utf8")),
    ];
    let marked = 0;
    for (const [name, init] of FORMS) {
      for (const server of [on, off]) {
        const answer = await home(server, init);
        if (answer.headers["x-nextjs-cache"] !== undefined) {
          marked += 1;
          expect(answer.headers["cache-control"], name).toBe("no-store");
          expect(
            answer.body === "" || built.includes(answer.body),
            `${name}: a marked response that is not a build file`,
          ).toBe(true);
        }
      }
    }
    console.log(`Home responses with the cache marker: ${marked}`);
    expect(
      filesContaining(".next", [
        prefix,
        ...HIDDEN_TITLES,
        ...HOME_SHELF.map((album) => album.title),
      ]),
    ).toEqual([]);
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

    // And with the switch off, none of it ever showed, in any form.
    expect(readerView(await home(off))).toEqual(emptyOff);
    await expectEmptySiteWhileOff();
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

// M3.8b (A6): public memories and artists, with every hidden memory state and
// every hidden artist reason beside them (the M3.7 and M3.5 fixtures).
describe("with memories and artists (A6)", () => {
  beforeAll(async () => {
    artists = await seedArtistPages(client, artistPrefix);
    memories = await seedMemories(client, memoryPrefix);
    hiddenSlugs.push(
      ...memories.hidden.map((hidden) => hidden.slug),
      // Previous addresses: the Home links only the current one.
      memories.shown.previousSlug,
      memories.shown.neverPublicSlug,
      memories.hiddenPreviousSlug,
    );
  }, 60_000);

  /** Every address a page links to, outside scripts. */
  const linksIn = (body: string) =>
    [
      ...new Set(
        [
          ...body
            .replace(/<script[\s\S]*?<\/script>/g, "")
            .matchAll(/href="(\/(?:albums|artists|memories)(?:\/[^"]*)?)"/g),
        ].map((m) => m[1]!),
      ),
    ].sort();

  it("still answers, with the switch off or a near miss, exactly the empty-site baseline, in every request form", async () => {
    await expectEmptySiteWhileOff();
    for (const [name, init] of FORMS) {
      for (const [index, server] of offServers().entries()) {
        const answer = await home(server, init);
        expect(masked(answer, []), `${name}, server ${index}`).toEqual(
          offBaseline.get(`${index}:${name}`),
        );
        for (const listed of [
          PUBLIC_MEMORY.title,
          PUBLIC_MEMORY.firstSong,
          LONG_BAND_NAME,
          "Jeff Buckley",
          "All artists",
          "All memories",
        ]) {
          expect(answer.body, `${name}: ${listed}`).not.toContain(listed);
        }
      }
    }
  });

  it("lists memories and artists in the approved order, with their archive links, each link answering 200", async () => {
    const page = await home(on);
    expect(page.status).toBe(200);
    const text = visibleText(page.body);
    expect(text).toMatch(/Most recent: .+ · (Album journal|Memory) · /);
    expect(text).toContain(PUBLIC_MEMORY.title);
    expect(text).toContain(
      `Memory · ${PUBLIC_MEMORY.firstSong} — ${PUBLIC_MEMORY.albumArtist}`,
    );
    // The sections in the approved order, each "All …" link in its own.
    const order = [
      'id="ph-recent"',
      'id="ph-albums"',
      ">All album journals<",
      'id="ph-artists"',
      ">All artists<",
      'id="ph-memories"',
      ">All memories<",
    ].map((mark) => page.body.indexOf(mark));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The memory card: its "when", its title, the first paragraph only.
    expect(text).toContain(PUBLIC_MEMORY.when);
    expect(text).toContain(PUBLIC_MEMORY.paragraphs[0]);
    // Every link answers 200: entries, artists, and the archives.
    const links = linksIn(page.body);
    for (const archive of ["/albums", "/artists", "/memories"]) {
      expect(links).toContain(archive);
    }
    expect(links.some((link) => link.startsWith("/memories/"))).toBe(true);
    expect(links.some((link) => link.startsWith("/artists/"))).toBe(true);
    for (const link of links) {
      const opened = await request(on.baseURL, link);
      expect(opened.status, link).toBe(200);
    }
    // At most five rows, four albums, three artists, three memories.
    const count = (pattern: RegExp) =>
      [...page.body.replace(/<script[\s\S]*?<\/script>/g, "").matchAll(pattern)]
        .length;
    expect(count(/class="ph-row"/g)).toBeLessThanOrEqual(5);
    expect(count(/class="ph-album"/g)).toBeLessThanOrEqual(4);
    expect(count(/class="ph-artist"/g)).toBe(3);
    expect(count(/class="px-memory"/g)).toBe(3);
  });

  it("never sends a memory's whole writing, an identifier, a photograph, or a hidden artist, in any request form", async () => {
    // Every identifier in the database: every value of every uuid column,
    // and every MusicBrainz identifier, matched in either case, with and
    // without hyphens. A cover's address names its release, so the Cover
    // Art Archive's own URLs are left out of the scanned text.
    const columns = (
      await client.query<{ table_name: string; column_name: string }>(`
        select table_name, column_name from information_schema.columns
         where table_schema = 'public'
           and (data_type = 'uuid' or column_name like 'mb\\_%')`)
    ).rows;
    const ids = new Set<string>();
    for (const { table_name, column_name } of columns) {
      const values = await client.query<{ value: string }>(
        `select distinct "${column_name}"::text as value from "${table_name}"
          where "${column_name}" is not null`,
      );
      for (const { value } of values.rows) {
        if (value.length >= 32) {
          ids.add(value.toLowerCase());
          ids.add(value.toLowerCase().replaceAll("-", ""));
        }
      }
    }
    expect(ids.size).toBeGreaterThan(0);
    for (const [name, init] of FORMS) {
      const answer = await home(on, init);
      const scanned = answer.body
        .replace(/https:\/\/coverartarchive\.org\/[^"\s,]*/g, "")
        .toLowerCase();
      expect(answer.headers["cache-control"], name).toBe("no-store");
      // The second paragraph is past the excerpt: never in HTML or Flight.
      expect(answer.body, name).not.toContain(PUBLIC_MEMORY.paragraphs[1]);
      for (const id of ids) {
        expect(scanned.includes(id), `${name}: ${id}`).toBe(false);
      }
      for (const absent of [
        "thumb.wikimedia.org",
        "upload.wikimedia.org",
        GRACE_ARTIST_PHOTO.credit,
        "Artist journal",
        "Solo artist",
      ]) {
        expect(answer.body, `${name}: ${absent}`).not.toContain(absent);
      }
    }
    // An archived artist is plain text in an album's credits (catalog
    // wording, as on the album journal), never one of the Artists cards.
    const page = (await home(on)).body;
    const artistsSection = page.slice(
      page.indexOf('id="ph-artists"'),
      page.indexOf('id="ph-memories"'),
    );
    expect(artistsSection.length).toBeGreaterThan(0);
    expect(artistsSection).not.toContain(ARTIST_MARKERS.archived);
    // The build's own addresses for the Home, with reads on: no second
    // paragraph and no hidden memory either.
    for (const path of INDEX_PATHS) {
      const answer = await request(on.baseURL, path);
      expect(answer.headers["cache-control"], path).toContain("no-store");
      expect(answer.body, path).not.toContain(PUBLIC_MEMORY.paragraphs[1]);
      for (const marker of MEMORY_MARKER_LIST) {
        expect(answer.body, `${path}: ${marker}`).not.toContain(marker);
      }
    }
    // Nothing about a memory or an artist was written to the server's disk.
    expect(
      filesContaining(".next", [
        memoryPrefix,
        artistPrefix,
        PUBLIC_MEMORY.title,
        PUBLIC_MEMORY.paragraphs[1],
        LONG_BAND_NAME,
        ...MEMORY_MARKER_LIST,
        ...HIDDEN_ONLY_LIST,
      ]),
    ).toEqual([]);
    // The Home's policy is unchanged: no image host for photographs.
    expect((await home(on)).headers["content-security-policy"]).toBe(
      CONTENT_SECURITY_POLICY,
    );
  });

  it("describes the Home and nothing it lists in its metadata", async () => {
    const markup = (await home(on)).body.replace(
      /<script[\s\S]*?<\/script>/g,
      "",
    );
    const head = [...markup.matchAll(/<(meta|title)[^>]*>(?:[^<]*<\/title>)?/g)]
      .map((m) => m[0])
      .join("\n");
    expect(head).toContain("<title>refrain</title>");
    for (const listed of [
      PUBLIC_MEMORY.title,
      "Jeff Buckley",
      LONG_BAND_NAME,
    ]) {
      expect(head, listed).not.toContain(listed);
    }
  });

  it("shows each change on the next request: unpublishing, deleting, restoring, and publishing a memory, and archiving an artist", async () => {
    const shown = memories!.shown;
    const listed = async () => {
      const page = await home(on);
      return { text: visibleText(page.body), links: linksIn(page.body) };
    };
    const memoryLink = `/memories/${shown.slug}`;
    expect((await listed()).links).toContain(memoryLink);

    await unpublishLanguageVersion(
      db(),
      author,
      shown.entryId,
      "en",
      "private",
    );
    let now = await listed();
    expect(now.links).not.toContain(memoryLink);
    expect(now.text).not.toContain(PUBLIC_MEMORY.title);

    await publishForTest(db(), shown.entryId, "en");
    expect((await listed()).links).toContain(memoryLink);

    await deleteMemory(db(), author, shown.entryId);
    expect((await listed()).links).not.toContain(memoryLink);
    // A restore keeps it private.
    await restoreMemory(db(), author, shown.entryId);
    expect((await listed()).links).not.toContain(memoryLink);
    await publishForTest(db(), shown.entryId, "en");
    expect((await listed()).links).toContain(memoryLink);

    // Archiving an artist takes it off the Home at once. Two visible artists
    // are named Jeff Buckley (this file's Grace and the artist fixtures'), so
    // each is at a suffixed address; once one is archived, the other has the
    // bare one, as its page does.
    const archived = artists!.grace.artistId;
    const suffixed = `/artists/jeff-buckley-${artistAddressSuffix(archived)}`;
    expect((await listed()).links).toContain(suffixed);
    expect((await listed()).links).not.toContain("/artists/jeff-buckley");
    await archiveArtist(db(), author, archived);
    now = await listed();
    expect(now.links).not.toContain(suffixed);
    expect(now.links).toContain("/artists/jeff-buckley");
    expect((await request(on.baseURL, "/artists/jeff-buckley")).status).toBe(
      200,
    );

    // And with the switch off, none of it ever showed, in any form.
    expect(readerView(await home(off))).toEqual(emptyOff);
    await expectEmptySiteWhileOff();
  });
});

describe("a database failure with reads on", () => {
  it("shows one fixed line in place of the lists, with no detail", async () => {
    const password = `pw-${randomUUID()}`;
    // The server starts without touching the database; only a request does.
    const broken = await startProductionServer({
      withAuthor: false,
      env: {
        REFRAIN_PUBLIC_READS_ENABLED: "true",
        BETTER_AUTH_URL: ORIGIN,
        DATABASE_URL: `postgres://nobody:${password}@127.0.0.1:1/none`,
      },
    });
    servers.push(broken);
    const page = await home(broken);
    expect(page.headers["cache-control"]).toBe("no-store");
    const text = visibleText(page.body);
    expect(text).toContain("The latest writing could not be loaded just now.");
    expect(text).not.toContain("Nothing published yet.");
    expect(text).toContain("some songs take you back.");
    for (const leak of [
      password,
      "ECONNREFUSED",
      "postgres://",
      "127.0.0.1:1",
    ]) {
      expect(page.body, leak).not.toContain(leak);
    }
    expect(readFileSync(broken.serverLog, "utf8")).not.toContain(password);
  });
});
