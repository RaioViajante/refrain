import { inspect } from "node:util";

import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { schema, type DatabaseExecutor, type Locale } from "@/db";
import {
  claimsOf,
  createTestAlbum,
  createTestAlbumJournal,
  createTestMemory,
  createTestTrackReflection,
  inRollbackTransaction,
  mintTestToken,
  otherSession,
  reissueTestToken,
  shiftedTestToken,
  testAuthor,
  testSecret,
  uniqueLabel,
} from "@/testing";

import {
  changeEntrySlug,
  restoreDeletedEntry,
  unpublishLanguageVersion,
} from "./commands";
import { PublicationError } from "./errors";
import { disclosureOf, fingerprintOf, readPublishState } from "./disclosure";
import { previewPublication, publishLanguageVersion } from "./publish";
import {
  getPublicLanguageVersion,
  listPublicLanguageVersions,
  listPublicTrackReflections,
} from "./queries";
import type { PublishPreview } from "./publish";

// ADR 0006 § 13: the command boundary, on real PostgreSQL. Everything is
// synthetic and rolled back. Tests that need separate transactions or real
// concurrency are in publish.concurrency.integration.test.ts.

const author = testAuthor();
const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Every table that holds anything a reader could see. A refusal must leave
// the checksum of all of them unchanged.
const CHECKED_TABLES = [
  "entries",
  "entry_texts",
  "album_journals",
  "artist_journals",
  "memories",
  "memory_music",
  "track_reflections",
  "track_reflection_texts",
  "entry_slugs",
] as const;

async function checksum(db: DatabaseExecutor): Promise<string[]> {
  const sums: string[] = [];
  for (const table of CHECKED_TABLES) {
    const result = await db.execute<{ sum: string }>(sql`
      select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as sum
        from ${sql.identifier(table)} x`);
    sums.push(result.rows[0]!.sum);
  }
  return sums;
}

// A document with one paragraph of the given text, as a SQL value. The
// database requires a body whenever there is body text.
const doc = (text: string) =>
  sql`${JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  })}::jsonb`;

async function failure(work: Promise<unknown>): Promise<PublicationError> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(PublicationError);
    return error as PublicationError;
  }
  throw new Error("Expected the call to be refused.");
}

function publishWith(
  db: DatabaseExecutor,
  entryId: string,
  preview: PublishPreview,
  extra: Record<string, unknown> = {},
  locale: Locale = "en",
) {
  return publishLanguageVersion(db, author, {
    entryId,
    locale,
    expectedVersion: preview.disclosure.entryVersion,
    confirmation: preview.confirmation,
    ...extra,
  });
}

function preview(db: DatabaseExecutor, entryId: string, locale: Locale = "en") {
  return previewPublication(db, author, { entryId, locale });
}

async function statusOf(db: DatabaseExecutor, entryId: string, locale: Locale) {
  const result = await db.execute<{ status: string }>(
    sql`select status from entry_texts where entry_id = ${entryId} and locale = ${locale}`,
  );
  return result.rows[0]?.status;
}

// An album journal in English and Portuguese with four reflections:
//   both     flagged, text in English and Portuguese
//   enOnly   flagged, text in English only
//   ptOnly   flagged, text in Portuguese only
//   hidden   not flagged, text in English
async function journal(
  tx: Parameters<Parameters<typeof inRollbackTransaction>[0]>[0],
  options: { status?: "draft" | "private"; rating?: number | null } = {},
) {
  const album = await createTestAlbum(tx, {
    trackTitles: ["[Test] A", "[Test] B", "[Test] C", "[Test] D"],
  });
  const status = options.status ?? "draft";
  const entryId = await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    slug: "test-publish",
    ratingHalfSteps: options.rating === undefined ? 8 : options.rating,
    versions: [
      { locale: "en", status, text: "[Test] English words" },
      {
        locale: "pt-BR",
        isOriginal: false,
        status,
        text: "[Test] Palavras",
      },
    ],
  });
  const make = (index: number, isPublished: boolean, texts: object) =>
    createTestTrackReflection(tx, {
      albumJournalId: entryId,
      albumId: album.albumId,
      trackId: album.trackIds[index]!,
      isPublished,
      isStillWriting: index === 0,
      texts,
    });
  const both = await make(0, true, {
    en: "[Test] en 0",
    "pt-BR": "[Test] pt 0",
  });
  const enOnly = await make(1, true, { en: "[Test] en 1" });
  const ptOnly = await make(2, true, { "pt-BR": "[Test] pt 2" });
  const hidden = await make(3, false, { en: "[Test] en 3" });
  return { entryId, album, both, enOnly, ptOnly, hidden };
}

describe("previewPublication", () => {
  it("discloses exactly what becomes public in the language, and no other", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId, both, enOnly } = await journal(tx);
      const result = await preview(tx, entryId, "en");
      const { disclosure } = result;

      expect(disclosure).toMatchObject({
        entryId,
        kind: "album_journal",
        locale: "en",
        entryVersion: 1,
        status: "draft",
        address: { slug: "test-publish", wasPublic: false },
        albumRating: { halfSteps: 8, alreadyPublic: false },
        memory: null,
        flaggedWithoutText: 1,
      });
      expect(disclosure.reflections.map((r) => r.trackReflectionId)).toEqual(
        [both, enOnly].sort(),
      );
      // Every item names its language, and none is another language's.
      expect(disclosure.reflections.every((r) => r.locale === "en")).toBe(true);
      // "Still writing" is shown and never decides whether it is public.
      expect(
        disclosure.reflections.find((r) => r.trackReflectionId === both),
      ).toMatchObject({ isStillWriting: true });
      expect(JSON.stringify(disclosure)).not.toContain("Palavras");
      expect(JSON.stringify(disclosure)).not.toContain("pt 0");
    });
  });

  it("describes the Portuguese version with its own pairs", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId, both, ptOnly } = await journal(tx);
      const { disclosure } = await preview(tx, entryId, "pt-BR");
      expect(disclosure.reflections.map((r) => r.trackReflectionId)).toEqual(
        [both, ptOnly].sort(),
      );
      expect(disclosure.flaggedWithoutText).toBe(1);
    });
  });

  it("writes nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const before = await checksum(tx);
      await preview(tx, entryId, "en");
      expect(await checksum(tx)).toEqual(before);
    });
  });

  it("returns a token that carries no writing, valid for fifteen minutes", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const result = await preview(tx, entryId, "en");
      const claims = claimsOf(result.confirmation);
      expect(Object.keys(claims).sort()).toEqual(
        ["e", "f", "i", "l", "n", "p", "s", "u", "x"].sort(),
      );
      expect(claims).toMatchObject({
        p: "publish",
        u: author.userId,
        s: author.sessionId,
        e: entryId,
        l: "en",
        n: 1,
      });
      expect(claims.x - claims.i).toBe(FIFTEEN_MINUTES);
      expect(result.expiresAtMs).toBe(claims.x);
      // Read from the database clock: close to this machine's, not equal.
      expect(Math.abs(claims.i - Date.now())).toBeLessThan(60_000);
      expect(result.confirmation).not.toContain("English");
    });
  });

  it("marks the album rating as already public when any version is public", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      await publishWith(tx, entryId, await preview(tx, entryId, "en"));
      const { disclosure } = await preview(tx, entryId, "pt-BR");
      expect(disclosure.albumRating).toEqual({
        halfSteps: 8,
        alreadyPublic: true,
      });
    });
  });

  it("lists no rating for a journal without one", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx, { rating: null });
      expect((await preview(tx, entryId)).disclosure.albumRating).toBeNull();
    });
  });

  it("discloses a memory's remembered-when text and ordered links", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx);
      const memoryId = await createTestMemory(tx, {
        slug: "test-memory",
        music: [
          { trackId: album.trackIds[1]! },
          { albumId: album.albumId },
          { trackId: album.trackIds[0]! },
        ],
      });
      await tx.execute(
        sql`update memories set remembered_when = '[Test] a summer' where entry_id = ${memoryId}`,
      );
      const { disclosure } = await preview(tx, memoryId);
      expect(disclosure.memory).toEqual({
        rememberedWhen: "[Test] a summer",
        music: [
          { trackId: album.trackIds[1] },
          { albumId: album.albumId },
          { trackId: album.trackIds[0] },
        ],
      });
      expect(disclosure.reflections).toEqual([]);
      expect(disclosure.albumRating).toBeNull();
    });
  });

  it.each(["draft", "private"] as const)(
    "allows a %s version and shows the status being left",
    async (status) => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx, { status });
        expect((await preview(tx, entryId)).disclosure.status).toBe(status);
      });
    },
  );

  describe("refuses", () => {
    it("an unknown entry, a missing language, and malformed input", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        const before = await checksum(tx);
        expect(
          (await failure(preview(tx, "11111111-1111-4111-8111-111111111111")))
            .failure,
        ).toBe("entry_not_found");
        await tx.execute(
          sql`delete from entry_texts where entry_id = ${entryId} and locale = 'pt-BR'`,
        );
        expect((await failure(preview(tx, entryId, "pt-BR"))).failure).toBe(
          "version_not_found",
        );
        for (const bad of [
          undefined,
          null,
          {},
          { entryId, locale: "fr" },
          { entryId: "x", locale: "en" },
          { entryId, locale: "en", extra: 1 },
        ]) {
          expect(
            (await failure(previewPublication(tx, author, bad))).failure,
          ).toBe("invalid_input");
        }
        await tx.execute(sql`select 1`); // the transaction is still usable
        expect(await checksum(tx)).not.toEqual([]);
        expect(before.length).toBe(CHECKED_TABLES.length);
      });
    });

    it("a deleted entry, a version with nothing to publish, and an entry without an address", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);

        await tx.execute(
          sql`update entry_texts set opening = '  ', body = ${doc(" ")}, body_text = ' \t  ' where entry_id = ${entryId} and locale = 'en'`,
        );
        expect((await failure(preview(tx, entryId))).failure).toBe(
          "nothing_to_publish",
        );
        // An opening sentence alone is enough (owner decision R1).
        await tx.execute(
          sql`update entry_texts set opening = '[Test] Just an opening' where entry_id = ${entryId} and locale = 'en'`,
        );
        expect((await preview(tx, entryId)).disclosure.version.opening).toBe(
          "[Test] Just an opening",
        );

        await tx.execute(
          sql`update entry_slugs set is_current = false where entry_id = ${entryId}`,
        );
        expect((await failure(preview(tx, entryId))).failure).toBe(
          "no_current_slug",
        );
        await tx.execute(
          sql`update entry_slugs set is_current = true where entry_id = ${entryId}`,
        );

        await tx.execute(
          sql`update entries set deleted_at = now() where id = ${entryId}`,
        );
        expect((await failure(preview(tx, entryId))).failure).toBe(
          "entry_deleted",
        );
      });
    });

    it("Unicode white space alone as empty, in the opening and in the body", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        const blank = "\u0085\u00a0\u2003\u2028\u3000 \t";
        await tx.execute(
          sql`update entry_texts set opening = ${blank}, body_text = ${blank} where entry_id = ${entryId} and locale = 'en'`,
        );
        expect((await failure(preview(tx, entryId))).failure).toBe(
          "nothing_to_publish",
        );
        // A zero-width space is not white space: it is content.
        await tx.execute(
          sql`update entry_texts set body_text = ${"​"} where entry_id = ${entryId} and locale = 'en'`,
        );
        await expect(preview(tx, entryId)).resolves.toBeDefined();
      });
    });
  });
});

describe("the disclosure equals what the public queries return (test 2)", () => {
  // {L status} x {other language} x {flag} x {text per language} x {rating}
  const lStatuses = ["draft", "private", "published"] as const;
  const others = [null, "draft", "private", "published"] as const;
  const shapes = [
    { flag: true, texts: { en: "[Test] e", "pt-BR": "[Test] p" } },
    { flag: true, texts: { en: "[Test] e" } },
    { flag: true, texts: { "pt-BR": "[Test] p" } },
    { flag: true, texts: {} },
    { flag: false, texts: { en: "[Test] e", "pt-BR": "[Test] p" } },
  ] as const;

  it.each([{ locale: "en" as Locale }, { locale: "pt-BR" as Locale }])(
    "for $locale over the whole matrix",
    async ({ locale }) => {
      await inRollbackTransaction(async (tx) => {
        const album = await createTestAlbum(tx, {
          trackTitles: shapes.map((_, index) => `[Test] T${index}`),
        });
        const otherLocale: Locale = locale === "en" ? "pt-BR" : "en";
        let n = 0;
        let compared = 0;
        for (const own of lStatuses) {
          for (const other of others) {
            for (const rating of [null, 6]) {
              const versions: Parameters<
                typeof createTestAlbumJournal
              >[1]["versions"] = [
                { locale, status: own, text: "[Test] words" },
              ];
              if (other) {
                versions.push({
                  locale: otherLocale,
                  isOriginal: false,
                  status: other,
                  text: "[Test] words",
                });
              }
              const entryId = await createTestAlbumJournal(tx, {
                albumId: album.albumId,
                versions,
                slug: `matrix-${locale.toLowerCase()}-${n++}`,
                ratingHalfSteps: rating,
              });
              for (const [index, shape] of shapes.entries()) {
                await createTestTrackReflection(tx, {
                  albumJournalId: entryId,
                  albumId: album.albumId,
                  trackId: album.trackIds[index]!,
                  isPublished: shape.flag,
                  texts: shape.texts,
                });
              }

              const { disclosure } = await preview(tx, entryId, locale);
              const before = await listPublicTrackReflections(
                tx,
                entryId,
                locale,
              );
              // Publish the language by the data layer, as the hypothetical
              // state the disclosure describes, then ask the public queries.
              await tx.execute(
                sql`update entry_texts
                       set status = 'published',
                           published_at = coalesce(published_at, now()),
                           first_published_at = coalesce(first_published_at, now())
                     where entry_id = ${entryId} and locale = ${locale}`,
              );
              const after = await listPublicTrackReflections(
                tx,
                entryId,
                locale,
              );
              expect(
                disclosure.reflections.map((r) => r.trackReflectionId).sort(),
              ).toEqual(after.map((r) => r.trackReflectionId).sort());
              if (own !== "published") {
                expect(before).toEqual([]);
              }
              // Never a pair of another language.
              expect(
                disclosure.reflections.every((r) => r.locale === locale),
              ).toBe(true);
              // The rating is public only through a public version.
              const anyPublic = own === "published" || other === "published";
              expect(disclosure.albumRating?.alreadyPublic ?? false).toBe(
                rating !== null && anyPublic,
              );
              compared++;
            }
          }
        }
        expect(compared).toBe(24);
      });
    },
  );
});

describe("publishing needs a token for exactly this state (test 3)", () => {
  it("publishes with a token from a preview, and makes exactly the disclosed set public", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId, both, enOnly } = await journal(tx);
      const result = await preview(tx, entryId);
      await expect(publishWith(tx, entryId, result)).resolves.toEqual({
        changed: true,
      });
      expect(await statusOf(tx, entryId, "en")).toBe("published");

      const publicNow = await listPublicTrackReflections(tx, entryId, "en");
      expect(publicNow.map((r) => r.trackReflectionId).sort()).toEqual(
        result.disclosure.reflections.map((r) => r.trackReflectionId).sort(),
      );
      expect(publicNow.map((r) => r.trackReflectionId).sort()).toEqual(
        [both, enOnly].sort(),
      );
    });
  });

  it("refuses an absent token with the fresh disclosure and no token, writing nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const before = await checksum(tx);
      const error = await failure(
        publishLanguageVersion(tx, author, {
          entryId,
          locale: "en",
          expectedVersion: 1,
        }),
      );
      expect(error.failure).toBe("confirmation_required");
      expect(error.disclosure?.entryId).toBe(entryId);
      expect(JSON.stringify(error.disclosure)).not.toContain("ct1.");
      expect(JSON.stringify(error)).not.toContain("ct1.");
      expect(error.message).not.toContain("English");
      expect(await checksum(tx)).toEqual(before);
    });
  });

  it("keeps the private disclosure out of anything that prints the error", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const error = await failure(
        publishLanguageVersion(tx, author, {
          entryId,
          locale: "en",
          expectedVersion: 1,
        }),
      );
      // The studio can still read it...
      expect(error.disclosure?.version.body).toBeDefined();
      // ...but a log line, an inspection, or a serialization cannot.
      for (const printed of [
        JSON.stringify(error),
        inspect(error, { depth: 6 }),
        String(error),
        error.stack ?? "",
        JSON.stringify({ ...error }),
      ]) {
        expect(printed).not.toContain("English words");
        expect(printed).not.toContain("en 0");
        expect(printed).not.toContain("ct1.");
      }
      expect(Object.keys(error)).not.toContain("disclosure");
    });
  });

  it("still needs a token when nothing is disclosed (an empty set)", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      await tx.execute(
        sql`update track_reflections set is_published = false where album_journal_id = ${entryId}`,
      );
      const result = await preview(tx, entryId);
      expect(result.disclosure.reflections).toEqual([]);
      const error = await failure(
        publishLanguageVersion(tx, author, {
          entryId,
          locale: "en",
          expectedVersion: 1,
        }),
      );
      expect(error.failure).toBe("confirmation_required");
      await expect(publishWith(tx, entryId, result)).resolves.toEqual({
        changed: true,
      });
    });
  });

  it.each([
    ["an empty string", ""],
    ["not a token", "hello"],
    ["a bare fingerprint", "A".repeat(43)],
    ["the wrong version prefix", "ct2.AAAA.AAAA"],
    ["no signature", "ct1.AAAA"],
    ["characters outside base64url", "ct1.AA+A.AAAA"],
    ["a token longer than the limit", `ct1.${"A".repeat(1100)}.AAAA`],
  ])("refuses %s as invalid input, writing nothing", async (_name, token) => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const before = await checksum(tx);
      const error = await failure(
        publishLanguageVersion(tx, author, {
          entryId,
          locale: "en",
          expectedVersion: 1,
          confirmation: token,
        }),
      );
      expect(error.failure).toBe("invalid_input");
      expect(error.disclosure).toBeUndefined();
      expect(await checksum(tx)).toEqual(before);
    });
  });

  it.each([
    ["a non-string", 7],
    ["null", null],
  ])("refuses %s as a token", async (_name, token) => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const error = await failure(
        publishLanguageVersion(tx, author, {
          entryId,
          locale: "en",
          expectedVersion: 1,
          confirmation: token,
        }),
      );
      expect(error.failure).toBe("invalid_input");
    });
  });

  it("refuses malformed ids, locales, versions, and extra fields", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const result = await preview(tx, entryId);
      const good = {
        entryId,
        locale: "en",
        expectedVersion: 1,
        confirmation: result.confirmation,
      };
      for (const bad of [
        { ...good, entryId: "nope" },
        { ...good, locale: "pt" },
        { ...good, expectedVersion: 0 },
        { ...good, expectedVersion: 1.5 },
        { ...good, expectedVersion: "1" },
        { ...good, expectedVersion: 2 ** 31 },
        { ...good, status: "published" },
        null,
        "x",
      ]) {
        expect(
          (await failure(publishLanguageVersion(tx, author, bad))).failure,
        ).toBe("invalid_input");
      }
      expect(await statusOf(tx, entryId, "en")).toBe("draft");
    });
  });

  describe("a token that is not for this request is invalid", () => {
    async function setup(tx: DatabaseExecutor) {
      const { entryId } = await journal(tx as Parameters<typeof journal>[0]);
      return { entryId, result: await preview(tx, entryId) };
    }

    it("when it is for another author, session, locale, or version", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId, result } = await setup(tx);
        const before = await checksum(tx);
        const attempts: Promise<unknown>[] = [
          publishLanguageVersion(tx, otherSession(author), {
            entryId,
            locale: "en",
            expectedVersion: 1,
            confirmation: result.confirmation,
          }),
          publishLanguageVersion(
            tx,
            { ...author, userId: "00000000-0000-4000-8000-0000000000cc" },
            {
              entryId,
              locale: "en",
              expectedVersion: 1,
              confirmation: result.confirmation,
            },
          ),
          publishWith(tx, entryId, result, {}, "pt-BR"),
          publishWith(tx, entryId, result, { expectedVersion: 2 }),
        ];
        for (const attempt of attempts) {
          expect((await failure(attempt)).failure).toBe(
            // Version 2 differs from the entry's version 1 only in the claim:
            // the token is checked before the lock.
            "confirmation_invalid",
          );
        }
        expect(await checksum(tx)).toEqual(before);
      });
    });

    it("when it is for another entry", async () => {
      await inRollbackTransaction(async (tx) => {
        const first = await setup(tx);
        const album = await createTestAlbum(tx);
        const second = await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          slug: "second-journal",
        });
        expect(
          (
            await failure(
              publishWith(tx, second, first.result, { entryId: second }),
            )
          ).failure,
        ).toBe("confirmation_invalid");
      });
    });

    it("when it is forged, signed with another key, or signed without the purpose string", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId, result } = await setup(tx);
        const claims = claimsOf(result.confirmation);
        const forged = [
          mintTestToken({ secret: "x".repeat(40), claims }),
          mintTestToken({ secret: testSecret(), claims, info: "other" }),
          mintTestToken({
            secret: testSecret(),
            claims,
            withoutDerivation: true,
          }),
          // The unkeyed fingerprint alone, in the shape of a token.
          `ct1.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${claims.f}`,
          // Two characters of the MAC replaced by others: never the same two
          // (about one token in 256 ends in "AA", and would stay genuine).
          result.confirmation.slice(0, -2) +
            (result.confirmation.endsWith("AA") ? "BB" : "AA"),
        ];
        for (const token of forged) {
          expect(
            (
              await failure(
                publishWith(tx, entryId, result, { confirmation: token }),
              )
            ).failure,
          ).toBe("confirmation_invalid");
        }
        expect(await statusOf(tx, entryId, "en")).toBe("draft");
      });
    });

    it("when it is for another purpose", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId, result } = await setup(tx);
        const claims = claimsOf(result.confirmation);
        const withoutLocale: Partial<typeof claims> = { ...claims };
        delete withoutLocale.l;
        const token = mintTestToken({
          secret: testSecret(),
          claims: { ...(withoutLocale as typeof claims), p: "change_public" },
        });
        expect(
          (
            await failure(
              publishWith(tx, entryId, result, { confirmation: token }),
            )
          ).failure,
        ).toBe("confirmation_invalid");
      });
    });
  });

  describe("expiry, by the database clock", () => {
    it("refuses a token older than fifteen minutes with the fresh disclosure and no token", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        const result = await preview(tx, entryId);
        const before = await checksum(tx);
        const old = shiftedTestToken(
          result.confirmation,
          -(FIFTEEN_MINUTES + 1000),
        );
        const error = await failure(
          publishWith(tx, entryId, result, { confirmation: old }),
        );
        expect(error.failure).toBe("confirmation_expired");
        expect(error.disclosure?.entryId).toBe(entryId);
        expect(JSON.stringify(error)).not.toContain("ct1.");
        expect(await checksum(tx)).toEqual(before);
      });
    });

    it("refuses a token issued in the future", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        const result = await preview(tx, entryId);
        const future = shiftedTestToken(result.confirmation, 10 * 60 * 1000);
        expect(
          (
            await failure(
              publishWith(tx, entryId, result, { confirmation: future }),
            )
          ).failure,
        ).toBe("confirmation_expired");
      });
    });

    it("accepts a token a minute before it expires", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        const result = await preview(tx, entryId);
        const nearly = shiftedTestToken(
          result.confirmation,
          -(FIFTEEN_MINUTES - 60_000),
        );
        await expect(
          publishWith(tx, entryId, result, { confirmation: nearly }),
        ).resolves.toEqual({ changed: true });
      });
    });

    it("refuses a token that claims a longer life", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        const result = await preview(tx, entryId);
        const claims = claimsOf(result.confirmation);
        const longer = reissueTestToken(result.confirmation, {
          x: claims.x + 24 * 60 * 60 * 1000,
        });
        expect(
          (
            await failure(
              publishWith(tx, entryId, result, { confirmation: longer }),
            )
          ).failure,
        ).toBe("confirmation_invalid");
      });
    });
  });

  describe("a token goes stale when any disclosed atom changes (test 4)", () => {
    // Each change is made with SQL, without bumping entries.version, so the
    // fingerprint alone must catch it. The refusal carries the new state.
    const changes: [
      string,
      (
        tx: DatabaseExecutor,
        f: Awaited<ReturnType<typeof journal>>,
      ) => Promise<unknown>,
    ][] = [
      [
        "a flag turned on",
        (tx, f) =>
          tx.execute(
            sql`update track_reflections set is_published = true where id = ${f.hidden}`,
          ),
      ],
      [
        "a flag turned off",
        (tx, f) =>
          tx.execute(
            sql`update track_reflections set is_published = false where id = ${f.both}`,
          ),
      ],
      [
        "text added in the language",
        (tx, f) =>
          tx.execute(
            sql`insert into track_reflection_texts (track_reflection_id, locale, body, body_text) values (${f.ptOnly}, 'en', ${doc("[Test] now")}, '[Test] now')`,
          ),
      ],
      [
        "text removed in the language",
        (tx, f) =>
          tx.execute(
            sql`delete from track_reflection_texts where track_reflection_id = ${f.enOnly} and locale = 'en'`,
          ),
      ],
      [
        "a reflection's text",
        (tx, f) =>
          tx.execute(
            sql`update track_reflection_texts set body = '{"type":"doc","content":[]}'::jsonb where track_reflection_id = ${f.both} and locale = 'en'`,
          ),
      ],
      [
        "a reflection's rating",
        (tx, f) =>
          tx.execute(
            sql`update track_reflections set rating_half_steps = 7 where id = ${f.both}`,
          ),
      ],
      [
        "a reflection's favourite mark",
        (tx, f) =>
          tx.execute(
            sql`update track_reflections set is_favourite = true where id = ${f.both}`,
          ),
      ],
      [
        "a reflection's still-writing label",
        (tx, f) =>
          tx.execute(
            sql`update track_reflections set is_still_writing = false where id = ${f.both}`,
          ),
      ],
      [
        "the album rating",
        (tx, f) =>
          tx.execute(
            sql`update album_journals set rating_half_steps = 9 where entry_id = ${f.entryId}`,
          ),
      ],
      [
        "the album rating cleared",
        (tx, f) =>
          tx.execute(
            sql`update album_journals set rating_half_steps = null where entry_id = ${f.entryId}`,
          ),
      ],
      [
        "the opening sentence",
        (tx, f) =>
          tx.execute(
            sql`update entry_texts set opening = '[Test] new' where entry_id = ${f.entryId} and locale = 'en'`,
          ),
      ],
      [
        "the body, by formatting only",
        (tx, f) =>
          tx.execute(
            sql`update entry_texts set body = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"[Test] English words","marks":[{"type":"bold"}]}]}]}'::jsonb where entry_id = ${f.entryId} and locale = 'en'`,
          ),
      ],
      [
        "the margin note",
        (tx, f) =>
          tx.execute(
            sql`update entry_texts set margin_note = '[Test] note' where entry_id = ${f.entryId} and locale = 'en'`,
          ),
      ],
      [
        "the address",
        (tx, f) => changeEntrySlug(tx, f.entryId, "another-address"),
      ],
      [
        "the entry version",
        (tx, f) =>
          tx.execute(
            sql`update entries set version = version + 1 where id = ${f.entryId}`,
          ),
      ],
      [
        "the version's updated_at (the stamp)",
        (tx, f) =>
          tx.execute(
            sql`update entry_texts set updated_at = updated_at + interval '1 second' where entry_id = ${f.entryId} and locale = 'en'`,
          ),
      ],
      [
        "the entry's updated_at (the stamp)",
        (tx, f) =>
          tx.execute(
            sql`update entries set updated_at = updated_at + interval '1 second' where id = ${f.entryId}`,
          ),
      ],
      [
        "the other language becoming public (the rating's exposure)",
        async (tx, f) =>
          publishWith(
            tx,
            f.entryId,
            await preview(tx, f.entryId, "pt-BR"),
            {},
            "pt-BR",
          ),
      ],
    ];

    it.each(changes)("%s", async (_name, change) => {
      await inRollbackTransaction(async (tx) => {
        const fixture = await journal(tx);
        const result = await preview(tx, fixture.entryId);
        await change(tx, fixture);
        const version = (
          await tx.execute<{ version: number }>(
            sql`select version from entries where id = ${fixture.entryId}`,
          )
        ).rows[0]!.version;
        const error = await failure(
          publishWith(tx, fixture.entryId, result, {
            expectedVersion: version,
            // The token was issued at the old version: when the version
            // itself changed, the request carries the new one and the token
            // is refused for it.
            confirmation: result.confirmation,
          }),
        );
        expect(["confirmation_stale", "confirmation_invalid"]).toContain(
          error.failure,
        );
        if (version === 1) {
          expect(error.failure).toBe("confirmation_stale");
          expect(error.disclosure?.entryId).toBe(fixture.entryId);
          expect(JSON.stringify(error)).not.toContain("ct1.");
        }
        expect(await statusOf(tx, fixture.entryId, "en")).toBe("draft");
      });
    });

    it("but not another language's reflection text", async () => {
      await inRollbackTransaction(async (tx) => {
        const fixture = await journal(tx);
        const result = await preview(tx, fixture.entryId, "en");
        await tx.execute(
          sql`insert into track_reflection_texts (track_reflection_id, locale, body, body_text)
              values (${fixture.enOnly}, 'pt-BR', ${doc("[Test] added")}, '[Test] added in Portuguese')`,
        );
        await tx.execute(
          sql`update track_reflection_texts set body_text = '[Test] edited'
               where track_reflection_id = ${fixture.both} and locale = 'pt-BR'`,
        );
        await expect(publishWith(tx, fixture.entryId, result)).resolves.toEqual(
          { changed: true },
        );
      });
    });

    it("a catalog title edit is not in the fingerprint (gap C11, closed by gate G8)", async () => {
      // Recorded, not endorsed: ADR 0006 conflict C11. Gate G8 blocks hosted
      // exposure until a public page cannot change its wording unconfirmed.
      await inRollbackTransaction(async (tx) => {
        const fixture = await journal(tx);
        const result = await preview(tx, fixture.entryId);
        await tx
          .update(schema.tracks)
          .set({ title: "[Test] Renamed" })
          .where(eq(schema.tracks.id, fixture.album.trackIds[0]!));
        await expect(publishWith(tx, fixture.entryId, result)).resolves.toEqual(
          { changed: true },
        );
      });
    });

    it("a second use of the same token", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        const result = await preview(tx, entryId);
        await publishWith(tx, entryId, result);
        expect((await failure(publishWith(tx, entryId, result))).failure).toBe(
          "confirmation_stale",
        );
      });
    });

    it("an unpublish and a republish between preview and use", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        const first = await preview(tx, entryId);
        await publishWith(tx, entryId, first);
        await unpublishLanguageVersion(tx, author, entryId, "en", "draft");
        // Within one rolled-back transaction `now()` does not move, so the
        // version's timestamp is what a later transaction would have moved.
        await tx.execute(
          sql`update entry_texts set updated_at = updated_at + interval '1 second' where entry_id = ${entryId}`,
        );
        expect((await failure(publishWith(tx, entryId, first))).failure).toBe(
          "confirmation_stale",
        );
      });
    });
  });

  describe("an already public version", () => {
    it("with a matching token writes nothing and reports no change", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        await publishWith(tx, entryId, await preview(tx, entryId));
        const again = await preview(tx, entryId);
        const before = await checksum(tx);
        await expect(publishWith(tx, entryId, again)).resolves.toEqual({
          changed: false,
        });
        // Repeatable: the token survives a no-op until it expires.
        await expect(publishWith(tx, entryId, again)).resolves.toEqual({
          changed: false,
        });
        expect(await checksum(tx)).toEqual(before);
      });
    });

    it("without a token is still refused", async () => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        await publishWith(tx, entryId, await preview(tx, entryId));
        const error = await failure(
          publishLanguageVersion(tx, author, {
            entryId,
            locale: "en",
            expectedVersion: 1,
          }),
        );
        expect(error.failure).toBe("confirmation_required");
      });
    });
  });
});

describe("the fingerprint itself covers what the claims also bind", () => {
  // The token's claims bind the locale and the version a second time. These
  // tests look at the fingerprint alone, so neither can be dropped from it
  // without a test noticing.
  async function fingerprintNow(
    tx: DatabaseExecutor,
    entryId: string,
    locale: Locale,
  ) {
    const state = await readPublishState(tx, entryId, locale);
    return fingerprintOf(state, disclosureOf(state, entryId, locale));
  }

  it("differs between languages whose content is identical", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx);
      const entryId = await createTestAlbumJournal(tx, {
        albumId: album.albumId,
        slug: "same-words",
        versions: [
          { locale: "en", text: "[Test] same" },
          { locale: "pt-BR", isOriginal: false, text: "[Test] same" },
        ],
      });
      expect(await fingerprintNow(tx, entryId, "en")).not.toBe(
        await fingerprintNow(tx, entryId, "pt-BR"),
      );
    });
  });

  it("changes with the entry version alone", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const before = await fingerprintNow(tx, entryId, "en");
      await tx.execute(
        sql`update entries set version = version + 1 where id = ${entryId}`,
      );
      expect(await fingerprintNow(tx, entryId, "en")).not.toBe(before);
    });
  });

  it("compares the set of reflections, not how many there are", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId, both, hidden } = await journal(tx);
      const before = await fingerprintNow(tx, entryId, "en");
      // Two disclosed reflections before and after, but not the same two.
      await tx.execute(
        sql`update track_reflections set is_published = false where id = ${both}`,
      );
      await tx.execute(
        sql`update track_reflections set is_published = true where id = ${hidden}`,
      );
      const state = await readPublishState(tx, entryId, "en");
      expect(state.reflections).toHaveLength(2);
      expect(await fingerprintNow(tx, entryId, "en")).not.toBe(before);
    });
  });

  it("is stable for an unchanged state", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      expect(await fingerprintNow(tx, entryId, "en")).toBe(
        await fingerprintNow(tx, entryId, "en"),
      );
    });
  });
});

describe("a memory's details are bound to the token", () => {
  async function memory(tx: Parameters<typeof journal>[0]) {
    const album = await createTestAlbum(tx);
    const memoryId = await createTestMemory(tx, {
      slug: "test-memory-details",
      music: [{ trackId: album.trackIds[0]! }, { trackId: album.trackIds[1]! }],
    });
    await tx.execute(
      sql`update memories set remembered_when = '[Test] a summer' where entry_id = ${memoryId}`,
    );
    return { memoryId, album };
  }

  const changes: [
    string,
    (
      tx: DatabaseExecutor,
      f: { memoryId: string; album: { trackIds: string[] } },
    ) => Promise<unknown>,
  ][] = [
    [
      "the remembered-when text",
      (tx, f) =>
        tx.execute(
          sql`update memories set remembered_when = '[Test] winter' where entry_id = ${f.memoryId}`,
        ),
    ],
    [
      "the remembered-when text cleared",
      (tx, f) =>
        tx.execute(
          sql`update memories set remembered_when = null where entry_id = ${f.memoryId}`,
        ),
    ],
    [
      "the order of the links",
      (tx, f) =>
        tx.execute(
          sql`update memory_music set position = 3 - position where memory_id = ${f.memoryId}`,
        ),
    ],
    [
      "a link added",
      (tx, f) =>
        tx.execute(
          sql`insert into memory_music (memory_id, position, track_id)
              values (${f.memoryId}, 3, ${f.album.trackIds[2]!})`,
        ),
    ],
    [
      "a link removed",
      (tx, f) =>
        tx.execute(
          sql`delete from memory_music where memory_id = ${f.memoryId} and position = 2`,
        ),
    ],
    [
      "the title",
      (tx, f) =>
        tx.execute(
          sql`update entry_texts set title = '[Test] New title' where entry_id = ${f.memoryId}`,
        ),
    ],
  ];

  it.each(changes)("%s makes it stale", async (_name, change) => {
    await inRollbackTransaction(async (tx) => {
      const fixture = await memory(tx);
      const result = await preview(tx, fixture.memoryId);
      await change(tx, fixture);
      const error = await failure(publishWith(tx, fixture.memoryId, result));
      expect(error.failure).toBe("confirmation_stale");
      expect(error.disclosure?.kind).toBe("memory");
    });
  });

  it("renumbering the links without reordering them changes nothing a reader sees", async () => {
    await inRollbackTransaction(async (tx) => {
      const fixture = await memory(tx);
      const result = await preview(tx, fixture.memoryId);
      await tx.execute(
        sql`update memory_music set position = position + 10 where memory_id = ${fixture.memoryId}`,
      );
      await expect(publishWith(tx, fixture.memoryId, result)).resolves.toEqual({
        changed: true,
      });
    });
  });
});

describe("the other refusals write nothing (test 8)", () => {
  it("a stale version is refused before the token is considered", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const result = await preview(tx, entryId);
      await tx.execute(
        sql`update entries set version = 2 where id = ${entryId}`,
      );
      const before = await checksum(tx);
      // The token names version 1 and so does the request: the entry moved.
      expect((await failure(publishWith(tx, entryId, result))).failure).toBe(
        "version_conflict",
      );
      expect(await checksum(tx)).toEqual(before);
    });
  });

  it("a deleted entry, nothing to publish, no address, and a missing language", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const result = await preview(tx, entryId);
      const before = await checksum(tx);

      await tx.execute(
        sql`update entry_slugs set is_current = false where entry_id = ${entryId}`,
      );
      expect((await failure(publishWith(tx, entryId, result))).failure).toBe(
        "no_current_slug",
      );
      await tx.execute(
        sql`update entry_slugs set is_current = true where entry_id = ${entryId}`,
      );

      await tx.execute(
        sql`update entry_texts set opening = null, body = ${doc("  ")}, body_text = '  ' where entry_id = ${entryId} and locale = 'en'`,
      );
      expect((await failure(publishWith(tx, entryId, result))).failure).toBe(
        "nothing_to_publish",
      );

      expect(
        (
          await failure(
            publishLanguageVersion(tx, author, {
              entryId: "11111111-1111-4111-8111-111111111111",
              locale: "en",
              expectedVersion: 1,
              confirmation: result.confirmation,
            }),
          )
        ).failure,
      ).toBe("confirmation_invalid");

      await tx.execute(
        sql`update entries set deleted_at = now() where id = ${entryId}`,
      );
      expect((await failure(publishWith(tx, entryId, result))).failure).toBe(
        "entry_deleted",
      );
      expect(before.length).toBeGreaterThan(0);
      expect(await statusOf(tx, entryId, "en")).toBe("draft");
    });
  });

  it("an unknown entry and a language the entry does not have", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const unknown = "22222222-2222-4222-8222-222222222222";
      // Mint a valid token for the unknown id, to reach the lock.
      const result = await preview(tx, entryId);
      const forUnknown = reissueTestToken(result.confirmation, { e: unknown });
      expect(
        (
          await failure(
            publishLanguageVersion(tx, author, {
              entryId: unknown,
              locale: "en",
              expectedVersion: 1,
              confirmation: forUnknown,
            }),
          )
        ).failure,
      ).toBe("entry_not_found");

      await tx.execute(
        sql`delete from entry_texts where entry_id = ${entryId} and locale = 'pt-BR'`,
      );
      const forPt = reissueTestToken(result.confirmation, { l: "pt-BR" });
      expect(
        (
          await failure(
            publishLanguageVersion(tx, author, {
              entryId,
              locale: "pt-BR",
              expectedVersion: 1,
              confirmation: forPt,
            }),
          )
        ).failure,
      ).toBe("version_not_found");
    });
  });

  it("rolls everything back when a step fails in the middle of the write", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      const result = await preview(tx, entryId);
      // A trigger that exists only inside this rolled-back transaction on the
      // disposable database: DDL is transactional in PostgreSQL. It makes the
      // last statement of the write fail after the first two succeeded.
      await tx.execute(sql`
        create function refuse_slug_mark_for_test() returns trigger
        language plpgsql as $$ begin raise exception 'forced failure'; end $$`);
      await tx.execute(sql`
        create trigger refuse_slug_mark_for_test before update on entry_slugs
        for each row execute function refuse_slug_mark_for_test()`);
      await expect(publishWith(tx, entryId, result)).rejects.not.toBeInstanceOf(
        PublicationError,
      );
      const state = await tx.execute<{
        status: string;
        published_at: string | null;
        first_published_at: string | null;
        entry_first: string | null;
      }>(sql`
        select t.status, t.published_at, t.first_published_at,
               e.first_published_at as entry_first
          from entry_texts t join entries e on e.id = t.entry_id
         where t.entry_id = ${entryId} and t.locale = 'en'`);
      expect(state.rows[0]).toEqual({
        status: "draft",
        published_at: null,
        first_published_at: null,
        entry_first: null,
      });
    });
  });
});

describe("Draft and Private take the same path (test 7)", () => {
  it.each(["draft", "private"] as const)(
    "a %s version is published with a token and refused without",
    async (status) => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx, { status });
        const error = await failure(
          publishLanguageVersion(tx, author, {
            entryId,
            locale: "en",
            expectedVersion: 1,
          }),
        );
        expect(error.failure).toBe("confirmation_required");
        expect(error.disclosure?.status).toBe(status);
        const result = await preview(tx, entryId);
        const old = shiftedTestToken(
          result.confirmation,
          -(FIFTEEN_MINUTES + 1000),
        );
        expect(
          (
            await failure(
              publishWith(tx, entryId, result, { confirmation: old }),
            )
          ).failure,
        ).toBe("confirmation_expired");
        await publishWith(tx, entryId, result);
        expect(await statusOf(tx, entryId, "en")).toBe("published");
      });
    },
  );
});

describe("translations stay private (test 11)", () => {
  it("publishing one language exposes no trace of the other", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      await publishWith(tx, entryId, await preview(tx, entryId, "en"));

      expect(
        (await listPublicLanguageVersions(tx, entryId)).map((v) => v.locale),
      ).toEqual(["en"]);
      expect(await getPublicLanguageVersion(tx, entryId, "pt-BR")).toBeNull();
      expect(await listPublicTrackReflections(tx, entryId, "pt-BR")).toEqual(
        [],
      );
      expect(await statusOf(tx, entryId, "pt-BR")).toBe("draft");
    });
  });
});

describe("restoring never publishes, and publishing again shows the full set (test 5)", () => {
  it("needs a fresh preview after a delete and a restore, and publishes exactly the flagged set", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId, both, enOnly } = await journal(tx);
      const first = await preview(tx, entryId);
      await publishWith(tx, entryId, first);

      await tx.execute(
        sql`update entries set deleted_at = now() where id = ${entryId}`,
      );
      expect((await failure(preview(tx, entryId))).failure).toBe(
        "entry_deleted",
      );
      expect((await failure(publishWith(tx, entryId, first))).failure).toBe(
        "entry_deleted",
      );
      await restoreDeletedEntry(tx, entryId);

      // Restored as private: nothing is public.
      expect(await statusOf(tx, entryId, "en")).toBe("private");
      expect(await listPublicLanguageVersions(tx, entryId)).toEqual([]);
      expect(await listPublicTrackReflections(tx, entryId, "en")).toEqual([]);

      // No token, and the token from before the deletion, are both refused.
      expect(
        (
          await failure(
            publishLanguageVersion(tx, author, {
              entryId,
              locale: "en",
              expectedVersion: 1,
            }),
          )
        ).failure,
      ).toBe("confirmation_required");
      expect((await failure(publishWith(tx, entryId, first))).failure).toBe(
        "confirmation_stale",
      );

      // A fresh preview discloses the flags that survived the restore.
      const fresh = await preview(tx, entryId);
      expect(fresh.disclosure.status).toBe("private");
      await publishWith(tx, entryId, fresh);
      expect(
        (await listPublicTrackReflections(tx, entryId, "en"))
          .map((r) => r.trackReflectionId)
          .sort(),
      ).toEqual([both, enOnly].sort());
    });
  });
});

describe("a missing configuration fails closed (test 1)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.BETTER_AUTH_SECRET = saved.BETTER_AUTH_SECRET;
    vi.restoreAllMocks();
  });

  it.each([
    ["missing", undefined],
    ["too short", "short"],
  ])(
    "when the secret is %s, nothing is read, minted, or written",
    async (_name, secret) => {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        const result = await preview(tx, entryId);
        const before = await checksum(tx);
        if (secret === undefined) {
          delete process.env.BETTER_AUTH_SECRET;
        } else {
          process.env.BETTER_AUTH_SECRET = secret;
        }
        expect((await failure(preview(tx, entryId))).failure).toBe(
          "unavailable",
        );
        // With and without a token.
        expect((await failure(publishWith(tx, entryId, result))).failure).toBe(
          "unavailable",
        );
        expect(
          (
            await failure(
              publishLanguageVersion(tx, author, {
                entryId,
                locale: "en",
                expectedVersion: 1,
              }),
            )
          ).failure,
        ).toBe("unavailable");
        process.env.BETTER_AUTH_SECRET = saved.BETTER_AUTH_SECRET;
        expect(await checksum(tx)).toEqual(before);
      });
    },
  );
});

describe("nothing private is logged", () => {
  it("writes no token, secret, or journal text to the console during a preview and a publish", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => {}),
    );
    try {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await journal(tx);
        const result = await preview(tx, entryId);
        await failure(
          publishLanguageVersion(tx, author, {
            entryId,
            locale: "en",
            expectedVersion: 1,
          }),
        );
        await publishWith(tx, entryId, result);
        const output = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
        expect(output).not.toContain(result.confirmation);
        expect(output).not.toContain(testSecret());
        expect(output).not.toContain("English words");
      });
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("history and slug rules are preserved", () => {
  it("sets the publication history once and marks the current slug as published", async () => {
    await inRollbackTransaction(async (tx) => {
      const { entryId } = await journal(tx);
      await publishWith(tx, entryId, await preview(tx, entryId, "en"));
      const first = (
        await tx.execute<{ first: string; entry_first: string }>(sql`
          select t.first_published_at::text as first,
                 e.first_published_at::text as entry_first
            from entry_texts t join entries e on e.id = t.entry_id
           where t.entry_id = ${entryId} and t.locale = 'en'`)
      ).rows[0]!;
      expect(first.first).toBe(first.entry_first);

      await unpublishLanguageVersion(tx, author, entryId, "en", "private");
      await tx.execute(
        sql`update entry_texts set updated_at = updated_at + interval '1 second' where entry_id = ${entryId}`,
      );
      await publishWith(tx, entryId, await preview(tx, entryId, "en"));
      const again = (
        await tx.execute<{ first: string }>(sql`
          select first_published_at::text as first from entry_texts
           where entry_id = ${entryId} and locale = 'en'`)
      ).rows[0]!;
      expect(again.first).toBe(first.first);

      const slug = await tx.execute<{ was_published: boolean }>(
        sql`select was_published from entry_slugs where entry_id = ${entryId} and is_current`,
      );
      expect(slug.rows[0]?.was_published).toBe(true);
    });
  });

  it("does not use a label that two tests could share", () => {
    expect(uniqueLabel("x")).not.toBe(uniqueLabel("x"));
  });
});
