// The Portuguese public surfaces over real HTTP (ADR 0008; ADR 0006
// amendment A7), against the production build and the disposable test
// database. Every rule is checked against the English form of the same
// address: one visibility answer for both forms, the proxy's status in every
// request form, redirects that keep their language, no-store everywhere, one
// not-found answer, the section's security headers, the encoded spellings of
// the prefix, alternates and the sitemap, and the version a Portuguese reader
// is shown. No private marker may appear in anything any request received.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

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
  comparable,
  corpus,
  request,
  visibleText,
  type Snapshot,
} from "@/testing/public-http";
import {
  fixtureDatabase,
  PRIVATE_MARKER_LIST,
  PRIVATE_MARKERS,
  PUBLIC_TEXT,
  removeSeeded,
  runPrefix,
  seedGrace,
  seedSimple,
  type SeededJournal,
} from "@/testing/public-journals";
import {
  removeSeededArtists,
  seedArtistPages,
  type SeededArtists,
} from "@/testing/public-artists";
import {
  removeSeededMemories,
  seedMemories,
  type SeededMemories,
} from "@/testing/public-memories";
import { forms, masked } from "@/testing/public-request-forms";
import {
  mintAuthorSession,
  removeMintedSessions,
} from "@/testing/http-session";
import { publishForTest } from "@/testing/publishing";
import { assertDisposableTestDatabase } from "@/testing/test-database";
import {
  ARTIST_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY,
} from "@/security-headers";

process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const offBase = inject("studioBaseURL");
const prefix = runPrefix();
const slug = (name: string) => `${prefix}-${name}`;
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();

let client: Client;
let on: ProductionServer;
let nearMiss: ProductionServer;
const seeded: SeededJournal[] = [];
let artists: SeededArtists;
let memories: SeededMemories;
let artistAddress = "";

/** The Portuguese form of an English path, as the routes and the proxy see it. */
function portuguese(path: string): string {
  if (path.startsWith(`/_next/data/${buildId}/`)) {
    return path.replace(
      `/_next/data/${buildId}/`,
      `/_next/data/${buildId}/pt/`,
    );
  }
  return path === "/" ? "/pt" : `/pt${path}`;
}

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-portuguese-tests",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  const db = fixtureDatabase(client);

  seeded.push(await seedGrace(client, { slug: slug("grace") }));
  for (const status of ["draft", "private"] as const) {
    seeded.push(
      await seedSimple(client, {
        slug: slug(status),
        title: `[Test] ${status} album`,
        status,
        marker: PRIVATE_MARKERS[status],
      }),
    );
  }
  seeded.push(
    await seedSimple(client, {
      slug: slug("deleted"),
      title: "[Test] Deleted album",
      status: "published",
      marker: PRIVATE_MARKERS.deleted,
      deletedAt: new Date(),
    }),
  );
  const renamed = await seedSimple(client, {
    slug: slug("old"),
    title: "[Test] Renamed album",
    status: "published",
    marker: "[Test] renamed album",
  });
  seeded.push(renamed);
  await changeEntrySlug(db, renamed.entryId, slug("new"));

  // A journal with a published Portuguese version, whose text is made public
  // on purpose (it replaces the private marker of the fixture).
  const bilingual = await seedGrace(client, { slug: slug("bilingual") });
  seeded.push(bilingual);
  await client.query(
    `update entry_texts
        set opening = '[Test] Abertura publica', margin_note = null,
            body = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"[Test] Texto publico"}]}]}'::jsonb,
            body_text = '[Test] Texto publico'
      where entry_id = $1 and locale = 'pt-BR'`,
    [bilingual.entryId],
  );
  await publishForTest(db, bilingual.entryId, "pt-BR");

  artists = await seedArtistPages(client, `${prefix}a`);
  memories = await seedMemories(client, `${prefix}m`);

  on = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: "true" },
  });
  nearMiss = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: "TRUE" },
  });
  const archive = (await request(on.baseURL, "/artists")).body;
  artistAddress = /href="\/artists\/([^"]+)"/.exec(archive)![1]!;
}, 180_000);

afterAll(async () => {
  await on?.stop().catch(() => undefined);
  await nearMiss?.stop().catch(() => undefined);
  try {
    await removeSeededMemories(client, memories, `${prefix}m`);
    await removeSeededArtists(client, artists, `${prefix}a`);
    await removeSeeded(client, seeded, prefix);
  } finally {
    await client.end();
  }
}, 120_000);

/** Every address of a section, in the states the rules name. */
function addresses(): Record<string, string> {
  return {
    home: "/",
    albums: "/albums",
    artists: "/artists",
    memories: "/memories",
    grace: `/albums/${slug("grace")}`,
    bilingual: `/albums/${slug("bilingual")}`,
    draft: `/albums/${slug("draft")}`,
    private: `/albums/${slug("private")}`,
    deleted: `/albums/${slug("deleted")}`,
    renamedOld: `/albums/${slug("old")}`,
    renamedNew: `/albums/${slug("new")}`,
    unknownAlbum: `/albums/${slug("nothing")}`,
    artist: `/artists/${artistAddress}`,
    unknownArtist: `/artists/${slug("nobody")}`,
    memory: `/memories/${memories.shown.slug}`,
    memoryPrevious: `/memories/${memories.shown.previousSlug}`,
    memoryHidden: `/memories/${memories.hidden[0]!.slug}`,
    unknownMemory: `/memories/${slug("nothing")}`,
  };
}

const sectionOf = (path: string) => path.split("/")[1] ?? "";

/** What an unknown address of the same section answers in that form. */
async function unknownIn(base: string, path: string): Promise<Snapshot> {
  const section = sectionOf(path.replace(/^\/pt(?=\/|$)/, ""));
  const english = section ? `/${section}/${slug("unknown")}` : "/nope";
  return request(base, path.startsWith("/pt") ? portuguese(english) : english);
}

describe("one visibility answer for both forms (A7, items 1 to 5)", () => {
  for (const [server, base] of [
    ["public reads on", () => on.baseURL],
    ["public reads off", () => offBase],
    ["a near miss of the switch", () => nearMiss.baseURL],
  ] as const) {
    it(`gives each address the same status in both forms, with ${server}`, async () => {
      for (const [name, path] of Object.entries(addresses())) {
        const english = await request(base(), path);
        const pt = await request(base(), portuguese(path));
        expect(pt.status, `${name}: ${portuguese(path)}`).toBe(english.status);
        expect(pt.headers["cache-control"], name).toMatch(/no-store/);
        if (english.status === 404) {
          // The one not-found answer: the same body as the English form and
          // as an unknown address, and the section's own headers.
          const unknown = comparable(await unknownIn(base(), portuguese(path)));
          expect(comparable(pt), name).toEqual(unknown);
          expect(pt.body, name).toBe(english.body);
          expect(comparable(pt).headers, name).toEqual(
            comparable(english).headers,
          );
        }
        if (english.status === 308) {
          expect(pt.headers.location, name).toBe(
            portuguese(english.headers.location!),
          );
        }
        if (english.status === 200) {
          expect(pt.body, name).toMatch(/<html[^>]*\blang="pt-BR"/);
          for (const header of [
            "content-security-policy",
            "x-frame-options",
            "x-content-type-options",
            "referrer-policy",
          ]) {
            expect(pt.headers[header], `${name}: ${header}`).toBe(
              english.headers[header],
            );
          }
        }
      }
    });
  }

  it("serves the Portuguese Home with public reads off as an empty site, whatever the database holds (A4)", async () => {
    const off = await request(offBase, "/pt");
    const miss = await request(nearMiss.baseURL, "/pt");
    expect(off.status).toBe(200);
    expect(visibleText(off.body)).toContain("Nada publicado ainda.");
    // The same page, apart from each server's own origin in its addresses.
    expect(masked(off, [offBase])).toEqual(masked(miss, [nearMiss.baseURL]));
    for (const marker of ["[Test]", "Grace", "Buckley"]) {
      expect(visibleText(off.body)).not.toContain(marker);
    }
  });

  it("keeps the redirect in its language, with no reflected host (item 3)", async () => {
    const pt = await request(on.baseURL, portuguese(`/albums/${slug("old")}`), {
      headers: { host: "evil.example", "x-forwarded-host": "evil.example" },
    });
    expect(pt.status).toBe(308);
    expect(pt.headers.location).toBe(`/pt/albums/${slug("new")}`);
    expect(pt.headers["cache-control"]).toBe("no-store");
    const memory = await request(
      on.baseURL,
      `/pt/memories/${memories.shown.previousSlug}`,
    );
    expect(memory.status).toBe(308);
    expect(memory.headers.location).toBe(`/pt/memories/${memories.shown.slug}`);
  });
});

describe("every request form of a Portuguese address (item 2)", () => {
  const prefixed = (s: string) =>
    forms(s, buildId).map(([name, path, headers]) => {
      const pt = path.startsWith("/_next/data/")
        ? path.replace(`/_next/data/${buildId}/`, `/_next/data/${buildId}/pt/`)
        : `/pt${path}`;
      return [name, pt, headers] as const;
    });

  it("answers a hidden address in every form as an unknown one, switch on or off", async () => {
    for (const base of [on.baseURL, offBase]) {
      const unknown = prefixed(slug("unknown"));
      const hidden = prefixed(slug("draft"));
      for (const [index, [name, path, headers]] of hidden.entries()) {
        const got = await request(base, path, { headers });
        const expected = await request(base, unknown[index]![1], {
          headers: unknown[index]![2],
        });
        expect(masked(got, [slug("draft")]), `${name}: ${path}`).toEqual(
          masked(expected, [slug("unknown")]),
        );
      }
    }
  });

  it("never lets a served address be stored, in any form", async () => {
    for (const [name, path, headers] of prefixed(slug("grace"))) {
      const got = await request(on.baseURL, path, { headers });
      expect(got.headers["cache-control"] ?? "", `${name}: ${path}`).toMatch(
        /no-store/,
      );
    }
  });

  it("answers the Portuguese Home's build files as the English Home's answer theirs", async () => {
    for (const [english, pt] of [
      ["/index.rsc", "/pt.rsc"],
      ["/index.segments/_tree.segment.rsc", "/pt.segments/_tree.segment.rsc"],
      [`/_next/data/${buildId}/index.json`, `/_next/data/${buildId}/pt.json`],
    ] as const) {
      for (const base of [on.baseURL, offBase]) {
        const a = await request(base, english);
        const b = await request(base, pt);
        expect(b.status, pt).toBe(a.status);
        expect(b.headers["cache-control"], pt).toBe(a.headers["cache-control"]);
      }
    }
  });
});

describe("every method and request form of every public route family (items 2 and 4)", () => {
  /** The forms a public address takes: methods, router requests, build files. */
  function familyForms(path: string): [string, string, RequestInit][] {
    const file = path === "/" ? "/index" : path;
    const query = `${path}${path.includes("?") ? "&" : "?"}_rsc=probe`;
    return [
      ["GET", path, {}],
      ["HEAD", path, { method: "HEAD" }],
      ["POST", path, { method: "POST" }],
      ["rsc", query, { headers: { rsc: "1" } }],
      [
        "prefetch",
        query,
        { headers: { rsc: "1", "next-router-prefetch": "1" } },
      ],
      [".rsc", `${file}.rsc`, {}],
      [".segments", `${file}.segments/_tree.segment.rsc`, {}],
      ["next data", `/_next/data/${buildId}${file}.json`, {}],
    ];
  }

  /** The Portuguese form of a form's path, the Home's build files included. */
  const portugueseForm = (path: string) =>
    path.startsWith("/index.") ||
    path.startsWith(`/_next/data/${buildId}/index.`)
      ? path.replace("/index.", "/pt.")
      : path.startsWith("/?")
        ? `/pt${path.slice(1)}`
        : portuguese(path);

  it("answers each Portuguese form exactly as its English form, switch on or off", async () => {
    const families = {
      home: "/",
      albums: "/albums",
      artists: "/artists",
      memories: "/memories",
      album: `/albums/${slug("grace")}`,
      hiddenAlbum: `/albums/${slug("draft")}`,
      artist: `/artists/${artistAddress}`,
      hiddenArtist: `/artists/${slug("nobody")}`,
      memory: `/memories/${memories.shown.slug}`,
      hiddenMemory: `/memories/${memories.hidden[0]!.slug}`,
    };
    let compared = 0;
    for (const base of [on.baseURL, offBase]) {
      for (const [family, address] of Object.entries(families)) {
        for (const [form, path, init] of familyForms(address)) {
          const english = await request(base, path, init);
          const pt = await request(base, portugueseForm(path), init);
          const name = `${family} ${form} ${portugueseForm(path)}`;
          expect(pt.status, name).toBe(english.status);
          for (const header of [
            "cache-control",
            "content-security-policy",
            "x-frame-options",
            "x-content-type-options",
            "referrer-policy",
            "allow",
          ]) {
            expect(pt.headers[header], `${name}: ${header}`).toBe(
              english.headers[header],
            );
          }
          if (english.status === 404) {
            // The not-found answer, byte for byte, in each form.
            expect(pt.body, name).toBe(english.body);
          }
          compared += 1;
        }
      }
    }
    expect(compared).toBe(160);
  });
});

describe("the Portuguese Studio's addresses (item 7)", () => {
  it("are not served yet, and answer as an unknown English Studio address does, with its private headers, signed in or not", async () => {
    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    const session = await mintAuthorSession(
      db,
      inject("studioCommandEnv").BETTER_AUTH_SECRET!,
    );
    try {
      for (const path of [
        "/pt/studio",
        "/pt/studio/journals",
        "/pt/studio/sign-in",
        "/pt/studio.rsc",
        "/pt/studio.segments/_tree.segment.rsc",
      ]) {
        // The same form of an English Studio address that no route serves.
        const english = path.replace("/pt/studio", "/studio/no-such-page");
        for (const headers of [
          {} as Record<string, string>,
          { cookie: session.cookie },
        ]) {
          const got = await request(offBase, path, { headers });
          const expected = await request(offBase, english, { headers });
          expect(got.status, path).toBe(404);
          expect(expected.status, english).toBe(404);
          expect(comparable(got), path).toEqual(comparable(expected));
          expect(got.headers["cache-control"], path).toMatch(
            /^private, .*no-store/,
          );
          expect(got.headers["x-frame-options"], path).toBe("DENY");
          expect(got.headers["referrer-policy"], path).toBe("no-referrer");
        }
      }
    } finally {
      await removeMintedSessions(db);
      await db.end();
    }
  });
});

describe("the encoded spellings of the prefix (item 2)", () => {
  it("are never the prefix: the unknown answer, no-store, the section's headers, and never a redirect", async () => {
    const nobody = (await request(on.baseURL, "/nope")).body;
    for (const [path, artist] of [
      ["/%70t", false],
      ["/p%74", false],
      ["/%70%74", false],
      [`/%70t/albums/${slug("grace")}`, false],
      [`/%70t/albums`, false],
      [`/%70t/artists/${artistAddress}`, true],
      [`/p%74/memories/${memories.shown.slug}`, false],
      // With a trailing slash, still never the trailing slash's redirect.
      ["/%70t/", false],
      [`/%70t/albums/${slug("grace")}/`, false],
      [`/%70t/albums/${slug("draft")}/`, false],
      [`/%70t/albums/${slug("nothing")}/`, false],
      [`/%70t/artists/${artistAddress}/`, true],
    ] as const) {
      for (const base of [on.baseURL, offBase]) {
        const got = await request(base, path);
        expect(got.status, path).toBe(404);
        expect(got.headers.location, path).toBeUndefined();
        expect(got.headers["cache-control"], path).toMatch(/no-store/);
        expect(got.body, path).toBe(nobody);
        expect(got.headers["content-security-policy"], path).toBe(
          artist ? ARTIST_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY,
        );
      }
    }
  });

  it("treats an encoded section after the literal prefix as the English form treats it", async () => {
    for (const base of [on.baseURL, offBase]) {
      for (const path of [
        `/%61lbums/${slug("grace")}`,
        `/%61lbums/${slug("draft")}`,
        "/%61lbums",
      ]) {
        const english = comparable(await request(base, path));
        const pt = comparable(await request(base, `/pt${path}`));
        expect(pt.status, path).toBe(english.status);
        expect(pt.headers, path).toEqual(english.headers);
        expect(pt.body, path).toBe(english.body);
      }
    }
  });
});

describe("what a Portuguese reader is shown (ADR 0008 § 1)", () => {
  it("shows the Portuguese version when it is published, marked as Portuguese", async () => {
    const pt = await request(on.baseURL, `/pt/albums/${slug("bilingual")}`);
    expect(pt.status).toBe(200);
    expect(pt.body).toMatch(
      /<p class="pj-opening" lang="pt-BR">\[Test\] Abertura publica<\/p>/,
    );
    expect(visibleText(pt.body)).toContain("Escrito em português");
    // The English reader still gets English.
    const english = await request(on.baseURL, `/albums/${slug("bilingual")}`);
    expect(english.body).toContain(PUBLIC_TEXT.opening);
    expect(english.body).not.toContain("Abertura publica");
  });

  it("shows the original when the translation is not published, marked as English, and never names the translation", async () => {
    const pt = await request(on.baseURL, `/pt/albums/${slug("grace")}`);
    expect(pt.status).toBe(200);
    expect(pt.body).toMatch(/<p class="pj-opening" lang="en">/);
    expect(pt.body).toMatch(/<div class="pj-body" lang="en">/);
    expect(visibleText(pt.body)).toContain("Escrito em inglês");
    expect(pt.body).not.toContain(PRIVATE_MARKERS.translation);
    // The rating is written with the Portuguese decimal mark.
    expect(pt.body).toContain('aria-label="Minha nota: 4,5 de 5"');
    expect(visibleText(pt.body)).toContain("[4,5] / 5");
    const home = await request(on.baseURL, "/pt");
    expect(visibleText(home.body)).toContain("[4,5]");
    expect(visibleText(home.body)).not.toContain("[4.5]");
    // The interface around it is Portuguese.
    for (const words of [
      "Diário de álbum",
      "Faixa a faixa",
      "Todos os álbuns",
    ]) {
      expect(visibleText(pt.body)).toContain(words);
    }
  });

  it("gives every served page the same language selector, whether or not a translation exists", async () => {
    const selector = (html: string, path: string) =>
      /<details class="public-language"[\s\S]*?<\/details>/
        .exec(html)![0]
        .split(path)
        .join("PATH");
    const grace = await request(on.baseURL, `/pt/albums/${slug("grace")}`);
    const bilingual = await request(
      on.baseURL,
      `/pt/albums/${slug("bilingual")}`,
    );
    expect(selector(grace.body, `/albums/${slug("grace")}`)).toBe(
      selector(bilingual.body, `/albums/${slug("bilingual")}`),
    );
    expect(grace.body).toContain(
      `href="/albums/${slug("grace")}" hrefLang="en"`,
    );
    expect(grace.body).toContain(
      `href="/pt/albums/${slug("grace")}" hrefLang="pt-BR"`,
    );
  });

  it("keeps every link in Portuguese", async () => {
    for (const path of ["/pt", "/pt/albums", "/pt/artists", "/pt/memories"]) {
      const page = await request(on.baseURL, path);
      const links = [
        ...visibleBody(page.body).matchAll(/<a\b[^>]*href="(\/[^"]*)"/g),
      ]
        .map((match) => match[1]!)
        .filter((href) => !href.startsWith("/_next/"));
      expect(links.length, path).toBeGreaterThan(4);
      // Only the selector's English option leaves the Portuguese pages.
      const english = links.filter(
        (href) =>
          href !== "/pt" && !href.startsWith("/pt/") && !href.startsWith("#"),
      );
      expect(english, path).toEqual([path === "/pt" ? "/" : path.slice(3)]);
    }
  });
});

/** A page's HTML without its scripts. */
function visibleBody(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, "");
}

describe("metadata, alternates, and the sitemap (ADR 0008 § 7; A7, item 8)", () => {
  it("names its own address in its language, and both languages as alternates", async () => {
    for (const path of [
      "/",
      "/albums",
      `/albums/${slug("grace")}`,
      `/artists/${artistAddress}`,
      `/memories/${memories.shown.slug}`,
    ]) {
      const origin = on.baseURL;
      const pt = portuguese(path);
      const page = await request(origin, pt);
      expect(page.body, pt).toContain(
        `<link rel="canonical" href="${origin}${pt}"/>`,
      );
      // The framework writes the Home's address without its final slash.
      const absolute = (href: string) =>
        href === "/" ? origin : `${origin}${href}`;
      for (const [lang, href] of [
        ["en", path],
        ["pt-BR", pt],
        ["x-default", path],
      ] as const) {
        expect(page.body, `${pt} ${lang}`).toContain(
          `<link rel="alternate" hrefLang="${lang}" href="${absolute(href)}"/>`,
        );
      }
      const english = await request(origin, path);
      expect(english.body, path).toContain(
        `<link rel="canonical" href="${absolute(path)}"/>`,
      );
      expect(english.body, path).toContain(
        `<link rel="alternate" hrefLang="pt-BR" href="${absolute(pt)}"/>`,
      );
    }
  });

  it("has no alternates and no canonical address on the not-found view", async () => {
    for (const path of [
      "/pt/albums/missing",
      `/pt/albums/${slug("draft")}`,
      "/nope",
    ]) {
      const page = await request(on.baseURL, path);
      expect(page.status, path).toBe(404);
      expect(page.body, path).not.toMatch(/rel="(canonical|alternate)"/);
    }
  });

  it("lists both forms of exactly the same addresses in the sitemap", async () => {
    const sitemap = await request(on.baseURL, "/sitemap.xml");
    const urls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1]!.replace(on.baseURL, ""),
    );
    const english = urls.filter(
      (url) => url !== "/pt" && !url.startsWith("/pt/"),
    );
    const pt = urls.filter((url) => url === "/pt" || url.startsWith("/pt/"));
    expect(pt.sort()).toEqual(english.map(portuguese).sort());
    expect(english).toContain(`/albums/${slug("grace")}`);
    expect(urls).not.toContain(`/albums/${slug("draft")}`);
    expect(urls).not.toContain(`/pt/albums/${slug("draft")}`);
    expect(urls.some((url) => url.includes("studio"))).toBe(false);
  });

  it("keeps the Portuguese Studio out of robots.txt's reach", async () => {
    const robots = await request(on.baseURL, "/robots.txt");
    expect(robots.body).toContain("Disallow: /studio\n");
    expect(robots.body).toContain("Disallow: /pt/studio\n");
  });

  it("describes a Portuguese page in Portuguese, and the writing's language in Open Graph", async () => {
    const archive = await request(on.baseURL, "/pt/albums");
    expect(archive.body).toContain("<title>Álbuns · refrain</title>");
    expect(archive.body).toContain(
      '<meta property="og:locale" content="pt_BR"/>',
    );
    const grace = await request(on.baseURL, `/pt/albums/${slug("grace")}`);
    // The version shown is English, so its preview says so.
    expect(grace.body).toContain(
      '<meta property="og:locale" content="en_US"/>',
    );
  });
});

describe("state transitions, seen in both forms at once (A7, required tests)", () => {
  it("unpublishing, republishing, deleting, and restoring change both forms on the next request", async () => {
    const db = fixtureDatabase(client);
    const journal = await seedGrace(client, {
      slug: slug("moving"),
      en: "draft",
    });
    seeded.push(journal);
    const path = `/albums/${slug("moving")}`;
    const both = async () => [
      (await request(on.baseURL, path)).status,
      (await request(on.baseURL, portuguese(path))).status,
    ];
    expect(await both()).toEqual([404, 404]);
    await publishForTest(db, journal.entryId, "en");
    expect(await both()).toEqual([200, 200]);
    await unpublishLanguageVersion(
      db,
      testAuthor(),
      journal.entryId,
      "en",
      "private",
    );
    expect(await both()).toEqual([404, 404]);
    await publishForTest(db, journal.entryId, "en");
    expect(await both()).toEqual([200, 200]);
    await deleteAlbumJournal(db, testAuthor(), journal.entryId);
    expect(await both()).toEqual([404, 404]);
    // Restoring never publishes (ADR 0005), in either form.
    await restoreAlbumJournal(db, testAuthor(), journal.entryId);
    expect(await both()).toEqual([404, 404]);
  });
});

describe("what every request saw", () => {
  it("contains no private marker", () => {
    const leaked = PRIVATE_MARKER_LIST.filter((marker) =>
      corpus.some((text) => text.includes(marker)),
    );
    expect(leaked).toEqual([]);
  });
});
