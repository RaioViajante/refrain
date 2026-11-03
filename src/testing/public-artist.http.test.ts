// The public artist page over real HTTP, against the production build and the
// disposable test database (M3.5). Several servers are started from the one
// build, each with its own value of REFRAIN_PUBLIC_READS_ENABLED, because the
// switch is read at request time.
//
// Every request is anonymous. An artist address that is not served (a
// catalog-only artist, one credited only on draft, private, deleted, or
// unpublished-translation writing, an archived one, a malformed address, and
// every address while the switch is off) must answer exactly as an unknown
// artist address does, in status, headers, and body, in every request form;
// and no private artist's name, photograph credit, or writing may appear in
// any response, header, payload, or server log.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// eslint-disable-next-line no-restricted-imports
import { unpublishLanguageVersion } from "@/modules/publication/commands";
// eslint-disable-next-line no-restricted-imports
import {
  artistAddressBase,
  artistAddressSuffix,
} from "@/modules/publication/artist-address";
import { ARTIST_CONTENT_SECURITY_POLICY } from "@/security-headers";
import { testAuthor } from "@/testing/fixtures";
import {
  startProductionServer,
  type ProductionServer,
} from "@/testing/production-server";
import {
  ARTIST_MARKERS,
  BROKEN_PHOTO,
  commonsPage,
  GRACE_ARTIST_PHOTO,
  LONG_BAND_NAME,
  PRIVATE_ARTIST_MARKER_LIST,
  removeSeededArtists,
  seedArtistPages,
  type SeededArtists,
} from "@/testing/public-artists";
import {
  comparable,
  corpus,
  request,
  visibleText,
} from "@/testing/public-http";
import {
  fixtureDatabase,
  PRIVATE_MARKER_LIST,
  runPrefix,
} from "@/testing/public-journals";
import { publishForTest } from "@/testing/publishing";
import { assertDisposableTestDatabase } from "@/testing/test-database";
import { commonsThumbnail } from "@/testing/wikimedia-fixtures";

process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const prefix = runPrefix();
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();

let client: Client;
let seeded: SeededArtists | undefined;
const servers: ProductionServer[] = [];

let on: ProductionServer;
const off: Record<string, ProductionServer> = {};
const OFF_VALUES = ["unset", "TRUE", "1", "true "];

/** The served address of each public artist, read from its album page. */
const addresses = { grace: "", long: "", broken: "" };
const UNKNOWN = `${prefix}-no-such-artist`;

async function start(value: string | undefined) {
  const server = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: value },
  });
  servers.push(server);
  return server;
}

/** The artist links an album journal's page carries. */
async function artistLinks(server: ProductionServer, slug: string) {
  const page = await request(server.baseURL, `/albums/${slug}`);
  expect(page.status).toBe(200);
  return [...page.body.matchAll(/href="\/artists\/([a-z0-9-]+)"/g)].map(
    (match) => match[1]!,
  );
}

/** A response, with the address that was asked for masked out. */
function masked(snapshot: Awaited<ReturnType<typeof request>>, slug: string) {
  const view = comparable(snapshot);
  const mask = (text: string) =>
    text
      .split(slug)
      .join("SLUG")
      .replace(/(")[A-Za-z0-9_-]{21,23}(?![A-Za-z0-9_-])/g, "$1ID");
  return {
    status: view.status,
    headers: Object.fromEntries(
      Object.entries(view.headers).map(([name, value]) => [name, mask(value)]),
    ),
    body: mask(view.body),
  };
}

/** Every transport form of one artist address. */
function forms(s: string): [string, string, Record<string, string>][] {
  return [
    ["document", `/artists/${s}`, {}],
    ["HEAD", `/artists/${s}`, { method: "HEAD" }],
    ["RSC", `/artists/${s}?_rsc=probe`, { rsc: "1" }],
    [
      "router prefetch",
      `/artists/${s}?_rsc=probe`,
      { rsc: "1", "next-router-prefetch": "1" },
    ],
    [
      "segment prefetch (tree)",
      `/artists/${s}?_rsc=probe`,
      {
        rsc: "1",
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/_tree",
      },
    ],
    [
      "segment prefetch (page)",
      `/artists/${s}?_rsc=probe`,
      {
        rsc: "1",
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/(artists)/artists/[slug]/__PAGE__",
      },
    ],
    ["segment file", `/artists/${s}.segments/_tree.segment.rsc`, {}],
    [".rsc", `/artists/${s}.rsc`, {}],
    ["next data", `/_next/data/${buildId}/artists/${s}.json`, {}],
    [
      "Accept: application/json",
      `/artists/${s}`,
      { accept: "application/json" },
    ],
    ["If-None-Match: *", `/artists/${s}`, { "if-none-match": "*" }],
    ["Range", `/artists/${s}`, { range: "bytes=0-10" }],
    ["crawler", `/artists/${s}`, { "user-agent": "Googlebot/2.1" }],
  ];
}

async function ask(
  server: ProductionServer,
  path: string,
  headers: Record<string, string>,
) {
  const { method, ...rest } = headers;
  return request(server.baseURL, path, {
    method: method ?? "GET",
    headers: rest,
    rsc: false,
  });
}

/** The address forms of an artist that must not be served. */
function candidateAddresses(name: string, id: string) {
  const base = artistAddressBase(name);
  return [base, `${base}-${artistAddressSuffix(id)}`];
}

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-public-artist-tests",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  seeded = await seedArtistPages(client, prefix);

  on = await start("true");
  for (const value of OFF_VALUES) {
    off[value] = await start(value === "unset" ? undefined : value);
  }

  // The served address of each public artist, as a reader finds it.
  const [graceLink] = await artistLinks(on, seeded.grace.slug);
  const [longLink] = await artistLinks(on, seeded.long.slug);
  const [brokenLink] = await artistLinks(on, seeded.broken.slug);
  addresses.grace = graceLink!;
  addresses.long = longLink!;
  addresses.broken = brokenLink!;
}, 180_000);

afterAll(async () => {
  for (const server of servers) {
    await server.stop();
  }
  if (client) {
    await removeSeededArtists(client, seeded, prefix);
    await client.end();
  }
});

describe("a public artist's page, with public reads on", () => {
  it("is served at the address its album journal links to, complete in the HTML", async () => {
    expect(addresses.grace).toMatch(/^jeff-buckley(-[0-9a-f]{10})?$/);
    const page = await request(on.baseURL, `/artists/${addresses.grace}`);
    expect(page.status).toBe(200);
    // Rendered in one pass: nothing waits in hidden markup for a script.
    expect(page.body).not.toMatch(/<div hidden id="S:/);
    const text = visibleText(page.body);
    expect(page.body).toMatch(/<h1[^>]*>Jeff Buckley<\/h1>/);
    expect(text).toContain("In this journal");
    expect(text).toContain("Album journals");
    expect(text).toContain("Grace");
    expect(text).toContain("Sketches for My Sweetheart the Drunk");
    expect(text).toContain("Tracks I wrote about");
    for (const track of [
      "Mojo Pin",
      "Last Goodbye",
      "Everybody Here Wants You",
    ]) {
      expect(text).toContain(track);
    }
    // Lilac Wine's reflection is not public, so it is not listed at all.
    expect(text).not.toContain("Lilac Wine");
    // Both album journals are linked at their served addresses.
    expect(page.body).toContain(`href="/albums/${seeded!.grace.slug}"`);
    expect(page.body).toContain(`href="/albums/${seeded!.sketches.slug}"`);
    // "4 / 6 tracks": Grace has three public reflections of six.
    expect(text).toContain("1994 · 3 / 6 tracks");
    expect(text).toContain("1998 · 1 / 3 tracks");
    // Artist-journal text and anything biographical are never shown.
    expect(text).not.toMatch(/Last edited|Singer and songwriter|Written in/);
  });

  it("shows the photograph the author chose, with its credit, its source, its license, and the changes", async () => {
    const page = await request(on.baseURL, `/artists/${addresses.grace}`);
    const thumbnail = commonsThumbnail(GRACE_ARTIST_PHOTO.fileName, 330);
    expect(page.body).toContain(`src="${thumbnail}"`);
    expect(page.body).toContain(
      `${commonsThumbnail(GRACE_ARTIST_PHOTO.fileName, 500)} 500w`,
    );
    expect(page.body).toMatch(
      /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i,
    );
    expect(page.body).toContain('aria-label="Photograph of Jeff Buckley"');
    const text = visibleText(page.body);
    expect(text).toContain(`Photo: ${GRACE_ARTIST_PHOTO.credit}`);
    expect(text).toContain("via Wikimedia Commons");
    expect(text).toContain("Resized, and cropped to fit the frame.");
    expect(text).toContain("Adaptations must use the same license.");
    expect(page.body).toContain(
      'href="https://creativecommons.org/licenses/by-sa/4.0/"',
    );
    expect(page.body).toContain(
      `href="${commonsPage(GRACE_ARTIST_PHOTO.fileName)}"`,
    );
    // The outbound links send no referrer.
    expect(page.body).not.toMatch(
      /<a(?![^>]*noreferrer)[^>]*href="https:\/\/(commons\.wikimedia|creativecommons)/,
    );
  });

  it("shows the empty frame, and the long name whole, for an artist without a photograph", async () => {
    const page = await request(on.baseURL, `/artists/${addresses.long}`);
    expect(page.status).toBe(200);
    expect(page.body).not.toContain("thumb.wikimedia.org");
    expect(page.body).toContain(
      `aria-label="No photograph of ${LONG_BAND_NAME}`,
    );
    expect(visibleText(page.body)).toContain("not available yet");
    expect(page.body).toMatch(
      new RegExp(`<h1[^>]*>${LONG_BAND_NAME.replace(/[[\]]/g, "\\$&")}</h1>`),
    );
  });

  it("is no-store, with the artist pages' image policy and the public headers", async () => {
    for (const address of [addresses.grace, UNKNOWN]) {
      const page = await request(on.baseURL, `/artists/${address}`);
      // The page sets exactly `no-store`; the framework's not-found view adds
      // its own words around it, as on the album journal.
      expect(page.headers["cache-control"], address).toContain("no-store");
      expect(page.headers["content-security-policy"], address).toBe(
        ARTIST_CONTENT_SECURITY_POLICY,
      );
      expect(page.headers["x-content-type-options"]).toBe("nosniff");
      expect(page.headers["x-frame-options"]).toBe("DENY");
      expect(page.headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
      for (const indicator of [
        "age",
        "x-cache",
        "x-vercel-cache",
        "cf-cache-status",
      ]) {
        expect(page.headers[indicator], indicator).toBeUndefined();
      }
    }
    // Only the artist pages allow Wikimedia's host; the album page does not.
    const album = await request(on.baseURL, `/albums/${seeded!.grace.slug}`);
    expect(album.headers["content-security-policy"]).not.toContain("wikimedia");
  });

  it("names itself canonically, from the site's own origin, with no image in its preview", async () => {
    const page = await request(on.baseURL, `/artists/${addresses.grace}`, {
      headers: { host: "evil.example", "x-forwarded-host": "evil.example" },
    });
    expect(page.body).toContain(
      `<link rel="canonical" href="${on.baseURL}/artists/${addresses.grace}"/>`,
    );
    expect(page.body).toContain("<title>Jeff Buckley · refrain</title>");
    expect(page.body).toContain(
      '<meta property="og:title" content="Jeff Buckley · refrain"/>',
    );
    expect(page.body).not.toMatch(/og:image|twitter:image/);
    expect(page.body).not.toContain("evil.example");
  });

  it("answers every transport form without caching it", async () => {
    for (const [name, path, headers] of forms(addresses.grace)) {
      const response = await ask(on, path, headers);
      expect(response.status, name).toBeLessThan(500);
      expect(response.headers["cache-control"], name).toContain("no-store");
    }
  });

  it("answers 405 with Allow for every other method, the same for every address", async () => {
    const answers = [];
    for (const address of [addresses.grace, UNKNOWN]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        const response = await request(on.baseURL, `/artists/${address}`, {
          method,
        });
        answers.push(comparable(response));
        expect(response.status, method).toBe(405);
        expect(response.headers.allow).toBe("GET, HEAD");
        expect(response.headers["cache-control"]).toBe("no-store");
      }
    }
    expect(answers.slice(0, 5)).toEqual(answers.slice(5));
  });
});

describe("an artist address that is not served", () => {
  it("answers exactly as an unknown address does, for every artist that must stay hidden", async () => {
    const unknown = masked(
      await request(on.baseURL, `/artists/${UNKNOWN}`),
      UNKNOWN,
    );
    expect(unknown.status).toBe(404);
    const ids = await client.query<{ id: string; name: string }>(
      "select id, name from artists where id = any($1)",
      [
        [
          ...seeded!.hidden.map((journal) => journal.artistId),
          ...seeded!.catalogOnlyArtistIds,
          seeded!.archivedArtistId,
        ],
      ],
    );
    expect(ids.rows).toHaveLength(seeded!.hidden.length + 2);
    for (const { id, name } of ids.rows) {
      for (const address of candidateAddresses(name, id)) {
        const hidden = await request(on.baseURL, `/artists/${address}`);
        expect(masked(hidden, address), `${name} at ${address}`).toEqual(
          unknown,
        );
      }
    }
    // And malformed addresses, before the database is asked.
    for (const address of [
      "Jeff-Buckley",
      "qz--qz",
      "-qzq",
      "q".repeat(81),
      "%20",
    ]) {
      const response = await request(on.baseURL, `/artists/${address}`);
      expect(response.status, address).toBe(404);
      expect(masked(response, address).body, address).toBe(unknown.body);
    }
  });

  it("answers as an unknown one in every transport form", async () => {
    const hidden = artistAddressBase(ARTIST_MARKERS.draftOnly);
    for (const [index, [name, path, headers]] of forms(hidden).entries()) {
      const [, unknownPath, unknownHeaders] = forms(UNKNOWN)[index]!;
      const a = masked(await ask(on, path, headers), hidden);
      const b = masked(await ask(on, unknownPath, unknownHeaders), UNKNOWN);
      expect(a, name).toEqual(b);
    }
  });

  it("does not link a credited artist that has no page: an archived one stays plain text", async () => {
    const page = await request(on.baseURL, `/albums/${seeded!.sketches.slug}`);
    expect(visibleText(page.body)).toContain(ARTIST_MARKERS.archived);
    const links = await artistLinks(on, seeded!.sketches.slug);
    expect(links).toEqual([addresses.grace]);
  });
});

describe("with public reads off", () => {
  it.each(OFF_VALUES)(
    "answers every artist address as an unknown one, in every form (%j)",
    async (value) => {
      const server = off[value]!;
      for (const address of [addresses.grace, addresses.long]) {
        for (const [index, [name, path, headers]] of forms(address).entries()) {
          const [, unknownPath, unknownHeaders] = forms(UNKNOWN)[index]!;
          const a = masked(await ask(server, path, headers), address);
          const b = masked(
            await ask(server, unknownPath, unknownHeaders),
            UNKNOWN,
          );
          expect(a, `${address} ${name}`).toEqual(b);
        }
      }
      // Every method, too: the switch comes before the method.
      const post = await request(
        server.baseURL,
        `/artists/${addresses.grace}`,
        {
          method: "POST",
        },
      );
      const unknownPost = await request(server.baseURL, `/artists/${UNKNOWN}`, {
        method: "POST",
      });
      expect(masked(post, addresses.grace)).toEqual(
        masked(unknownPost, UNKNOWN),
      );
      expect(post.status).toBe(404);
      // The sitemap does not exist.
      expect((await request(server.baseURL, "/sitemap.xml")).status).toBe(404);
    },
  );
});

describe("the sitemap", () => {
  it("lists the served artist addresses, and no hidden artist", async () => {
    const sitemap = await request(on.baseURL, "/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers["cache-control"]).toBe("no-store");
    const listed = [
      ...sitemap.body.matchAll(/<loc>[^<]*\/artists\/([^<]+)<\/loc>/g),
    ].map((match) => match[1]!);
    for (const address of Object.values(addresses)) {
      expect(listed).toContain(address);
    }
    // Every listed artist address is served.
    for (const address of listed) {
      expect(
        (await request(on.baseURL, `/artists/${address}`)).status,
        address,
      ).toBe(200);
    }
    for (const marker of PRIVATE_ARTIST_MARKER_LIST) {
      expect(sitemap.body).not.toContain(artistAddressBase(marker));
    }
  });
});

// These change the seeded state, so they come last, in order.
describe("a change shows on the next request", () => {
  it("hides the page when the last public journal about the artist's albums is unpublished, and shows it again when one is published", async () => {
    const db = fixtureDatabase(client);
    const author = testAuthor();
    const page = () => request(on.baseURL, `/artists/${addresses.grace}`);
    const unknown = masked(
      await request(on.baseURL, `/artists/${UNKNOWN}`),
      UNKNOWN,
    );

    await unpublishLanguageVersion(
      db,
      author,
      seeded!.grace.entryId,
      "en",
      "private",
    );
    const one = await page();
    expect(one.status).toBe(200);
    // Grace is gone from the page; Sketches keeps the artist public.
    expect(visibleText(one.body)).not.toContain("Mojo Pin");

    await unpublishLanguageVersion(
      db,
      author,
      seeded!.sketches.entryId,
      "en",
      "private",
    );
    expect(masked(await page(), addresses.grace)).toEqual(unknown);
    expect(await artistLinks(on, seeded!.long.slug)).toEqual([addresses.long]);

    await publishForTest(db, seeded!.sketches.entryId, "en");
    expect((await page()).status).toBe(200);
    await publishForTest(db, seeded!.grace.entryId, "en");
  });

  it("shows the empty frame on the next request after the photograph is removed", async () => {
    await client.query(
      `update artists set photo_url = null, photo_credit = null,
         photo_license = null, photo_source_url = null, photo_file_sha1 = null,
         photo_file_timestamp = null, photo_chosen_at = null
       where id = $1`,
      [seeded!.broken.artistId],
    );
    const page = await request(on.baseURL, `/artists/${addresses.broken}`);
    expect(page.status).toBe(200);
    expect(page.body).not.toContain(BROKEN_PHOTO.credit);
    expect(page.body).not.toContain("thumb.wikimedia.org");
  });

  it("hides the page on the next request after the artist is archived", async () => {
    await client.query("update artists set archived_at = now() where id = $1", [
      seeded!.long.artistId,
    ]);
    const unknown = masked(
      await request(on.baseURL, `/artists/${UNKNOWN}`),
      UNKNOWN,
    );
    expect(
      masked(
        await request(on.baseURL, `/artists/${addresses.long}`),
        addresses.long,
      ),
    ).toEqual(unknown);
    expect(await artistLinks(on, seeded!.long.slug)).toEqual([]);
  });
});

describe("everything a reader was sent", () => {
  it("never names a hidden artist, a private photograph credit, or private writing, and nor does any log", () => {
    const sent = corpus.join("\n");
    for (const marker of [
      ...PRIVATE_ARTIST_MARKER_LIST,
      ...PRIVATE_MARKER_LIST,
    ]) {
      expect(sent, marker).not.toContain(marker);
    }
    for (const server of servers) {
      const log = readFileSync(server.serverLog, "utf8");
      for (const marker of [
        ...PRIVATE_ARTIST_MARKER_LIST,
        ...PRIVATE_MARKER_LIST,
      ]) {
        expect(log, marker).not.toContain(marker);
      }
    }
    // Not vacuous: the public artist was sent.
    expect(sent).toContain("Jeff Buckley");
  });
});
