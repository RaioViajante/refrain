// The Writing Studio in Brazilian Portuguese over real HTTP, against the
// production build (ADR 0008 §§ 2, 8, and 9; ADR 0006 A7, item 7). Each
// `/pt/studio` page is an authorized page like its English form: the author
// gets it in Portuguese, with the same private data; everyone else is sent to
// the sign-in page of the same language, and sees none of it. The language
// never decides what is read, and a Server Action answers the same from either
// tree. The cache policy of every request form is held by
// studio-private-cache.http.test.ts, for both trees. Synthetic data only.
import { v3En } from "@/i18n/v3/en";
import { v3PtBR } from "@/i18n/v3/pt-BR";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestMemory,
} from "@/testing/fixtures";
import {
  mintAuthorSession,
  removeMintedSessions,
  type MintedSession,
} from "@/testing/http-session";
import { FIXTURE } from "@/testing/provider-fixtures";
import { request, visibleText } from "@/testing/public-http";
import { fixtureDatabase } from "@/testing/public-journals";
import { assertDisposableTestDatabase } from "@/testing/test-database";
import { PHOTO } from "@/testing/wikimedia-fixtures";
import { studioEn } from "@/i18n/studio/en";
import { studioPtBR } from "@/i18n/studio/pt-BR";

const base = inject("studioBaseURL");
const commandEnv = inject("studioCommandEnv");

const run = randomUUID().slice(0, 8);
const MARKERS = {
  artist: `[Test] PT3 ${run} private artist`,
  album: `[Test] PT3 ${run} private album`,
  journal: `[Test] PT3 ${run} private journal writing`,
  memory: `[Test] PT3 ${run} memória privada`,
  draftMemory: `[Test] PT3 ${run} draft memory`,
  publishedMemory: `[Test] PT3 ${run} published memory`,
};
const MARKER_LIST = Object.values(MARKERS);

let db: Client;
let author: MintedSession;
let ids: {
  artistId: string;
  albumId: string;
  trackIds: string[];
  journalId: string;
  memoryId: string;
  draftMemoryId: string;
  publishedMemoryId: string;
};

beforeAll(async () => {
  db = new Client({
    connectionString: commandEnv.DATABASE_URL!,
    application_name: "refrain-http-studio-portuguese",
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
    const journalId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      versions: [{ locale: "en", status: "private", text: MARKERS.journal }],
      slug: `t${run}-pt3-journal`,
    });
    // A memory written originally in Portuguese (ADR 0008 § 10).
    const memoryId = await createTestMemory(tx, {
      versions: [
        {
          locale: "pt-BR",
          status: "private",
          title: MARKERS.memory,
          text: MARKERS.memory,
        },
      ],
      slug: `t${run}-pt3-memoria`,
    });
    // A memory in each of the other two states, for what the Studio says
    // about publishing.
    const draftMemoryId = await createTestMemory(tx, {
      versions: [
        {
          locale: "en",
          status: "draft",
          title: MARKERS.draftMemory,
          text: MARKERS.draftMemory,
        },
      ],
      slug: `t${run}-pt3-draft`,
    });
    const publishedMemoryId = await createTestMemory(tx, {
      versions: [
        {
          locale: "en",
          status: "published",
          title: MARKERS.publishedMemory,
          text: MARKERS.publishedMemory,
        },
      ],
      slug: `t${run}-pt3-published`,
    });
    return {
      artistId,
      albumId: album.albumId,
      trackIds: album.trackIds,
      journalId,
      memoryId,
      draftMemoryId,
      publishedMemoryId,
    };
  });
}, 120_000);

afterAll(async () => {
  try {
    if (ids) {
      for (const entryId of [
        ids.journalId,
        ids.memoryId,
        ids.draftMemoryId,
        ids.publishedMemoryId,
      ]) {
        await db.query("delete from entry_slugs where entry_id = $1", [
          entryId,
        ]);
        await db.query("delete from entries where id = $1", [entryId]);
      }
      await db.query("delete from albums where id = $1", [ids.albumId]);
      await db.query("delete from tracks where id = any($1)", [ids.trackIds]);
      await db.query("delete from artists where id = $1", [ids.artistId]);
    }
    await removeMintedSessions(db);
  } finally {
    await db.end();
  }
});

/** A Studio page, its title in each language, and what the author sees on it. */
function studioPages(): {
  path: string;
  title: keyof typeof studioEn.meta;
  marker?: string;
  /** Where the selector leads, when it is not this page without its query. */
  pair?: string;
}[] {
  return [
    { path: "/studio", title: "studio", marker: MARKERS.album },
    { path: "/studio/catalog", title: "catalog" },
    { path: "/studio/catalog/add", title: "addMusic" },
    { path: "/studio/artists", title: "artists", marker: MARKERS.artist },
    { path: "/studio/artists/new", title: "newArtist" },
    { path: `/studio/artists/${ids.artistId}/photo`, title: "photo" },
    {
      path: `/studio/artists/${ids.artistId}/photo/review?file=${PHOTO.onStage}`,
      title: "photoReview",
      // A review needs its file, which the selector never copies from the
      // query: it leads to the artist's photograph page instead.
      pair: `/studio/artists/${ids.artistId}/photo`,
    },
    {
      path: `/studio/catalog/add/album/${FIXTURE.paperMoon}`,
      title: "chooseEdition",
    },
    {
      path: `/studio/catalog/add/release/${FIXTURE.firstPressing}`,
      title: "reviewBeforeAdding",
    },
    {
      path: `/studio/catalog/add/artist/${FIXTURE.inkQuartet}`,
      title: "reviewBeforeAdding",
    },
    {
      path: `/studio/artists/${ids.artistId}`,
      title: "artist",
      marker: MARKERS.artist,
    },
    { path: "/studio/albums", title: "albums", marker: MARKERS.album },
    { path: "/studio/albums/new", title: "newAlbum" },
    { path: `/studio/albums/${ids.albumId}/artwork`, title: "artwork" },
    {
      path: `/studio/albums/${ids.albumId}`,
      title: "album",
      marker: MARKERS.album,
    },
    { path: "/studio/tracks", title: "tracks" },
    { path: "/studio/tracks/new", title: "newTrack" },
    { path: `/studio/tracks/${ids.trackIds[0]}`, title: "track" },
    { path: "/studio/journals", title: "journals", marker: MARKERS.album },
    { path: "/studio/journals/new", title: "newJournal" },
    {
      path: `/studio/journals/${ids.journalId}`,
      title: "journal",
      marker: MARKERS.journal,
    },
    {
      path: `/studio/journals/${ids.journalId}/edit`,
      title: "editJournal",
      marker: MARKERS.journal,
    },
    { path: "/studio/journals/deleted", title: "deleted" },
    { path: "/studio/memories", title: "memories", marker: MARKERS.memory },
    { path: "/studio/memories/new", title: "newMemory" },
    {
      path: `/studio/memories/${ids.memoryId}`,
      title: "memory",
      marker: MARKERS.memory,
    },
  ];
}

function title(body: string): string {
  return body.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
}

/** The two addresses the footer's language selector links to. */
function selectorLinks(body: string): string[] {
  return [
    ...body.matchAll(/<a href="([^"]+)" hrefLang="[^"]+" lang="[^"]+"/gi),
  ].map((match) => match[1]!);
}

describe("each Portuguese Studio page, for the author", () => {
  it("is in Portuguese, with the author's own data, its title, and the selector's pair", async () => {
    for (const { path, title: key, marker, pair } of studioPages()) {
      const pt = await request(base, `/pt${path}`, {
        headers: { cookie: author.cookie },
      });
      const where = `/pt${path}`;
      expect(pt.status, where).toBe(200);
      expect(pt.body, where).toMatch(/<html[^>]*\blang="pt-BR"/);
      expect(title(pt.body), where).toBe(studioPtBR.meta[key]);
      expect(pt.body, where).toMatch(
        /<meta name="robots" content="noindex, nofollow"/,
      );
      const words = visibleText(pt.body);
      // v3: the sidebar's name and its link to the site, in Portuguese.
      expect(words, where).toContain("refrain");
      expect(words, where).toContain(v3PtBR.desk.s46);
      expect(words, where).not.toContain(studioEn.frame.studio);
      expect(words, where).not.toContain(studioEn.signOut.action);
      if (marker) {
        expect(pt.body, where).toContain(marker);
      }
      // The selector links to this page in each language, and nowhere else.
      const route = pair ?? path.split("?")[0]!;
      expect(selectorLinks(pt.body).sort(), where).toEqual(
        [route, `/pt${route}`].sort(),
      );
      // Every link inside the Studio keeps its language.
      const studioLinks = [
        ...pt.body.matchAll(/href="(\/(?:pt\/)?studio[^"]*)"/g),
      ].map((match) => match[1]!);
      const english = studioLinks.filter(
        (href) => href.startsWith("/studio") && href !== route,
      );
      expect(english, where).toEqual([]);
    }
  }, 120_000);

  it("is the same data as its English form, said in English there", async () => {
    for (const { path, title: key, marker, pair } of studioPages()) {
      const en = await request(base, path, {
        headers: { cookie: author.cookie },
      });
      expect(en.status, path).toBe(200);
      expect(en.body, path).toMatch(/<html[^>]*\blang="en"/);
      expect(title(en.body), path).toBe(studioEn.meta[key]);
      const words = visibleText(en.body);
      // v3: the sidebar's link to the site, in English.
      expect(words, path).toContain(v3En.desk.s46);
      expect(words, path).not.toContain(v3PtBR.desk.s46);
      if (marker) {
        expect(en.body, path).toContain(marker);
      }
      const route = pair ?? path.split("?")[0]!;
      expect(selectorLinks(en.body).sort(), path).toEqual(
        [route, `/pt${route}`].sort(),
      );
    }
  }, 120_000);

  it("never translates the writing: each shows in its own language, marked", async () => {
    for (const prefix of ["", "/pt"]) {
      const journal = await request(
        base,
        `${prefix}/studio/journals/${ids.journalId}`,
        { headers: { cookie: author.cookie } },
      );
      const escaped = MARKERS.journal.replace(/[[\]]/g, "\\$&");
      expect(journal.body).toMatch(
        new RegExp(`<article lang="en"[^>]*>[\\s\\S]*${escaped}`),
      );
      const memory = await request(
        base,
        `${prefix}/studio/memories/${ids.memoryId}`,
        { headers: { cookie: author.cookie } },
      );
      // The editor's fields carry the memory's own language.
      expect(memory.body).toMatch(/<textarea[^>]*lang="pt-BR"/);
      expect(memory.body).toContain(MARKERS.memory);
    }
  });

  it("keeps the selector to the page's own pair, whatever the query says", async () => {
    const path = `/studio/journals/${ids.journalId}`;
    const answer = await request(
      base,
      `/pt${path}?restored=1&next=//example.com&lang=en`,
      { headers: { cookie: author.cookie } },
    );
    expect(selectorLinks(answer.body).sort()).toEqual(
      [path, `/pt${path}`].sort(),
    );
    // No link is built from the query.
    expect(answer.body).not.toMatch(/href="[^"]*example\.com/);
  });
});

// Memories are published through the same review as album journals (M3.7):
// the Memories page once still said publishing them was not available, while
// each memory offered Publish…. The list and each memory's controls must say
// the same thing, in both languages, for a draft, a private, and a published
// memory.
describe("what the Studio says about publishing memories", () => {
  const RETIRED = [
    "Publishing memories isn’t available yet",
    "Publicar memórias ainda não está disponível",
  ];
  const languages = [
    { prefix: "", words: studioEn },
    { prefix: "/pt", words: studioPtBR },
  ];

  /** The visible text of a page the author opens. */
  async function authorPage(path: string): Promise<string> {
    const answer = await request(base, path, {
      headers: { cookie: author.cookie },
    });
    expect(answer.status, path).toBe(200);
    return visibleText(answer.body);
  }

  it("never says on the Memories page that publishing is unavailable", async () => {
    for (const { prefix, words } of languages) {
      const where = `${prefix}/studio/memories`;
      const answer = await request(base, where, {
        headers: { cookie: author.cookie },
      });
      expect(answer.status, where).toBe(200);
      const page = visibleText(answer.body);
      // Each memory's own row carries its own status.
      const rows = [...answer.body.matchAll(/<li\b[\s\S]*?<\/li>/g)].map(
        (match) => visibleText(match[0]),
      );
      for (const [marker, status] of [
        [MARKERS.memory, words.memoryStatus.private],
        [MARKERS.draftMemory, words.memoryStatus.draft],
        [MARKERS.publishedMemory, words.memoryStatus.published],
      ] as const) {
        const row = rows.filter((text) => text.includes(marker));
        expect(row, `${where} ${marker}`).toHaveLength(1);
        expect(row[0], `${where} ${marker}`).toContain(status);
      }
      for (const retired of RETIRED) {
        expect(page, where).not.toContain(retired);
      }
    }
  });

  it("offers Publish… on a draft and on a private memory, ready to press", async () => {
    for (const { prefix, words } of languages) {
      for (const [id, status] of [
        [ids.draftMemoryId, "draft"],
        [ids.memoryId, "private"],
      ] as const) {
        const where = `${prefix}/studio/memories/${id}`;
        const answer = await request(base, where, {
          headers: { cookie: author.cookie },
        });
        expect(answer.status, where).toBe(200);
        const publish = [
          ...answer.body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g),
        ].filter((match) =>
          visibleText(match[2]!).includes(words.visibility.publish),
        );
        expect(publish, where).toHaveLength(1);
        expect(publish[0]![1], where).not.toMatch(/\sdisabled(?:=|\s|$)/);
        expect(publish[0]![1], where).not.toMatch(/aria-disabled="true"/);
        const page = visibleText(answer.body);
        expect(page, where).toContain(words.memoryControls.states[status]);
        expect(page, where).toContain(words.visibility.privateHint);
        expect(page, where).not.toContain(words.visibility.unpublish);
        for (const retired of RETIRED) {
          expect(page, where).not.toContain(retired);
        }
      }
    }
  });

  it("offers Unpublish… on a published memory, and says what published means", async () => {
    for (const { prefix, words } of languages) {
      const where = `${prefix}/studio/memories/${ids.publishedMemoryId}`;
      const page = await authorPage(where);
      expect(page, where).toContain(words.memoryControls.states.published);
      expect(page, where).toContain(words.visibility.unpublish);
      expect(page, where).toContain(
        words.memoryControls.publishedHint(words.publicPageNote),
      );
      expect(page, where).not.toContain(words.visibility.publish);
    }
  });
});

describe("a visitor who is not the author", () => {
  it("is sent to the sign-in page of the page's own language, and sees nothing private", async () => {
    for (const { path } of studioPages()) {
      for (const [prefix, signIn] of [
        ["", "/studio/sign-in"],
        ["/pt", "/pt/studio/sign-in"],
      ] as const) {
        const answer = await request(base, `${prefix}${path}`);
        const where = `${prefix}${path}`;
        expect(answer.body, where).toContain(
          `NEXT_REDIRECT;replace;${signIn};307;`,
        );
        for (const marker of MARKER_LIST) {
          expect(answer.body, where).not.toContain(marker);
        }
        expect(answer.headers["cache-control"], where).toBe(
          "private, no-store, max-age=0, must-revalidate",
        );
      }
    }
  }, 120_000);

  it("gets the sign-in page in Portuguese at /pt/studio/sign-in, with no callback parameter", async () => {
    const answer = await request(base, "/pt/studio/sign-in");
    expect(answer.status).toBe(200);
    expect(answer.body).toMatch(/<html[^>]*\blang="pt-BR"/);
    expect(title(answer.body)).toBe(studioPtBR.meta.signIn);
    const words = visibleText(answer.body);
    expect(words).toContain(studioPtBR.signIn.password);
    expect(words).not.toContain(studioEn.signIn.password);
    expect(answer.body).not.toMatch(/callback|redirectTo|next=/i);
  });
});

describe("an author already signed in, on a sign-in page", () => {
  it.each([
    ["/studio/sign-in", "/studio"],
    ["/pt/studio/sign-in", "/pt/studio"],
  ])("%s goes to the Desk in its own language", async (path, desk) => {
    const answer = await request(base, path, {
      headers: { cookie: author.cookie },
    });
    expect(answer.body).toContain(`NEXT_REDIRECT;replace;${desk};307;`);
  });
});

describe("a Server Action called from either tree", () => {
  interface Route {
    id: string;
    route: string;
  }

  function actionRoutes(name: string): { en: Route; pt: Route } {
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
        const pages = Object.keys(entry.workers);
        const en = pages.find((page) => page.startsWith("app/(en)/studio"));
        const pt = pages.find((page) => page.startsWith("app/pt/studio"));
        if (!en || !pt) {
          break;
        }
        const route = (page: string) =>
          page
            .replace(/^app\/\(en\)/, "")
            .replace(/^app/, "")
            .replace(/\/page$/, "");
        return { en: { id, route: route(en) }, pt: { id, route: route(pt) } };
      }
    }
    throw new Error(`No server action ${name} is used in both trees.`);
  }

  async function call(route: Route, cookie: string | undefined) {
    const response = await fetch(`${base}${route.route}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        origin: base,
        accept: "text/x-component",
        "content-type": "text/plain;charset=UTF-8",
        "next-action": route.id,
        ...(cookie ? { cookie } : {}),
      },
      // Invalid input: refused by validation, so nothing is written.
      body: JSON.stringify([{ name: "" }]),
    });
    const body = await response.text();
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      code: body.match(/"code":"([a-z_]+)"/)?.[1],
    };
  }

  it("is the same entry for every Studio action, used by both trees alike", async () => {
    // Every Server Action the Studio uses, from the build's manifest: each is
    // one id, bound to the English and the Portuguese form of the same pages,
    // so studio-actions.http.test.ts, which calls every action, holds both.
    const manifest = JSON.parse(
      readFileSync(".next/server/server-reference-manifest.json", "utf8"),
    ) as {
      node: Record<
        string,
        { workers: Record<string, unknown>; exportedName: string }
      >;
    };
    const studio = Object.values(manifest.node).filter((entry) =>
      Object.keys(entry.workers).some((page) =>
        /^app\/(\(en\)\/|pt\/)studio/.test(page),
      ),
    );
    expect(studio.length).toBeGreaterThan(30);
    for (const entry of studio) {
      const pages = Object.keys(entry.workers);
      const english = pages
        .filter((page) => page.startsWith("app/(en)/studio"))
        .map((page) => page.slice("app/(en)".length))
        .sort();
      const portuguese = pages
        .filter((page) => page.startsWith("app/pt/studio"))
        .map((page) => page.slice("app/pt".length))
        .sort();
      expect(portuguese, entry.exportedName).toEqual(english);
    }
  });

  it("is one action: the same id, the same refusal codes, and nothing written", async () => {
    const { en, pt } = actionRoutes("createArtistAction");
    expect(pt.id).toBe(en.id);
    expect(pt.route.startsWith("/pt/studio")).toBe(true);
    for (const cookie of [author.cookie, undefined]) {
      const fromEnglish = await call(en, cookie);
      const fromPortuguese = await call(pt, cookie);
      expect(fromPortuguese).toEqual(fromEnglish);
      expect(fromPortuguese.code).toBe(
        cookie ? "invalid_input" : "unauthorized",
      );
    }
    const created = await db.query(
      "select count(*)::int as n from artists where name = ''",
    );
    expect(created.rows[0].n).toBe(0);
  });
});

// The design-system catalogue is drawn in the reference's own page frame, not
// the Studio's sidebar, so it is held here rather than in the list above: an
// authorized page in both languages, private, and the visitor's sign-in
// otherwise.
describe("the System catalogue", () => {
  it("is the author's, in each language, private and unindexed", async () => {
    for (const [prefix, lang, words, system] of [
      ["", "en", studioEn, v3En.system],
      ["/pt", "pt-BR", studioPtBR, v3PtBR.system],
    ] as const) {
      const where = `${prefix}/studio/system`;
      const page = await request(base, where, {
        headers: { cookie: author.cookie },
      });
      expect(page.status, where).toBe(200);
      expect(page.body, where).toMatch(
        new RegExp(`<html[^>]*\\blang="${lang}"`),
      );
      expect(title(page.body), where).toBe(words.meta.system);
      expect(page.body, where).toMatch(
        /<meta name="robots" content="noindex, nofollow"/,
      );
      expect(page.headers["cache-control"], where).toBe(
        "private, no-store, max-age=0, must-revalidate",
      );
      const text = visibleText(page.body);
      expect(text, where).toContain(system.h1);
      expect(text, where).toContain(words.system.yourWords);
      // No bracket placeholder and none of the reference's sample values.
      expect(text, where).not.toMatch(/\[[^\]]*\]/);
      expect(page.body, where).not.toMatch(/buckley|lilac wine|c-grace|bm-/i);
    }
  });

  it("sends anyone else to the sign-in page of its language", async () => {
    for (const [prefix, signIn] of [
      ["", "/studio/sign-in"],
      ["/pt", "/pt/studio/sign-in"],
    ] as const) {
      const answer = await request(base, `${prefix}/studio/system`);
      expect(answer.body).toContain(`NEXT_REDIRECT;replace;${signIn};307;`);
      expect(answer.body).not.toContain(v3En.system.h1b);
      expect(answer.body).not.toContain(v3PtBR.system.h1b);
      expect(answer.headers["cache-control"]).toBe(
        "private, no-store, max-age=0, must-revalidate",
      );
    }
  });
});
