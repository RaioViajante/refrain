// The cover display switch over real HTTP (docs/security.md § Deployment
// gate, item 6; the design proposed in ADR 0009 § 12), against the production
// build and the disposable test database. One build is served with
// `REFRAIN_COVER_DISPLAY_ENABLED` unset, `false`, `TRUE`, and `true`:
//
// - unless it is exactly `true`, no response names an image host, a stored
//   cover's release, or its image id: not the public pages (the Home, the album
//   archive, an album journal, an artist page) in English and Portuguese and
//   in their transport forms, and not the author's own Studio (the Desk, the
//   albums, an album, its artwork page, the journals, the editor, Add music's
//   edition list and release review), in either language, document or RSC;
// - the Studio's choosing screens list the archive's candidates as text, and
//   the action that chooses a cover is refused (`cover_display_disabled`);
// - exactly `true` shows the same covers as before, which proves the scan can
//   see them;
// - authentication, public reads, and the indexing policy are unchanged, and
//   every stored cover is kept.
//
// Synthetic data only: every row is labelled "[Test]" and removed at the end.
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

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
import { FIXTURE } from "@/testing/provider-fixtures";
import {
  removeSeededArtists,
  seedArtistPages,
  type SeededArtists,
} from "@/testing/public-artists";
import { request, type Snapshot } from "@/testing/public-http";
import { forms } from "@/testing/public-request-forms";
import { runPrefix, type SeededJournal } from "@/testing/public-journals";
import { assertDisposableTestDatabase } from "@/testing/test-database";

const commandEnv = inject("studioCommandEnv");
const secret = commandEnv.BETTER_AUTH_SECRET!;
const databaseUrl = commandEnv.DATABASE_URL!;
const prefix = runPrefix();
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();

/** The values that leave covers off; a key means the variable is unset. */
const OFF_VALUES = { unset: undefined, false: "false", nearMiss: "TRUE" };

let client: Client;
let author: MintedSession;
let artists: SeededArtists;
let artistAddress = "";
const servers: ProductionServer[] = [];
const off: Record<keyof typeof OFF_VALUES, ProductionServer> = {} as Record<
  keyof typeof OFF_VALUES,
  ProductionServer
>;
let on: ProductionServer;
/** Public reads off, covers on: still nothing public. */
let readsOff: ProductionServer;

/** The stored cover of each seeded album, keyed by album id. */
const stored = new Map<string, { release: string; image: string }>();
const coverOf = (albumId: string) => {
  const { release, image } = stored.get(albumId)!;
  return `https://coverartarchive.org/release/${release}/${image}`;
};
/** The album, unpublished and linked to MusicBrainz, with a chooser. */
let chooser: SeededJournal;

async function start(env: Record<string, string | undefined>) {
  // The same session secret and database as the shared server, so the
  // author's minted session opens the Studio on every one of them.
  const server = await startProductionServer({
    withAuthor: false,
    env: { BETTER_AUTH_SECRET: secret, ...env },
  });
  servers.push(server);
  return server;
}

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-cover-display-tests",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  artists = await seedArtistPages(client, `${prefix}c`);
  const albums = [
    artists.grace,
    artists.sketches,
    artists.long,
    artists.broken,
    ...artists.hidden,
  ];
  for (const [index, journal] of albums.entries()) {
    // A synthetic release and image for each, so a scan can name them.
    const release = `c0ffee00-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const image = `98765432${String(index + 10)}`;
    stored.set(journal.albumId, { release, image });
    await client.query(
      "update albums set cover_url = $1, cover_source = 'Cover Art Archive' where id = $2",
      [
        `https://coverartarchive.org/release/${release}/${image}`,
        journal.albumId,
      ],
    );
  }
  // An album no published journal shows, linked to the fixtures' release
  // group, so its artwork page lists the archive's candidates.
  chooser = artists.hidden[0]!;
  await client.query(
    "update albums set mb_release_group_id = $1 where id = $2",
    [FIXTURE.paperMoon, chooser.albumId],
  );
  author = await mintAuthorSession(client, secret);

  for (const [name, value] of Object.entries(OFF_VALUES)) {
    off[name as keyof typeof OFF_VALUES] = await start({
      REFRAIN_PUBLIC_READS_ENABLED: "true",
      REFRAIN_COVER_DISPLAY_ENABLED: value,
    });
  }
  on = await start({
    REFRAIN_PUBLIC_READS_ENABLED: "true",
    REFRAIN_COVER_DISPLAY_ENABLED: "true",
  });
  readsOff = await start({ REFRAIN_COVER_DISPLAY_ENABLED: "true" });
  const archive = (await request(on.baseURL, "/artists")).body;
  artistAddress = /href="\/artists\/([^"]+)"/.exec(archive)![1]!;
}, 240_000);

afterAll(async () => {
  for (const server of servers) {
    await server.stop().catch(() => undefined);
  }
  try {
    await client.query(
      "update albums set mb_release_group_id = null where id = $1",
      [chooser?.albumId],
    );
    await removeMintedSessions(client);
    await removeSeededArtists(client, artists, `${prefix}c`);
  } finally {
    await client.end();
  }
}, 120_000);

/**
 * Runs `work` while the chooser album is not linked to the fixtures' release
 * group, so that Add music's release review offers the release for import
 * (with its covers) instead of a link to the album already in the catalog.
 */
async function withChooserUnlinked(work: () => Promise<void>) {
  await client.query(
    "update albums set mb_release_group_id = null where id = $1",
    [chooser.albumId],
  );
  try {
    await work();
  } finally {
    await client.query(
      "update albums set mb_release_group_id = $1 where id = $2",
      [FIXTURE.paperMoon, chooser.albumId],
    );
  }
}

/** What must never be in a response while covers are off. */
function storedMarkers(): string[] {
  return [
    "coverartarchive.org",
    "archive.org",
    ...[...stored.values()].flatMap(({ release, image }) => [release, image]),
  ];
}

function expectNoCover(response: Snapshot, what: string) {
  for (const marker of storedMarkers()) {
    expect(response.body.includes(marker), `${what}: ${marker}`).toBe(false);
  }
  // Nor in any header but the Content-Security-Policy, which lists the hosts
  // a page may load and is the same whatever the switch says.
  for (const [name, value] of Object.entries(response.headers)) {
    if (name === "content-security-policy") {
      continue;
    }
    expect(String(value), `${what}: header ${name}`).not.toMatch(
      /archive\.org/,
    );
  }
}

function expectNoindex(response: Snapshot, what: string) {
  expect(response.headers["x-robots-tag"], what).toBe(ROBOTS_DIRECTIVE);
}

function both(path: string): string[] {
  return [path, path === "/" ? "/pt" : `/pt${path}`];
}

function publicPaths(): string[] {
  return [
    ...both("/"),
    ...both("/albums"),
    ...both(`/albums/${artists.grace.slug}`),
    ...both(`/albums/${artists.sketches.slug}`),
    ...both(`/artists/${artistAddress}`),
    ...both("/artists"),
    ...both("/memories"),
    "/sitemap.xml",
  ];
}

function studioPaths(): string[] {
  return [
    "/studio",
    "/studio/albums",
    `/studio/albums/${chooser.albumId}`,
    `/studio/albums/${chooser.albumId}/artwork`,
    `/studio/albums/${artists.grace.albumId}`,
    `/studio/albums/${artists.grace.albumId}/artwork`,
    "/studio/journals",
    `/studio/journals/${artists.grace.entryId}`,
    `/studio/journals/${artists.grace.entryId}/edit`,
    `/studio/journals/new?album=${chooser.albumId}`,
    "/studio/journals/deleted",
    "/studio/catalog/add",
    `/studio/catalog/add/album/${FIXTURE.paperMoon}`,
    `/studio/catalog/add/release/${FIXTURE.firstPressing}`,
  ].flatMap((path) => [path, `/pt${path}`]);
}

describe("with the switch anything but exactly `true`", () => {
  it("no public page or transport form names a cover, in English or Portuguese, and the fallback frame is shown", async () => {
    for (const [name, server] of Object.entries(off)) {
      for (const path of publicPaths()) {
        const what = `${name} ${path}`;
        const page = await request(server.baseURL, path);
        expect(page.status, what).toBe(200);
        expectNoCover(page, what);
        expectNoindex(page, what);
        const rsc = await request(server.baseURL, path, { rsc: true });
        expectNoCover(rsc, `${what} _rsc`);
      }
      const journal = await request(
        server.baseURL,
        `/albums/${artists.grace.slug}`,
      );
      expect(journal.body).not.toMatch(/<img\b[^>]*coverartarchive/);
      expect(journal.body).toMatch(
        /Album artwork for [^"]*: not available yet/,
      );
      const portuguese = await request(
        server.baseURL,
        `/pt/albums/${artists.grace.slug}`,
      );
      expect(portuguese.body).not.toMatch(/<img\b[^>]*coverartarchive/);
      for (const [label, path, headers] of forms(artists.grace.slug, buildId)) {
        for (const form of [path, `/pt${path}`]) {
          const got = await request(server.baseURL, form, { headers });
          expectNoCover(got, `${name} ${label} ${form}`);
        }
      }
    }
  });

  it("the author's own Studio names no cover either, document or RSC, in both languages, and still works", async () => {
    for (const [name, server] of Object.entries(off)) {
      for (const path of studioPaths()) {
        const what = `${name} ${path}`;
        const page = await request(server.baseURL, path, {
          headers: { cookie: author.cookie },
        });
        expect(page.status, what).toBe(200);
        expect(page.body, what).not.toContain("NEXT_REDIRECT");
        expectNoCover(page, what);
        expectNoindex(page, what);
        const rsc = await request(server.baseURL, path, {
          rsc: true,
          headers: { cookie: author.cookie },
        });
        expectNoCover(rsc, `${what} _rsc`);
      }
    }
  });

  it("the choosing screens list the candidates as text and offer no choice, and say a cover is stored", async () => {
    const server = off.unset;
    for (const [language, words] of [
      [
        "",
        {
          off: "Covers are turned off here",
          candidate: "Front cover 1: image ",
          stored: "A cover is chosen. Covers are turned off here",
          use: "Use this cover",
          releaseOff:
            "so no cover can be chosen, and the album is added without one",
        },
      ],
      [
        "/pt",
        {
          off: "As capas estão desativadas aqui",
          candidate: "Capa frontal 1: imagem ",
          stored: "Há uma capa escolhida. As capas estão desativadas aqui",
          use: "Usar esta capa",
          releaseOff: "e o álbum é adicionado sem capa",
        },
      ],
    ] as const) {
      const artwork = await request(
        server.baseURL,
        `${language}/studio/albums/${chooser.albumId}/artwork`,
        { headers: { cookie: author.cookie } },
      );
      expect(artwork.body).toContain(words.off);
      expect(artwork.body).toContain(words.candidate);
      expect(artwork.body).toContain(words.stored);
      expect(artwork.body).not.toContain(words.use);
      expect(artwork.body).not.toMatch(/<img\b/);

      await withChooserUnlinked(async () => {
        for (const rsc of [false, true]) {
          const release = await request(
            server.baseURL,
            `${language}/studio/catalog/add/release/${FIXTURE.firstPressing}`,
            { rsc, headers: { cookie: author.cookie } },
          );
          expectNoCover(release, `release review ${language} ${rsc}`);
          if (!rsc) {
            expect(release.body).toContain(words.releaseOff);
            expect(release.body).toContain(words.candidate);
            expect(release.body).not.toMatch(/name="cover"/);
          }
        }
      });
    }
  });

  it("refuses a cover choice, writes nothing, and keeps every stored cover", async () => {
    for (const [name, server] of Object.entries(off)) {
      const result = await action(
        server.baseURL,
        "setAlbumArtworkAction",
        {
          albumId: chooser.albumId,
          releaseId: FIXTURE.firstPressing,
          imageId: FIXTURE.frontImage,
          expectedCover: null,
        },
        chooser.albumId,
      );
      expect(result, name).toEqual({
        ok: false,
        code: "cover_display_disabled",
      });
    }
    await expectStoredCoversKept();
  });
});

describe("with the switch exactly `true`", () => {
  it("shows the stored covers on the public pages and in the Studio, as before", async () => {
    const grace = coverOf(artists.grace.albumId);
    for (const path of both(`/albums/${artists.grace.slug}`)) {
      const page = await request(on.baseURL, path);
      expect(page.body, path).toContain(`src="${grace}-500.jpg"`);
      expectNoindex(page, path);
    }
    for (const path of both("/")) {
      expect((await request(on.baseURL, path)).body, path).toContain(
        "coverartarchive.org/release/",
      );
    }
    for (const path of [
      `/studio/albums/${chooser.albumId}/artwork`,
      `/pt/studio/albums/${chooser.albumId}/artwork`,
    ]) {
      const page = await request(on.baseURL, path, {
        headers: { cookie: author.cookie },
      });
      expect(page.body, path).toContain(`${coverOf(chooser.albumId)}-500.jpg`);
      // The stored address itself is never sent: only image sources.
      expect(page.body, path).not.toContain(`${coverOf(chooser.albumId)}"`);
      expect(page.body, path).toMatch(/<img\b/);
    }
    const editions = await request(
      on.baseURL,
      `/studio/catalog/add/album/${FIXTURE.paperMoon}`,
      { headers: { cookie: author.cookie } },
    );
    expect(editions.body).toContain("/front-250");
    await withChooserUnlinked(async () => {
      const release = await request(
        on.baseURL,
        `/studio/catalog/add/release/${FIXTURE.firstPressing}`,
        { headers: { cookie: author.cookie } },
      );
      expect(release.body).toContain(
        `https://coverartarchive.org/release/${FIXTURE.firstPressing}/${FIXTURE.frontImage}-500.jpg`,
      );
      expect(release.body).toMatch(/name="cover"/);
    });
  });

  it("reaches the command past the switch: a stale view is refused as before, and nothing is written", async () => {
    const result = await action(
      on.baseURL,
      "setAlbumArtworkAction",
      {
        albumId: chooser.albumId,
        releaseId: FIXTURE.firstPressing,
        imageId: FIXTURE.frontImage,
        // The author's view said no cover; one is stored.
        expectedCover: null,
      },
      chooser.albumId,
    );
    expect(result).toEqual({ ok: false, code: "stale" });
    await expectStoredCoversKept();
  });

  it("still shows nothing public while public reads are off", async () => {
    for (const path of [
      `/albums/${artists.grace.slug}`,
      `/pt/albums/${artists.grace.slug}`,
      "/albums",
      `/artists/${artistAddress}`,
    ]) {
      const page = await request(readsOff.baseURL, path);
      expect(page.status, path).toBe(404);
      expectNoCover(page, path);
      expectNoindex(page, path);
    }
    const home = await request(readsOff.baseURL, "/");
    expect(home.status).toBe(200);
    expectNoCover(home, "/");
  });
});

describe("authentication, whatever the switch says", () => {
  it("still sends a visitor to sign-in, shows no cover, and refuses a visitor's action", async () => {
    for (const server of [...Object.values(off), on]) {
      for (const language of ["", "/pt"]) {
        const page = await request(
          server.baseURL,
          `${language}/studio/albums/${chooser.albumId}/artwork`,
        );
        expect(page.body).toContain(
          `NEXT_REDIRECT;replace;${language}/studio/sign-in;307;`,
        );
        expectNoCover(page, `visitor ${language}`);
        expectNoindex(page, `visitor ${language}`);
      }
      const result = await action(
        server.baseURL,
        "setAlbumArtworkAction",
        {
          albumId: chooser.albumId,
          releaseId: FIXTURE.firstPressing,
          imageId: FIXTURE.frontImage,
          expectedCover: null,
        },
        chooser.albumId,
        null,
      );
      expect(result).toEqual({ ok: false, code: "unauthorized" });
    }
    await expectStoredCoversKept();
  });
});

async function expectStoredCoversKept() {
  for (const albumId of stored.keys()) {
    const { rows } = await client.query<{
      cover_url: string | null;
      cover_source: string | null;
    }>("select cover_url, cover_source from albums where id = $1", [albumId]);
    expect(rows[0], albumId).toEqual({
      cover_url: coverOf(albumId),
      cover_source: "Cover Art Archive",
    });
  }
}

function actionId(name: string): { id: string; route: string } {
  const manifest = JSON.parse(
    readFileSync(".next/server/server-reference-manifest.json", "utf8"),
  ) as {
    node: Record<
      string,
      { workers: Record<string, unknown>; exportedName: string }
    >;
  };
  for (const [id, entry] of Object.entries(manifest.node)) {
    if (entry.exportedName === name) {
      const page = Object.keys(entry.workers).sort()[0]!;
      return {
        id,
        route: page.replace(/^app\/\(en\)/, "").replace(/\/page$/, ""),
      };
    }
  }
  throw new Error(`No server action named ${name}.`);
}

/** Calls a Server Action as the Studio does, with the author's session. */
async function action(
  base: string,
  name: string,
  input: unknown,
  routeId: string,
  cookie: string | null = author.cookie,
): Promise<unknown> {
  const { id, route } = actionId(name);
  const response = await fetch(`${base}${route.replace("[id]", routeId)}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: base,
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      "next-action": id,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify([input]),
  });
  const text = await response.text();
  expect(text).not.toContain("coverartarchive.org");
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    try {
      const value: unknown = JSON.parse(line.slice(colon + 1));
      if (typeof value === "object" && value !== null && "ok" in value) {
        return value;
      }
    } catch {
      // Not the result line.
    }
  }
  throw new Error(`No action result:\n${text.slice(0, 300)}`);
}
