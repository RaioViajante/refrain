// ADR 0006 A13 (approved by the owner on 2026-11-15): the router's URL forms
// (`<address>.rsc` and `<address>.segments/…/*.segment.rsc`) of an address
// that is not served. Next.js decides from the requested path, after the
// proxy, that a rendered answer is the router's payload, so these forms
// cannot answer an unknown address's HTML document byte for byte
// (docs/evidence/self-proxy-and-g1.md). What A13 requires instead, and this
// file fixes on the production build:
//
// 1. Their answer does not depend on what the database holds: the same bytes
//    with no entry at all, and with a published, a draft, a private, a
//    deleted, and an unpublished journal, memories in every state, and artist
//    pages (the framework's per-render identifiers masked).
// 2. A hidden address and an unknown one answer the same bytes in each such
//    form (the requested slug, of the same length, masked).
// 3. They carry no stored text, no private marker, and no cookie.
//
// Every other request form keeps byte identity with the HTML document of an
// unknown address (public-archives.http.test.ts, public-album-journal,
// public-memory, public-artist, public-request-forms).
import { randomBytes } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// eslint-disable-next-line no-restricted-imports
import { unpublishLanguageVersion } from "@/modules/publication/commands";
import { testAuthor } from "@/testing/fixtures";
import {
  startProductionServer,
  type ProductionServer,
} from "@/testing/production-server";
import {
  PRIVATE_ARTIST_MARKER_LIST,
  removeSeededArtists,
  seedArtistPages,
  type SeededArtists,
} from "@/testing/public-artists";
import { comparable, request } from "@/testing/public-http";
import {
  fixtureDatabase,
  PRIVATE_MARKER_LIST,
  PRIVATE_MARKERS,
  removeSeeded,
  runPrefix,
  seedSimple,
  type SeededJournal,
} from "@/testing/public-journals";
import {
  MEMORY_MARKER_LIST,
  PUBLIC_MEMORY,
  removeSeededMemories,
  seedMemories,
  type SeededMemories,
} from "@/testing/public-memories";
import { assertDisposableTestDatabase } from "@/testing/test-database";

// The commands that unpublish need the application's configuration; it exists
// only in this process's memory.
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

const databaseUrl = inject("studioCommandEnv").DATABASE_URL!;
const prefix = runPrefix();
const slug = (name: string) => `${prefix}-${name}`;
const author = testAuthor();
const COOKIE = "probe=refrain-private-cookie-value";

const HIDDEN = ["draft", "private", "deleted", "unpublished"] as const;

/** The router's URL forms of one address. */
const urlForms = (address: string) => [
  `${address}.rsc`,
  `${address}.segments/_tree.segment.rsc`,
  `${address}.segments/_full.segment.rsc`,
];

// Addresses that are not served in either state of the database: the
// sections with the switch off, and, with it on, journal, memory, and artist
// addresses that name nothing (the hidden ones are compared below).
const OFF_ADDRESSES = [
  "/albums",
  "/artists",
  "/memories",
  "/about",
  "/pt/albums",
  "/pt/about",
];
const ON_ADDRESSES = [
  `/albums/${slug("no-such-journal")}`,
  `/pt/albums/${slug("no-such-journal")}`,
  `/memories/${slug("no-such-memory")}`,
  `/artists/${slug("no-such-artist")}`,
];

let client: Client;
const db = () => fixtureDatabase(client);
const seeded: SeededJournal[] = [];
let memories: SeededMemories | undefined;
let artists: SeededArtists | undefined;
let off: ProductionServer;
let on: ProductionServer;

/** The framework's per-render identifiers, which differ on every request. */
const withoutRenderIds = (text: string) =>
  text.replace(/(")[A-Za-z0-9_-]{21,23}(?![A-Za-z0-9_-])/g, "$1ID");

/** Every answer as received, before any masking, for the marker scan. */
const raw = new Map<string, string>();

async function answers(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [server, addresses] of [
    [off, OFF_ADDRESSES],
    [on, ON_ADDRESSES],
  ] as const) {
    for (const path of addresses.flatMap(urlForms)) {
      const answer = comparable(
        await request(server.baseURL, path, { headers: { cookie: COOKIE } }),
      );
      const key = `${server === off ? "off" : "on"} ${path}`;
      raw.set(key, JSON.stringify(answer));
      out.set(key, withoutRenderIds(JSON.stringify(answer)));
    }
  }
  return out;
}

let empty: Map<string, string>;
let populated: Map<string, string>;

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-router-forms",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);
  off = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: undefined },
  });
  on = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: "true" },
  });

  // The empty state: no writing, no catalog record, nothing to publish.
  const { rows } = await client.query<{ entries: string; albums: string }>(
    "select (select count(*) from entries) as entries, (select count(*) from albums) as albums",
  );
  expect(
    rows[0],
    "the disposable database must start this file with no entry and no album (another file left rows behind)",
  ).toEqual({ entries: "0", albums: "0" });
  empty = await answers();

  // The populated state: every publication state.
  for (const [state, status, deletedAt] of [
    ["published", "published", undefined],
    ["draft", "draft", undefined],
    ["private", "private", undefined],
    ["deleted", "published", new Date()],
    ["unpublished", "published", undefined],
  ] as const) {
    seeded.push(
      await seedSimple(client, {
        slug: slug(state),
        title: `[Test] ROUTER-FORMS-${state}`,
        status,
        marker:
          state in PRIVATE_MARKERS
            ? PRIVATE_MARKERS[state as keyof typeof PRIVATE_MARKERS]
            : `[Test] ROUTER-FORMS-MARKER-${state}`,
        deletedAt,
      }),
    );
  }
  await unpublishLanguageVersion(
    db(),
    author,
    seeded.find((s) => s.slug === slug("unpublished"))!.entryId,
    "en",
    "private",
  );
  memories = await seedMemories(client, prefix);
  artists = await seedArtistPages(client, `${prefix}a`);
  populated = await answers();
}, 240_000);

afterAll(async () => {
  await off?.stop().catch(() => undefined);
  await on?.stop().catch(() => undefined);
  try {
    if (artists) await removeSeededArtists(client, artists, `${prefix}a`);
    if (memories) await removeSeededMemories(client, memories, prefix);
    await removeSeeded(client, seeded, prefix);
  } finally {
    await client.end();
  }
});

describe("the router's URL forms of an address that is not served (ADR 0006 A13)", () => {
  it("answer the same bytes with an empty and with a populated database", () => {
    expect(populated.size).toBe(empty.size);
    expect(empty.size).toBe((OFF_ADDRESSES.length + ON_ADDRESSES.length) * 3);
    for (const [key, before] of empty) {
      expect(populated.get(key), key).toBe(before);
    }
  });

  it("are a 404 with the shared not-found payload, and carry no stored text and no cookie", () => {
    for (const [key, masked] of populated) {
      // Scanned as received: masking could hide a token of an ID's length.
      const answer = raw.get(key)!;
      expect(withoutRenderIds(answer), key).toBe(masked);
      const parsed = JSON.parse(answer) as {
        status: number;
        headers: Record<string, string>;
        body: string;
      };
      expect(parsed.status, key).toBe(404);
      expect(parsed.headers["content-type"], key).toContain("text/x-component");
      expect(parsed.headers["cache-control"], key).toContain("no-store");
      expect(parsed.body, key).toContain("/_not-found");
      for (const marker of [
        ...PRIVATE_MARKER_LIST,
        ...MEMORY_MARKER_LIST,
        ...PRIVATE_ARTIST_MARKER_LIST,
        "ROUTER-FORMS",
        "[Test]",
        PUBLIC_MEMORY.albumArtist,
        "refrain-private-cookie-value",
      ]) {
        expect(answer.includes(marker), `${key}: ${marker}`).toBe(false);
      }
    }
  });

  it.each(HIDDEN)(
    "answer a %s journal's address as an unknown one, byte for byte, in each form",
    async (state) => {
      const hidden = slug(state);
      // An unknown address of the same length: the payload echoes the
      // requested address, so the length changes its byte offsets.
      const unknown = slug("z".repeat(state.length));
      for (const prefixPath of ["/albums", "/pt/albums"]) {
        const hiddenForms = urlForms(`${prefixPath}/${hidden}`);
        const unknownForms = urlForms(`${prefixPath}/${unknown}`);
        for (const [i, path] of hiddenForms.entries()) {
          const got = comparable(
            await request(on.baseURL, path, { headers: { cookie: COOKIE } }),
          );
          const expected = comparable(
            await request(on.baseURL, unknownForms[i]!, {
              headers: { cookie: COOKIE },
            }),
          );
          expect(got.status, path).toBe(404);
          const mask = (text: string, s: string) =>
            withoutRenderIds(text.split(s).join("SLUG"));
          expect(
            mask(JSON.stringify(got), hidden),
            `${path} against ${unknownForms[i]}`,
          ).toBe(mask(JSON.stringify(expected), unknown));
        }
      }
    },
  );

  it("answer every hidden memory's address as an unknown one in each form, EN and /pt", async () => {
    // Every memory that is not served, by state (seedMemories).
    const hiddenMemories = memories!.hidden.map((memory) => memory.slug);
    expect(hiddenMemories.length).toBeGreaterThan(0);
    for (const hidden of hiddenMemories) {
      const unknown = `${prefix}-${"z".repeat(hidden.length - prefix.length - 1)}`;
      for (const section of ["/memories", "/pt/memories"]) {
        const unknownForms = urlForms(`${section}/${unknown}`);
        for (const [i, path] of urlForms(`${section}/${hidden}`).entries()) {
          const got = comparable(
            await request(on.baseURL, path, { headers: { cookie: COOKIE } }),
          );
          const expected = comparable(
            await request(on.baseURL, unknownForms[i]!, {
              headers: { cookie: COOKIE },
            }),
          );
          expect(got.status, path).toBe(404);
          expect(
            withoutRenderIds(JSON.stringify(got).split(hidden).join("SLUG")),
            path,
          ).toBe(
            withoutRenderIds(
              JSON.stringify(expected).split(unknown).join("SLUG"),
            ),
          );
        }
      }
    }
  });
});
