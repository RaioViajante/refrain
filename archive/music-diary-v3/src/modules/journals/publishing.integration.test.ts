import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Locale, type Transaction } from "@/db";
import {
  captureFailure,
  claimsOf,
  createTestArtist,
  createTestArtistJournal,
  createTestJournal,
  createTestTrackReflection,
  inScratchTransaction,
  otherSession,
  reissueTestToken,
  rowChecksum,
  shiftedTestToken,
  testAuthor,
  setPrivacyForTest,
} from "@/testing";

import {
  deleteAlbumJournal,
  restoreAlbumJournal,
  saveAlbumJournal,
  setAlbumJournalPrivacy,
} from "./commands";
import { JournalError, type JournalFailure } from "./errors";
import {
  previewAlbumJournalPublication,
  previewAlbumJournalPublicChange,
  publishAlbumJournalVersion,
} from "./publishing";

// M2.3: the Journals wrappers that the studio's publication workflow calls
// (ADR 0006 §§ 2 to 5, 8, 9, 12), on real PostgreSQL. The Publication engine
// has its own tests (M2.1); these prove the studio-facing layer: the review
// the dialog shows, the kind check, the failure codes, language isolation,
// unpublishing, and the restore scenario. All synthetic, labelled "[Test]".

const author = testAuthor();

interface Statuses {
  en: string;
  "pt-BR": string | undefined;
}

async function statuses(tx: Transaction, entryId: string): Promise<Statuses> {
  const rows = await tx
    .select({
      locale: schema.entryTexts.locale,
      status: schema.entryTexts.status,
    })
    .from(schema.entryTexts)
    .where(eq(schema.entryTexts.entryId, entryId));
  return {
    en: rows.find((row) => row.locale === "en")!.status,
    "pt-BR": rows.find((row) => row.locale === "pt-BR")?.status,
  };
}

async function entryVersion(tx: Transaction, entryId: string): Promise<number> {
  const [row] = await tx
    .select({ version: schema.entries.version })
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  return row!.version;
}

/**
 * An album journal written in English (private) and Portuguese (private).
 * Track 1: set to show, written in both languages. Track 2: set to show, no
 * text. Track 3: written in English, not set to show.
 */
async function journal(
  tx: Transaction,
  statusOfEnglish: "draft" | "private" = "private",
) {
  const made = await createTestJournal(tx, {
    ratingHalfSteps: 9,
    versions: [
      {
        locale: "en",
        status: statusOfEnglish,
        text: "[Test] First paragraph.",
      },
      {
        locale: "pt-BR",
        isOriginal: false,
        status: "private",
        text: "[Test] Parágrafo.",
      },
    ],
  });
  const [one, two, three] = made.trackIds as [string, string, string];
  const common = { albumJournalId: made.entryId, albumId: made.albumId };
  await createTestTrackReflection(tx, {
    ...common,
    trackId: one,
    isPublished: true,
    isFavourite: true,
    ratingHalfSteps: 7,
    texts: {
      en: "[Test] Shown reflection",
      "pt-BR": "[Test] Reflexão mostrada",
    },
  });
  await createTestTrackReflection(tx, {
    ...common,
    trackId: two,
    isPublished: true,
  });
  await createTestTrackReflection(tx, {
    ...common,
    trackId: three,
    texts: { en: "[Test] Kept private" },
  });
  return { ...made, one, two, three };
}

async function preview(tx: Transaction, entryId: string, locale: Locale) {
  return previewAlbumJournalPublication(tx, author, { entryId, locale });
}

async function publish(
  tx: Transaction,
  entryId: string,
  locale: Locale,
  token: string | undefined,
  expectedVersion?: number,
) {
  return publishAlbumJournalVersion(tx, author, {
    entryId,
    locale,
    expectedVersion: expectedVersion ?? (await entryVersion(tx, entryId)),
    ...(token === undefined ? {} : { confirmation: token }),
  });
}

async function failureOf(
  tx: Transaction,
  work: () => Promise<unknown>,
): Promise<JournalFailure | undefined> {
  const error = await captureFailure(tx, async () => {
    await work();
  });
  if (error === undefined) {
    return undefined;
  }
  expect(error).toBeInstanceOf(JournalError);
  return (error as JournalError).failure;
}

describe("the publication preview the studio dialog shows", () => {
  it("shows the exact public surface of one language, and what stays private", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const before = await rowChecksum(tx);

      const shown = await preview(tx, made.entryId, "en");
      const { review } = shown;

      expect(review.locale).toBe("en");
      expect(review.status).toBe("private");
      expect(review.text).toEqual([["[Test] First paragraph."]]);
      expect(review.albumRating).toEqual({
        halfSteps: 9,
        alreadyPublic: false,
      });
      expect(review.address.slug).toMatch(/^test-/);
      // Only the track that is set to show AND written in English is public.
      expect(review.reflections.map((item) => item.trackId)).toEqual([
        made.one,
      ]);
      expect(review.reflections[0]).toMatchObject({
        locale: "en",
        text: [["[Test] Shown reflection"]],
        isFavourite: true,
        ratingHalfSteps: 7,
      });
      // Set to show with no English text: not public in English.
      expect(review.flaggedWithoutText).toBe(1);
      // Written in English and not set to show: stays private, by title only.
      expect(review.stayingPrivate).toEqual([
        { trackId: made.three, trackTitle: "[Test] Track 3" },
      ]);
      expect(JSON.stringify(review)).not.toContain("Kept private");
      // No Portuguese reflection appears in the English review.
      expect(JSON.stringify(review)).not.toContain("Reflexão");

      expect(shown.confirmation).toMatch(/^ct1\./);
      // The preview writes nothing and changes no visibility.
      expect(await rowChecksum(tx)).toEqual(before);
      expect(await statuses(tx, made.entryId)).toEqual({
        en: "private",
        "pt-BR": "private",
      });
    });
  });

  it("is the same preview from a draft as from a private version", async () => {
    await inScratchTransaction(async (tx) => {
      const draft = await journal(tx, "draft");
      const privateOne = await journal(tx, "private");
      const fromDraft = await preview(tx, draft.entryId, "en");
      const fromPrivate = await preview(tx, privateOne.entryId, "en");
      expect(fromDraft.review.status).toBe("draft");
      expect(fromPrivate.review.status).toBe("private");
      expect(fromDraft.review.reflections).toHaveLength(1);
      expect(fromDraft.review.flaggedWithoutText).toBe(
        fromPrivate.review.flaggedWithoutText,
      );
    });
  });

  it("marks an album rating that is already public through another language", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const first = await preview(tx, made.entryId, "pt-BR");
      await publish(tx, made.entryId, "pt-BR", first.confirmation);
      const second = await preview(tx, made.entryId, "en");
      expect(second.review.albumRating).toEqual({
        halfSteps: 9,
        alreadyPublic: true,
      });
    });
  });

  it("refuses what cannot be published, and writes nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const before = await rowChecksum(tx);

      const artist = await createTestArtistJournal(tx, {
        artistId: await createTestArtist(tx),
        slug: "test-artist-kind",
      });
      expect(await failureOf(tx, () => preview(tx, artist, "en"))).toBe(
        "entry_not_found",
      );
      expect(
        await failureOf(tx, () =>
          previewAlbumJournalPublication(tx, author, {
            entryId: "00000000-0000-4000-8000-000000000000",
            locale: "en",
          }),
        ),
      ).toBe("entry_not_found");
      expect(
        await failureOf(tx, () =>
          previewAlbumJournalPublication(tx, author, {
            entryId: "nope",
            locale: "en",
          }),
        ),
      ).toBe("invalid_input");
      expect(
        await failureOf(tx, () =>
          previewAlbumJournalPublication(tx, author, {
            entryId: made.entryId,
            locale: "fr",
          }),
        ),
      ).toBe("invalid_input");
      // A language version that does not exist.
      const onlyEnglish = await createTestJournal(tx, {
        versions: [{ locale: "en" }],
      });
      expect(
        await failureOf(tx, () => preview(tx, onlyEnglish.entryId, "pt-BR")),
      ).toBe("entry_not_found");

      await deleteAlbumJournal(tx, author, made.entryId);
      expect(await failureOf(tx, () => preview(tx, made.entryId, "en"))).toBe(
        "entry_deleted",
      );
      expect(await rowChecksum(tx)).not.toEqual(before); // the delete itself
    });
  });

  it("refuses a version with nothing to publish", async () => {
    await inScratchTransaction(async (tx) => {
      const empty = await createTestJournal(tx, {
        versions: [{ locale: "en", text: "   " }],
      });
      expect(await failureOf(tx, () => preview(tx, empty.entryId, "en"))).toBe(
        "nothing_to_publish",
      );
    });
  });
});

describe("a review that is closed without confirming leaves everything as it was", () => {
  it("changes no flag, version, status, or row, however often it is opened, and the token still works", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const flags = async () =>
        (
          await tx
            .select({
              trackId: schema.trackReflections.trackId,
              flag: schema.trackReflections.isPublished,
            })
            .from(schema.trackReflections)
            .where(eq(schema.trackReflections.albumJournalId, made.entryId))
        )
          .map((row) => `${row.trackId}:${row.flag}`)
          .sort();
      const before = {
        rows: await rowChecksum(tx),
        flags: await flags(),
        version: await entryVersion(tx, made.entryId),
        statuses: await statuses(tx, made.entryId),
      };

      // Opening it, reading it, and closing it any number of times.
      const first = await preview(tx, made.entryId, "en");
      await preview(tx, made.entryId, "en");
      await preview(tx, made.entryId, "pt-BR");

      expect({
        rows: await rowChecksum(tx),
        flags: await flags(),
        version: await entryVersion(tx, made.entryId),
        statuses: await statuses(tx, made.entryId),
      }).toEqual(before);
      // Closing a review does not spoil it: the same token can still publish.
      expect(await publish(tx, made.entryId, "en", first.confirmation)).toEqual(
        { changed: true },
      );
    });
  });
});

describe("a stale Draft, Private, or Unpublish is refused", () => {
  const change = (
    tx: Transaction,
    entryId: string,
    status: "draft" | "private",
    expectedStatus: string,
    locale: Locale = "en",
  ) =>
    setAlbumJournalPrivacy(tx, author, {
      entryId,
      locale,
      status,
      expectedStatus,
    });

  it("applies a change only when the version still has the status the screen showed", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx, "draft");
      await change(tx, made.entryId, "private", "draft");
      expect((await statuses(tx, made.entryId)).en).toBe("private");
      // The screen still shows "draft": the version is private now.
      const before = await rowChecksum(tx);
      expect(
        await failureOf(tx, () => change(tx, made.entryId, "draft", "draft")),
      ).toBe("status_changed");
      expect(await rowChecksum(tx)).toEqual(before);
      expect((await statuses(tx, made.entryId)).en).toBe("private");
    });
  });

  it("does not let a tab that shows private unpublish what another tab published", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      // Tab A drew the page while the version was private. Tab B publishes it.
      const token = (await preview(tx, made.entryId, "en")).confirmation;
      await publish(tx, made.entryId, "en", token);
      const before = await rowChecksum(tx);

      for (const status of ["draft", "private"] as const) {
        expect(
          await failureOf(tx, () =>
            change(tx, made.entryId, status, "private"),
          ),
        ).toBe("status_changed");
      }
      expect(await rowChecksum(tx)).toEqual(before);
      expect((await statuses(tx, made.entryId)).en).toBe("published");

      // The legitimate Unpublish, from a tab that shows the real state.
      await change(tx, made.entryId, "private", "published");
      expect((await statuses(tx, made.entryId)).en).toBe("private");
      // And a second, stale Unpublish is refused rather than applied again.
      expect(
        await failureOf(tx, () =>
          change(tx, made.entryId, "draft", "published"),
        ),
      ).toBe("status_changed");
      expect((await statuses(tx, made.entryId)).en).toBe("private");
    });
  });

  it("checks only the language it is about, and refuses what cannot be checked", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const token = (await preview(tx, made.entryId, "pt-BR")).confirmation;
      await publish(tx, made.entryId, "pt-BR", token);
      // English is private, as the screen shows; Portuguese being published
      // is not what this change is about.
      await change(tx, made.entryId, "draft", "private", "en");
      expect(await statuses(tx, made.entryId)).toEqual({
        en: "draft",
        "pt-BR": "published",
      });
      // Missing or unknown expectation, a missing version, a deleted journal.
      expect(
        await failureOf(tx, () =>
          setAlbumJournalPrivacy(tx, author, {
            entryId: made.entryId,
            locale: "en",
            status: "private",
          } as never),
        ),
      ).toBe("invalid_input");
      expect(
        await failureOf(tx, () =>
          change(tx, made.entryId, "private", "unknown"),
        ),
      ).toBe("invalid_input");
      const onlyEnglish = await createTestJournal(tx, {
        versions: [{ locale: "en" }],
      });
      expect(
        await failureOf(tx, () =>
          change(tx, onlyEnglish.entryId, "private", "draft", "pt-BR"),
        ),
      ).toBe("entry_not_found");
      await deleteAlbumJournal(tx, author, made.entryId);
      expect(
        await failureOf(tx, () => change(tx, made.entryId, "private", "draft")),
      ).toBe("entry_deleted");
    });
  });
});

describe("publishing with the token a separate preview returned", () => {
  it("publishes from a private version and from a draft, and only that language", async () => {
    await inScratchTransaction(async (tx) => {
      for (const start of ["private", "draft"] as const) {
        const made = await journal(tx, start);
        const shown = await preview(tx, made.entryId, "en");
        const done = await publish(tx, made.entryId, "en", shown.confirmation);
        expect(done).toEqual({ changed: true });
        expect(await statuses(tx, made.entryId)).toEqual({
          en: "published",
          "pt-BR": "private",
        });
        const [version] = await tx
          .select({
            publishedAt: schema.entryTexts.publishedAt,
            firstPublishedAt: schema.entryTexts.firstPublishedAt,
          })
          .from(schema.entryTexts)
          .where(
            and(
              eq(schema.entryTexts.entryId, made.entryId),
              eq(schema.entryTexts.locale, "en"),
            ),
          );
        expect(version!.publishedAt).not.toBeNull();
        expect(version!.firstPublishedAt).not.toBeNull();
        // The address is reserved for good from now on (ADR 0003).
        const [slug] = await tx
          .select({ wasPublished: schema.entrySlugs.wasPublished })
          .from(schema.entrySlugs)
          .where(eq(schema.entrySlugs.entryId, made.entryId));
        expect(slug!.wasPublished).toBe(true);
        // Publishing never changes a reflection's own flag.
        const flags = await tx
          .select({ flag: schema.trackReflections.isPublished })
          .from(schema.trackReflections)
          .where(eq(schema.trackReflections.albumJournalId, made.entryId));
        expect(flags.map((row) => row.flag).sort()).toEqual([
          false,
          true,
          true,
        ]);
      }
    });
  });

  it("refuses to publish without a confirmation, and writes nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const before = await rowChecksum(tx);
      expect(
        await failureOf(tx, () => publish(tx, made.entryId, "en", undefined)),
      ).toBe("confirmation_required");
      // Not of the token's form: an input error, not a confirmation problem.
      for (const bad of ["", "ct1", "x.y.z", "ct1.a b.c"]) {
        expect(
          await failureOf(tx, () => publish(tx, made.entryId, "en", bad)),
        ).toBe("invalid_input");
      }
      expect(await rowChecksum(tx)).toEqual(before);
    });
  });

  it("refuses a token for another purpose, language, session, entry, or version", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const other = await journal(tx);
      const english = (await preview(tx, made.entryId, "en")).confirmation;
      const portuguese = (await preview(tx, made.entryId, "pt-BR"))
        .confirmation;
      const before = await rowChecksum(tx);

      // Another language's token.
      expect(
        await failureOf(tx, () => publish(tx, made.entryId, "en", portuguese)),
      ).toBe("confirmation_invalid");
      // Another entry's token.
      expect(
        await failureOf(tx, () => publish(tx, other.entryId, "en", english)),
      ).toBe("confirmation_invalid");
      // A change_public token cannot publish.
      const changePublic = reissueTestToken(english, { p: "change_public" });
      delete (claimsOf(changePublic) as { l?: string }).l;
      expect(
        await failureOf(tx, () =>
          publish(tx, made.entryId, "en", changePublic),
        ),
      ).toBe("confirmation_invalid");
      // Another session of the same author.
      const asOther = await captureFailure(tx, async () => {
        await publishAlbumJournalVersion(tx, otherSession(author), {
          entryId: made.entryId,
          locale: "en",
          expectedVersion: await entryVersion(tx, made.entryId),
          confirmation: english,
        });
      });
      expect((asOther as JournalError).failure).toBe("confirmation_invalid");
      // Another version of the entry.
      const current = await entryVersion(tx, made.entryId);
      expect(
        await failureOf(tx, () =>
          publish(tx, made.entryId, "en", english, current + 1),
        ),
      ).toBe("confirmation_invalid");
      expect(await rowChecksum(tx)).toEqual(before);
    });
  });

  it("refuses an expired token and one from the future, with a fresh review to ask for", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const token = (await preview(tx, made.entryId, "en")).confirmation;
      const before = await rowChecksum(tx);
      const sixteenMinutes = 16 * 60 * 1000;
      expect(
        await failureOf(tx, () =>
          publish(
            tx,
            made.entryId,
            "en",
            shiftedTestToken(token, -sixteenMinutes),
          ),
        ),
      ).toBe("confirmation_expired");
      expect(
        await failureOf(tx, () =>
          publish(
            tx,
            made.entryId,
            "en",
            shiftedTestToken(token, sixteenMinutes),
          ),
        ),
      ).toBe("confirmation_expired");
      expect(await rowChecksum(tx)).toEqual(before);
    });
  });

  it("refuses a token once what readers would see has changed, whichever way", async () => {
    await inScratchTransaction(async (tx) => {
      const changes: [
        string,
        (made: Awaited<ReturnType<typeof journal>>) => Promise<unknown>,
      ][] = [
        [
          "a reflection set to show",
          (made) =>
            saveAlbumJournal(tx, author, {
              entryId: made.entryId,
              expectedVersion: 1,
              reflections: [{ trackId: made.three, isPublished: true }],
            }),
        ],
        [
          "the album rating",
          (made) =>
            saveAlbumJournal(tx, author, {
              entryId: made.entryId,
              expectedVersion: 1,
              albumRating: 3,
            }),
        ],
        [
          "the writing",
          (made) =>
            saveAlbumJournal(tx, author, {
              entryId: made.entryId,
              expectedVersion: 1,
              body: "[Test] A different text.",
            }),
        ],
      ];
      for (const [name, change] of changes) {
        const made = await journal(tx);
        const token = (await preview(tx, made.entryId, "en")).confirmation;
        await change(made);
        // The save bumped the version, so the editor that held the review is
        // stale; the studio asks for a new review either way.
        expect(
          await failureOf(tx, () => publish(tx, made.entryId, "en", token, 1)),
          name,
        ).toBe("version_conflict");
        // Even with the new version the old token is not accepted.
        expect(
          await failureOf(tx, () => publish(tx, made.entryId, "en", token)),
          name,
        ).toBe("confirmation_invalid");
        expect((await statuses(tx, made.entryId)).en, name).toBe("private");
      }
    });
  });

  it("refuses a deleted journal, a stale editor, and a version with nothing to publish", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const token = (await preview(tx, made.entryId, "en")).confirmation;
      // A stale editor with no token, and with a token bound to the old version.
      expect(
        await failureOf(tx, () =>
          publish(tx, made.entryId, "en", undefined, 99),
        ),
      ).toBe("version_conflict");
      expect(
        await failureOf(tx, () => publish(tx, made.entryId, "en", token, 99)),
      ).toBe("confirmation_invalid");

      await deleteAlbumJournal(tx, author, made.entryId);
      expect(
        await failureOf(tx, () => publish(tx, made.entryId, "en", token)),
      ).toBe("entry_deleted");
      expect((await statuses(tx, made.entryId)).en).toBe("private");
    });
  });

  it("refuses an entry that is not an album journal", async () => {
    await inScratchTransaction(async (tx) => {
      const artist = await createTestArtistJournal(tx, {
        artistId: await createTestArtist(tx),
        slug: "test-artist-publish",
      });
      expect(
        await failureOf(tx, () =>
          publish(tx, artist, "en", "ct1.AAAA.BBBB", 1),
        ),
      ).toBe("entry_not_found");
    });
  });

  it("leaves a published version alone when published again with an unchanged disclosure", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const token = (await preview(tx, made.entryId, "en")).confirmation;
      await publish(tx, made.entryId, "en", token);
      const again = await preview(tx, made.entryId, "en");
      expect(again.review.status).toBe("published");
      const before = await rowChecksum(tx);
      expect(await publish(tx, made.entryId, "en", again.confirmation)).toEqual(
        {
          changed: false,
        },
      );
      expect(await rowChecksum(tx)).toEqual(before);
    });
  });
});

describe("unpublishing a language version", () => {
  it("removes only that version from publication and deletes nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      for (const locale of ["en", "pt-BR"] as const) {
        const token = (await preview(tx, made.entryId, locale)).confirmation;
        await publish(tx, made.entryId, locale, token);
      }
      const history = await tx
        .select({
          locale: schema.entryTexts.locale,
          first: schema.entryTexts.firstPublishedAt,
          body: schema.entryTexts.bodyText,
        })
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, made.entryId));
      const slugBefore = await tx
        .select()
        .from(schema.entrySlugs)
        .where(eq(schema.entrySlugs.entryId, made.entryId));

      await setPrivacyForTest(tx, author, {
        entryId: made.entryId,
        locale: "en",
        status: "private",
      });

      expect(await statuses(tx, made.entryId)).toEqual({
        en: "private",
        "pt-BR": "published",
      });
      const after = await tx
        .select({
          locale: schema.entryTexts.locale,
          first: schema.entryTexts.firstPublishedAt,
          body: schema.entryTexts.bodyText,
          publishedAt: schema.entryTexts.publishedAt,
        })
        .from(schema.entryTexts)
        .where(eq(schema.entryTexts.entryId, made.entryId));
      // The writing and the publication history are kept.
      for (const row of history) {
        const now = after.find((item) => item.locale === row.locale)!;
        expect(now.first).toEqual(row.first);
        expect(now.body).toEqual(row.body);
      }
      expect(after.find((row) => row.locale === "en")!.publishedAt).toBeNull();
      expect(
        after.find((row) => row.locale === "pt-BR")!.publishedAt,
      ).not.toBeNull();
      // The address stays reserved; the reflections are untouched.
      expect(
        await tx
          .select()
          .from(schema.entrySlugs)
          .where(eq(schema.entrySlugs.entryId, made.entryId)),
      ).toEqual(slugBefore);
      const reflections = await tx.select().from(schema.trackReflectionTexts);
      expect(reflections.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("can only go to draft or private, and a token from before it is stale", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const token = (await preview(tx, made.entryId, "en")).confirmation;
      await publish(tx, made.entryId, "en", token);

      expect(
        await failureOf(tx, () =>
          setPrivacyForTest(tx, author, {
            entryId: made.entryId,
            locale: "en",
            status: "published",
          } as never),
        ),
      ).toBe("invalid_input");

      const beforeUnpublish = await preview(tx, made.entryId, "en");
      await setPrivacyForTest(tx, author, {
        entryId: made.entryId,
        locale: "en",
        status: "draft",
      });
      // The review shown before it can no longer publish anything.
      expect(
        await failureOf(tx, () =>
          publish(tx, made.entryId, "en", beforeUnpublish.confirmation),
        ),
      ).toBe("confirmation_stale");
      expect((await statuses(tx, made.entryId)).en).toBe("draft");
    });
  });

  it("is refused for a deleted journal", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      const token = (await preview(tx, made.entryId, "en")).confirmation;
      await publish(tx, made.entryId, "en", token);
      await deleteAlbumJournal(tx, author, made.entryId);
      expect(
        await failureOf(tx, () =>
          setPrivacyForTest(tx, author, {
            entryId: made.entryId,
            locale: "en",
            status: "private",
          }),
        ),
      ).toBe("entry_deleted");
    });
  });
});

describe("deleting and restoring a journal that was published", () => {
  it("returns it private, and publishing again discloses the reflections that were set to show", async () => {
    await inScratchTransaction(async (tx) => {
      // It starts as a draft: inside one rolled-back transaction every
      // `now()` is the same instant, so the status is what tells the token's
      // state from the restored one. The HTTP suite proves the same across
      // real, committed transactions.
      const made = await journal(tx, "draft");
      const first = await preview(tx, made.entryId, "en");
      await publish(tx, made.entryId, "en", first.confirmation);

      await deleteAlbumJournal(tx, author, made.entryId);
      const restored = await restoreAlbumJournal(tx, author, made.entryId);
      expect(restored.madePrivate).toEqual(["en"]);
      expect((await statuses(tx, made.entryId)).en).toBe("private");

      // The token from before the deletion cannot republish it, and neither
      // can publishing without one.
      expect(
        await failureOf(tx, () =>
          publish(tx, made.entryId, "en", first.confirmation),
        ),
      ).toBe("confirmation_stale");
      expect(
        await failureOf(tx, () => publish(tx, made.entryId, "en", undefined)),
      ).toBe("confirmation_required");
      expect((await statuses(tx, made.entryId)).en).toBe("private");

      // A new review shows the reflection that was set to show before.
      const second = await preview(tx, made.entryId, "en");
      expect(second.review.reflections.map((item) => item.trackId)).toEqual([
        made.one,
      ]);
      await publish(tx, made.entryId, "en", second.confirmation);
      expect((await statuses(tx, made.entryId)).en).toBe("published");
    });
  });
});

describe("the review of a change to a public journal", () => {
  it("names a shorter text and a cleared field as changes, with what readers see now and after", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      await publish(
        tx,
        made.entryId,
        "en",
        (await preview(tx, made.entryId, "en")).confirmation,
      );
      const version = await entryVersion(tx, made.entryId);

      const shorter = await previewAlbumJournalPublicChange(tx, author, {
        entryId: made.entryId,
        expectedVersion: version,
        body: "[Test] Brief.",
      });
      expect(shorter.confirmation).toMatch(/^ct1\./);
      expect(shorter.review.changes).toEqual([
        {
          kind: "edited",
          label: "Your reflection",
          locale: "en",
          before: {
            type: "text",
            text: [["[Test] First paragraph."]],
          },
          after: { type: "text", text: [["[Test] Brief."]] },
        },
      ]);

      const cleared = await previewAlbumJournalPublicChange(tx, author, {
        entryId: made.entryId,
        expectedVersion: version,
        opening: "[Test] An opening",
      });
      expect(cleared.review.changes[0]).toMatchObject({
        label: "Opening sentence",
        after: { type: "text", text: [["[Test] An opening"]] },
      });
    });
  });

  it("names the track and language of a reflection, and asks nothing for a removal", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      await publish(
        tx,
        made.entryId,
        "en",
        (await preview(tx, made.entryId, "en")).confirmation,
      );
      const version = await entryVersion(tx, made.entryId);

      const added = await previewAlbumJournalPublicChange(tx, author, {
        entryId: made.entryId,
        expectedVersion: version,
        reflections: [{ trackId: made.three, isPublished: true }],
      });
      expect(added.review.changes.map((change) => change.kind)).toContain(
        "added",
      );
      expect(
        added.review.changes.find(
          (change) => change.label === "Reflection on the track",
        ),
      ).toMatchObject({
        trackTitle: "[Test] Track 3",
        locale: "en",
        after: { type: "text", text: [["[Test] Kept private"]] },
      });

      const removal = await previewAlbumJournalPublicChange(tx, author, {
        entryId: made.entryId,
        expectedVersion: version,
        reflections: [{ trackId: made.one, isPublished: false }],
      });
      expect(removal.review.changes).toEqual([]);
      expect(removal.confirmation).toBeNull();
    });
  });

  it("reaches the same refusals as the save, and never mints a token for them", async () => {
    await inScratchTransaction(async (tx) => {
      const made = await journal(tx);
      expect(
        await failureOf(tx, () =>
          previewAlbumJournalPublicChange(tx, author, {
            entryId: made.entryId,
            expectedVersion: 99,
            body: "[Test] x",
          }),
        ),
      ).toBe("version_conflict");
      await deleteAlbumJournal(tx, author, made.entryId);
      expect(
        await failureOf(tx, () =>
          previewAlbumJournalPublicChange(tx, author, {
            entryId: made.entryId,
            expectedVersion: 1,
            body: "[Test] x",
          }),
        ),
      ).toBe("entry_deleted");
    });
  });
});
