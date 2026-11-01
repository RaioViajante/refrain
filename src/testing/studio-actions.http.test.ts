// The Writing Studio's server actions and pages over real HTTP, against the
// production build (`next start`) and the disposable test database. Setup:
// src/testing/http-global-setup.ts.
//
// Server Actions are public POST endpoints, so these tests call them the way
// any client could: with the action's identifier and a request body, with and
// without a session. They read the database directly afterwards to prove what
// was, and was not, written. Sessions are minted in the test database rather
// than signed in, so the sign-in rate limit that the authentication tests
// count is untouched (src/testing/http-session.ts).
//
// Everything is synthetic and carries one run label; the rows are removed at
// the end, and minted sessions too.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  mintAuthorSession,
  removeMintedSessions,
  tamperedCookie,
  type MintedSession,
} from "@/testing/http-session";
import { assertDisposableTestDatabase } from "@/testing/test-database";

const base = inject("studioBaseURL");
const secret = inject("studioCommandEnv").BETTER_AUTH_SECRET!;
const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const serverLog = inject("studioServerLog");

const label = `[Test] HTTP ${randomUUID().slice(0, 8)}`;
const NOWHERE = "00000000-0000-4000-8000-000000000000";

let db: Client;
let author: MintedSession;

interface ActionEntry {
  id: string;
  route: string;
}

// The build's own table of server actions: identifier, file, and the pages
// that bundle each one.
function loadActions(): Record<string, ActionEntry> {
  const manifest = JSON.parse(
    readFileSync(".next/server/server-reference-manifest.json", "utf8"),
  ) as {
    node: Record<
      string,
      {
        workers: Record<string, unknown>;
        exportedName: string;
        filename: string;
      }
    >;
  };
  const actions: Record<string, ActionEntry> = {};
  for (const [id, entry] of Object.entries(manifest.node)) {
    const page = Object.keys(entry.workers).sort()[0]!;
    actions[entry.exportedName] = {
      id,
      route: page.replace(/^app/, "").replace(/\/page$/, "") || "/",
    };
  }
  return actions;
}

const actions = loadActions();

type Result =
  | { ok: true; data?: Record<string, unknown> }
  | {
      ok: false;
      code: string;
      fields?: Record<string, string>;
      blockedBy?: string;
    };

function parseResult(text: string): Result {
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(line.slice(colon + 1));
      if (typeof value === "object" && value !== null && "ok" in value) {
        return value as Result;
      }
    } catch {
      // Not a JSON line of the Flight response.
    }
  }
  throw new Error(`No action result in the response:\n${text.slice(0, 400)}`);
}

// Calls a server action exactly as a browser would: a POST to a page that
// bundles it, with the action identifier and the arguments as the body.
async function call(
  name: string,
  args: unknown[],
  options: { cookie?: string; routeId?: string; origin?: string | null } = {},
): Promise<Result> {
  const action = actions[name];
  if (!action) {
    throw new Error(`The build has no server action named ${name}.`);
  }
  const route = action.route.replace("[id]", options.routeId ?? NOWHERE);
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...(options.origin === null ? {} : { origin: options.origin ?? base }),
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      "next-action": action.id,
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: JSON.stringify(args),
  });
  return parseResult(await response.text());
}

function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { redirect: "manual", headers });
}

async function scalar<Value = string>(
  sql: string,
  params: unknown[] = [],
): Promise<Value> {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0] as Value;
}

const TABLES = [
  "artists",
  "albums",
  "album_artists",
  "album_editions",
  "tracks",
  "track_artists",
  "album_tracks",
  "edition_tracks",
  "entries",
  "entry_texts",
  "album_journals",
  "entry_slugs",
] as const;

// A checksum of every row of every catalog and writing table, so "nothing was
// written" means no row was added, removed, or changed.
async function snapshot(): Promise<Record<string, string | null>> {
  const checksums: Record<string, string | null> = {};
  for (const table of TABLES) {
    checksums[table] = await scalar<string | null>(
      `select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from ${table} t`,
    );
  }
  return checksums;
}

beforeAll(async () => {
  db = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-action-tests",
  });
  await db.connect();
  await assertDisposableTestDatabase(db);
  author = await mintAuthorSession(db, secret);
});

afterAll(async () => {
  try {
    const own = `${label}%`;
    const journals = `select aj.entry_id from album_journals aj
                        join albums a on a.id = aj.album_id
                       where a.title like $1`;
    await db.query(`delete from entry_slugs where entry_id in (${journals})`, [
      own,
    ]);
    await db.query(`delete from entries where id in (${journals})`, [own]);
    await db.query("delete from albums where title like $1", [own]);
    await db.query("delete from tracks where title like $1", [own]);
    await db.query("delete from artists where name like $1", [own]);
    await removeMintedSessions(db);
  } finally {
    await db.end();
  }
});

describe("the minted session is a real session", () => {
  it("renders the desk for the author's cookie, and not without it", async () => {
    const withCookie = await get("/studio", { cookie: author.cookie });
    expect(withCookie.status).toBe(200);
    const html = await withCookie.text();
    expect(html).toContain("Your desk");
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(withCookie.headers.get("cache-control")).toContain("no-store");

    const without = await (await get("/studio")).text();
    expect(without).not.toContain("Your desk");
    expect(without).toContain("NEXT_REDIRECT;replace;/studio/sign-in;307;");
  });
});

// State shared by the tests below, which run in order.
const ids = {
  artist: "",
  freeArtist: "",
  archivedArtist: "",
  album: "",
  freeAlbum: "",
  archivedAlbum: "",
  track: "",
  extraTrack: "",
  freeTrack: "",
  spareTrack: "",
  archivedTrack: "",
  journal: "",
};
let journalVersion = 1;

function ok(result: Result): Record<string, unknown> {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  return (result as { ok: true; data?: Record<string, unknown> }).data ?? {};
}

describe("the author's complete journey, through real HTTP and PostgreSQL", () => {
  const cookie = () => author.cookie;
  const own = (name: string) => `${label} ${name}`;

  it("creates an artist, an album credited to it, and tracks on the album", async () => {
    ids.artist = String(
      ok(
        await call(
          "createArtistAction",
          [{ name: own("Artist"), kind: "person" }],
          { cookie: cookie() },
        ),
      ).id,
    );
    ids.freeArtist = String(
      ok(
        await call(
          "createArtistAction",
          [{ name: own("Free artist"), kind: "group" }],
          { cookie: cookie() },
        ),
      ).id,
    );
    ids.archivedArtist = String(
      ok(
        await call(
          "createArtistAction",
          [{ name: own("Archived artist"), kind: "person" }],
          { cookie: cookie() },
        ),
      ).id,
    );
    ok(
      await call("archiveArtistAction", [ids.archivedArtist], {
        cookie: cookie(),
        routeId: ids.archivedArtist,
      }),
    );

    ids.album = String(
      ok(
        await call(
          "createAlbumAction",
          [
            {
              title: own("Album"),
              firstReleaseYear: 1994,
              credits: [{ artistId: ids.artist }],
              edition: { label: "[Test] Label", country: "us" },
            },
          ],
          { cookie: cookie() },
        ),
      ).id,
    );
    ids.freeAlbum = String(
      ok(
        await call(
          "createAlbumAction",
          [{ title: own("Free album"), credits: [{ artistId: ids.artist }] }],
          { cookie: cookie() },
        ),
      ).id,
    );
    ids.archivedAlbum = String(
      ok(
        await call(
          "createAlbumAction",
          [
            {
              title: own("Archived album"),
              credits: [{ artistId: ids.artist }],
            },
          ],
          { cookie: cookie() },
        ),
      ).id,
    );
    ok(
      await call("archiveAlbumAction", [ids.archivedAlbum], {
        cookie: cookie(),
        routeId: ids.archivedAlbum,
      }),
    );

    // A new track on the album, and one that is created apart and then added.
    ids.track = String(
      ok(
        await call(
          "createTrackAction",
          [
            {
              title: own("Track 1"),
              lengthMs: 222_000,
              artistIds: [ids.artist],
              albumId: ids.album,
            },
          ],
          { cookie: cookie() },
        ),
      ).id,
    );
    ids.extraTrack = String(
      ok(
        await call("createTrackAction", [{ title: own("Track 2") }], {
          cookie: cookie(),
        }),
      ).id,
    );
    ids.freeTrack = String(
      ok(
        await call("createTrackAction", [{ title: own("Free track") }], {
          cookie: cookie(),
        }),
      ).id,
    );
    ids.spareTrack = String(
      ok(
        await call("createTrackAction", [{ title: own("Spare track") }], {
          cookie: cookie(),
        }),
      ).id,
    );
    ids.archivedTrack = String(
      ok(
        await call("createTrackAction", [{ title: own("Archived track") }], {
          cookie: cookie(),
        }),
      ).id,
    );
    ok(
      await call("archiveTrackAction", [ids.archivedTrack], {
        cookie: cookie(),
        routeId: ids.archivedTrack,
      }),
    );

    ok(
      await call("addTrackToAlbumAction", [ids.album, ids.extraTrack], {
        cookie: cookie(),
        routeId: ids.album,
      }),
    );
    ok(
      await call("moveTrackInAlbumAction", [ids.album, ids.extraTrack, "up"], {
        cookie: cookie(),
        routeId: ids.album,
      }),
    );

    // The rows are really in PostgreSQL, joined as the Albums page joins them.
    const rows = await db.query<{ title: string; artist: string }>(
      `select al.title, ar.name as artist
         from albums al
         join album_artists aa on aa.album_id = al.id
         join artists ar on ar.id = aa.artist_id
        where al.id = $1`,
      [ids.album],
    );
    expect(rows.rows).toEqual([{ title: own("Album"), artist: own("Artist") }]);
    const order = await db.query<{ title: string; position: number }>(
      `select t.title, et.position
         from edition_tracks et join tracks t on t.id = et.track_id
        where et.album_id = $1 order by et.position`,
      [ids.album],
    );
    expect(order.rows).toEqual([
      { title: own("Track 2"), position: 1 },
      { title: own("Track 1"), position: 2 },
    ]);
  });

  it("creates a private draft journal, which is never public", async () => {
    const created = ok(
      await call(
        "createJournalAction",
        [
          {
            albumId: ids.album,
            locale: "pt-BR",
            opening: `${label} <img src=x onerror=1>`,
            body: `${label} first paragraph.\nSecond line.\n\n<script>window.__xss=1</script> second paragraph.`,
          },
        ],
        { cookie: cookie() },
      ),
    );
    ids.journal = String(created.entryId);
    expect(created.version).toBe(1);

    const stored = await db.query<{
      status: string;
      locale: string;
      is_original: boolean;
      published_at: string | null;
    }>(
      "select status, locale, is_original, published_at from entry_texts where entry_id = $1",
      [ids.journal],
    );
    expect(stored.rows).toEqual([
      {
        status: "draft",
        locale: "pt-BR",
        is_original: true,
        published_at: null,
      },
    ]);
    const featured = await scalar<boolean>(
      "select is_featured from album_journals where entry_id = $1",
      [ids.journal],
    );
    expect(featured).toBe(false);
    const slugs = await db.query<{ was_published: boolean }>(
      "select was_published from entry_slugs where entry_id = $1",
      [ids.journal],
    );
    expect(slugs.rows).toEqual([{ was_published: false }]);
  });

  it("returns to find the saved writing intact, and saves again", async () => {
    const view = await (
      await get(`/studio/journals/${ids.journal}`, { cookie: cookie() })
    ).text();
    expect(view).toContain(`${label} first paragraph.`);
    expect(view).toContain("Second line.");
    // Markup in the writing is text, never structure.
    expect(view).not.toContain("<script>window.__xss=1</script>");
    expect(view).not.toContain("<img src=x");
    expect(view).toContain("&lt;script&gt;window.__xss=1&lt;/script&gt;");

    const edit = await (
      await get(`/studio/journals/${ids.journal}/edit`, { cookie: cookie() })
    ).text();
    expect(edit).toContain("<textarea");
    expect(edit).toContain(`${label} first paragraph.`);
    expect(edit).not.toContain("<script>window.__xss=1</script>");

    const saved = ok(
      await call(
        "saveJournalAction",
        [
          {
            entryId: ids.journal,
            expectedVersion: 1,
            opening: `${label} opening`,
            body: `${label} edited.\n\nKept paragraph.`,
          },
        ],
        { cookie: cookie(), routeId: ids.journal },
      ),
    );
    journalVersion = Number(saved.version);
    expect(journalVersion).toBe(2);
    const body = await scalar<string>(
      "select body_text from entry_texts where entry_id = $1",
      [ids.journal],
    );
    expect(body).toBe(`${label} edited.\n\nKept paragraph.`);
    const document = await scalar<{ content: { type: string }[] }>(
      "select body from entry_texts where entry_id = $1",
      [ids.journal],
    );
    expect(document.content.map((node) => node.type)).toEqual([
      "paragraph",
      "paragraph",
    ]);
  });

  it("refuses a stale save as a conflict and writes nothing", async () => {
    const before = await snapshot();
    const stale = await call(
      "saveJournalAction",
      [
        {
          entryId: ids.journal,
          expectedVersion: 1,
          body: `${label} stale text`,
        },
      ],
      { cookie: cookie(), routeId: ids.journal },
    );
    expect(stale).toEqual({ ok: false, code: "conflict" });
    expect(await snapshot()).toEqual(before);
  });

  it("lets exactly one of two simultaneous saves through", async () => {
    const results = await Promise.all(
      ["A", "B"].map((editor) =>
        call(
          "saveJournalAction",
          [
            {
              entryId: ids.journal,
              expectedVersion: journalVersion,
              body: `${label} editor ${editor}`,
            },
          ],
          { cookie: cookie(), routeId: ids.journal },
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, code: "conflict" },
    ]);
    journalVersion += 1;
    expect(
      await scalar<number>("select version from entries where id = $1", [
        ids.journal,
      ]),
    ).toBe(journalVersion);
  });

  it("manages the private status and never publishes", async () => {
    ok(
      await call(
        "setJournalPrivacyAction",
        [{ entryId: ids.journal, locale: "pt-BR", status: "private" }],
        { cookie: cookie(), routeId: ids.journal },
      ),
    );
    expect(
      await scalar("select status from entry_texts where entry_id = $1", [
        ids.journal,
      ]),
    ).toBe("private");

    for (const status of ["published", "public", ""]) {
      const refused = await call(
        "setJournalPrivacyAction",
        [{ entryId: ids.journal, locale: "pt-BR", status }],
        { cookie: cookie(), routeId: ids.journal },
      );
      expect(refused).toMatchObject({ ok: false, code: "invalid_input" });
    }
    expect(
      await scalar("select status from entry_texts where entry_id = $1", [
        ids.journal,
      ]),
    ).toBe("private");
    expect(
      await scalar<string | null>(
        "select published_at::text from entry_texts where entry_id = $1",
        [ids.journal],
      ),
    ).toBeNull();
    expect(
      await scalar<string | null>(
        "select first_published_at::text from entries where id = $1",
        [ids.journal],
      ),
    ).toBeNull();
  });

  it("refuses unsafe or unknown identifiers with a fixed code", async () => {
    const before = await snapshot();
    const cases: [string, unknown[], string][] = [
      [
        "updateArtistAction",
        [NOWHERE, { name: own("x"), kind: "person" }],
        "not_found",
      ],
      [
        "updateArtistAction",
        ["not-a-uuid", { name: own("x"), kind: "person" }],
        "invalid_input",
      ],
      ["deleteAlbumAction", ["1; drop table albums;--"], "invalid_input"],
      [
        "saveJournalAction",
        [{ entryId: NOWHERE, expectedVersion: 1, body: "x" }],
        "not_found",
      ],
      // An entry that is not an album journal is not found either.
      ["deleteJournalAction", [ids.artist], "not_found"],
      [
        "createJournalAction",
        [{ albumId: ids.archivedAlbum, locale: "en", body: "x" }],
        "archived",
      ],
      [
        "createJournalAction",
        [{ albumId: ids.album, locale: "fr", body: "x" }],
        "invalid_input",
      ],
      [
        "createAlbumAction",
        [{ title: own("x"), credits: [{ artistId: ids.archivedArtist }] }],
        "archived",
      ],
      ["addTrackToAlbumAction", [ids.album, ids.archivedTrack], "archived"],
      ["deleteArtistAction", [ids.artist], "in_use"],
      ["deleteAlbumAction", [ids.album], "in_use"],
      ["deleteTrackAction", [ids.track], "in_use"],
      ["createArtistAction", [{ name: "", kind: "person" }], "invalid_input"],
    ];
    for (const [name, args, code] of cases) {
      const result = await call(name, args, {
        cookie: cookie(),
        routeId: ids.artist,
      });
      expect(result, `${name} ${JSON.stringify(args)}`).toMatchObject({
        ok: false,
        code,
      });
      // A fixed code and field names: never SQL, stack traces, or a message.
      expect(JSON.stringify(result)).not.toMatch(
        /select |insert |constraint|violates|\sat\s|node_modules/i,
      );
    }
    expect(await snapshot()).toEqual(before);
  });

  it("deletes unreferenced catalog records for real, and refuses referenced ones", async () => {
    ok(
      await call("deleteTrackAction", [ids.freeTrack], {
        cookie: cookie(),
        routeId: ids.freeTrack,
      }),
    );
    ok(
      await call("deleteAlbumAction", [ids.freeAlbum], {
        cookie: cookie(),
        routeId: ids.freeAlbum,
      }),
    );
    ok(
      await call("deleteArtistAction", [ids.freeArtist], {
        cookie: cookie(),
        routeId: ids.freeArtist,
      }),
    );
    expect(
      await scalar<number>("select count(*)::int from tracks where id = $1", [
        ids.freeTrack,
      ]),
    ).toBe(0);
    expect(
      await scalar<number>("select count(*)::int from albums where id = $1", [
        ids.freeAlbum,
      ]),
    ).toBe(0);
    expect(
      await scalar<number>("select count(*)::int from artists where id = $1", [
        ids.freeArtist,
      ]),
    ).toBe(0);
    // The album with a journal is archived, never deleted.
    ok(
      await call("archiveAlbumAction", [ids.album], {
        cookie: cookie(),
        routeId: ids.album,
      }),
    );
    expect(
      await scalar<boolean>(
        "select archived_at is not null from albums where id = $1",
        [ids.album],
      ),
    ).toBe(true);
    ok(
      await call("restoreAlbumAction", [ids.album], {
        cookie: cookie(),
        routeId: ids.album,
      }),
    );
  });

  it("shows the desk and lists with figures computed by PostgreSQL", async () => {
    const desk = await (await get("/studio", { cookie: cookie() })).text();
    expect(desk).toContain("Your catalog");
    expect(desk).toContain("Your journals");
    const albums = await (
      await get("/studio/albums", { cookie: cookie() })
    ).text();
    // The JOIN (credited artist), the aggregate (tracks), the subquery (used in).
    expect(albums).toContain(own("Album"));
    expect(albums).toContain(own("Artist"));
    expect(albums).toMatch(/2 tracks/);
    expect(albums).toMatch(/used in 1 entry/);
    const journals = await (
      await get("/studio/journals", { cookie: cookie() })
    ).text();
    expect(journals).toMatch(/1 (draft|journal)|private/);
  });
});

describe("what a request without the author's session can do", () => {
  // Every action, called with valid arguments for records that exist, so a
  // missing check would visibly write. Each is listed by the name the build
  // gives it; a new action without an entry here fails the first test.
  function attempts(): Record<string, { args: unknown[]; routeId: string }> {
    return {
      createArtistAction: {
        args: [{ name: `${label} Intruder`, kind: "person" }],
        routeId: NOWHERE,
      },
      updateArtistAction: {
        args: [ids.artist, { name: `${label} Hijacked`, kind: "group" }],
        routeId: ids.artist,
      },
      archiveArtistAction: { args: [ids.artist], routeId: ids.artist },
      restoreArtistAction: {
        args: [ids.archivedArtist],
        routeId: ids.archivedArtist,
      },
      deleteArtistAction: {
        args: [ids.archivedArtist],
        routeId: ids.archivedArtist,
      },
      createAlbumAction: {
        args: [
          {
            title: `${label} Intruder album`,
            credits: [{ artistId: ids.artist }],
          },
        ],
        routeId: NOWHERE,
      },
      updateAlbumAction: {
        args: [
          ids.album,
          {
            title: `${label} Hijacked album`,
            credits: [{ artistId: ids.artist }],
          },
        ],
        routeId: ids.album,
      },
      archiveAlbumAction: { args: [ids.album], routeId: ids.album },
      restoreAlbumAction: {
        args: [ids.archivedAlbum],
        routeId: ids.archivedAlbum,
      },
      deleteAlbumAction: {
        args: [ids.archivedAlbum],
        routeId: ids.archivedAlbum,
      },
      addTrackToAlbumAction: {
        args: [ids.album, ids.spareTrack],
        routeId: ids.album,
      },
      removeTrackFromAlbumAction: {
        args: [ids.album, ids.track],
        routeId: ids.album,
      },
      moveTrackInAlbumAction: {
        args: [ids.album, ids.track, "up"],
        routeId: ids.album,
      },
      createTrackAction: {
        args: [{ title: `${label} Intruder track`, albumId: ids.album }],
        routeId: NOWHERE,
      },
      updateTrackAction: {
        args: [ids.track, { title: `${label} Hijacked track` }],
        routeId: ids.track,
      },
      archiveTrackAction: { args: [ids.track], routeId: ids.track },
      restoreTrackAction: {
        args: [ids.archivedTrack],
        routeId: ids.archivedTrack,
      },
      deleteTrackAction: {
        args: [ids.archivedTrack],
        routeId: ids.archivedTrack,
      },
      createJournalAction: {
        args: [
          { albumId: ids.album, locale: "en", body: `${label} intruder words` },
        ],
        routeId: NOWHERE,
      },
      saveJournalAction: {
        args: [
          {
            entryId: ids.journal,
            expectedVersion: journalVersion,
            body: `${label} hijacked words`,
          },
        ],
        routeId: ids.journal,
      },
      setJournalPrivacyAction: {
        args: [{ entryId: ids.journal, locale: "pt-BR", status: "draft" }],
        routeId: ids.journal,
      },
      deleteJournalAction: { args: [ids.journal], routeId: ids.journal },
    };
  }

  it("covers every server action in the build", () => {
    expect(Object.keys(attempts()).sort()).toEqual(Object.keys(actions).sort());
    expect(Object.keys(actions).length).toBeGreaterThanOrEqual(22);
  });

  async function credentials(): Promise<[string, string | undefined][]> {
    const expired = await mintAuthorSession(db, secret, -60);
    const revoked = await mintAuthorSession(db, secret);
    await db.query("delete from auth_sessions where token = $1", [
      revoked.token,
    ]);
    return [
      ["no cookie", undefined],
      ["a fabricated cookie", "refrain.session_token=forged.value"],
      [
        "another cookie name",
        `better-auth.session_token=${author.cookie.split("=")[1]}`,
      ],
      ["a real token with a wrong signature", tamperedCookie(author)],
      ["an expired session", expired.cookie],
      ["a revoked session", revoked.cookie],
    ];
  }

  it("is refused by every action, whatever the credentials, and writes nothing", async () => {
    const before = await snapshot();
    for (const [what, cookie] of await credentials()) {
      for (const [name, { args, routeId }] of Object.entries(attempts())) {
        const result = await call(name, args, { cookie, routeId });
        expect(result, `${name} with ${what}`).toEqual({
          ok: false,
          code: "unauthorized",
        });
      }
    }
    expect(await snapshot()).toEqual(before);
    // The intruders are not in the database under any name.
    expect(
      Number(
        await scalar(
          `select (select count(*) from artists where name like '%Intruder%' or name like '%Hijacked%')
              + (select count(*) from albums where title like '%Intruder%' or title like '%Hijacked%')
              + (select count(*) from tracks where title like '%Intruder%' or title like '%Hijacked%')
              + (select count(*) from entry_texts where body_text like '%intruder%' or body_text like '%hijacked%')`,
        ),
      ),
    ).toBe(0);
  });

  it("is refused without an Origin header, even with the author's cookie", async () => {
    // Next.js itself accepts an action call that has no Origin header, so the
    // studio checks it (SameSite=Strict is then a second control, not the only one).
    const before = await snapshot();
    const result = await call("deleteJournalAction", [ids.journal], {
      cookie: author.cookie,
      routeId: ids.journal,
      origin: null,
    });
    expect(result).toEqual({ ok: false, code: "unauthorized" });
    expect(await snapshot()).toEqual(before);
    expect(
      await scalar<string | null>(
        "select deleted_at::text from entries where id = $1",
        [ids.journal],
      ),
    ).toBeNull();
  });

  it("is refused from another origin, even with the author's cookie", async () => {
    const before = await snapshot();
    const action = actions.deleteJournalAction!;
    const response = await fetch(
      `${base}${action.route.replace("[id]", ids.journal)}`,
      {
        method: "POST",
        redirect: "manual",
        headers: {
          origin: "https://attacker.example",
          "content-type": "text/plain;charset=UTF-8",
          "next-action": action.id,
          cookie: author.cookie,
        },
        body: JSON.stringify([ids.journal]),
      },
    );
    expect(response.status).not.toBe(200);
    await response.body?.cancel();
    expect(await snapshot()).toEqual(before);
    expect(
      await scalar<string | null>(
        "select deleted_at::text from entries where id = $1",
        [ids.journal],
      ),
    ).toBeNull();
  });

  const privateStrings = () => [
    label,
    "first paragraph",
    "Second line",
    "Kept paragraph",
    "editor A",
  ];

  it("shows no private writing or catalog entry on any studio page", async () => {
    const paths = [
      "/studio",
      "/studio/artists",
      `/studio/artists/${ids.artist}`,
      "/studio/albums",
      `/studio/albums/${ids.album}`,
      "/studio/tracks",
      `/studio/tracks/${ids.track}`,
      "/studio/journals",
      "/studio/journals/new",
      `/studio/journals/new?album=${ids.album}`,
      `/studio/journals/${ids.journal}`,
      `/studio/journals/${ids.journal}/edit`,
    ];
    for (const path of paths) {
      for (const headers of [
        {},
        { cookie: "refrain.session_token=forged.value" },
        // The router's prefetch and RSC payload requests, which a cache could keep.
        { rsc: "1" },
        { rsc: "1", "next-router-prefetch": "1" },
        {
          rsc: "1",
          "next-router-prefetch": "1",
          "next-router-segment-prefetch": "/_tree",
        },
      ] as Record<string, string>[]) {
        let response = await get(path, headers);
        // Next.js first redirects a router request that lacks its `_rsc`
        // cache-busting parameter to the same address with it. The browser's
        // router always sends it, so follow that one hop.
        const location = response.headers.get("location");
        if (
          response.status === 307 &&
          location &&
          new URL(location, base).pathname === new URL(path, base).pathname
        ) {
          await response.body?.cancel();
          response = await get(location, headers);
        }
        const body = await response.text();
        for (const text of privateStrings()) {
          expect(
            body,
            `${path} ${JSON.stringify(headers)} leaked ${text}`,
          ).not.toContain(text);
        }
        if (response.status === 200) {
          const cache = response.headers.get("cache-control") ?? "";
          if (!cache.includes("no-store")) {
            // Only Next.js's prerendered static shell, answering a router
            // prefetch, may be stored by a cache. Its body held none of the
            // private strings (above), and the next test shows it is the same
            // for a record that exists and one that does not.
            expect(
              headers["next-router-prefetch"] ??
                headers["next-router-segment-prefetch"],
              `${path} ${JSON.stringify(headers)} is stored by a cache (${cache})`,
            ).toBeDefined();
          }
        } else {
          // The router's own request without a session is answered with a
          // redirect to sign-in. Next.js sends no cache header on it, and a
          // 307 is not cacheable by default (RFC 9111 § 3). It reveals only
          // the sign-in address.
          expect(response.status, `${path} ${JSON.stringify(headers)}`).toBe(
            307,
          );
          expect(
            new URL(response.headers.get("location") ?? "", base).pathname,
          ).toBe("/studio/sign-in");
        }
        expect(response.headers.get("x-frame-options")).toBe("DENY");
      }
    }
  });

  it("serves the same static shell whether or not a record exists", async () => {
    const routes: [string, string][] = [
      ["artists", ids.artist],
      ["albums", ids.album],
      ["tracks", ids.track],
      ["journals", ids.journal],
    ];
    const headers = {
      rsc: "1",
      "next-router-prefetch": "1",
      "next-router-segment-prefetch": "/_tree",
    };
    for (const [section, realId] of routes) {
      const normalized = async (id: string) => {
        const response = await get(`/studio/${section}/${id}`, headers);
        const body = (await response.text()).split(id).join("ID");
        return { status: response.status, body };
      };
      expect(await normalized(realId), section).toEqual(
        await normalized(NOWHERE),
      );
    }
  });

  it("keeps the titles of studio pages generic and the pages out of search", async () => {
    for (const path of [
      `/studio/journals/${ids.journal}`,
      `/studio/albums/${ids.album}`,
      `/studio/artists/${ids.artist}`,
    ]) {
      const html = await (await get(path, { cookie: author.cookie })).text();
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
      expect(title).toMatch(/· refrain$/);
      expect(title).not.toContain(label);
      expect(html).toContain('name="robots" content="noindex, nofollow"');
    }
    // There is no public surface that lists any of it.
    for (const path of [
      "/sitemap.xml",
      "/robots.txt",
      "/feed.xml",
      "/albums",
      "/journals",
      "/api/journals",
      "/api/albums",
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      expect(await response.text()).not.toContain(label);
    }
  });
});

describe("the journey ends cleanly", () => {
  it("moves the journal to Recently deleted and keeps it, then signs out for good", async () => {
    ok(
      await call("deleteJournalAction", [ids.journal], {
        cookie: author.cookie,
        routeId: ids.journal,
      }),
    );
    const row = await db.query<{
      deleted: boolean;
      status: string;
      body_text: string;
    }>(
      `select e.deleted_at is not null as deleted, t.status, t.body_text
         from entries e join entry_texts t on t.entry_id = e.id where e.id = $1`,
      [ids.journal],
    );
    expect(row.rows[0]).toMatchObject({ deleted: true, status: "private" });
    expect(row.rows[0]!.body_text).toContain(label);

    // A deleted journal cannot be saved or have its status changed.
    expect(
      await call(
        "saveJournalAction",
        [{ entryId: ids.journal, expectedVersion: journalVersion, body: "x" }],
        { cookie: author.cookie, routeId: ids.journal },
      ),
    ).toEqual({ ok: false, code: "deleted" });
    expect(
      await call(
        "setJournalPrivacyAction",
        [{ entryId: ids.journal, locale: "pt-BR", status: "draft" }],
        { cookie: author.cookie, routeId: ids.journal },
      ),
    ).toEqual({ ok: false, code: "deleted" });

    const list = await (
      await get("/studio/journals", { cookie: author.cookie })
    ).text();
    expect(list).toContain("Recently deleted");
    // Restoring and "Delete now" are not offered anywhere.
    expect(list).not.toMatch(/Restore journal|Delete now/);

    // Signing out ends the session: the same cookie then grants nothing.
    await db.query("delete from auth_sessions where token = $1", [
      author.token,
    ]);
    const after = await (
      await get(`/studio/journals/${ids.journal}`, { cookie: author.cookie })
    ).text();
    expect(after).not.toContain(label);
    expect(after).toContain("NEXT_REDIRECT;replace;/studio/sign-in;307;");
    expect(
      await call(
        "saveJournalAction",
        [{ entryId: ids.journal, expectedVersion: 1, body: "x" }],
        { cookie: author.cookie, routeId: ids.journal },
      ),
    ).toEqual({ ok: false, code: "unauthorized" });
  });

  it("wrote nothing private to the server log", async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const log = readFileSync(serverLog, "utf8");
    for (const text of [
      label,
      "first paragraph",
      "Second line",
      "window.__xss",
    ]) {
      expect(log).not.toContain(text);
    }
    expect(log).not.toMatch(/insert into|update "|select "/i);
  });
});
