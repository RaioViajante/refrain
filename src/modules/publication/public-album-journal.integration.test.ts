import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  schema,
  type DatabaseExecutor,
  type Locale,
  type Transaction,
} from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestArtistJournal,
  createTestTrackReflection,
  inRollbackTransaction,
  type TestVersion,
} from "@/testing";

import {
  getPublicAlbumJournal,
  listPublicAlbumJournalAddresses,
} from "./public-album-journal";
import { changeEntrySlug } from "./commands";
import { listPublicAlbums, listRecentPublicAlbumJournals } from "./public-home";
import { routeAlbumJournalRequest } from "./public-routing";
import { resolvePublicSlug } from "./queries";

// The public album-journal read model against real PostgreSQL (M3.1): what a
// reader may see, in every state of the journal, compared with an independent
// account written here in plain TypeScript. The HTTP behavior of the same
// states is tested against the production build in
// src/testing/public-album-journal.http.test.ts.

type Status = "draft" | "private" | "published";

interface State {
  deleted: boolean;
  en: Status;
  pt: Status | null;
  original: "en" | "pt-BR";
  flag: boolean;
  enText: boolean;
  ptText: boolean;
}

const statuses: Status[] = ["draft", "private", "published"];

function states(): State[] {
  const all: State[] = [];
  for (const deleted of [false, true]) {
    for (const en of statuses) {
      for (const pt of [null, ...statuses] as (Status | null)[]) {
        for (const original of ["en", "pt-BR"] as const) {
          if (pt === null && original === "pt-BR") {
            continue;
          }
          for (const flag of [false, true]) {
            for (const enText of [false, true]) {
              for (const ptText of [false, true]) {
                if (pt === null && ptText) {
                  continue;
                }
                all.push({ deleted, en, pt, original, flag, enText, ptText });
              }
            }
          }
        }
      }
    }
  }
  return all;
}

const EN_TEXT = "[Test] English body";
const PT_TEXT = "[Test] Portuguese body";
// Each language is published on its own day, so the date a list shows says
// which version it chose.
const PUBLISHED_ON = {
  en: new Date("2026-01-05T00:00:00Z"),
  "pt-BR": new Date("2026-02-05T00:00:00Z"),
} as const;
const RATING = 7;

// The oracle: what a reader of an English-speaking interface may see.
function expected(state: State) {
  const visible = (status: Status | null) =>
    !state.deleted && status === "published";
  const enVisible = visible(state.en);
  const ptVisible = visible(state.pt);
  if (!enVisible && !ptVisible) {
    return null;
  }
  const originalVisible = state.original === "en" ? enVisible : ptVisible;
  const locale: Locale = enVisible
    ? "en"
    : originalVisible
      ? state.original
      : "pt-BR";
  const hasText = locale === "en" ? state.enText : state.ptText;
  return {
    locale,
    reflected: state.flag && hasText,
    rating: RATING,
  };
}

describe("the public album journal in every state", () => {
  it("is exactly what the independent oracle says, for every combination", async () => {
    const all = states();
    expect(all.length).toBeGreaterThan(300);
    const mismatches: string[] = [];

    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, "[Test] Artist");
      for (const [index, state] of all.entries()) {
        const slug = `matrix-${index}`;
        const album = await createTestAlbum(tx, {
          title: `[Test] Album ${index}`,
          trackTitles: ["[Test] A", "[Test] B", "[Test] C"],
          artistIds: [artistId],
        });
        const versions: TestVersion[] = [
          {
            locale: "en",
            status: state.en,
            isOriginal: state.original === "en",
            text: EN_TEXT,
            publishedAt: PUBLISHED_ON.en,
          },
        ];
        if (state.pt !== null) {
          versions.push({
            locale: "pt-BR",
            status: state.pt,
            isOriginal: state.original === "pt-BR",
            text: PT_TEXT,
            publishedAt: PUBLISHED_ON["pt-BR"],
          });
        }
        const entryId = await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          versions,
          slug,
          ratingHalfSteps: RATING,
          deletedAt: state.deleted ? new Date() : undefined,
        });
        await createTestTrackReflection(tx, {
          albumJournalId: entryId,
          albumId: album.albumId,
          trackId: album.trackIds[1]!,
          isPublished: state.flag,
          texts: {
            ...(state.enText ? { en: "[Test] en reflection" } : {}),
            ...(state.ptText ? { "pt-BR": "[Test] pt reflection" } : {}),
          },
        });

        const page = await getPublicAlbumJournal(tx, entryId, "en");
        const want = expected(state);
        const label = JSON.stringify(state);

        const resolution = await resolvePublicSlug(tx, "album_journal", slug);
        const addresses = await listPublicAlbumJournalAddresses(tx);
        const listed = addresses.includes(slug);

        if (want === null) {
          if (page !== null) mismatches.push(`${label}: a page was served`);
          if (resolution.outcome !== "not_found")
            mismatches.push(`${label}: the address resolved`);
          if (listed) mismatches.push(`${label}: the sitemap listed it`);
          continue;
        }
        if (page === null) {
          mismatches.push(`${label}: no page`);
          continue;
        }
        if (resolution.outcome !== "found") {
          mismatches.push(`${label}: the address did not resolve`);
        }
        if (!listed) mismatches.push(`${label}: the sitemap lacks it`);
        if (page.locale !== want.locale) {
          mismatches.push(`${label}: locale ${page.locale}`);
        }
        const body = JSON.stringify(page.body);
        const own = want.locale === "en" ? EN_TEXT : PT_TEXT;
        const other = want.locale === "en" ? PT_TEXT : EN_TEXT;
        if (!body.includes(own) || body.includes(other)) {
          mismatches.push(`${label}: the body is not the chosen version's`);
        }
        if (page.ratingHalfSteps !== want.rating) {
          mismatches.push(`${label}: rating ${page.ratingHalfSteps}`);
        }
        const shown = page.tracks[1]!.reflection !== null;
        if (shown !== want.reflected) {
          mismatches.push(`${label}: reflection shown=${shown}`);
        }
        // The other tracks never have one, and the reflection's text is the
        // chosen language's own.
        if (
          page.tracks[0]!.reflection !== null ||
          page.tracks[2]!.reflection !== null
        ) {
          mismatches.push(`${label}: a reflection on the wrong track`);
        }
        const reflection = page.tracks[1]!.reflection;
        if (reflection) {
          const text = JSON.stringify(reflection.body);
          const wantText =
            want.locale === "en" ? "en reflection" : "pt reflection";
          const otherText =
            want.locale === "en" ? "pt reflection" : "en reflection";
          if (!text.includes(wantText) || text.includes(otherText)) {
            mismatches.push(`${label}: reflection text of the wrong language`);
          }
        }
      }

      // The Home (M3.4): both of its lists, read once over every state, hold
      // exactly the visible journals, each dated by the version the oracle
      // chose. Every album here has one journal, so it presents that one.
      const recent = new Map(
        (await listRecentPublicAlbumJournals(tx, "en", 100_000)).map((card) => [
          card.slug,
          card,
        ]),
      );
      const albums = new Map(
        (await listPublicAlbums(tx, "en", 100_000)).map((card) => [
          card.slug,
          card,
        ]),
      );
      for (const [index, state] of all.entries()) {
        const slug = `matrix-${index}`;
        const want = expected(state);
        const label = JSON.stringify(state);
        for (const [name, list] of [
          ["Recently written", recent],
          ["Albums", albums],
        ] as const) {
          const card = list.get(slug);
          if (want === null) {
            if (card) mismatches.push(`${label}: ${name} listed it`);
            continue;
          }
          if (!card) {
            mismatches.push(`${label}: ${name} lacks it`);
            continue;
          }
          if (
            card.publishedAt.getTime() !== PUBLISHED_ON[want.locale].getTime()
          ) {
            mismatches.push(`${label}: ${name} dated another version`);
          }
          if (card.ratingHalfSteps !== want.rating) {
            mismatches.push(`${label}: ${name} rating ${card.ratingHalfSteps}`);
          }
        }
      }
    });

    expect(mismatches).toEqual([]);
    // 384 states in one transaction: allow for a slow runner (it took just over
    // the default 5 s in CI once).
  }, 60_000);
});

describe("the public album journal's projection", () => {
  async function publishedJournal(tx: Transaction) {
    const first = await createTestArtist(tx, "[Test] First");
    const second = await createTestArtist(tx, "[Test] Second");
    const album = await createTestAlbum(tx, {
      title: "[Test] Album",
      trackTitles: ["[Test] One", "[Test] Two", "[Test] Three"],
      artistIds: [first, second],
      firstReleaseYear: 1994,
    });
    const entryId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      versions: [{ locale: "en", status: "published" }],
      slug: "projection",
      ratingHalfSteps: 9,
    });
    return { entryId, album, first, second };
  }

  it("holds only what a reader may see, at every level", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId, album } = await publishedJournal(tx);
      await createTestTrackReflection(tx, {
        albumJournalId: entryId,
        albumId: album.albumId,
        trackId: album.trackIds[0]!,
        isPublished: true,
        isFavourite: true,
        isStillWriting: true,
        ratingHalfSteps: 8,
        texts: { en: "[Test] public" },
      });
      const page = (await getPublicAlbumJournal(tx, entryId, "en"))!;
      expect(Object.keys(page).sort()).toEqual([
        "album",
        "body",
        "credits",
        "entryId",
        "isOriginal",
        "locale",
        "marginNote",
        "opening",
        "publishedAt",
        "ratingHalfSteps",
        "tracks",
      ]);
      expect(Object.keys(page.album).sort()).toEqual([
        "artwork",
        "firstReleaseYear",
        "label",
        "title",
      ]);
      expect(page.album.artwork).toBeNull();
      // M3.5: the credited artist's public address, never an identifier.
      expect(Object.keys(page.credits[0]!).sort()).toEqual([
        "artistAddress",
        "name",
      ]);
      expect(page.credits[0]!.artistAddress).toMatch(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
      );
      // A track row carries no database id.
      expect(Object.keys(page.tracks[0]!).sort()).toEqual([
        "credit",
        "number",
        "reflection",
        "title",
      ]);
      expect(Object.keys(page.tracks[0]!.reflection!).sort()).toEqual([
        "body",
        "isFavourite",
        "isStillWriting",
        "ratingHalfSteps",
      ]);
      const text = JSON.stringify(page);
      for (const word of [
        "status",
        "deleted",
        "draft",
        "version",
        "updatedAt",
        "createdAt",
        "slug",
        "is_published",
        "isPublished",
      ]) {
        expect(text, word).not.toContain(`"${word}"`);
      }
    });
  });

  it("shows the chosen cover as image sources only, and nothing for any other stored value (M3.2)", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId, album } = await publishedJournal(tx);
      const release = "3f8c4f8e-0000-4000-8000-000000000001";
      const stored = `https://coverartarchive.org/release/${release}/1000000001`;
      await tx
        .update(schema.albums)
        .set({ coverUrl: stored, coverSource: "Cover Art Archive" })
        .where(eq(schema.albums.id, album.albumId));
      const page = (await getPublicAlbumJournal(tx, entryId, "en"))!;
      expect(page.album.artwork).toEqual({
        src: `${stored}-500.jpg`,
        srcSet: `${stored}-250.jpg 250w, ${stored}-500.jpg 500w, ${stored}-1200.jpg 1200w`,
      });
      // The stored address itself is not part of the page.
      expect(JSON.stringify(page)).not.toContain(`"${stored}"`);

      for (const [coverUrl, coverSource] of [
        ["https://evil.example/cover.jpg", "Cover Art Archive"],
        ["javascript:alert(1)", "Cover Art Archive"],
        [`${stored}?track=1`, "Cover Art Archive"],
        [stored, "elsewhere"],
      ]) {
        await tx
          .update(schema.albums)
          .set({ coverUrl, coverSource })
          .where(eq(schema.albums.id, album.albumId));
        const tampered = (await getPublicAlbumJournal(tx, entryId, "en"))!;
        expect(tampered.album.artwork, coverUrl).toBeNull();
        expect(JSON.stringify(tampered)).not.toContain(coverUrl);
      }
    });
  });

  it("is unchanged by an artist photograph, set, replaced, or removed (M3.3, gate G8)", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId, first, second } = await publishedJournal(tx);
      const before = JSON.stringify(
        await getPublicAlbumJournal(tx, entryId, "en"),
      );
      const name = "Test_Ink_Quartet_on_stage.jpg";
      const photo = {
        photoUrl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/330px-${name}`,
        photoCredit: "[Test] Photographer One",
        photoLicense: "CC BY-SA 4.0",
        photoSourceUrl: `https://commons.wikimedia.org/wiki/File:${name}`,
        photoFileSha1: "a".repeat(40),
        photoFileTimestamp: new Date("2019-05-04T12:00:00Z"),
        photoChosenAt: new Date("2026-11-02T12:00:00Z"),
      };
      const empty = Object.fromEntries(
        Object.keys(photo).map((key) => [key, null]),
      );
      for (const values of [
        photo,
        { ...photo, photoCredit: "[Test] Other" },
        empty,
      ]) {
        await tx
          .update(schema.artists)
          .set(values)
          .where(eq(schema.artists.id, first));
        await tx
          .update(schema.artists)
          .set(values)
          .where(eq(schema.artists.id, second));
        const page = JSON.stringify(
          await getPublicAlbumJournal(tx, entryId, "en"),
        );
        expect(page).toBe(before);
        expect(page).not.toContain("wikimedia");
        expect(page).not.toContain("Photographer");
      }
    });
  });

  it("lists credits in order, using the credited name when there is one", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId, album } = await publishedJournal(tx);
      const names = (await getPublicAlbumJournal(tx, entryId, "en"))!.credits;
      expect(names.map((c) => c.name)).toEqual([
        "[Test] First",
        "[Test] Second",
      ]);
      // A credit as the release names it.
      await tx
        .update(schema.albumArtists)
        .set({ creditedAs: "[Test] Credited As" })
        .where(
          and(
            eq(schema.albumArtists.albumId, album.albumId),
            eq(schema.albumArtists.position, 1),
          ),
        );
      expect(
        (await getPublicAlbumJournal(tx, entryId, "en"))!.credits[0]!.name,
      ).toBe("[Test] Credited As");
    });
  });

  it("lists the reference edition's tracks in order with their own credit", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId, album } = await publishedJournal(tx);
      await tx
        .update(schema.tracks)
        .set({ credit: "[Test] Writer" })
        .where(eq(schema.tracks.id, album.trackIds[1]!));
      const page = (await getPublicAlbumJournal(tx, entryId, "en"))!;
      expect(page.tracks.map((t) => [t.number, t.title, t.credit])).toEqual([
        [1, "[Test] One", null],
        [2, "[Test] Two", "[Test] Writer"],
        [3, "[Test] Three", null],
      ]);
      expect(page.album).toEqual({
        title: "[Test] Album",
        firstReleaseYear: 1994,
        label: "[Test] Label",
        artwork: null,
      });
      expect(page.ratingHalfSteps).toBe(9);
    });
  });

  it("serves the reader's language when both are public, and the other when only it is", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, {
        title: "[Test] Two languages",
      });
      const entryId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        versions: [
          { locale: "en", status: "published", text: EN_TEXT },
          { locale: "pt-BR", status: "published", text: PT_TEXT },
        ],
        slug: "two-languages",
      });
      expect((await getPublicAlbumJournal(tx, entryId, "en"))!.locale).toBe(
        "en",
      );
      expect((await getPublicAlbumJournal(tx, entryId, "pt-BR"))!.locale).toBe(
        "pt-BR",
      );
    });
  });

  it("is not an artist journal's page", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, "[Test] Artist");
      const entryId = await createTestArtistJournal(tx, {
        artistId,
        versions: [{ locale: "en", status: "published" }],
        slug: "an-artist-journal",
      });
      expect(await getPublicAlbumJournal(tx, entryId, "en")).toBeNull();
      expect(
        await getPublicAlbumJournal(
          tx,
          "00000000-0000-4000-8000-000000000000",
          "en",
        ),
      ).toBeNull();
    });
  });
});

describe("the sitemap's addresses", () => {
  it("are exactly the addresses that resolve to a page, and never a previous one", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx, { title: "[Test] Renamed" });
      const entryId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        versions: [{ locale: "en", status: "published" }],
        slug: "sitemap-old",
      });
      await changeEntrySlug(tx, entryId, "sitemap-new");
      const listed = await listPublicAlbumJournalAddresses(tx);
      expect(listed).toContain("sitemap-new");
      expect(listed).not.toContain("sitemap-old");
      // Every listed address is served, and the previous one redirects.
      for (const slug of listed) {
        expect(
          (await resolvePublicSlug(tx, "album_journal", slug)).outcome,
          slug,
        ).toBe("found");
      }
      expect(
        await resolvePublicSlug(tx, "album_journal", "sitemap-old"),
      ).toEqual({
        outcome: "redirect",
        currentSlug: "sitemap-new",
      });
    });
  });
});

describe("the routing decision", () => {
  const on = { REFRAIN_PUBLIC_READS_ENABLED: "true" };

  async function twoAddresses(tx: Transaction) {
    const album = await createTestAlbum(tx, { title: "[Test] Routing" });
    const entryId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      versions: [{ locale: "en", status: "published" }],
      slug: "route-old",
    });
    await changeEntrySlug(tx, entryId, "route-new");
    return entryId;
  }

  it("serves a current address, redirects a previous one, and 404s the rest", async () => {
    await inRollbackTransaction(async (tx) => {
      await twoAddresses(tx);
      const route = (method: string, slug: string, env = on) =>
        routeAlbumJournalRequest(() => tx, { method, slug }, env);
      expect(await route("GET", "route-new")).toEqual({ action: "serve" });
      expect(await route("HEAD", "route-new")).toEqual({ action: "serve" });
      expect(await route("GET", "route-old")).toEqual({
        action: "redirect",
        currentSlug: "route-new",
      });
      expect(await route("GET", "route-unknown")).toEqual({
        action: "not_found",
      });
    });
  });

  it("answers the unknown-address 404 to every method while the switch is off or not exactly true", async () => {
    await inRollbackTransaction(async (tx) => {
      await twoAddresses(tx);
      for (const env of [
        {},
        { REFRAIN_PUBLIC_READS_ENABLED: "" },
        { REFRAIN_PUBLIC_READS_ENABLED: "TRUE" },
        { REFRAIN_PUBLIC_READS_ENABLED: "1" },
        { REFRAIN_PUBLIC_READS_ENABLED: "false" },
      ]) {
        for (const method of ["GET", "HEAD", "POST", "DELETE"]) {
          for (const slug of ["route-new", "route-old", "route-unknown"]) {
            expect(
              await routeAlbumJournalRequest(() => tx, { method, slug }, env),
              `${JSON.stringify(env)} ${method} ${slug}`,
            ).toEqual({ action: "not_found" });
          }
        }
      }
    });
  });

  it("refuses other methods before looking at the address", async () => {
    let reads = 0;
    const db = () => {
      reads += 1;
      throw new Error("the database must not be reached");
    };
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(
        await routeAlbumJournalRequest(db, { method, slug: "route-new" }, on),
      ).toEqual({ action: "method_not_allowed" });
    }
    expect(reads).toBe(0);
  });

  it("answers a malformed address without reading the database", async () => {
    let reads = 0;
    const db = () => {
      reads += 1;
      throw new Error("the database must not be reached");
    };
    for (const slug of [
      "",
      "UPPER",
      "a b",
      "a_b",
      "-a",
      "a-",
      "a--b",
      "a".repeat(81),
      "ä",
      "../x",
      "a%2Fb",
    ]) {
      expect(
        await routeAlbumJournalRequest(db, { method: "GET", slug }, on),
        JSON.stringify(slug),
      ).toEqual({ action: "not_found" });
    }
    expect(reads).toBe(0);
  });

  it("fails as unavailable, never as a 404, and never repeats the error", async () => {
    const broken = {
      execute: async () => {
        throw new Error("password=hunter2 host=db.internal");
      },
    } as unknown as DatabaseExecutor;
    const answer = await routeAlbumJournalRequest(
      () => broken,
      { method: "GET", slug: "route-new" },
      on,
    );
    expect(answer).toEqual({ action: "unavailable" });
    expect(JSON.stringify(answer)).not.toContain("hunter2");
    // A database that cannot even be opened is the same.
    expect(
      await routeAlbumJournalRequest(
        () => {
          throw new Error("DATABASE_URL is not set");
        },
        { method: "GET", slug: "route-new" },
        on,
      ),
    ).toEqual({ action: "unavailable" });
  });
});
