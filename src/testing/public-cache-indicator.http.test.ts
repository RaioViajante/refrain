// Gate G2 and the cache-hit indicator (M3.1 owner review). The prerendered
// not-found view carries `x-nextjs-cache: HIT`, which ADR 0006 § 14 (G2) says
// no response may carry. These tests do not waive that wording; they measure
// what the marker can and cannot reveal, on the production build, with
// adversarial requests:
//
// 1. it is the same on every not-found response, whatever the reason the
//    address is not served (unknown, draft, private, deleted, unpublished,
//    restored, retired), and for GET, HEAD, and RSC requests;
// 2. request history does not change it, in a long-lived server or in a fresh
//    process whose first request is a hidden address;
// 3. it never accompanies a response that carries entry-specific content: not
//    a served page, a redirect, the sitemap, `robots.txt`, `405`, or `503`;
// 4. status, headers, body, and timing do not tell a hidden address from an
//    unknown one;
// 5. the bytes that carry the marker are the build's own artifact, so they
//    cannot contain anything a journal wrote.
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
import { comparable, request, type Snapshot } from "@/testing/public-http";
import {
  fixtureDatabase,
  PRIVATE_MARKER_LIST,
  PRIVATE_MARKERS,
  removeSeeded,
  runPrefix,
  seedGrace,
  seedSimple,
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
const MARKER = "x-nextjs-cache";

let client: Client;
let on: ProductionServer;
let off: ProductionServer;
const seeded: SeededJournal[] = [];
const db = () => fixtureDatabase(client);

// Every address that is not served, by the reason it is not served.
const hidden: Record<string, string> = {};
// An address that is served, and one that redirects.
let servedSlug = "";
let redirectFrom = "";

beforeAll(async () => {
  client = new Client({
    connectionString: databaseUrl,
    application_name: "refrain-http-cache-indicator",
  });
  await client.connect();
  await assertDisposableTestDatabase(client);

  on = await startProductionServer({
    withAuthor: false,
    env: { REFRAIN_PUBLIC_READS_ENABLED: "true" },
  });
  off = await startProductionServer({ withAuthor: false });

  const name = (reason: string) => `${prefix}-${reason}`;

  // Never public.
  for (const status of ["draft", "private"] as const) {
    hidden[status] = name(status);
    seeded.push(
      await seedSimple(client, {
        slug: hidden[status],
        title: `[Test] ${status} album`,
        status,
        marker: PRIVATE_MARKERS.draft,
      }),
    );
  }
  hidden["deleted, never public"] = name("deleted-never");
  seeded.push(
    await seedSimple(client, {
      slug: hidden["deleted, never public"],
      title: "[Test] Deleted album",
      status: "private",
      marker: PRIVATE_MARKERS.draft,
      deletedAt: new Date(),
    }),
  );

  // Public once, then not: the history an observer would most like to see.
  const publicOnce = async (reason: string) => {
    const slug = name(reason);
    const journal = await seedGrace(client, { slug, en: "draft" });
    seeded.push(journal);
    await publishForTest(db(), journal.entryId, "en");
    // Make it genuinely served and requested while public, so any cache that
    // existed would hold it.
    const served = await request(on.baseURL, `/albums/${slug}`);
    expect(served.status).toBe(200);
    await request(on.baseURL, `/albums/${slug}`, { rsc: true });
    return { slug, entryId: journal.entryId };
  };

  const unpublished = await publicOnce("unpublished");
  await unpublishLanguageVersion(
    db(),
    author,
    unpublished.entryId,
    "en",
    "private",
  );
  hidden["unpublished after being public"] = unpublished.slug;

  const deleted = await publicOnce("deleted");
  await deleteAlbumJournal(db(), author, deleted.entryId);
  hidden["deleted after being public"] = deleted.slug;

  const restored = await publicOnce("restored");
  await deleteAlbumJournal(db(), author, restored.entryId);
  await restoreAlbumJournal(db(), author, restored.entryId);
  hidden["restored (stays private)"] = restored.slug;

  const retired = await publicOnce("retired-old");
  await changeEntrySlug(db(), retired.entryId, name("retired-new"));
  await unpublishLanguageVersion(db(), author, retired.entryId, "en", "draft");
  hidden["retired address of an unpublished entry"] = retired.slug;
  hidden["current address of that entry"] = name("retired-new");

  // Served, and redirecting.
  const live = await publicOnce("live");
  servedSlug = live.slug;
  const moved = await publicOnce("moved-old");
  await changeEntrySlug(db(), moved.entryId, name("moved-new"));
  redirectFrom = moved.slug;
}, 180_000);

afterAll(async () => {
  await on?.stop().catch(() => undefined);
  await off?.stop().catch(() => undefined);
  try {
    await removeSeeded(client, seeded, prefix);
  } finally {
    await client.end();
  }
}, 60_000);

const unknownSlug = () => `${prefix}-never-existed`;
const get = async (
  base: string,
  path: string,
  init?: Parameters<typeof request>[2],
) => {
  const answer = await request(base, path, init);
  if (answer.status === 404) {
    notFounds.push(answer);
  }
  return answer;
};

// A slug is the only thing an answer may repeat, and none repeats it here.
const body404 = (snapshot: Snapshot) => comparable(snapshot);

// Two servers differ in the port that the framework's own rewrite header names.
const sameServer = (snapshot: Snapshot) => {
  const view = comparable(snapshot);
  return {
    ...view,
    headers: Object.fromEntries(
      Object.entries(view.headers).map(([name, value]) => [
        name,
        value.replace(/localhost:\d+/g, "localhost:PORT"),
      ]),
    ),
  };
};

/**
 * Every file the build wrote for the public routes and the not-found view,
 * written before any journal existed. A response that carries the cache-hit
 * marker must be exactly one of these, or empty.
 */
function buildArtifacts(): Map<string, string> {
  const root = ".next/server/app";
  const found = new Map<string, string>();
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.(html|rsc)$/.test(entry.name)) {
        found.set(path, readFileSync(path, "utf8"));
      }
    }
  };
  for (const name of ["albums", "_not-found.segments"]) {
    walk(join(root, name));
  }
  for (const name of ["_not-found.html", "_not-found.rsc"]) {
    found.set(join(root, name), readFileSync(join(root, name), "utf8"));
  }
  return found;
}

// Every 404 any request below received, to look for echoes of an address.
const notFounds: Snapshot[] = [];

describe("the marker on a not-found response", () => {
  it("is the same for an unknown address and for every reason an address is hidden", async () => {
    const reference = body404(
      await get(on.baseURL, `/albums/${unknownSlug()}`),
    );
    expect(reference.status).toBe(404);
    for (const [reason, slug] of Object.entries(hidden)) {
      const got = body404(await get(on.baseURL, `/albums/${slug}`));
      expect(got, reason).toEqual(reference);
      expect(got.headers[MARKER], reason).toBe(reference.headers[MARKER]);
    }
  });

  it("is the same over HEAD, RSC, prefetch, and a crawler request", async () => {
    const forms: [string, Parameters<typeof request>[2]][] = [
      ["HEAD", { method: "HEAD" }],
      ["RSC", { rsc: true }],
      ["prefetch", { rsc: true, headers: { "next-router-prefetch": "1" } }],
      ["crawler", { headers: { "user-agent": "Googlebot/2.1" } }],
    ];
    for (const [label, init] of forms) {
      const reference = await get(on.baseURL, `/albums/${unknownSlug()}`, init);
      for (const [reason, slug] of Object.entries(hidden)) {
        const got = await get(on.baseURL, `/albums/${slug}`, init);
        expect(got.status, `${label}: ${reason}`).toBe(reference.status);
        expect(got.headers[MARKER], `${label}: ${reason}`).toBe(
          reference.headers[MARKER],
        );
        expect(got.headers["cache-control"], `${label}: ${reason}`).toBe(
          reference.headers["cache-control"],
        );
      }
    }
  });

  it("is not changed by request history", async () => {
    const slug = hidden["unpublished after being public"]!;
    const first = body404(await get(on.baseURL, `/albums/${slug}`));
    for (let index = 0; index < 25; index += 1) {
      await get(on.baseURL, `/albums/${slug}`);
      await get(on.baseURL, `/albums/${unknownSlug()}`);
      await get(on.baseURL, `/albums/${servedSlug}`);
    }
    expect(body404(await get(on.baseURL, `/albums/${slug}`))).toEqual(first);
    expect(body404(await get(on.baseURL, `/albums/${unknownSlug()}`))).toEqual(
      first,
    );
  });

  it("is the same on the first request a fresh process ever answers", async () => {
    const reference = sameServer(
      await get(on.baseURL, `/albums/${unknownSlug()}`),
    );
    for (const slug of [
      hidden["unpublished after being public"]!,
      hidden["deleted after being public"]!,
      unknownSlug(),
    ]) {
      const fresh = await startProductionServer({
        withAuthor: false,
        env: { REFRAIN_PUBLIC_READS_ENABLED: "true" },
      });
      try {
        const first = sameServer(await get(fresh.baseURL, `/albums/${slug}`));
        expect(first, slug).toEqual(reference);
      } finally {
        await fresh.stop();
      }
    }
  }, 120_000);

  it("is the same with the switch off, for every address", async () => {
    const reference = body404(
      await get(off.baseURL, `/albums/${unknownSlug()}`),
    );
    expect(reference.status).toBe(404);
    // ...and it is the same view as with the switch on.
    expect(
      sameServer(await get(off.baseURL, `/albums/${unknownSlug()}`)),
    ).toEqual(sameServer(await get(on.baseURL, `/albums/${unknownSlug()}`)));
    for (const slug of [servedSlug, ...Object.values(hidden)]) {
      expect(body404(await get(off.baseURL, `/albums/${slug}`)), slug).toEqual(
        reference,
      );
    }
  });
});

describe("the marker never accompanies entry-specific content", () => {
  it("is absent from a served page, its RSC payload, a redirect, the sitemap, robots.txt, and 405", async () => {
    const answers: [string, Snapshot][] = [
      ["served page", await get(on.baseURL, `/albums/${servedSlug}`)],
      [
        "served RSC",
        await get(on.baseURL, `/albums/${servedSlug}`, { rsc: true }),
      ],
      [
        "served page for a crawler",
        await get(on.baseURL, `/albums/${servedSlug}`, {
          headers: { "user-agent": "Googlebot/2.1" },
        }),
      ],
      ["redirect", await get(on.baseURL, `/albums/${redirectFrom}`)],
      ["sitemap", await get(on.baseURL, "/sitemap.xml")],
      ["robots", await get(on.baseURL, "/robots.txt")],
      [
        "405",
        await get(on.baseURL, `/albums/${servedSlug}`, { method: "POST" }),
      ],
    ];
    expect(answers[0]![1].status).toBe(200);
    expect(answers[3]![1].status).toBe(308);
    expect(answers[6]![1].status).toBe(405);
    for (const [label, answer] of answers) {
      expect(answer.headers[MARKER], label).toBeUndefined();
      expect(answer.headers["cache-control"], label).toContain("no-store");
    }
    // The page that carries the writing has no marker: it is rendered for
    // this request, from the database.
    expect(answers[0]![1].body).toContain("Grace");
  });

  it("is on a served address's prefetch only as bytes the build itself wrote", async () => {
    // A router prefetch of a served address is answered from the prerendered
    // shell (navigation, "Loading…", footer), which holds no entry data. The
    // marker is therefore on a response for a SERVED address, and the question
    // is whether it can accompany anything the entry wrote. It cannot: the
    // body is exactly a file from the build, or empty.
    const artifacts = [...buildArtifacts().values()];
    const forms: Record<string, string>[] = [
      { "next-router-prefetch": "1" },
      { "next-router-prefetch": "1", "next-router-segment-prefetch": "/_tree" },
      {
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/!KHB1YmxpYyk/albums/$d$slug/__PAGE__",
      },
    ];
    let marked = 0;
    for (const slug of [servedSlug, redirectFrom, ...Object.values(hidden)]) {
      for (const headers of forms) {
        const answer = await get(on.baseURL, `/albums/${slug}`, {
          rsc: true,
          headers,
        });
        if (answer.headers[MARKER] === undefined) {
          continue;
        }
        marked += 1;
        expect(answer.headers["cache-control"]).toContain("no-store");
        expect(
          answer.body === "" || artifacts.includes(answer.body),
          `${slug} ${JSON.stringify(headers)} (${answer.status}) is not a build artifact`,
        ).toBe(true);
        for (const needle of [...PRIVATE_MARKER_LIST, prefix, "[Test]"]) {
          expect(answer.body).not.toContain(needle);
          expect(JSON.stringify(answer.headers)).not.toContain(needle);
        }
      }
    }
    // The test is not vacuous: the framework does mark these.
    expect(marked).toBeGreaterThan(0);
  });

  it("is carried on the not-found view only by the build's own prerendered bytes", async () => {
    const answers = [
      await get(on.baseURL, `/albums/${unknownSlug()}`),
      await get(
        on.baseURL,
        `/albums/${hidden["unpublished after being public"]}`,
      ),
      await get(on.baseURL, `/albums/${hidden["draft"]}`),
      await get(off.baseURL, `/albums/${servedSlug}`),
      // The sitemap and robots.txt with the switch off are this same view.
      await get(off.baseURL, "/sitemap.xml"),
      await get(off.baseURL, "/robots.txt"),
    ];
    const artifact = readFileSync(".next/server/app/_not-found.html", "utf8");
    for (const answer of answers) {
      expect(answer.headers[MARKER]).toBe("HIT");
      // No row, slug, title, or marker of any journal is in the artifact, and
      // the answer holds none either.
      for (const needle of [...PRIVATE_MARKER_LIST, prefix, "[Test]"]) {
        expect(artifact).not.toContain(needle);
        expect(answer.body).not.toContain(needle);
        expect(JSON.stringify(answer.headers)).not.toContain(needle);
      }
      expect(answer.body).toBe(artifact);
    }
  });
});

describe("the not-found view's illustration", () => {
  it("is a static file, byte for byte the approved original, and the same for everyone", async () => {
    const original = readFileSync("public/artwork/refrain-404.png");
    const digest = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex");
    for (const base of [on.baseURL, off.baseURL]) {
      const response = await fetch(`${base}/artwork/refrain-404.png`, {
        redirect: "manual",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get(MARKER)).toBeNull();
      expect(digest(new Uint8Array(await response.arrayBuffer()))).toBe(
        digest(original),
      );
    }
  });
});

describe("what else could tell a hidden address from an unknown one", () => {
  it("has the same response time, within a generous bound", async () => {
    // A hidden address and an unknown one run the same code: one slug query,
    // then the same rewrite to the same prerendered view. This measures it,
    // with interleaved requests so that drift affects both alike. It is a
    // tripwire for an extra query or a branch, not a constant-time proof: a
    // network observer far from the server cannot resolve what this can.
    const slug = hidden["unpublished after being public"]!;
    const time = async (path: string) => {
      const start = performance.now();
      const response = await fetch(`${on.baseURL}${path}`, {
        redirect: "manual",
      });
      await response.text();
      return performance.now() - start;
    };
    for (let warm = 0; warm < 20; warm += 1) {
      await time(`/albums/${slug}`);
      await time(`/albums/${unknownSlug()}`);
    }
    const hiddenTimes: number[] = [];
    const unknownTimes: number[] = [];
    for (let round = 0; round < 80; round += 1) {
      hiddenTimes.push(await time(`/albums/${slug}`));
      unknownTimes.push(await time(`/albums/${unknownSlug()}`));
    }
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    const difference = Math.abs(median(hiddenTimes) - median(unknownTimes));
    expect(difference).toBeLessThan(15);
  }, 120_000);

  it("repeats no address, and no journal text, in any not-found response", () => {
    expect(notFounds.length).toBeGreaterThan(40);
    for (const answer of notFounds) {
      const text = JSON.stringify(answer.headers) + answer.body;
      for (const needle of [
        ...PRIVATE_MARKER_LIST,
        ...Object.values(hidden),
        servedSlug,
        redirectFrom,
        unknownSlug(),
        prefix,
      ]) {
        expect(text).not.toContain(needle);
      }
    }
  });
});
