// Artist photographs (M3.3) over real HTTP: the production build, the
// disposable test database, and the local Wikimedia mock the test server is
// always given (src/testing/production-server.ts), so nothing here reaches
// Wikimedia Commons or Wikidata. The mock records every request it receives,
// which is how these tests see what the server sent: its identification, its
// spacing, and that an anonymous request sends nothing at all.
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { STUDIO_CONTENT_SECURITY_POLICY } from "@/security-headers";
import {
  mintAuthorSession,
  removeMintedSessions,
  type MintedSession,
} from "@/testing/http-session";
import { photoReview } from "@/testing/music-reviews";
import { FIXTURE } from "@/testing/provider-fixtures";
import { assertDisposableTestDatabase } from "@/testing/test-database";
import {
  commonsThumbnail,
  PHOTO,
  PHOTO_SCENARIO,
  photoSha1,
} from "@/testing/wikimedia-fixtures";

const base = inject("studioBaseURL");
const secret = inject("studioCommandEnv").BETTER_AUTH_SECRET!;
const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const mock = inject("providerMockOrigin");

const USER_AGENT = "Refrain/0.1.0 ( https://github.com/RaioViajante/refrain )";
const PREFIX = "[Test] HTTP Photo";

let db: Client;
let author: MintedSession;
let linked: string;
let plain: string;

interface Recorded {
  path: string;
  userAgent: string;
  at: number;
}

async function recorded(): Promise<Recorded[]> {
  return (await (await fetch(`${mock}/__requests`)).json()) as Recorded[];
}

const wikimediaRequests = async () =>
  (await recorded()).filter((r) => /^\/(commons|wikidata)\//.test(r.path));

async function page(path: string, cookie?: string) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return { response, html: await response.text() };
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
        return value as { ok: boolean; code?: string };
      }
    } catch {
      // Not the result line.
    }
  }
  throw new Error(`No action result:\n${text.slice(0, 300)}`);
}

async function photoRow(id: string) {
  const result = await db.query<{
    photo_url: string | null;
    photo_credit: string | null;
    photo_license: string | null;
    photo_source_url: string | null;
    photo_file_sha1: string | null;
    photo_chosen_at: Date | null;
  }>(
    `select photo_url, photo_credit, photo_license, photo_source_url,
            photo_file_sha1, photo_chosen_at
       from artists where id = $1`,
    [id],
  );
  return result.rows[0]!;
}

/** The fingerprint of the stored photograph, from the artist page's form. */
async function expectedPhotoOf(id: string): Promise<string | null> {
  const { html } = await page(`/studio/artists/${id}/photo`, author.cookie);
  const match = /\\?"expectedPhoto\\?":\\?"([0-9a-f]{64})/.exec(html);
  return match ? match[1]! : null;
}

beforeAll(async () => {
  db = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-photo-tests",
  });
  await db.connect();
  await assertDisposableTestDatabase(db);
  await db.query("delete from artists where name like $1", [`${PREFIX}%`]);
  linked = (
    await db.query<{ id: string }>(
      "insert into artists (name, kind) values ($1, 'group') returning id",
      [`${PREFIX} Linked`],
    )
  ).rows[0]!.id;
  plain = (
    await db.query<{ id: string }>(
      "insert into artists (name, kind) values ($1, 'person') returning id",
      [`${PREFIX} Plain`],
    )
  ).rows[0]!.id;
  // HTTP test files run one at a time, and the music tests remove the
  // fixture artist with this MBID when they finish.
  await db.query("update artists set mb_artist_id = $1 where id = $2", [
    FIXTURE.inkQuartet,
    linked,
  ]);
  author = await mintAuthorSession(db, secret);
});

afterAll(async () => {
  try {
    await assertDisposableTestDatabase(db);
    await db.query("delete from artists where name like $1", [`${PREFIX}%`]);
    await removeMintedSessions(db);
  } finally {
    await db.end();
  }
});

describe("artist photographs without the author's session", () => {
  it("show nothing and ask Wikimedia nothing", async () => {
    const before = (await recorded()).length;
    for (const path of [
      `/studio/artists/${linked}`,
      `/studio/artists/${linked}/photo`,
      `/studio/artists/${linked}/photo?q=Ink%20Quartet`,
      `/studio/artists/${linked}/photo/review?file=${PHOTO.onStage}`,
    ]) {
      const { html } = await page(path);
      expect(html, path).not.toContain(PREFIX);
      expect(html, path).not.toContain("Photographer One");
      expect(html, path).toContain(
        "NEXT_REDIRECT;replace;/studio/sign-in;307;",
      );
    }
    expect((await recorded()).length).toBe(before);
  });
});

describe("artist photographs with the author's session", () => {
  it("search Commons from the server, identified, and offer only usable files", async () => {
    const { response, html } = await page(
      `/studio/artists/${plain}/photo?q=Ink%20Quartet`,
      author.cookie,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toBe(
      STUDIO_CONTENT_SECURITY_POLICY,
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(html).toContain("From Wikimedia Commons");
    for (const usable of [PHOTO.onStage, PHOTO.portrait, PHOTO.attributed]) {
      expect(html).toContain(commonsThumbnail(usable, 330));
    }
    for (const refused of [
      PHOTO.nonCommercial,
      PHOTO.unknownAuthor,
      PHOTO.mismatch,
      PHOTO.hostile,
      PHOTO.small,
      PHOTO.animated,
      PHOTO.ported,
      PHOTO.elsewhere,
    ]) {
      expect(html, refused).not.toContain(encodeURIComponent(refused));
    }
    expect(html).toContain("8 more files can’t be offered");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("images.example.test");
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
    const search = (await wikimediaRequests()).filter((r) =>
      r.path.includes("gsrsearch="),
    );
    const last = new URL(`http://x${search.at(-1)!.path}`);
    expect(last.pathname).toBe("/commons/w/api.php");
    expect(last.searchParams.get("gsrsearch")).toBe(
      "Ink Quartet filetype:bitmap",
    );
    for (const request of await wikimediaRequests()) {
      expect(request.userAgent).toBe(USER_AGENT);
      expect(request.path).not.toContain(author.token);
      expect(request.path).not.toContain(plain);
    }
  });

  it("suggest through Wikidata for a linked artist, and search nothing until asked", async () => {
    const before = await photoRow(linked);
    const { html } = await page(
      `/studio/artists/${linked}/photo`,
      author.cookie,
    );
    expect(html).toContain("Suggested through Wikidata");
    expect(html).toContain("That is a lead, not proof");
    expect(html).toContain(commonsThumbnail(PHOTO.onStage, 330));
    expect(html).toContain(commonsThumbnail(PHOTO.portrait, 330));
    expect(html).toContain("Search Wikimedia Commons for a photograph");
    expect(await photoRow(linked)).toEqual(before);
    const wikidata = (await wikimediaRequests()).filter((r) =>
      r.path.startsWith("/wikidata/"),
    );
    expect(
      wikidata.map(
        (r) => new URL(`http://x${r.path}`).searchParams.get("srsearch") ?? "",
      ),
    ).toContain(`haswbstatement:P434=${FIXTURE.inkQuartet}`);
  });

  it("never sends two Wikimedia requests closer than the spacing", async () => {
    const times = (await wikimediaRequests()).map((r) => r.at);
    expect(times.length).toBeGreaterThan(2);
    for (let index = 1; index < times.length; index++) {
      // 500 ms apart, measured by another process's clock: allow 50 ms.
      expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(450);
    }
  });

  it("say when nothing is found, and when Commons cannot be reached", async () => {
    const nothing = await page(
      `/studio/artists/${plain}/photo?q=${encodeURIComponent(PHOTO_SCENARIO.nothing)}`,
      author.cookie,
    );
    expect(nothing.html).toContain("Nothing found for");
    const before = (await wikimediaRequests()).length;
    const down = await page(
      `/studio/artists/${plain}/photo?q=${encodeURIComponent(PHOTO_SCENARIO.unavailable)}`,
      author.cookie,
    );
    expect(down.response.status).toBe(200);
    expect(down.html).toContain("Couldn’t reach Wikimedia Commons.");
    // The first try and two retries, no more.
    expect((await wikimediaRequests()).length - before).toBe(3);
  });

  it("review a file with its attribution, and write nothing", async () => {
    const before = await photoRow(plain);
    const { html } = await page(
      `/studio/artists/${plain}/photo/review?file=${PHOTO.onStage}`,
      author.cookie,
    );
    expect(html).toContain("Review photograph");
    expect(html).toContain("[Test] Photographer One");
    expect(html).toContain("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(html).toContain(
      `https://commons.wikimedia.org/wiki/File:${PHOTO.onStage}`,
    );
    expect(html).toContain("Personality rights");
    expect(html).toContain("Use this photograph");
    expect(await photoRow(plain)).toEqual(before);
  });

  it("explain a file that cannot be used, and never load it", async () => {
    const { html } = await page(
      `/studio/artists/${plain}/photo/review?file=${PHOTO.unknownAuthor}`,
      author.cookie,
    );
    expect(html).toContain("This photograph can’t be used.");
    expect(html).toContain("doesn’t name the photographer");
    expect(html).not.toContain(commonsThumbnail(PHOTO.unknownAuthor, 330));
    expect(html).not.toContain("Use this photograph");

    const gone = await page(
      `/studio/artists/${plain}/photo/review?file=${PHOTO.removed}`,
      author.cookie,
    );
    expect(gone.html).toContain("Wikimedia Commons has no such file.");

    const invalid = await page(
      `/studio/artists/${plain}/photo/review?file=..%2Fsecret.jpg`,
      author.cookie,
    );
    // Under Cache Components the not-found view streams with a 200 (M3.1).
    expect(invalid.html).toContain("This page is not available.");
    expect(invalid.html).not.toContain("Credit shown");
  });

  it("set only a reviewed file, refuse a stale view, and remove it", async () => {
    const review = await photoReview(PHOTO.onStage);
    const forged = await call(
      "setArtistPhotoAction",
      {
        artistId: plain,
        file: PHOTO.onStage,
        review: "a".repeat(64),
        expectedPhoto: null,
      },
      plain,
    );
    expect(forged).toEqual({ ok: false, code: "stale" });
    expect((await photoRow(plain)).photo_url).toBeNull();

    expect(
      await call(
        "setArtistPhotoAction",
        { artistId: plain, file: PHOTO.onStage, review, expectedPhoto: null },
        plain,
      ),
    ).toMatchObject({ ok: true });
    expect(await photoRow(plain)).toMatchObject({
      photo_url: commonsThumbnail(PHOTO.onStage, 330),
      photo_credit: "[Test] Photographer One",
      photo_license: "CC BY-SA 4.0",
      photo_file_sha1: photoSha1(PHOTO.onStage),
    });
    expect((await photoRow(plain)).photo_chosen_at).not.toBeNull();

    // The same view again: the photograph on file has changed since.
    expect(
      await call(
        "setArtistPhotoAction",
        { artistId: plain, file: PHOTO.onStage, review, expectedPhoto: null },
        plain,
      ),
    ).toEqual({ ok: false, code: "stale" });

    const artistPage = await page(`/studio/artists/${plain}`, author.cookie);
    // React separates the words of the credit line with comment markers.
    expect(artistPage.html).toMatch(
      /Photo: (?:<!-- -->)?\[Test\] Photographer One/,
    );
    expect(artistPage.html).toContain("Photo details");
    expect(artistPage.html).toContain(commonsThumbnail(PHOTO.onStage, 330));

    expect(
      await call(
        "removeArtistPhotoAction",
        { artistId: plain, expectedPhoto: "b".repeat(64) },
        plain,
      ),
    ).toEqual({ ok: false, code: "stale" });
    const expectedPhoto = await expectedPhotoOf(plain);
    expect(expectedPhoto).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await call(
        "removeArtistPhotoAction",
        { artistId: plain, expectedPhoto },
        plain,
      ),
    ).toMatchObject({ ok: true });
    expect(await photoRow(plain)).toMatchObject({
      photo_url: null,
      photo_credit: null,
      photo_file_sha1: null,
      photo_chosen_at: null,
    });
  });

  it("refuse a file that changed between the review and the approval", async () => {
    // The fixture's "changing" file has a new version on every lookup.
    const { html } = await page(
      `/studio/artists/${plain}/photo/review?file=${PHOTO.changing}`,
      author.cookie,
    );
    expect(html).toContain("Use this photograph");
    const fingerprint = /\\?"review\\?":\\?"([0-9a-f]{64})/.exec(html)?.[1];
    expect(fingerprint).toBeDefined();
    expect(
      await call(
        "setArtistPhotoAction",
        {
          artistId: plain,
          file: PHOTO.changing,
          review: fingerprint,
          expectedPhoto: null,
        },
        plain,
      ),
    ).toEqual({ ok: false, code: "stale" });
    expect((await photoRow(plain)).photo_url).toBeNull();
  });
});
