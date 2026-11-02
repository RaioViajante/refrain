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

// Like `call`, and also returns the response text and headers, for the checks
// about what a response carries (no-store, no token, no writing).
async function callRaw(
  name: string,
  args: unknown[],
  options: { cookie?: string; routeId?: string } = {},
): Promise<{ result: Result; text: string; headers: Headers }> {
  const action = actions[name];
  if (!action) {
    throw new Error(`The build has no server action named ${name}.`);
  }
  const route = action.route.replace("[id]", options.routeId ?? NOWHERE);
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: base,
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      "next-action": action.id,
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { result: parseResult(text), text, headers: response.headers };
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
  "track_reflections",
  "track_reflection_texts",
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
    expect(html).toContain("Everything you are writing");
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(withCookie.headers.get("cache-control")).toContain("no-store");

    const without = await (await get("/studio")).text();
    expect(without).not.toContain("Everything you are writing");
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
  // A journal that is in Recently deleted, for the restore tests.
  recoverable: "",
};
let journalVersion = 1;

// The data of a successful result, for the checks that read nested fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dataOf(result: Result): Record<string, any> {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result as { data: Record<string, any> }).data;
}

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

  it("writes a second journal, makes it private, and moves it to Recently deleted", async () => {
    const created = ok(
      await call(
        "createJournalAction",
        [
          {
            albumId: ids.album,
            locale: "en",
            opening: `${label} Recoverable opening`,
            body: `${label} recoverable first.\n\nRecoverable second paragraph.\n\nRecoverable third.`,
          },
        ],
        { cookie: cookie() },
      ),
    );
    ids.recoverable = String(created.entryId);
    ok(
      await call(
        "setJournalPrivacyAction",
        [{ entryId: ids.recoverable, locale: "en", status: "private" }],
        { cookie: cookie(), routeId: ids.recoverable },
      ),
    );
    ok(
      await call("deleteJournalAction", [ids.recoverable], {
        cookie: cookie(),
        routeId: ids.recoverable,
      }),
    );
    expect(
      await scalar<boolean>(
        "select deleted_at is not null from entries where id = $1",
        [ids.recoverable],
      ),
    ).toBe(true);
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

    // The second save names only the body, and adds a paragraph to what the
    // editor showed. Everything the author wrote first must still be there.
    const before = await db.query<{
      opening: string;
      body_text: string;
      body: { content: unknown[] };
    }>("select opening, body_text, body from entry_texts where entry_id = $1", [
      ids.journal,
    ]);
    const original = before.rows[0]!;
    const added = `${label} Kept paragraph.`;
    const saved = ok(
      await call(
        "saveJournalAction",
        [
          {
            entryId: ids.journal,
            expectedVersion: 1,
            body: `${original.body_text}\n\n${added}`,
          },
        ],
        { cookie: cookie(), routeId: ids.journal },
      ),
    );
    journalVersion = Number(saved.version);
    expect(journalVersion).toBe(2);
    const after = (
      await db.query<{
        opening: string;
        body_text: string;
        body: { content: unknown[] };
      }>(
        "select opening, body_text, body from entry_texts where entry_id = $1",
        [ids.journal],
      )
    ).rows[0]!;
    expect(after.body_text).toBe(`${original.body_text}\n\n${added}`);
    // The opening sentence was not named, so it is unchanged.
    expect(after.opening).toBe(original.opening);
    // The paragraphs that were there are exactly as they were.
    expect(after.body.content).toHaveLength(original.body.content.length + 1);
    expect(after.body.content.slice(0, original.body.content.length)).toEqual(
      original.body.content,
    );
    expect(
      (after.body.content as { type: string }[]).map((node) => node.type),
    ).toEqual(["paragraph", "paragraph", "paragraph"]);
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

  it("treats every update as a patch: what is left out stays, what is named changes", async () => {
    // Artist: sort name set, then a rename that does not mention it.
    ok(
      await call(
        "updateArtistAction",
        [ids.artist, { sortName: `${label} Sort` }],
        { cookie: cookie(), routeId: ids.artist },
      ),
    );
    ok(
      await call("updateArtistAction", [ids.artist, { kind: "group" }], {
        cookie: cookie(),
        routeId: ids.artist,
      }),
    );
    const artist = () =>
      db.query<{ name: string; sort_name: string | null; kind: string }>(
        "select name, sort_name, kind from artists where id = $1",
        [ids.artist],
      );
    expect((await artist()).rows[0]).toEqual({
      name: own("Artist"),
      sort_name: `${label} Sort`,
      kind: "group",
    });
    // Clearing is on purpose: null clears, and only that field.
    ok(
      await call("updateArtistAction", [ids.artist, { sortName: null }], {
        cookie: cookie(),
        routeId: ids.artist,
      }),
    );
    expect((await artist()).rows[0]).toEqual({
      name: own("Artist"),
      sort_name: null,
      kind: "group",
    });
    // Nothing named, or a required field cleared: refused, nothing written.
    const before = await snapshot();
    for (const patch of [{}, { name: "" }, { name: null }]) {
      expect(
        await call("updateArtistAction", [ids.artist, patch], {
          cookie: cookie(),
          routeId: ids.artist,
        }),
      ).toMatchObject({ ok: false, code: "invalid_input" });
    }
    expect(await snapshot()).toEqual(before);

    // Album: a retitle keeps the credits, the year, and the reference edition.
    const album = () =>
      db.query<{
        title: string;
        year: number;
        label: string;
        country: string;
        credits: number;
        tracks: number;
      }>(
        `select al.title, al.first_release_year as year, ed.label, ed.country,
                (select count(*)::int from album_artists where album_id = al.id) as credits,
                (select count(*)::int from album_tracks where album_id = al.id) as tracks
           from albums al join album_editions ed on ed.album_id = al.id and ed.is_reference
          where al.id = $1`,
        [ids.album],
      );
    const albumBefore = (await album()).rows[0]!;
    ok(
      await call(
        "updateAlbumAction",
        [ids.album, { title: `${own("Album")} (retitled)` }],
        { cookie: cookie(), routeId: ids.album },
      ),
    );
    expect((await album()).rows[0]).toEqual({
      ...albumBefore,
      title: `${own("Album")} (retitled)`,
    });
    ok(
      await call(
        "updateAlbumAction",
        [ids.album, { edition: { label: null } }],
        { cookie: cookie(), routeId: ids.album },
      ),
    );
    expect((await album()).rows[0]).toEqual({
      ...albumBefore,
      title: `${own("Album")} (retitled)`,
      label: null,
    });
    expect(
      await call("updateAlbumAction", [ids.album, { edition: {} }], {
        cookie: cookie(),
        routeId: ids.album,
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      await call("updateAlbumAction", [ids.album, { credits: [] }], {
        cookie: cookie(),
        routeId: ids.album,
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect((await album()).rows[0]).toMatchObject({
      credits: 1,
      tracks: albumBefore.tracks,
    });

    // Track: a retitle keeps its length, credits, and place on the album.
    const track = () =>
      db.query<{
        title: string;
        length_ms: number | null;
        credits: number;
        albums: number;
      }>(
        `select t.title, t.length_ms,
                (select count(*)::int from track_artists where track_id = t.id) as credits,
                (select count(*)::int from album_tracks where track_id = t.id) as albums
           from tracks t where t.id = $1`,
        [ids.track],
      );
    const trackBefore = (await track()).rows[0]!;
    ok(
      await call(
        "updateTrackAction",
        [ids.track, { title: `${own("Track 1")} (retitled)` }],
        { cookie: cookie(), routeId: ids.track },
      ),
    );
    expect((await track()).rows[0]).toEqual({
      ...trackBefore,
      title: `${own("Track 1")} (retitled)`,
    });
    expect(
      await call("updateTrackAction", [ids.track, {}], {
        cookie: cookie(),
        routeId: ids.track,
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("saves a journal as a patch: an unrelated field never erases the writing", async () => {
    const stored = () =>
      db.query<{ opening: string | null; body_text: string }>(
        "select opening, body_text from entry_texts where entry_id = $1",
        [ids.journal],
      );
    const before = (await stored()).rows[0]!;
    expect(before.body_text.length).toBeGreaterThan(20);

    // Neither field named: refused, and the text and version are untouched.
    const snapshotBefore = await snapshot();
    expect(
      await call(
        "saveJournalAction",
        [{ entryId: ids.journal, expectedVersion: journalVersion }],
        { cookie: cookie(), routeId: ids.journal },
      ),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await snapshot()).toEqual(snapshotBefore);

    // Only the opening sentence named: the body is exactly as it was.
    const opening = ok(
      await call(
        "saveJournalAction",
        [
          {
            entryId: ids.journal,
            expectedVersion: journalVersion,
            opening: `${label} new opening`,
          },
        ],
        { cookie: cookie(), routeId: ids.journal },
      ),
    );
    journalVersion = Number(opening.version);
    expect((await stored()).rows[0]).toEqual({
      opening: `${label} new opening`,
      body_text: before.body_text,
    });

    // A stale patch is still refused by the version counter.
    expect(
      await call(
        "saveJournalAction",
        [
          {
            entryId: ids.journal,
            expectedVersion: journalVersion - 1,
            opening: `${label} stale opening`,
          },
        ],
        { cookie: cookie(), routeId: ids.journal },
      ),
    ).toEqual({ ok: false, code: "conflict" });
    expect((await stored()).rows[0]!.opening).toBe(`${label} new opening`);

    // Clearing the opening on purpose clears only the opening.
    const cleared = ok(
      await call(
        "saveJournalAction",
        [
          {
            entryId: ids.journal,
            expectedVersion: journalVersion,
            opening: null,
          },
        ],
        { cookie: cookie(), routeId: ids.journal },
      ),
    );
    journalVersion = Number(cleared.version);
    expect((await stored()).rows[0]).toEqual({
      opening: null,
      body_text: before.body_text,
    });
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
    // The album is the journal's heading, with the artist as context; the
    // author's own words appear only as a preview, beside dates and status.
    expect(journals).toContain(`${own("Album")} (retitled)`);
    expect(journals).toContain(own("Artist"));
    const currentBody = await scalar<string>(
      "select body_text from entry_texts where entry_id = $1",
      [ids.journal],
    );
    expect(journals).toContain(currentBody.slice(0, 40));
    expect(journals.replaceAll("<!-- -->", "")).toMatch(
      /started [A-Z][a-z]{2} \d{1,2}, \d{4}/,
    );
    const albumPage = await (
      await get(`/studio/albums/${ids.album}`, { cookie: cookie() })
    ).text();
    expect(albumPage.replaceAll("<!-- -->", "")).toMatch(
      /Journal started [A-Z][a-z]{2} \d{1,2}, \d{4}/,
    );
    // The journal page's heading is the album, and its <title> names neither.
    const journalPage = await (
      await get(`/studio/journals/${ids.journal}`, { cookie: cookie() })
    ).text();
    expect(/<h1[^>]*>([^<]*)<\/h1>/.exec(journalPage)?.[1]).toBe(
      `${own("Album")} (retitled)`,
    );
  });
});

describe("writing track by track, through real HTTP and PostgreSQL", () => {
  const cookie = () => author.cookie;
  let draft = "";
  let published = "";

  const versionOf = (entryId: string) =>
    scalar<number>("select version from entries where id = $1", [entryId]);

  const create = async (suffix: string) =>
    String(
      ok(
        await call(
          "createJournalAction",
          [
            {
              albumId: ids.album,
              locale: "en",
              body: `${label} ${suffix} body.`,
            },
          ],
          { cookie: cookie() },
        ),
      ).entryId,
    );

  it("saves reflections, marks, ratings, and the album rating in one request", async () => {
    draft = await create("draft");
    const saved = ok(
      await call(
        "saveJournalAction",
        [
          {
            entryId: draft,
            expectedVersion: 1,
            albumRating: 8,
            reflections: [
              {
                trackId: ids.track,
                isPublished: true,
                isFavourite: true,
                ratingHalfSteps: 7,
                texts: { en: `${label} first line\nsecond line` },
              },
            ],
          },
        ],
        { cookie: cookie(), routeId: draft },
      ),
    );
    expect(saved.version).toBe(2);
    const row = (
      await db.query(
        `select tr.is_published, tr.is_favourite, tr.rating_half_steps,
                trt.locale, trt.body_text, j.rating_half_steps as album_rating
           from track_reflections tr
           join track_reflection_texts trt on trt.track_reflection_id = tr.id
           join album_journals j on j.entry_id = tr.album_journal_id
          where tr.album_journal_id = $1`,
        [draft],
      )
    ).rows[0];
    expect(row).toEqual({
      is_published: true,
      is_favourite: true,
      rating_half_steps: 7,
      locale: "en",
      body_text: `${label} first line\nsecond line`,
      album_rating: 8,
    });
    // Set to show is not public: the journal is a draft.
    expect(
      await scalar<string>(
        "select status from entry_texts where entry_id = $1",
        [draft],
      ),
    ).toBe("draft");
  });

  it("refuses bad ratings, unknown tracks, and malformed reflections with fixed codes, and writes nothing", async () => {
    const before = await snapshot();
    const version = await versionOf(draft);
    for (const change of [
      { albumRating: 0 },
      { albumRating: 11 },
      { albumRating: 4.5 },
      { reflections: [{ trackId: ids.track, ratingHalfSteps: 1.5 }] },
      { reflections: [{ trackId: ids.track }] },
      {
        reflections: [
          { trackId: ids.track, isFavourite: true },
          { trackId: ids.track, isStillWriting: true },
        ],
      },
      { reflections: [{ trackId: ids.track, status: "published" }] },
      // A confirmation hidden inside a reflection is an unknown key.
      {
        reflections: [
          {
            trackId: ids.track,
            isFavourite: true,
            confirmation: "ct1.AAAA.BBBB",
          },
        ],
      },
      { reflections: [{ trackId: ids.track, texts: { fr: "x" } }] },
      {
        reflections: [
          { trackId: ids.track, texts: { en: "x".repeat(20_001) } },
        ],
      },
    ]) {
      expect(
        await call(
          "saveJournalAction",
          [{ entryId: draft, expectedVersion: version, ...change }],
          { cookie: cookie(), routeId: draft },
        ),
        JSON.stringify(change).slice(0, 80),
      ).toMatchObject({ ok: false, code: "invalid_input" });
    }
    // A recording that is not on this journal's album.
    expect(
      await call(
        "saveJournalAction",
        [
          {
            entryId: draft,
            expectedVersion: version,
            reflections: [{ trackId: ids.freeTrack, isFavourite: true }],
          },
        ],
        { cookie: cookie(), routeId: draft },
      ),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a change to a published journal's public page without the dialog's confirmation, and shows no writing in the answer", async () => {
    published = await create("published");
    ok(
      await call(
        "saveJournalAction",
        [
          {
            entryId: published,
            expectedVersion: 1,
            reflections: [
              {
                trackId: ids.track,
                isPublished: true,
                texts: { en: `${label} public reflection` },
              },
            ],
          },
        ],
        { cookie: cookie(), routeId: published },
      ),
    );
    // Published through the studio's own two requests: a preview, then the
    // publish with the token the preview returned.
    const shown = ok(
      await call(
        "previewPublicationAction",
        [{ entryId: published, locale: "en" }],
        { cookie: cookie(), routeId: published },
      ),
    );
    ok(
      await call(
        "publishJournalVersionAction",
        [
          {
            entryId: published,
            locale: "en",
            expectedVersion: await versionOf(published),
            confirmation: shown.confirmation,
          },
        ],
        { cookie: cookie(), routeId: published },
      ),
    );
    const before = await snapshot();
    const version = await versionOf(published);
    for (const [extra, code] of [
      [{}, "confirmation_required"],
      // A token that is not of the token's form is an input error.
      [{ confirmation: "not-a-token" }, "invalid_input"],
      // One of the right form that this server never issued.
      [{ confirmation: "ct1.AAAA.BBBB" }, "confirmation_invalid"],
    ] as const) {
      const refused = await callRaw(
        "saveJournalAction",
        [
          {
            entryId: published,
            expectedVersion: version,
            body: `${label} a changed public text`,
            ...extra,
          },
        ],
        { cookie: cookie(), routeId: published },
      );
      expect(refused.result).toMatchObject({ ok: false, code });
      // No writing, no disclosure, and no token in the refusal.
      expect(refused.text).not.toContain(label);
      expect(refused.text).not.toContain("ct1.");
    }
    for (const change of [
      { albumRating: 6 },
      { reflections: [{ trackId: ids.track, isFavourite: true }] },
      {
        reflections: [
          { trackId: ids.track, texts: { en: `${label} shorter` } },
        ],
      },
    ]) {
      expect(
        await call(
          "saveJournalAction",
          [{ entryId: published, expectedVersion: version, ...change }],
          { cookie: cookie(), routeId: published },
        ),
      ).toEqual({ ok: false, code: "confirmation_required" });
    }
    expect(await snapshot()).toEqual(before);

    // A removal needs no confirmation: unflagging is saved.
    ok(
      await call(
        "saveJournalAction",
        [
          {
            entryId: published,
            expectedVersion: version,
            reflections: [{ trackId: ids.track, isPublished: false }],
          },
        ],
        { cookie: cookie(), routeId: published },
      ),
    );
    expect(
      await scalar<boolean>(
        "select is_published from track_reflections where album_journal_id = $1",
        [published],
      ),
    ).toBe(false);
  });

  it("is refused for a visitor, whatever the reflection says, and writes nothing", async () => {
    const before = await snapshot();
    for (const cookieHeader of [
      undefined,
      "refrain.session_token=forged.value",
    ]) {
      expect(
        await call(
          "saveJournalAction",
          [
            {
              entryId: draft,
              expectedVersion: await versionOf(draft),
              reflections: [{ trackId: ids.track, isFavourite: false }],
            },
          ],
          { cookie: cookieHeader, routeId: draft },
        ),
      ).toEqual({ ok: false, code: "unauthorized" });
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe("publishing from the studio, through real HTTP and PostgreSQL", () => {
  const cookie = () => author.cookie;

  const statusOf = (entryId: string, locale = "en") =>
    scalar<string>(
      "select status from entry_texts where entry_id = $1 and locale = $2",
      [entryId, locale],
    );
  const versionOf = (entryId: string) =>
    scalar<number>("select version from entries where id = $1", [entryId]);

  // A journal with writing, an album rating, and one track reflection that is
  // set to show, so there is something to disclose.
  async function written(suffix: string): Promise<string> {
    const entryId = String(
      ok(
        await call(
          "createJournalAction",
          [
            {
              albumId: ids.album,
              locale: "en",
              opening: `${label} ${suffix} opening`,
              body: `${label} ${suffix} body.`,
            },
          ],
          { cookie: cookie() },
        ),
      ).entryId,
    );
    ok(
      await call(
        "saveJournalAction",
        [
          {
            entryId,
            expectedVersion: 1,
            albumRating: 9,
            reflections: [
              {
                trackId: ids.track,
                isPublished: true,
                texts: { en: `${label} ${suffix} track words` },
              },
            ],
          },
        ],
        { cookie: cookie(), routeId: entryId },
      ),
    );
    return entryId;
  }

  const preview = async (entryId: string, asCookie = cookie()) =>
    ok(
      await call("previewPublicationAction", [{ entryId, locale: "en" }], {
        cookie: asCookie,
        routeId: entryId,
      }),
    ) as {
      confirmation: string;
      review: { text: unknown; reflections: unknown[] };
    };

  const publish = async (
    entryId: string,
    confirmation: unknown,
    options: { cookie?: string; expectedVersion?: number } = {},
  ) =>
    call(
      "publishJournalVersionAction",
      [
        {
          entryId,
          locale: "en",
          expectedVersion:
            options.expectedVersion ?? (await versionOf(entryId)),
          ...(confirmation === undefined ? {} : { confirmation }),
        },
      ],
      { cookie: options.cookie ?? cookie(), routeId: entryId },
    );

  let live = "";

  it("previews what readers would see with a token, and publishes nothing", async () => {
    const entryId = await written("preview");
    const before = await snapshot();
    const shown = await callRaw(
      "previewPublicationAction",
      [{ entryId, locale: "en" }],
      { cookie: cookie(), routeId: entryId },
    );
    expect(shown.result).toMatchObject({ ok: true });
    // Private writing goes only to the author's request, and is never cached.
    expect(shown.headers.get("cache-control")).toContain("no-store");
    const data = dataOf(shown.result);
    expect(data.confirmation).toMatch(/^ct1\./);
    expect(data.expiresAtMs).toBeGreaterThan(Date.now());
    expect(data.review).toMatchObject({
      entryId,
      locale: "en",
      status: "draft",
      opening: `${label} preview opening`,
      text: [[`${label} preview body.`]],
      albumRating: { halfSteps: 9, alreadyPublic: false },
    });
    expect(data.review.reflections).toHaveLength(1);
    expect(data.review.reflections[0].text).toEqual([
      [`${label} preview track words`],
    ]);
    // A preview changes nothing, anywhere.
    expect(await snapshot()).toEqual(before);
    expect(await statusOf(entryId)).toBe("draft");
  });

  it("refuses a preview of anything that cannot be published, with fixed codes and no writing", async () => {
    const entryId = await written("refused");
    const before = await snapshot();
    const cases: [string, unknown, string][] = [
      ["an unknown journal", { entryId: NOWHERE, locale: "en" }, "not_found"],
      ["a malformed id", { entryId: "nope", locale: "en" }, "invalid_input"],
      [
        "a language that does not exist",
        { entryId, locale: "fr" },
        "invalid_input",
      ],
      [
        "a language version not written",
        { entryId, locale: "pt-BR" },
        "not_found",
      ],
      [
        "an extra field",
        { entryId, locale: "en", status: "published" },
        "invalid_input",
      ],
      ["no input", undefined, "invalid_input"],
    ];
    for (const [what, input, code] of cases) {
      const refused = await callRaw("previewPublicationAction", [input], {
        cookie: cookie(),
        routeId: entryId,
      });
      expect(refused.result, what).toMatchObject({ ok: false, code });
      expect(refused.text, what).not.toMatch(
        /select |insert |constraint|\bat \//i,
      );
      expect(refused.text, what).not.toContain("ct1.");
    }
    expect(await snapshot()).toEqual(before);
  });

  it("publishes only with the token that a preview returned, to this session, for this journal", async () => {
    live = await written("live");
    const mine = await preview(live);
    // Another journal, with its own preview, for the wrong-journal case.
    const elsewhere = await written("elsewhere");
    const theirs = await preview(elsewhere);
    const before = await snapshot();

    // No confirmation at all.
    expect(await publish(live, undefined)).toEqual({
      ok: false,
      code: "confirmation_required",
    });
    // Not of the token's form: an input error.
    for (const bad of ["", "x", "ct1", "not-a-token"]) {
      expect(await publish(live, bad)).toMatchObject({
        ok: false,
        code: "invalid_input",
      });
    }
    // The right form, never issued by this server.
    expect(await publish(live, "ct1.AAAA.BBBB")).toEqual({
      ok: false,
      code: "confirmation_invalid",
    });
    // Another session of the same author cannot use this session's token.
    const other = await mintAuthorSession(db, secret);
    expect(
      await publish(live, mine.confirmation, { cookie: other.cookie }),
    ).toEqual({
      ok: false,
      code: "confirmation_invalid",
    });
    // Another journal's token.
    expect(await publish(live, theirs.confirmation)).toEqual({
      ok: false,
      code: "confirmation_invalid",
    });
    // A stale editor.
    expect(await publish(live, undefined, { expectedVersion: 99 })).toEqual({
      ok: false,
      code: "conflict",
    });
    expect(await snapshot()).toEqual(before);
    expect(await statusOf(live)).toBe("draft");

    // With the token from its own preview, it publishes, and the answer
    // carries no token.
    const done = await callRaw(
      "publishJournalVersionAction",
      [
        {
          entryId: live,
          locale: "en",
          expectedVersion: await versionOf(live),
          confirmation: mine.confirmation,
        },
      ],
      { cookie: cookie(), routeId: live },
    );
    expect(done.result).toEqual({ ok: true, data: { changed: true } });
    // The token is never echoed. (A success also carries the re-rendered
    // studio page, which is the author's own page for their own request.)
    expect(done.text).not.toContain("ct1.");
    expect(await statusOf(live)).toBe("published");
    expect(
      await scalar<boolean>(
        "select was_published from entry_slugs where entry_id = $1 and is_current",
        [live],
      ),
    ).toBe(true);
    // Publishing changed no reflection's own setting.
    expect(
      await scalar<boolean>(
        "select is_published from track_reflections where album_journal_id = $1",
        [live],
      ),
    ).toBe(true);
    // The token is spent: the state it described is gone.
    expect(await publish(live, mine.confirmation)).toMatchObject({
      ok: false,
    });
    expect(elsewhere).not.toBe(live);
  });

  it("lets exactly one of two simultaneous confirmations through", async () => {
    const entryId = await written("double");
    const shown = await preview(entryId);
    const version = await versionOf(entryId);
    const results = await Promise.all([
      publish(entryId, shown.confirmation, { expectedVersion: version }),
      publish(entryId, shown.confirmation, { expectedVersion: version }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({
      ok: false,
      code: "confirmation_stale",
    });
    expect(await statusOf(entryId)).toBe("published");
  });

  it("refuses a token once the journal changed after the preview", async () => {
    const entryId = await written("changed");
    const shown = await preview(entryId);
    const version = await versionOf(entryId);
    ok(
      await call(
        "saveJournalAction",
        [
          {
            entryId,
            expectedVersion: version,
            body: `${label} written again.`,
          },
        ],
        { cookie: cookie(), routeId: entryId },
      ),
    );
    // The editor that held the preview is stale...
    expect(
      await publish(entryId, shown.confirmation, { expectedVersion: version }),
    ).toEqual({ ok: false, code: "conflict" });
    // ...and the token is not accepted for the new version either.
    expect(await publish(entryId, shown.confirmation)).toEqual({
      ok: false,
      code: "confirmation_invalid",
    });
    expect(await statusOf(entryId)).toBe("draft");
    // A new preview shows the new writing.
    const fresh = await preview(entryId);
    expect(fresh.review.text).toEqual([[`${label} written again.`]]);
  });

  it("edits published writing only with the confirmation of exactly that change", async () => {
    const version = await versionOf(live);
    const shorter = {
      entryId: live,
      expectedVersion: version,
      body: `${label} short`,
    };
    const before = await snapshot();

    // Without it, and with a token that was never issued: refused, nothing saved.
    expect(
      await call("saveJournalAction", [shorter], {
        cookie: cookie(),
        routeId: live,
      }),
    ).toEqual({ ok: false, code: "confirmation_required" });
    expect(
      await call(
        "saveJournalAction",
        [{ ...shorter, confirmation: "ct1.AAAA.BBBB" }],
        {
          cookie: cookie(),
          routeId: live,
        },
      ),
    ).toEqual({ ok: false, code: "confirmation_invalid" });
    expect(await snapshot()).toEqual(before);

    // The preview names the change, mints a token, and writes nothing.
    const shown = await callRaw("previewPublicChangeAction", [shorter], {
      cookie: cookie(),
      routeId: live,
    });
    expect(shown.headers.get("cache-control")).toContain("no-store");
    const data = dataOf(shown.result);
    expect(data.confirmation).toMatch(/^ct1\./);
    expect(data.review.changes).toEqual([
      {
        kind: "edited",
        label: "Your reflection",
        locale: "en",
        before: { type: "text", text: [[`${label} live body.`]] },
        after: { type: "text", text: [[`${label} short`]] },
      },
    ]);
    expect(await snapshot()).toEqual(before);

    // Another session's token is refused.
    const other = await mintAuthorSession(db, secret);
    const theirs = ok(
      await call("previewPublicChangeAction", [shorter], {
        cookie: other.cookie,
        routeId: live,
      }),
    );
    expect(
      await call(
        "saveJournalAction",
        [{ ...shorter, confirmation: theirs.confirmation }],
        { cookie: cookie(), routeId: live },
      ),
    ).toEqual({ ok: false, code: "confirmation_invalid" });
    expect(await snapshot()).toEqual(before);

    // The author's own token saves exactly that change, once.
    const saved = ok(
      await call(
        "saveJournalAction",
        [{ ...shorter, confirmation: data.confirmation }],
        { cookie: cookie(), routeId: live },
      ),
    );
    expect(saved.version).toBe(version + 1);
    expect(
      await scalar<string>(
        "select body_text from entry_texts where entry_id = $1",
        [live],
      ),
    ).toBe(`${label} short`);
    expect(
      await call(
        "saveJournalAction",
        [
          {
            ...shorter,
            expectedVersion: version + 1,
            confirmation: data.confirmation,
          },
        ],
        { cookie: cookie(), routeId: live },
      ),
    ).toMatchObject({ ok: false });

    // A change that touches nothing readers see has nothing to confirm.
    const quiet = ok(
      await call(
        "previewPublicChangeAction",
        [
          {
            entryId: live,
            expectedVersion: version + 1,
            reflections: [{ trackId: ids.track, isPublished: false }],
          },
        ],
        { cookie: cookie(), routeId: live },
      ),
    );
    expect(quiet.confirmation).toBeNull();
  });

  it("unpublishes one language version and deletes nothing", async () => {
    const entryId = await written("unpublish");
    await publish(entryId, (await preview(entryId)).confirmation);
    expect(await statusOf(entryId)).toBe("published");
    const history = await scalar<string>(
      "select first_published_at::text from entry_texts where entry_id = $1",
      [entryId],
    );
    const text = await scalar<string>(
      "select body_text from entry_texts where entry_id = $1",
      [entryId],
    );

    expect(
      await call(
        "setJournalPrivacyAction",
        [{ entryId, locale: "en", status: "private" }],
        { cookie: cookie(), routeId: entryId },
      ),
    ).toMatchObject({ ok: true });
    expect(await statusOf(entryId)).toBe("private");
    expect(
      await scalar<string | null>(
        "select published_at::text from entry_texts where entry_id = $1",
        [entryId],
      ),
    ).toBeNull();
    expect(
      await scalar<string>(
        "select first_published_at::text from entry_texts where entry_id = $1",
        [entryId],
      ),
    ).toBe(history);
    expect(
      await scalar<string>(
        "select body_text from entry_texts where entry_id = $1",
        [entryId],
      ),
    ).toBe(text);
    // Its address stays reserved.
    expect(
      await scalar<boolean>(
        "select was_published from entry_slugs where entry_id = $1 and is_current",
        [entryId],
      ),
    ).toBe(true);
    // It cannot be "unpublished" into published.
    expect(
      await call(
        "setJournalPrivacyAction",
        [{ entryId, locale: "en", status: "published" }],
        { cookie: cookie(), routeId: entryId },
      ),
    ).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("returns a deleted, published journal private, and publishes it again only after a new review", async () => {
    const entryId = await written("restore");
    const first = await preview(entryId);
    ok(await publish(entryId, first.confirmation));

    ok(
      await call("deleteJournalAction", [entryId], {
        cookie: cookie(),
        routeId: entryId,
      }),
    );
    // Nothing can be previewed or published while it is deleted.
    expect(
      await call("previewPublicationAction", [{ entryId, locale: "en" }], {
        cookie: cookie(),
        routeId: entryId,
      }),
    ).toEqual({ ok: false, code: "deleted" });
    expect(await publish(entryId, first.confirmation)).toEqual({
      ok: false,
      code: "deleted",
    });

    const restored = ok(
      await call("restoreJournalAction", [entryId], {
        cookie: cookie(),
        routeId: entryId,
      }),
    );
    expect(restored.madePrivate).toEqual(["en"]);
    expect(await statusOf(entryId)).toBe("private");

    // The review from before the deletion is stale, and no token is refused.
    expect(await publish(entryId, first.confirmation)).toEqual({
      ok: false,
      code: "confirmation_stale",
    });
    expect(await publish(entryId, undefined)).toEqual({
      ok: false,
      code: "confirmation_required",
    });
    expect(await statusOf(entryId)).toBe("private");

    // A new review shows the reflection that was set to show before.
    const second = await preview(entryId);
    expect(second.review.reflections).toHaveLength(1);
    ok(await publish(entryId, second.confirmation));
    expect(await statusOf(entryId)).toBe("published");
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
      // Publication (ADR 0006 § 10): both previews return private writing, so
      // they are refused to a visitor too.
      previewPublicationAction: {
        args: [{ entryId: ids.journal, locale: "en" }],
        routeId: ids.journal,
      },
      previewPublicChangeAction: {
        args: [
          {
            entryId: ids.journal,
            expectedVersion: journalVersion,
            body: `${label} hijacked words`,
          },
        ],
        routeId: ids.journal,
      },
      publishJournalVersionAction: {
        args: [
          {
            entryId: ids.journal,
            locale: "en",
            expectedVersion: journalVersion,
            confirmation: "ct1.AAAA.BBBB",
          },
        ],
        routeId: ids.journal,
      },
      deleteJournalAction: { args: [ids.journal], routeId: ids.journal },
      // A journal that really is in Recently deleted, so a restore that got
      // through would visibly change the database.
      restoreJournalAction: {
        args: [ids.recoverable],
        routeId: ids.recoverable,
      },
    };
  }

  it("covers every server action in the build", () => {
    expect(Object.keys(attempts()).sort()).toEqual(Object.keys(actions).sort());
    expect(Object.keys(actions).length).toBeGreaterThanOrEqual(26);
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

  it("requires the request's own Origin for every action, even with the author's session", async () => {
    // Next.js accepts an action call that has no Origin header, so each action
    // goes through perform(), which refuses it. The call below is made for
    // all of them, with valid arguments for records that exist, so a missing
    // check would write. (A foreign Origin is stopped by Next.js itself.)
    const before = await snapshot();
    for (const [name, { args, routeId }] of Object.entries(attempts())) {
      for (const origin of [null, `${base}/`]) {
        const result = await call(name, args, {
          cookie: author.cookie,
          routeId,
          origin,
        });
        expect(result, `${name} with Origin ${String(origin)}`).toEqual({
          ok: false,
          code: "unauthorized",
        });
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  it("ignores prototype-pollution keys, and still applies the fields it is given", async () => {
    // JSON.parse makes `__proto__` an own key, as a hostile client could send.
    const before = await snapshot();
    for (const polluted of [
      '{"__proto__":{"sortName":"POLLUTED"},"constructor":{"prototype":{"kind":"person"}}}',
      '{"__proto__":{"name":"POLLUTED"}}',
    ]) {
      const result = await call(
        "updateArtistAction",
        [ids.artist, JSON.parse(polluted)],
        { cookie: author.cookie, routeId: ids.artist },
      );
      expect(result).toMatchObject({ ok: false, code: "invalid_input" });
    }
    expect(await snapshot()).toEqual(before);
    // Beside a real field, only that field changes.
    const current = await scalar<string | null>(
      "select sort_name from artists where id = $1",
      [ids.artist],
    );
    // The real field repeats the stored kind, so the shared fixture is unchanged.
    const kind = await scalar<string>(
      "select kind from artists where id = $1",
      [ids.artist],
    );
    const withReal = JSON.parse(
      `{"__proto__":{"sortName":"POLLUTED"},"kind":"${kind}"}`,
    );
    ok(
      await call("updateArtistAction", [ids.artist, withReal], {
        cookie: author.cookie,
        routeId: ids.artist,
      }),
    );
    expect(
      await scalar<string | null>(
        "select sort_name from artists where id = $1",
        [ids.artist],
      ),
    ).toBe(current);
    // A liveness probe only: the assertions above are what show that the
    // polluted keys were ignored.
    const after = await get("/studio/sign-in");
    expect(after.status).toBe(200);
    await after.body?.cancel();
  });

  it("answers a malformed action body, before any session check, without leaking or falling over", async () => {
    // Next.js decodes an action's arguments before the action runs, so a body
    // that is not valid Flight data fails there. It must reveal nothing, write
    // nothing, and leave the server up (docs/security.md, issue #11).
    const before = await snapshot();
    const action = actions.deleteJournalAction!;
    for (const body of [
      '{"name":"$B1"}',
      '["$F1"]',
      '["$Q9"]',
      "[",
      "\u0000",
    ]) {
      const response = await fetch(
        `${base}${action.route.replace("[id]", ids.journal)}`,
        {
          method: "POST",
          redirect: "manual",
          headers: {
            origin: base,
            "content-type": "text/plain;charset=UTF-8",
            "next-action": action.id,
          },
          body,
        },
      );
      const text = await response.text();
      // Next.js answers a body it cannot decode with a bare 500 and a digest.
      expect(response.status, body).toBe(500);
      expect(text).not.toContain(label);
      expect(text).not.toMatch(/\sat\s|node_modules|select |insert /i);
    }
    expect(await snapshot()).toEqual(before);
    const alive = await get("/studio/sign-in");
    expect(alive.status).toBe(200);
    await alive.body?.cancel();
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
      "/studio/journals/deleted",
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
      "/studio/journals/deleted",
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

describe("recovering a journal from Recently deleted, through real HTTP and PostgreSQL", () => {
  const cookie = () => author.cookie;

  const texts = async (entryId: string) =>
    (
      await db.query(
        `select locale, status, published_at, first_published_at, opening,
                body, body_text
           from entry_texts where entry_id = $1 order by locale`,
        [entryId],
      )
    ).rows;
  const entryRow = async (entryId: string) =>
    (
      await db.query(
        "select deleted_at, first_published_at, version from entries where id = $1",
        [entryId],
      )
    ).rows[0];
  const slugs = async (entryId: string) =>
    (
      await db.query(
        "select kind, slug, is_current, was_published from entry_slugs where entry_id = $1 order by slug",
        [entryId],
      )
    ).rows;

  it("lists the journal on the Recently deleted page, for the author only", async () => {
    const page = await get("/studio/journals/deleted", {
      cookie: cookie(),
    });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toContain("no-store");
    const html = await page.text();
    expect(html).toContain("Recently deleted");
    expect(html).toContain(label); // the album title
    expect(html).toContain("Restore…");
    // The words promise only what is built (ADR 0002, INV-4).
    expect(html).toContain("nothing removes it automatically");
    expect(html).toContain("Permanent deletion is not offered yet");
    expect(html).not.toMatch(/30 days|gone in|will be deleted|purged/i);
    expect(html).not.toMatch(/Delete now|Delete permanently|Delete forever/);

    const anonymous = await (await get("/studio/journals/deleted")).text();
    expect(anonymous).not.toContain(label);
    expect(anonymous).not.toContain("Restore…");
    expect(anonymous).toContain("NEXT_REDIRECT;replace;/studio/sign-in;307;");
  });

  it("restores a private journal with every paragraph intact, and the page says so", async () => {
    const before = await texts(ids.recoverable);
    const slugsBefore = await slugs(ids.recoverable);
    const entryBefore = await entryRow(ids.recoverable);
    expect(before[0]).toMatchObject({ status: "private" });

    const result = ok(
      await call("restoreJournalAction", [ids.recoverable], {
        cookie: cookie(),
        routeId: ids.recoverable,
      }),
    );
    expect(result).toEqual({ madePrivate: [] });

    expect(await texts(ids.recoverable)).toEqual(before);
    expect(await slugs(ids.recoverable)).toEqual(slugsBefore);
    expect(await entryRow(ids.recoverable)).toEqual({
      ...entryBefore,
      deleted_at: null,
    });

    const html = await (
      await get(`/studio/journals/${ids.recoverable}?restored=1`, {
        cookie: cookie(),
      })
    ).text();
    expect(html).toContain("Restored from Recently deleted");
    expect(html).toContain("Recoverable second paragraph.");
    expect(html).toContain("Recoverable third.");
    expect(html).toContain("Edit this journal");
    expect(html).not.toContain("until you restore it");

    // It is among the live journals again, and out of Recently deleted.
    const list = await (
      await get("/studio/journals", { cookie: cookie() })
    ).text();
    expect(list).toContain("Recoverable second paragraph");
    const deletedPage = await (
      await get("/studio/journals/deleted", { cookie: cookie() })
    ).text();
    expect(deletedPage).not.toContain("Recoverable second paragraph");
  });

  it("answers a second restore with a fixed code and changes nothing", async () => {
    const before = await snapshot();
    expect(
      await call("restoreJournalAction", [ids.recoverable], {
        cookie: cookie(),
        routeId: ids.recoverable,
      }),
    ).toEqual({ ok: false, code: "not_deleted" });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses malformed, unknown, and other-kind ids with fixed codes", async () => {
    const before = await snapshot();
    for (const [argument, code] of [
      ["not-a-uuid", "invalid_input"],
      ["", "invalid_input"],
      [42, "invalid_input"],
      [null, "invalid_input"],
      [{ entryId: ids.recoverable }, "invalid_input"],
      [NOWHERE, "not_found"],
      // An artist's id is not a journal.
      [ids.artist, "not_found"],
    ] as const) {
      const result = await call("restoreJournalAction", [argument], {
        cookie: cookie(),
        routeId: ids.recoverable,
      });
      expect(result, JSON.stringify(argument)).toMatchObject({
        ok: false,
        code,
      });
      expect(JSON.stringify(result)).not.toMatch(/uuid|select |constraint/i);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("returns a journal that was published as private, and keeps its history and address", async () => {
    // The studio cannot publish, so the published state is set directly in
    // the disposable test database, as a later milestone's command would.
    const entryId = String(
      ok(
        await call(
          "createJournalAction",
          [
            {
              albumId: ids.album,
              locale: "en",
              body: `${label} once published.\n\nSecond paragraph of it.`,
            },
          ],
          { cookie: cookie() },
        ),
      ).entryId,
    );
    await db.query(
      `update entry_texts set status = 'published',
              published_at = timestamptz '2026-01-01 00:00:00+00',
              first_published_at = timestamptz '2026-01-01 00:00:00+00'
        where entry_id = $1`,
      [entryId],
    );
    await db.query(
      `update entries set first_published_at = timestamptz '2026-01-01 00:00:00+00'
        where id = $1`,
      [entryId],
    );
    await db.query(
      "update entry_slugs set was_published = true where entry_id = $1 and is_current",
      [entryId],
    );
    ok(
      await call("deleteJournalAction", [entryId], {
        cookie: cookie(),
        routeId: entryId,
      }),
    );
    // Deleted: the page says it was published, and that it returns private.
    const deletedHtml = await (
      await get("/studio/journals/deleted", { cookie: cookie() })
    ).text();
    expect(deletedHtml).toContain("English: published, returns as private");
    const before = await texts(entryId);
    const slugsBefore = await slugs(entryId);
    expect(before[0]).toMatchObject({ status: "published" });

    const result = ok(
      await call("restoreJournalAction", [entryId], {
        cookie: cookie(),
        routeId: entryId,
      }),
    );
    expect(result).toEqual({ madePrivate: ["en"] });

    const [after] = await texts(entryId);
    expect(after).toMatchObject({
      status: "private",
      published_at: null,
      body_text: before[0].body_text,
    });
    expect(new Date(after.first_published_at).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(after.body).toEqual(before[0].body);
    expect(
      new Date((await entryRow(entryId)).first_published_at).toISOString(),
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(await slugs(entryId)).toEqual(slugsBefore);
    expect((await entryRow(entryId)).deleted_at).toBeNull();
    // Nothing published remains, and the page says why it is private.
    expect(
      await scalar<number>(
        "select count(*)::int from entry_texts where entry_id = $1 and (status = 'published' or published_at is not null)",
        [entryId],
      ),
    ).toBe(0);
    const html = await (
      await get(`/studio/journals/${entryId}?restored=private`, {
        cookie: cookie(),
      })
    ).text();
    expect(html).toContain("that part is now private");
    expect(html).toContain("Nothing is published again until you choose to");
  });

  it("names a notice only from a fixed word, never from the query string", async () => {
    const hostile = encodeURIComponent("<script>window.__xss=2</script>");
    for (const value of [hostile, "yes", "private%00", "1&restored=private"]) {
      const html = await (
        await get(`/studio/journals/${ids.recoverable}?restored=${value}`, {
          cookie: cookie(),
        })
      ).text();
      expect(html).not.toContain("window.__xss=2");
      expect(html).not.toContain("Restored from Recently deleted");
    }
    // A stale link does not claim a restore for a journal that is deleted.
    ok(
      await call("deleteJournalAction", [ids.recoverable], {
        cookie: cookie(),
        routeId: ids.recoverable,
      }),
    );
    const stale = await (
      await get(`/studio/journals/${ids.recoverable}?restored=1`, {
        cookie: cookie(),
      })
    ).text();
    expect(stale).not.toContain("Restored from Recently deleted");
    expect(stale).toContain("until you restore it");
  });

  it("still refuses a restore with no Origin or a foreign one, with the author's session", async () => {
    const before = await snapshot();
    expect(
      await call("restoreJournalAction", [ids.recoverable], {
        cookie: cookie(),
        routeId: ids.recoverable,
        origin: null,
      }),
    ).toEqual({ ok: false, code: "unauthorized" });
    const action = actions.restoreJournalAction!;
    const foreign = await fetch(
      `${base}${action.route.replace("[id]", ids.recoverable)}`,
      {
        method: "POST",
        redirect: "manual",
        headers: {
          origin: "https://attacker.example",
          "content-type": "text/plain;charset=UTF-8",
          "next-action": action.id,
          cookie: cookie(),
        },
        body: JSON.stringify([ids.recoverable]),
      },
    );
    expect(foreign.status).not.toBe(200);
    await foreign.body?.cancel();
    expect(await snapshot()).toEqual(before);
    expect((await entryRow(ids.recoverable)).deleted_at).not.toBeNull();
  });

  it("answers a malformed restore body from a visitor with the framework's own error too: no session, no content, no change", async () => {
    // Next.js decodes the body before any session check, so a visitor gets the
    // framework's error (docs/security.md, deployment gate 3), never the
    // application's. Both must reveal nothing and write nothing.
    const before = await snapshot();
    const action = actions.restoreJournalAction!;
    for (const cookie of [undefined, "refrain.session_token=forged.value"]) {
      for (const body of ['{"name":"$B1"}', "[", "", "\u0000"]) {
        const response = await fetch(
          `${base}${action.route.replace("[id]", ids.recoverable)}`,
          {
            method: "POST",
            redirect: "manual",
            headers: {
              origin: base,
              "content-type": "text/plain;charset=UTF-8",
              "next-action": action.id,
              ...(cookie ? { cookie } : {}),
            },
            body,
          },
        );
        const text = await response.text();
        expect(response.status, body).toBe(500);
        expect(text).not.toContain(label);
        expect(text).not.toMatch(
          /\sat\s|node_modules|select |update |unauthorized/i,
        );
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  it("answers a malformed restore body with the framework's own error, writing nothing", async () => {
    const before = await snapshot();
    const action = actions.restoreJournalAction!;
    for (const body of ['{"name":"$B1"}', '["$F1"]', "[", "\u0000"]) {
      const response = await fetch(
        `${base}${action.route.replace("[id]", ids.recoverable)}`,
        {
          method: "POST",
          redirect: "manual",
          headers: {
            origin: base,
            "content-type": "text/plain;charset=UTF-8",
            "next-action": action.id,
            cookie: cookie(),
          },
          body,
        },
      );
      const text = await response.text();
      expect(response.status, body).toBe(500);
      expect(text).not.toContain(label);
      expect(text).not.toMatch(/\sat\s|node_modules|select |update /i);
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe("the journey ends cleanly", () => {
  it("moves the journal to Recently deleted and keeps it, then signs out for good", async () => {
    const writtenBeforeDelete = await scalar<string>(
      "select body_text from entry_texts where entry_id = $1",
      [ids.journal],
    );
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
    // The words say what happened and promise nothing that is not built: the
    // writing is kept, nothing removes it, restoring is offered, and there is
    // no permanent delete in the studio (INV-4).
    expect(list).toContain("not erased");
    expect(list).toContain("nothing removes it automatically");
    expect(list).toContain("permanent deletion is not offered yet");
    expect(list).not.toMatch(/30 days|gone in|will be deleted|purged/i);
    expect(list).not.toMatch(/Delete now|Delete permanently|Delete forever/);
    // The deleted journal is not among the live ones, and its page says the same.
    const deletedPage = await (
      await get(`/studio/journals/${ids.journal}`, { cookie: author.cookie })
    ).text();
    expect(deletedPage).toContain("Its writing is kept in the database");
    expect(deletedPage).toContain("until you restore it");
    expect(deletedPage).not.toMatch(/Delete now|Delete permanently/);
    expect(deletedPage).not.toMatch(
      /Edit this journal|Move to Recently deleted/,
    );
    // The writing is still in PostgreSQL, whole.
    expect(
      await scalar<string>(
        "select body_text from entry_texts where entry_id = $1",
        [ids.journal],
      ),
    ).toBe(writtenBeforeDelete);

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
    // A confirmation token is never logged (ADR 0006 § 3).
    expect(log).not.toContain("ct1.");
  });
});
