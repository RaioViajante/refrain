// Removing an album's cover over real HTTP (ADR 0006 A8), against the
// production build and the disposable test database, on two servers of one
// build: public reads on, with the cover display switch on, and with it
// unset (off). The removal is the cover takedown:
//
// - the artwork page offers it whenever a cover is stored, in every state
//   (a published journal shows the album, the album is archived, it is not
//   linked to MusicBrainz) and with the switch on or off, in English and
//   Portuguese; the album's page links to it;
// - the action removes a cover while a journal is served, for an archived
//   album, and with the switch off, and the public page then shows the
//   fallback frame, in English and Portuguese, still served (`200`);
// - a stale view is refused, a repeated removal succeeds, and a visitor is
//   refused with nothing written.
//
// Synthetic data only: every row is labelled "[Test]" and removed at the end.
import { createHash } from "node:crypto";
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
import {
  removeSeededArtists,
  seedArtistPages,
  type SeededArtists,
} from "@/testing/public-artists";
import { request } from "@/testing/public-http";
import { runPrefix, type SeededJournal } from "@/testing/public-journals";
import { assertDisposableTestDatabase } from "@/testing/test-database";

const commandEnv = inject("studioCommandEnv");
const secret = commandEnv.BETTER_AUTH_SECRET!;
const databaseUrl = commandEnv.DATABASE_URL!;
const prefix = runPrefix();

let client: Client;
let author: MintedSession;
let artists: SeededArtists;
const servers: ProductionServer[] = [];
let on: ProductionServer;
let off: ProductionServer;

/** A published journal's album. */
let published: SeededJournal;
/** A published journal's album, archived (its page is still served). */
let archived: SeededJournal;
/** A private journal's album, not linked to MusicBrainz. */
let unlinked: SeededJournal;
/** A private journal's album, archived. */
let archivedPrivate: SeededJournal;

function coverOf(index: number) {
  const release = `dec0de00-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const image = `5550001${index}`;
  return {
    release,
    image,
    url: `https://coverartarchive.org/release/${release}/${image}`,
  };
}
const covers = new Map<string, ReturnType<typeof coverOf>>();
const stateOf = (albumId: string) =>
  createHash("sha256")
    .update(`refrain:cover:${covers.get(albumId)!.url}`)
    .digest("hex");

async function start(env: Record<string, string | undefined>) {
  const server = await startProductionServer({
    withAuthor: false,
    env: { BETTER_AUTH_SECRET: secret, ...env },
  });
  servers.push(server);
  return server;
}

async function setCover(journal: SeededJournal, index: number) {
  const cover = coverOf(index);
  covers.set(journal.albumId, cover);
  await client.query(
    "update albums set cover_url = $1, cover_source = 'Cover Art Archive' where id = $2",
    [cover.url, journal.albumId],
  );
}

async function storedCover(albumId: string) {
  const { rows } = await client.query<{
    cover_url: string | null;
    cover_source: string | null;
  }>("select cover_url, cover_source from albums where id = $1", [albumId]);
  return rows[0];
}

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-cover-removal-tests",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  artists = await seedArtistPages(client, `${prefix}r`);
  published = artists.grace;
  archived = artists.sketches;
  unlinked = artists.hidden[0]!;
  archivedPrivate = artists.hidden[1]!;
  await setCover(published, 1);
  await setCover(archived, 2);
  await setCover(unlinked, 3);
  await setCover(artists.long, 4);
  await setCover(archivedPrivate, 5);
  await client.query(
    "update albums set archived_at = now() where id = any($1)",
    [[archived.albumId, archivedPrivate.albumId]],
  );
  author = await mintAuthorSession(client, secret);
  on = await start({
    REFRAIN_PUBLIC_READS_ENABLED: "true",
    REFRAIN_COVER_DISPLAY_ENABLED: "true",
  });
  off = await start({ REFRAIN_PUBLIC_READS_ENABLED: "true" });
}, 240_000);

afterAll(async () => {
  for (const server of servers) {
    await server.stop().catch(() => undefined);
  }
  try {
    await client.query(
      "update albums set archived_at = null where id = any($1)",
      [[archived?.albumId, archivedPrivate?.albumId].filter(Boolean)],
    );
    await removeMintedSessions(client);
    await removeSeededArtists(client, artists, `${prefix}r`);
  } finally {
    await client.end();
  }
}, 120_000);

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

/** Calls the removal as the Studio does, with the author's session or none. */
async function remove(
  base: string,
  albumId: string,
  expectedCover: string | null,
  cookie: string | null = author.cookie,
): Promise<unknown> {
  const { id, route } = actionId("removeAlbumArtworkAction");
  const response = await fetch(`${base}${route.replace("[id]", albumId)}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: base,
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      "next-action": id,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify([{ albumId, expectedCover }]),
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

const WORDS = {
  "": {
    remove: "Remove artwork…",
    onPublicPage: "Shown on a public page",
    publicPanel: "You can still remove the cover above.",
    archivedPanel: "This album is archived. Restore it to choose a cover.",
    notLinked: "Not linked to MusicBrainz",
    question: "Remove this album’s artwork?",
    fallback: /Album artwork for [^"<]*: not available yet/,
  },
  "/pt": {
    remove: "Remover a capa…",
    onPublicPage: "Exibido numa página pública",
    publicPanel: "Você ainda pode remover a capa acima.",
    archivedPanel:
      "Este álbum está arquivado. Restaure-o para escolher uma capa.",
    notLinked: "Não vinculado ao MusicBrainz",
    question: "Remover a capa deste álbum?",
    fallback: /Capa do álbum [^"<]*: ainda não disponível/,
  },
} as const;

function expectNoCoverOf(body: string, albumId: string, what: string) {
  const { release, image } = covers.get(albumId)!;
  expect(body.includes(release), `${what}: release`).toBe(false);
  expect(body.includes(image), `${what}: image`).toBe(false);
}

describe("the artwork page", () => {
  it("offers the removal in every state, with the switch on or off, in English and Portuguese", async () => {
    for (const server of [on, off]) {
      for (const [language, w] of Object.entries(WORDS)) {
        for (const [journal, panel] of [
          [published, w.publicPanel],
          // Archived, but its journal is served: the public-page panel.
          [archived, w.publicPanel],
          [archivedPrivate, w.archivedPanel],
          [unlinked, w.notLinked],
        ] as const) {
          const path = `${language}/studio/albums/${journal.albumId}/artwork`;
          const what = `${server === on ? "on" : "off"} ${path}`;
          const page = await request(server.baseURL, path, {
            headers: { cookie: author.cookie },
          });
          expect(page.status, what).toBe(200);
          expect(page.body, what).toContain(w.remove);
          expect(page.body, what).toContain(panel);
          expect(page.headers["x-robots-tag"], what).toBe(ROBOTS_DIRECTIVE);
          // The confirmation is closed until asked for.
          expect(page.body, what).not.toMatch(/<dialog[^>]*\bopen\b/);
        }
        // The album's page links to the artwork page, even unlinked.
        const album = await request(
          server.baseURL,
          `${language}/studio/albums/${unlinked.albumId}`,
          { headers: { cookie: author.cookie } },
        );
        expect(album.body).toContain(
          `href="${language}/studio/albums/${unlinked.albumId}/artwork"`,
        );
      }
    }
  });
});

describe("removing a cover", () => {
  it("is refused to a visitor, with nothing written", async () => {
    for (const server of [on, off]) {
      expect(
        await remove(
          server.baseURL,
          published.albumId,
          stateOf(published.albumId),
          null,
        ),
      ).toEqual({ ok: false, code: "unauthorized" });
    }
    expect((await storedCover(published.albumId))!.cover_url).toBe(
      covers.get(published.albumId)!.url,
    );
  });

  it("takes a served journal's cover down with the switch off, and its page shows the fallback in both languages", async () => {
    const cover = covers.get(published.albumId)!;
    // Shown before, on the server where covers are on.
    for (const language of Object.keys(WORDS)) {
      const page = await request(
        on.baseURL,
        `${language}/albums/${published.slug}`,
      );
      expect(page.status).toBe(200);
      expect(page.body).toContain(`${cover.url}-500.jpg`);
    }

    // A view of another cover is refused.
    expect(await remove(off.baseURL, published.albumId, null)).toEqual({
      ok: false,
      code: "stale",
    });
    expect(
      await remove(off.baseURL, published.albumId, stateOf(published.albumId)),
    ).toMatchObject({ ok: true });
    expect(await storedCover(published.albumId)).toEqual({
      cover_url: null,
      cover_source: null,
    });
    // Repeated: nothing left to remove, and no error.
    expect(
      await remove(on.baseURL, published.albumId, stateOf(published.albumId)),
    ).toMatchObject({ ok: true });

    for (const server of [on, off]) {
      for (const [language, w] of Object.entries(WORDS)) {
        const path = `${language}/albums/${published.slug}`;
        const what = `${server === on ? "on" : "off"} ${path}`;
        const page = await request(server.baseURL, path);
        // Still served: nothing was unpublished.
        expect(page.status, what).toBe(200);
        expect(page.body, what).toMatch(w.fallback);
        expectNoCoverOf(page.body, published.albumId, what);
        const rsc = await request(server.baseURL, path, { rsc: true });
        expectNoCoverOf(rsc.body, published.albumId, `${what} _rsc`);
        for (const listing of [language || "/", `${language}/albums`]) {
          const list = await request(server.baseURL, listing);
          expect(list.status, listing).toBe(200);
          expectNoCoverOf(list.body, published.albumId, `${what} ${listing}`);
          expect(list.body, listing).toContain(published.slug);
        }
        // The artwork page no longer offers it, and says there is none.
        const artwork = await request(
          server.baseURL,
          `${language}/studio/albums/${published.albumId}/artwork`,
          { headers: { cookie: author.cookie } },
        );
        expect(artwork.body, what).not.toContain(w.remove);
        // The panel says why no cover can be chosen, and no longer offers a
        // removal there is nothing for.
        expect(artwork.body, what).toContain(w.onPublicPage);
        expect(artwork.body, what).not.toContain(w.publicPanel);
      }
    }
    expect(
      (
        await client.query<{ status: string }>(
          "select status from entry_texts where entry_id = $1 and locale = 'en'",
          [published.entryId],
        )
      ).rows[0]!.status,
    ).toBe("published");
  });

  it("takes an archived album's cover down while its journal is served", async () => {
    const before = await request(on.baseURL, `/albums/${archived.slug}`);
    expect(before.status).toBe(200);
    expect(before.body).toContain(
      `${covers.get(archived.albumId)!.url}-500.jpg`,
    );

    expect(
      await remove(on.baseURL, archived.albumId, stateOf(archived.albumId)),
    ).toMatchObject({ ok: true });
    expect(await storedCover(archived.albumId)).toEqual({
      cover_url: null,
      cover_source: null,
    });
    const archivedRow = await client.query<{ archived: boolean }>(
      "select archived_at is not null as archived from albums where id = $1",
      [archived.albumId],
    );
    expect(archivedRow.rows[0]!.archived).toBe(true);
    for (const [language, w] of Object.entries(WORDS)) {
      const page = await request(
        on.baseURL,
        `${language}/albums/${archived.slug}`,
      );
      expect(page.status).toBe(200);
      expect(page.body).toMatch(w.fallback);
      expectNoCoverOf(page.body, archived.albumId, language);
    }
  });

  it("takes a private album's cover down too, and leaves the other albums' covers", async () => {
    expect(
      await remove(off.baseURL, unlinked.albumId, stateOf(unlinked.albumId)),
    ).toMatchObject({ ok: true });
    expect(await storedCover(unlinked.albumId)).toEqual({
      cover_url: null,
      cover_source: null,
    });
    // Another album's cover is untouched, and still shown.
    const other = covers.get(artists.long.albumId)!;
    expect(await storedCover(artists.long.albumId)).toEqual({
      cover_url: other.url,
      cover_source: "Cover Art Archive",
    });
    const page = await request(on.baseURL, `/albums/${artists.long.slug}`);
    expect(page.body).toContain(`${other.url}-500.jpg`);
  });
});
