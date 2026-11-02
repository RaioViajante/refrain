// Cache and publication-state safety of the public page over real HTTP (M3.1,
// ADR 0006 § 11, gate G2, and § 13 test 22): after every change of state that
// affects what a reader may see, the NEXT request shows the new state, never
// the old content, a stale redirect, or a stale 404. The changes are made with
// the real commands against real PostgreSQL, and each is followed at once by
// an anonymous request to the production build. Nothing sleeps: if a response
// could come from a cache, an assertion here would see the old state.
import { randomBytes } from "node:crypto";

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
  comparable,
  corpus,
  filesContaining,
  request,
  type Snapshot,
} from "@/testing/public-http";
import {
  fixtureDatabase,
  PRIVATE_MARKER_LIST,
  PUBLIC_TEXT,
  removeSeeded,
  runPrefix,
  seedGrace,
  type SeededJournal,
} from "@/testing/public-journals";
import { publishForTest } from "@/testing/publishing";
import {
  startProductionServer,
  type ProductionServer,
} from "@/testing/production-server";
import { assertDisposableTestDatabase } from "@/testing/test-database";

process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const prefix = runPrefix();
const author = testAuthor();

let client: Client;
let server: ProductionServer;
const seeded: SeededJournal[] = [];
let counter = 0;

const db = () => fixtureDatabase(client);

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-transition-tests",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  server = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: "true" },
  });
}, 120_000);

afterAll(async () => {
  await server?.stop().catch(() => undefined);
  try {
    await removeSeeded(client, seeded, prefix);
  } finally {
    await client.end();
  }
}, 60_000);

/** A journal that is published, with its own address. */
async function publishedJournal() {
  counter += 1;
  const slug = `${prefix}-j${counter}`;
  const journal = await seedGrace(client, { slug, en: "draft" });
  seeded.push(journal);
  await publishForTest(db(), journal.entryId, "en");
  return { ...journal, slug };
}

const get = (path: string, init?: Parameters<typeof request>[2]) =>
  request(server.baseURL, path, init);

// What the next request to an address must answer.
async function expectServed(slug: string) {
  const page = await get(`/albums/${slug}`);
  expect(page.status, `${slug} served`).toBe(200);
  expect(page.headers["cache-control"]).toContain("no-store");
  return page;
}

async function expectUnknown(slug: string) {
  const unknown = comparable(await get(`/albums/${prefix}-nothing-here`));
  const got = comparable(await get(`/albums/${slug}`));
  expect(got.status, `${slug} hidden`).toBe(404);
  expect(got).toEqual(unknown);
  expect(
    comparable(await get(`/albums/${slug}`, { rsc: true })),
    `${slug} hidden over RSC`,
  ).toEqual(
    comparable(await get(`/albums/${prefix}-nothing-here`, { rsc: true })),
  );
}

async function expectRedirect(from: string, to: string) {
  const got = await get(`/albums/${from}`);
  expect(got.status, `${from} redirects`).toBe(308);
  expect(got.headers.location).toBe(`/albums/${to}`);
  expect(got.headers["cache-control"]).toBe("no-store");
}

async function sitemapHas(slug: string) {
  const sitemap = await get("/sitemap.xml");
  expect(sitemap.status).toBe(200);
  return sitemap.body.includes(`/albums/${slug}</loc>`);
}

describe("unpublishing", () => {
  it("takes effect on the next request, and republishing on the one after", async () => {
    const { entryId, slug } = await publishedJournal();
    await expectServed(slug);
    expect(await sitemapHas(slug)).toBe(true);

    await unpublishLanguageVersion(db(), author, entryId, "en", "private");
    await expectUnknown(slug);
    expect(await sitemapHas(slug)).toBe(false);

    await publishForTest(db(), entryId, "en");
    const page = await expectServed(slug);
    expect(page.body).toContain(PUBLIC_TEXT.opening);
    expect(await sitemapHas(slug)).toBe(true);
  });

  it("holds under rapid alternation: every read matches the state just written", async () => {
    const { entryId, slug } = await publishedJournal();
    for (let round = 0; round < 8; round += 1) {
      await unpublishLanguageVersion(db(), author, entryId, "en", "draft");
      await expectUnknown(slug);
      await publishForTest(db(), entryId, "en");
      await expectServed(slug);
    }
  }, 60_000);
});

describe("deleting and restoring", () => {
  it("deleting hides the page at once; restoring does not publish it", async () => {
    const { entryId, slug } = await publishedJournal();
    await expectServed(slug);

    await deleteAlbumJournal(db(), author, entryId);
    await expectUnknown(slug);
    expect(await sitemapHas(slug)).toBe(false);

    // A restore never publishes (ADR 0005): the page stays hidden.
    const restored = await restoreAlbumJournal(db(), author, entryId);
    expect(restored.madePrivate).toEqual(["en"]);
    await expectUnknown(slug);
    expect(await sitemapHas(slug)).toBe(false);

    // Only the author's explicit publication makes it public again.
    await publishForTest(db(), entryId, "en");
    await expectServed(slug);
  });
});

describe("changing the address", () => {
  it("redirects the previous address of a public journal, and nothing once it is hidden", async () => {
    const { entryId, slug } = await publishedJournal();
    const renamed = `${slug}-renamed`;
    await changeEntrySlug(db(), entryId, renamed);
    await expectRedirect(slug, renamed);
    await expectServed(renamed);
    expect(await sitemapHas(renamed)).toBe(true);
    expect(await sitemapHas(slug)).toBe(false);

    // Unpublished: the redirect is gone at once, and the old and the current
    // address answer as an unknown one.
    await unpublishLanguageVersion(db(), author, entryId, "en", "private");
    await expectUnknown(slug);
    await expectUnknown(renamed);

    // Published again: the redirect returns.
    await publishForTest(db(), entryId, "en");
    await expectRedirect(slug, renamed);
    await expectServed(renamed);
  });

  it("returning to a previous address makes it current again", async () => {
    const { entryId, slug } = await publishedJournal();
    await changeEntrySlug(db(), entryId, `${slug}-b`);
    await changeEntrySlug(db(), entryId, slug);
    await expectServed(slug);
    await expectRedirect(`${slug}-b`, slug);
  });
});

describe("language versions", () => {
  async function translate(entryId: string) {
    // The synthetic translation becomes public on purpose in this test, so its
    // text is replaced by text that is not a private marker.
    await client.query(
      `update entry_texts
          set opening = '[Test] Abertura publica', margin_note = null,
              body = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"[Test] Texto publico"}]}]}'::jsonb,
              body_text = '[Test] Texto publico'
        where entry_id = $1 and locale = 'pt-BR'`,
      [entryId],
    );
  }

  it("serves the reader's language, then the remaining version, then nothing", async () => {
    const { entryId, slug } = await publishedJournal();
    await translate(entryId);

    // The translation is a draft: the page never mentions it.
    let page = await expectServed(slug);
    expect(page.body).not.toContain("Abertura publica");
    expect(page.body).toContain("Written in English");

    await publishForTest(db(), entryId, "pt-BR");
    page = await expectServed(slug);
    // An English reader still gets English.
    expect(page.body).toContain(PUBLIC_TEXT.opening);
    expect(page.body).not.toContain("Abertura publica");

    // The English version is withdrawn: the remaining version is served.
    await unpublishLanguageVersion(db(), author, entryId, "en", "private");
    page = await expectServed(slug);
    expect(page.body).toContain("Abertura publica");
    expect(page.body).toContain("Written in Brazilian Portuguese");
    expect(page.body).not.toContain(PUBLIC_TEXT.opening);
    // Its reflections: the flagged one in Portuguese is not public, because the
    // fixture never made a Portuguese reflection public.
    expect(page.body).not.toContain(PUBLIC_TEXT.reflection("Mojo Pin"));

    await unpublishLanguageVersion(db(), author, entryId, "pt-BR", "private");
    await expectUnknown(slug);
  });
});

/** The journal's own rating line, apart from the tracks' ratings. */
function albumRating(html: string): string | null {
  return /<p class="pj-rating">[\s\S]*?<\/p>/.exec(html)?.[0] ?? null;
}

describe("a reflection and the rating", () => {
  it("shows and hides a reflection as its flag and text change", async () => {
    const { entryId, trackIds, slug } = await publishedJournal();
    const mojoPin = PUBLIC_TEXT.reflection("Mojo Pin");
    expect((await expectServed(slug)).body).toContain(mojoPin);

    const reflection = (
      await client.query<{ id: string }>(
        "select id from track_reflections where album_journal_id = $1 and track_id = $2",
        [entryId, trackIds[0]],
      )
    ).rows[0]!.id;

    // Unflagged: gone on the next request.
    await client.query(
      "update track_reflections set is_published = false where id = $1",
      [reflection],
    );
    let page = await expectServed(slug);
    expect(page.body).not.toContain(mojoPin);

    // Flagged again: back.
    await client.query(
      "update track_reflections set is_published = true where id = $1",
      [reflection],
    );
    expect((await expectServed(slug)).body).toContain(mojoPin);

    // The text removed: gone, and the track reads "not written yet".
    await client.query(
      "delete from track_reflection_texts where track_reflection_id = $1",
      [reflection],
    );
    page = await expectServed(slug);
    expect(page.body).not.toContain(mojoPin);
    expect(
      page.body.match(/class="pj-track-status">not written yet</g),
    ).toHaveLength(4);
  });

  it("shows a changed rating, and no rating once it is cleared", async () => {
    const { entryId, slug } = await publishedJournal();
    expect(albumRating((await expectServed(slug)).body)).toContain(
      "My rating: 4.5 out of 5",
    );

    await client.query(
      "update album_journals set rating_half_steps = 6 where entry_id = $1",
      [entryId],
    );
    expect(albumRating((await expectServed(slug)).body)).toContain(
      "My rating: 3 out of 5",
    );

    await client.query(
      "update album_journals set rating_half_steps = null where entry_id = $1",
      [entryId],
    );
    // No rating line at all; the tracks' own ratings are unaffected.
    expect(albumRating((await expectServed(slug)).body)).toBeNull();
  });
});

describe("edited public text", () => {
  it("shows the new text on the next request and never the old", async () => {
    const { entryId, slug } = await publishedJournal();
    const before = await expectServed(slug);
    expect(before.body).toContain(PUBLIC_TEXT.opening);

    await client.query(
      `update entry_texts set opening = '[Test] A rewritten opening.'
        where entry_id = $1 and locale = 'en'`,
      [entryId],
    );
    const after = await expectServed(slug);
    expect(after.body).toContain("[Test] A rewritten opening.");
    expect(after.body).not.toContain(PUBLIC_TEXT.opening);
  });
});

describe("no cache anywhere", () => {
  const responseClasses = async (): Promise<[string, Snapshot][]> => {
    const { entryId, slug } = await publishedJournal();
    const renamed = `${slug}-r`;
    await changeEntrySlug(db(), entryId, renamed);
    const hidden = await publishedJournal();
    await unpublishLanguageVersion(
      db(),
      author,
      hidden.entryId,
      "en",
      "private",
    );
    return [
      ["200 page", await get(`/albums/${renamed}`)],
      ["200 RSC", await get(`/albums/${renamed}`, { rsc: true })],
      ["308", await get(`/albums/${slug}`)],
      ["404 hidden", await get(`/albums/${hidden.slug}`)],
      ["404 unknown", await get(`/albums/${prefix}-no-such`)],
      ["404 hidden RSC", await get(`/albums/${hidden.slug}`, { rsc: true })],
      ["405", await get(`/albums/${renamed}`, { method: "POST" })],
      ["sitemap", await get("/sitemap.xml")],
      ["robots", await get("/robots.txt")],
    ];
  };

  it("sends no-store on every response class and no cache-hit indicator", async () => {
    for (const [name, response] of await responseClasses()) {
      expect(response.headers["cache-control"], name).toContain("no-store");
      expect(response.headers["cache-control"], name).not.toMatch(
        /public|s-maxage|max-age=[1-9]/,
      );
      for (const header of [
        "age",
        "x-cache",
        "cf-cache-status",
        "x-vercel-cache",
      ]) {
        expect(response.headers[header], `${name} ${header}`).toBeUndefined();
      }
      // A 404 is the build's own prerendered not-found view: the same bytes
      // for every address, whatever its state, so the framework marks it
      // `x-nextjs-cache: HIT`. That says nothing about a journal (the view is
      // identical for an unknown address, as the tests above compare) and the
      // response is `no-store`. Every response that could carry a journal's
      // state is not marked.
      if (!name.startsWith("404")) {
        expect(response.headers["x-nextjs-cache"], name).not.toBe("HIT");
      }
    }
  });

  it("wrote no journal data to the build's own disk", () => {
    // After everything above has been served: nothing of a journal, public or
    // private, appears anywhere in the build output or its cache.
    const needles = [
      ...PRIVATE_MARKER_LIST,
      PUBLIC_TEXT.opening,
      PUBLIC_TEXT.paragraph,
    ];
    expect(filesContaining(".next", needles)).toEqual([]);
  });

  it("sent no private marker in anything it answered", () => {
    expect(corpus.length).toBeGreaterThan(50);
    const all = corpus.join("\n");
    for (const marker of PRIVATE_MARKER_LIST) {
      expect(all.includes(marker), marker).toBe(false);
    }
  });
});
