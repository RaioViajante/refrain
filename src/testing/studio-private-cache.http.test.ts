// F-01: every studio and authentication response is kept by no cache, and the
// author's private data reaches only the author's own session.
//
// On Vercel the studio's documents are partially prerendered: the generic
// shell comes from the platform's cache and the author's data is streamed
// into the same response, which the platform answered with
// `public, max-age=0, must-revalidate` (F-01, issue #63). The fix sets
// `private, no-store, max-age=0, must-revalidate` on every studio and
// authentication path in next.config.ts. These tests hold the production build
// (`next start`) to it for every request form, three kinds of visitor, and any
// order of requests; the header routes that Vercel receives are checked from
// the same configuration in src/next-config.test.ts. What `next start` cannot
// show, the platform's own precedence, is verified on the hosted deployment
// (docs/security.md#studio-responses).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

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
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
} from "@/testing/fixtures";
import { fixtureDatabase } from "@/testing/public-journals";
import { assertDisposableTestDatabase } from "@/testing/test-database";

const base = inject("studioBaseURL");
const commandEnv = inject("studioCommandEnv");

// Unique to this run: finding any of them in a response that is not the
// author's own is a leak.
const run = randomUUID().slice(0, 8);
const MARKERS = {
  artist: `[Test] F01 ${run} private artist`,
  album: `[Test] F01 ${run} private album`,
  writing: `[Test] F01 ${run} private writing`,
};
const MARKER_LIST = Object.values(MARKERS);

let db: Client;
let author: MintedSession;
// A second production server on the same build and database, with the same
// secret, whose configured author is someone else: the real author's session
// is a valid session of the wrong author there (`not_author`). No second
// account is created; the database allows exactly one.
let otherServer: ProductionServer;
let ids: {
  artistId: string;
  albumId: string;
  trackIds: string[];
  entryId: string;
};

type Visitor = "author" | "anonymous" | "wrong-author";
const VISITORS: Visitor[] = ["author", "anonymous", "wrong-author"];

function originOf(visitor: Visitor): string {
  return visitor === "wrong-author" ? otherServer.baseURL : base;
}

function cookieOf(visitor: Visitor): Record<string, string> {
  return visitor === "anonymous" ? {} : { cookie: author.cookie };
}

// The request forms a browser, the router, or a cache can send for a page.
const FORMS: Record<string, Record<string, string>> = {
  document: {},
  rsc: { rsc: "1" },
  prefetch: { rsc: "1", "next-router-prefetch": "1" },
  "segment prefetch": {
    rsc: "1",
    "next-router-prefetch": "1",
    "next-router-segment-prefetch": "/_tree",
  },
};

function pages(): string[] {
  return [
    "/studio",
    "/studio/artists",
    `/studio/artists/${ids.artistId}`,
    "/studio/albums",
    `/studio/albums/${ids.albumId}`,
    "/studio/journals",
    `/studio/journals/${ids.entryId}`,
    "/studio/journals/deleted",
    "/studio/sign-in",
    // Not found, below the studio.
    "/studio/no-such-page",
    `/studio/artists/00000000-0000-4000-8000-000000000000`,
  ];
}

// The desk's transport files, which sit beside `/studio`, not under it.
// `next start` answers these addresses with its not-found view (the router
// asks with headers instead); Vercel serves the build's files at them, so
// studio-build-output.http.test.ts checks every generated one against the
// compiled header routes.
const TRANSPORT_FILES = [
  "/studio.rsc",
  "/studio.prefetch.rsc",
  "/studio.segments/_tree.segment.rsc",
  "/studio/artists.segments/_tree.segment.rsc",
];

interface Answer {
  status: number;
  cacheControl: string;
  body: string;
  location: string | null;
}

async function ask(
  visitor: Visitor,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
  origin = originOf(visitor),
): Promise<Answer> {
  const send = (url: string) =>
    fetch(url, {
      method,
      redirect: "manual",
      headers: { ...headers, ...cookieOf(visitor) },
    });
  let response = await send(`${origin}${path}`);
  // The router's requests are first redirected to the same address with the
  // `_rsc` cache-busting parameter, which the browser always sends. That
  // redirect is a response too, so its policy is checked before following it.
  const location = response.headers.get("location");
  if (
    response.status === 307 &&
    location &&
    new URL(location, origin).pathname === path.split("?")[0]
  ) {
    expectPrivate(response.headers.get("cache-control"), `${path} hop`);
    await response.body?.cancel();
    response = await send(new URL(location, origin).toString());
  }
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control") ?? "",
    body: await response.text(),
    location: response.headers.get("location"),
  };
}

function directivesOf(value: string | null): Set<string> {
  return new Set((value ?? "").split(",").map((directive) => directive.trim()));
}

/** Kept by no cache: not shared, not stored, not reused without asking. */
function expectPrivate(value: string | null, where: string): void {
  expect(directivesOf(value), `${where}: ${value}`).toContain("private");
  expectNotStored(value, where);
}

/** Stored by no cache at all, shared or private (`no-store`). */
function expectNotStored(value: string | null, where: string): void {
  const directives = directivesOf(value);
  expect(directives, `${where}: ${value}`).toContain("no-store");
  for (const forbidden of [
    "public",
    "immutable",
    "stale-while-revalidate",
    "stale-if-error",
  ]) {
    expect(
      [...directives].some((d) => d.startsWith(forbidden)),
      where,
    ).toBe(false);
  }
  expect(value ?? "", where).not.toMatch(/s-maxage/);
  expect(value ?? "", where).not.toMatch(/max-age=[1-9]/);
}

function expectNoMarker(body: string, where: string): void {
  for (const marker of MARKER_LIST) {
    expect(body, `${where} leaked ${marker}`).not.toContain(marker);
  }
}

interface ActionEntry {
  id: string;
  route: string;
}

function serverAction(name: string): ActionEntry {
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
        route: page.replace(/^app\/\(en\)/, "").replace(/\/page$/, "") || "/",
      };
    }
  }
  throw new Error(`The build has no server action named ${name}.`);
}

beforeAll(async () => {
  db = new Client({
    connectionString: commandEnv.DATABASE_URL!,
    application_name: "refrain-http-f01-tests",
  });
  await db.connect();
  await assertDisposableTestDatabase(db);
  author = await mintAuthorSession(db, commandEnv.BETTER_AUTH_SECRET!);
  ids = await fixtureDatabase(db).transaction(async (tx) => {
    const artistId = await createTestArtist(tx, MARKERS.artist);
    const album = await createTestAlbum(tx, {
      title: MARKERS.album,
      artistIds: [artistId],
    });
    const entryId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      versions: [{ locale: "en", status: "private", text: MARKERS.writing }],
      slug: `t${run}-f01-private`,
    });
    return {
      artistId,
      albumId: album.albumId,
      trackIds: album.trackIds,
      entryId,
    };
  });
  otherServer = await startProductionServer({
    withAuthor: false,
    env: {
      BETTER_AUTH_SECRET: commandEnv.BETTER_AUTH_SECRET,
      REFRAIN_AUTHOR_EMAIL: "not-the-author@example.com",
    },
  });
}, 120_000);

afterAll(async () => {
  try {
    await otherServer?.stop();
    if (ids) {
      await db.query("delete from entry_slugs where entry_id = $1", [
        ids.entryId,
      ]);
      await db.query("delete from entries where id = $1", [ids.entryId]);
      // The album first: its track and edition rows go with it, and only
      // then can this run's tracks and artist be deleted (RESTRICT).
      await db.query("delete from albums where id = $1", [ids.albumId]);
      await db.query("delete from tracks where id = any($1)", [ids.trackIds]);
      await db.query("delete from artists where id = $1", [ids.artistId]);
    }
    await removeMintedSessions(db);
  } finally {
    await db.end();
  }
});

describe("the visitors are who the tests say they are", () => {
  it("shows the author's private data to the author, and to no one else", async () => {
    const own = await ask("author", "/studio/artists");
    expect(own.status).toBe(200);
    expect(own.body).toContain(MARKERS.artist);
    const desk = await ask("author", "/studio");
    expect(desk.body).toContain(MARKERS.album);

    for (const visitor of ["anonymous", "wrong-author"] as const) {
      const other = await ask(visitor, "/studio/artists");
      expectNoMarker(other.body, visitor);
      // Both are sent to sign-in, streamed after the generic shell.
      expect(other.body).toContain(
        "NEXT_REDIRECT;replace;/studio/sign-in;307;",
      );
    }
  });
});

describe("every studio response is kept by no cache (F-01)", () => {
  it.each(VISITORS)(
    "for the %s, in every request form of every studio page",
    async (visitor) => {
      for (const path of pages()) {
        for (const [form, headers] of Object.entries(FORMS)) {
          const answer = await ask(visitor, path, headers);
          const where = `${visitor} ${form} ${path} (${answer.status})`;
          expectPrivate(answer.cacheControl, where);
          if (visitor !== "author") {
            expectNoMarker(answer.body, where);
          }
        }
        const head = await ask(visitor, path, {}, "HEAD");
        expectPrivate(head.cacheControl, `${visitor} HEAD ${path}`);
      }
    },
    120_000,
  );

  it.each(VISITORS)(
    "for the %s, on the desk's transport files",
    async (visitor) => {
      for (const path of TRANSPORT_FILES) {
        const answer = await ask(visitor, path);
        const where = `${visitor} ${path} (${answer.status})`;
        expectPrivate(answer.cacheControl, where);
        if (visitor !== "author") {
          expectNoMarker(answer.body, where);
        }
      }
    },
  );

  it("on the authentication endpoints, signed in or not", async () => {
    const own = await ask("author", "/api/auth/get-session");
    expect(own.status).toBe(200);
    expect(own.body).toContain('"session"');
    expectPrivate(own.cacheControl, "get-session (author)");
    const none = await ask("anonymous", "/api/auth/get-session");
    expectPrivate(none.cacheControl, "get-session (anonymous)");
    expect(none.body).not.toContain('"session"');
  });

  it("on Server Action answers, authorized or refused", async () => {
    const action = serverAction("createArtistAction");
    for (const visitor of VISITORS) {
      const origin = originOf(visitor);
      const response = await fetch(`${origin}${action.route}`, {
        method: "POST",
        redirect: "manual",
        headers: {
          origin,
          accept: "text/x-component",
          "content-type": "text/plain;charset=UTF-8",
          "next-action": action.id,
          ...cookieOf(visitor),
        },
        // Invalid input: the author's call is refused by validation, so
        // nothing is written by any of the three.
        body: JSON.stringify([{ name: "" }]),
      });
      const body = await response.text();
      // The framework sets a Server Action's own policy, and it wins over
      // next.config.ts: `no-cache, no-store, max-age=0, must-revalidate`. It
      // is not marked `private`, but `no-store` already forbids every cache,
      // shared or private, from keeping it.
      expect(response.headers.get("cache-control")).toBe(
        "no-cache, no-store, max-age=0, must-revalidate",
      );
      expectNotStored(
        response.headers.get("cache-control"),
        `${visitor} action (${response.status})`,
      );
      expect(body).toMatch(
        visitor === "author"
          ? /"code":"invalid_input"/
          : /"code":"unauthorized"/,
      );
    }
    const created = await db.query(
      "select count(*)::int as n from artists where name = ''",
    );
    expect(created.rows[0].n).toBe(0);
  });
});

describe("no session can receive another session's response (F-01)", () => {
  it("never replays the author's data to the others, in any order of requests", async () => {
    // Interleaved, so that anything a server or cache kept from the author's
    // request would be served to the next visitor.
    const order: Visitor[] = [
      "author",
      "anonymous",
      "author",
      "wrong-author",
      "author",
      "anonymous",
      "wrong-author",
      "author",
    ];
    for (const path of [
      "/studio",
      "/studio/artists",
      `/studio/albums/${ids.albumId}`,
    ]) {
      for (const [form, headers] of Object.entries(FORMS)) {
        for (const visitor of order) {
          const answer = await ask(visitor, path, headers);
          const where = `${visitor} after the author, ${form} ${path}`;
          expectPrivate(answer.cacheControl, where);
          // The author's own document and Flight payload carry the private
          // data, so its absence from the others' answers means something.
          if (visitor === "author" && (form === "document" || form === "rsc")) {
            expect(answer.body, where).toContain(
              path === "/studio" ? MARKERS.album : MARKERS.artist,
            );
          }
          if (visitor !== "author") {
            expectNoMarker(answer.body, where);
          }
        }
      }
    }
  }, 120_000);

  it("serves the router's prefetches as the same generic shell to everyone", async () => {
    // A prefetch is the only response that the framework builds without the
    // request's session. It must hold nothing that depends on who asked.
    for (const path of [
      "/studio",
      "/studio/artists",
      `/studio/albums/${ids.albumId}`,
    ]) {
      const answers = await Promise.all(
        VISITORS.map((visitor) =>
          ask(visitor, path, FORMS["segment prefetch"]),
        ),
      );
      for (const [index, answer] of answers.entries()) {
        const where = `${VISITORS[index]} segment prefetch ${path}`;
        // A real shell, not an error page: the comparison proves something.
        expect(answer.status, where).toBe(200);
        expect(answer.body.length, where).toBeGreaterThan(100);
        expectNoMarker(answer.body, where);
        expect(answer.body, where).toBe(answers[0]!.body);
      }
      // A bare prefetch: an empty `404` from a server process with no history
      // for the route, a `200` once that process has some (measured; it is
      // the server's state, not the visitor's). So each server is compared
      // with itself: after the same warm-up, the answer with a session (the
      // author on the main server, the wrong author on the second) is the
      // answer without one, byte for byte.
      const servers: [string, Visitor][] = [
        [base, "author"],
        [otherServer.baseURL, "wrong-author"],
      ];
      for (const [origin, visitor] of servers) {
        const where = `${visitor} server prefetch ${path}`;
        for (let warm = 0; warm < 2; warm++) {
          await ask("anonymous", path, FORMS.prefetch, "GET", origin);
        }
        const none = await ask(
          "anonymous",
          path,
          FORMS.prefetch,
          "GET",
          origin,
        );
        const withSession = await ask(visitor, path, FORMS.prefetch);
        const noneAgain = await ask(
          "anonymous",
          path,
          FORMS.prefetch,
          "GET",
          origin,
        );
        for (const answer of [none, withSession, noneAgain]) {
          expect([200, 404], where).toContain(answer.status);
          expectNoMarker(answer.body, where);
        }
        expect(withSession.status, where).toBe(none.status);
        expect(withSession.body, where).toBe(none.body);
        expect(noneAgain.status, where).toBe(none.status);
        expect(noneAgain.body, where).toBe(none.body);
      }
    }
  });

  it("serves the desk's segment prefetch byte for byte from its build file", async () => {
    // The response every visitor gets is the generic file `next build`
    // wrote, which studio-build-output.http.test.ts scans for private data.
    const file = readFileSync(
      ".next/server/app/studio.segments/_tree.segment.rsc",
      "utf8",
    );
    for (const visitor of VISITORS) {
      const answer = await ask(visitor, "/studio", FORMS["segment prefetch"]);
      expect(answer.body, visitor).toBe(file);
    }
  });
});

describe("the policy is the studio's only", () => {
  it("leaves the immutable static assets cacheable", async () => {
    const html = (await ask("author", "/studio")).body;
    const script = html.match(/src="(\/_next\/static\/[^"]+\.js)"/)?.[1];
    expect(script).toBeDefined();
    const response = await fetch(`${base}${script}`);
    await response.body?.cancel();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });
});
