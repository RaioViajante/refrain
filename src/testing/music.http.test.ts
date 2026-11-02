// Add music and album artwork (M3.2) over real HTTP: the production build
// (`next start`), the disposable test database, and the local MusicBrainz and
// Cover Art Archive mock that the test server is always given
// (src/testing/production-server.ts), so nothing here reaches a real
// provider. The mock records every request it receives, which is how these
// tests see what the server sent out: its identification, its spacing, and
// that an anonymous request sends nothing at all.
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { CONTENT_SECURITY_POLICY } from "@/security-headers";
import {
  mintAuthorSession,
  removeMintedSessions,
  type MintedSession,
} from "@/testing/http-session";
import { removeMusicFixtureRecords } from "@/testing/music-records";
import { artistReview, releaseReviews } from "@/testing/music-reviews";
import { FIXTURE, SCENARIO } from "@/testing/provider-fixtures";
import { assertDisposableTestDatabase } from "@/testing/test-database";

const base = inject("studioBaseURL");
const secret = inject("studioCommandEnv").BETTER_AUTH_SECRET!;
const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const mock = inject("providerMockOrigin");

const USER_AGENT = "Refrain/0.1.0 ( https://github.com/RaioViajante/refrain )";
const FRONT = `https://coverartarchive.org/release/${FIXTURE.firstPressing}/${FIXTURE.frontImage}`;

let db: Client;
let author: MintedSession;

interface Recorded {
  path: string;
  userAgent: string;
  at: number;
}

async function recorded(): Promise<Recorded[]> {
  return (await (await fetch(`${mock}/__requests`)).json()) as Recorded[];
}

async function page(path: string, cookie?: string) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return { response, html: await response.text() };
}

// The build's table of server actions, as in studio-actions.http.test.ts.
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
        route: page.replace(/^app/, "").replace(/\/page$/, ""),
      };
    }
  }
  throw new Error(`No server action named ${name}.`);
}

async function call(name: string, input: unknown, routeId: string) {
  const action = actionId(name);
  const response = await fetch(
    `${base}${action.route.replace("[id]", routeId)}`,
    {
      method: "POST",
      redirect: "manual",
      headers: {
        origin: base,
        accept: "text/x-component",
        "content-type": "text/plain;charset=UTF-8",
        "next-action": action.id,
        cookie: author.cookie,
      },
      body: JSON.stringify([input]),
    },
  );
  const text = await response.text();
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    try {
      const value: unknown = JSON.parse(line.slice(colon + 1));
      if (typeof value === "object" && value !== null && "ok" in value) {
        return value as { ok: boolean; code?: string; data?: { id: string } };
      }
    } catch {
      // Not the result line.
    }
  }
  throw new Error(`No action result:\n${text.slice(0, 300)}`);
}

async function scalar<Value>(sql: string, params: unknown[] = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0] as Value;
}

beforeAll(async () => {
  db = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-music-tests",
  });
  await db.connect();
  await assertDisposableTestDatabase(db);
  await removeMusicFixtureRecords(db);
  author = await mintAuthorSession(db, secret);
});

afterAll(async () => {
  try {
    await removeMusicFixtureRecords(db);
    await removeMintedSessions(db);
  } finally {
    await db.end();
  }
});

describe("Add music without the author's session", () => {
  it("shows nothing and asks no provider anything", async () => {
    // A linked album, so the artwork page would ask the archive if it let
    // the request through.
    const linked = await scalar<string>(
      "insert into albums (title, mb_release_group_id) values ('[Test] HTTP linked', $1) returning id",
      [FIXTURE.paperMoonCover],
    );
    const before = (await recorded()).length;
    for (const path of [
      `/studio/albums/${linked}/artwork`,
      "/studio/catalog/add?q=paper%20moon",
      `/studio/catalog/add/album/${FIXTURE.paperMoon}`,
      `/studio/catalog/add/release/${FIXTURE.firstPressing}`,
      `/studio/catalog/add/artist/${FIXTURE.inkQuartet}`,
    ]) {
      const { html } = await page(path);
      expect(html, path).not.toContain("[Test] Paper Moon");
      expect(html, path).not.toContain("[Test] Ink Quartet");
      expect(html, path).not.toContain("[Test] HTTP linked");
      expect(html, path).toContain(
        "NEXT_REDIRECT;replace;/studio/sign-in;307;",
      );
    }
    expect((await recorded()).length).toBe(before);
  });
});

describe("Add music with the author's session", () => {
  it("searches MusicBrainz from the server, identified, with only the words typed", async () => {
    const { response, html } = await page(
      "/studio/catalog/add?q=Paper%20Moon",
      author.cookie,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toBe(
      CONTENT_SECURITY_POLICY,
    );
    expect(html).toContain("From MusicBrainz");
    expect(html).toContain("[Test] Paper Moon (Legacy Edition)");
    expect(html).toContain(`/studio/catalog/add/album/${FIXTURE.paperMoon}`);
    expect(html).toContain(
      "Data from MusicBrainz. Artwork from Cover Art Archive, added only if you choose it.",
    );
    const search = (await recorded()).filter((r) =>
      r.path.startsWith("/ws/2/release-group?"),
    );
    const last = new URL(`http://x${search.at(-1)!.path}`);
    expect(last.searchParams.get("query")).toBe(
      "(paper moon) OR artist:(paper moon)",
    );
    expect(last.searchParams.get("fmt")).toBe("json");
    // No cookie, session, or anything of the author's reaches the provider.
    for (const request of await recorded()) {
      expect(request.userAgent).toBe(USER_AGENT);
      expect(request.path).not.toContain(author.token);
    }
  });

  it("says when nothing is found, and when MusicBrainz cannot be reached", async () => {
    const nothing = await page(
      `/studio/catalog/add?q=${encodeURIComponent(SCENARIO.nothing)}`,
      author.cookie,
    );
    expect(nothing.html).toContain("Nothing found for");
    expect(nothing.html).toContain("Check the spelling, or try fewer words.");

    const before = (await recorded()).length;
    const down = await page(
      `/studio/catalog/add?q=${encodeURIComponent(SCENARIO.unavailable)}`,
      author.cookie,
    );
    expect(down.response.status).toBe(200);
    expect(down.html).toContain("Couldn’t reach MusicBrainz.");
    expect(down.html).toContain(
      "Your catalog and your writing still work. Try again in a moment.",
    );
    // The first try and two retries, no more.
    expect((await recorded()).length - before).toBe(3);
  });

  it("never sends two MusicBrainz requests within a second of each other", async () => {
    const times = (await recorded())
      .filter((r) => r.path.startsWith("/ws/2/"))
      .map((r) => r.at);
    expect(times.length).toBeGreaterThan(3);
    for (let index = 1; index < times.length; index++) {
      // 1.1 s apart, measured by another process's clock: allow 100 ms.
      expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(1000);
    }
  });

  it("lists the editions of a release group and reviews one without writing", async () => {
    const before = await scalar<string>("select count(*) from albums");
    const editions = await page(
      `/studio/catalog/add/album/${FIXTURE.paperMoon}`,
      author.cookie,
    );
    expect(editions.html).toContain("Choose an edition");
    expect(editions.html).toContain(
      `/studio/catalog/add/release/${FIXTURE.firstPressing}`,
    );
    const review = await page(
      `/studio/catalog/add/release/${FIXTURE.firstPressing}`,
      author.cookie,
    );
    expect(review.html).toContain("Add to catalog");
    expect(review.html).toContain("[Test] Second Verse");
    // The front cover is offered, built from validated parts; the back is not.
    expect(review.html).toContain(`${FRONT}-500.jpg`);
    expect(review.html).not.toContain(FIXTURE.backImage);
    expect(review.html).not.toContain("http://coverartarchive.org");
    expect(await scalar<string>("select count(*) from albums")).toBe(before);

    const unknown = await page(
      "/studio/catalog/add/release/00000000-0000-4000-8000-000000000000",
      author.cookie,
    );
    expect(unknown.html).not.toContain("Add to catalog");
  });

  it("imports only what was reviewed, with the chosen cover, and refuses it twice", async () => {
    const { review } = await releaseReviews(FIXTURE.firstPressing);
    const stale = await call(
      "importMusicReleaseAction",
      { releaseId: FIXTURE.firstPressing, review: "a".repeat(64) },
      FIXTURE.firstPressing,
    );
    expect(stale).toEqual({ ok: false, code: "stale" });

    const imported = await call(
      "importMusicReleaseAction",
      {
        releaseId: FIXTURE.firstPressing,
        review,
        coverImageId: FIXTURE.frontImage,
      },
      FIXTURE.firstPressing,
    );
    expect(imported.ok).toBe(true);
    const albumId = imported.data!.id;
    expect(
      (
        await db.query(
          `select a.title, a.cover_url, a.cover_source, ed.mb_release_id,
                  (select count(*)::int from edition_tracks et where et.edition_id = ed.id) as tracks
             from albums a join album_editions ed on ed.album_id = a.id and ed.is_reference
            where a.id = $1`,
          [albumId],
        )
      ).rows,
    ).toEqual([
      {
        title: "[Test] Paper Moon",
        cover_url: FRONT,
        cover_source: "Cover Art Archive",
        mb_release_id: FIXTURE.firstPressing,
        tracks: 3,
      },
    ]);
    expect(
      await scalar<string>(
        "select count(*) from entries e join album_journals aj on aj.entry_id = e.id where aj.album_id = $1",
        [albumId],
      ),
    ).toBe("0");

    const again = await call(
      "importMusicReleaseAction",
      { releaseId: FIXTURE.firstPressing, review },
      FIXTURE.firstPressing,
    );
    expect(again).toEqual({ ok: false, code: "duplicate" });

    // The album page shows the cover over its fallback, without a referrer.
    const albumPage = await page(`/studio/albums/${albumId}`, author.cookie);
    expect(albumPage.html).toContain(`src="${FRONT}-500.jpg"`);
    expect(albumPage.html).toMatch(/referrerpolicy="no-referrer"/i);
    expect(albumPage.html).toContain("Album artwork for [Test] Paper Moon");
  });

  it("adds and links artists without renaming anything", async () => {
    const review = await artistReview(FIXTURE.paperSinger);
    const added = await call(
      "importMusicArtistAction",
      { mbArtistId: FIXTURE.paperSinger, review },
      FIXTURE.paperSinger,
    );
    // The import above already added this artist as a credit.
    expect(added).toEqual({ ok: false, code: "duplicate" });
    const kept = await scalar<string>(
      "select name from artists where mb_artist_id = $1",
      [FIXTURE.paperSinger],
    );
    expect(kept).toBe("[Test] Paper Singer");
  });

  it("refuses an artwork change while a published journal shows the album", async () => {
    const albumId = await scalar<string>(
      "select id from albums where mb_release_group_id = $1",
      [FIXTURE.paperMoon],
    );
    const entry = await scalar<string>(
      "insert into entries (kind, first_published_at) values ('album_journal', now()) returning id",
    );
    await db.query(
      `insert into entry_texts (entry_id, locale, is_original, status, published_at, first_published_at, body_text)
       values ($1, 'en', true, 'published', now(), now(), '')`,
      [entry],
    );
    await db.query(
      "insert into album_journals (entry_id, album_id) values ($1, $2)",
      [entry, albumId],
    );

    const removal = await call(
      "removeAlbumArtworkAction",
      { albumId, expectedCoverUrl: FRONT },
      albumId,
    );
    expect(removal).toEqual({ ok: false, code: "public_page" });
    const artwork = await page(
      `/studio/albums/${albumId}/artwork`,
      author.cookie,
    );
    expect(artwork.html).toContain("Shown on a public page");
    expect(artwork.html).not.toContain("Use this cover");
    expect(
      await scalar<string>("select cover_url from albums where id = $1", [
        albumId,
      ]),
    ).toBe(FRONT);

    // Unpublished, the change is possible again, and stale views are refused.
    await db.query(
      "update entry_texts set status = 'private', published_at = null where entry_id = $1",
      [entry],
    );
    expect(
      await call(
        "removeAlbumArtworkAction",
        { albumId, expectedCoverUrl: null },
        albumId,
      ),
    ).toEqual({ ok: false, code: "stale" });
    expect(
      await call(
        "removeAlbumArtworkAction",
        { albumId, expectedCoverUrl: FRONT },
        albumId,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await call(
        "setAlbumArtworkAction",
        {
          albumId,
          releaseId: FIXTURE.legacyEdition,
          imageId: FIXTURE.legacyFrontImage,
          expectedCoverUrl: null,
        },
        albumId,
      ),
    ).toMatchObject({ ok: true });
  });
});
