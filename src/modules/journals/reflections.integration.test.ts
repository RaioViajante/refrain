import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Transaction } from "@/db";
import {
  captureFailure,
  createTestJournal,
  createTestTrackReflection,
  inScratchTransaction,
  testAuthor,
} from "@/testing";
import {
  listPublicLanguageVersions,
  listPublicTrackReflections,
} from "@/modules/publication";

import {
  deleteAlbumJournal,
  restoreAlbumJournal,
  saveAlbumJournal,
} from "./commands";
import { JournalError, type JournalFailure } from "./errors";
import { getTrackByTrack } from "./queries";

// Track reflections, ratings, and flags saved through the album-journal save
// (data model, boundary 3), on real PostgreSQL. Everything is synthetic and
// labelled "[Test]". A save of a PUBLIC journal that changes what a reader
// sees is covered in confirmed-save.integration.test.ts.

const author = testAuthor();

async function versionOf(tx: Transaction, entryId: string): Promise<number> {
  const [row] = await tx
    .select({ version: schema.entries.version })
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  return row!.version;
}

type Fields = Record<string, unknown>;

async function save(tx: Transaction, entryId: string, fields: Fields) {
  return saveAlbumJournal(tx, author, {
    entryId,
    expectedVersion: await versionOf(tx, entryId),
    ...fields,
  });
}

async function failureOf(
  tx: Transaction,
  work: (db: Transaction) => Promise<unknown>,
): Promise<JournalFailure | undefined> {
  const error = await captureFailure(tx, work);
  if (error === undefined) {
    return undefined;
  }
  expect(error).toBeInstanceOf(JournalError);
  return (error as JournalError).failure;
}

async function textRows(tx: Transaction, entryId: string) {
  const result = await tx.execute<{
    track_id: string;
    locale: string;
    body_text: string;
  }>(sql`
    select tr.track_id, trt.locale, trt.body_text
      from track_reflection_texts trt
      join track_reflections tr on tr.id = trt.track_reflection_id
     where tr.album_journal_id = ${entryId}
     order by tr.track_id, trt.locale`);
  return result.rows;
}

describe("writing a track reflection", () => {
  it("creates it on the first save, in the album's order, and reads it back", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const [first, second] = journal.trackIds as [string, string, string];
      const saved = await save(tx, journal.entryId, {
        reflections: [
          {
            trackId: second,
            texts: {
              en: "[Test] First line\nsecond line\n\n[Test] New paragraph",
            },
            isFavourite: true,
            ratingHalfSteps: 7,
          },
        ],
      });
      expect(saved).toEqual({ version: 2 });

      const view = await getTrackByTrack(tx, author, journal.entryId);
      expect(view?.tracks.map((track) => track.title)).toEqual([
        "[Test] Track 1",
        "[Test] Track 2",
        "[Test] Track 3",
      ]);
      expect(view?.tracks.map((track) => track.number)).toEqual([1, 2, 3]);
      expect(
        view?.tracks.find((t) => t.trackId === first)?.reflection,
      ).toBeNull();
      expect(view?.tracks[1]?.reflection).toEqual({
        isPublished: false,
        isStillWriting: false,
        isFavourite: true,
        ratingHalfSteps: 7,
        // Multiline plain text comes back exactly.
        texts: { en: "[Test] First line\nsecond line\n\n[Test] New paragraph" },
        publicIn: [],
      });
      expect(view?.version).toBe(2);
    });
  });

  it("is a patch: flags leave the text alone, and text leaves the flags alone", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const trackId = journal.trackIds[0]!;
      await save(tx, journal.entryId, {
        reflections: [{ trackId, texts: { en: "[Test] Kept" } }],
      });
      await save(tx, journal.entryId, {
        reflections: [{ trackId, isStillWriting: true, ratingHalfSteps: 3 }],
      });
      let state = (await getTrackByTrack(tx, author, journal.entryId))!
        .tracks[0]!.reflection!;
      expect(state.texts).toEqual({ en: "[Test] Kept" });
      expect(state).toMatchObject({ isStillWriting: true, ratingHalfSteps: 3 });

      await save(tx, journal.entryId, {
        reflections: [{ trackId, texts: { en: "[Test] Rewritten" } }],
      });
      state = (await getTrackByTrack(tx, author, journal.entryId))!.tracks[0]!
        .reflection!;
      expect(state.texts).toEqual({ en: "[Test] Rewritten" });
      expect(state).toMatchObject({ isStillWriting: true, ratingHalfSteps: 3 });
    });
  });

  it("keeps each language apart, and clearing one touches nothing else", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const trackId = journal.trackIds[0]!;
      await save(tx, journal.entryId, {
        reflections: [
          {
            trackId,
            texts: { en: "[Test] English", "pt-BR": "[Test] Português" },
          },
        ],
      });
      await save(tx, journal.entryId, {
        reflections: [{ trackId, texts: { en: "[Test] English, revised" } }],
      });
      expect(
        (await textRows(tx, journal.entryId)).map((r) => [
          r.locale,
          r.body_text,
        ]),
      ).toEqual([
        ["en", "[Test] English, revised"],
        ["pt-BR", "[Test] Português"],
      ]);

      // A blank text removes that language's row: a row always means text.
      await save(tx, journal.entryId, {
        reflections: [{ trackId, texts: { "pt-BR": "  \n " } }],
      });
      expect(
        (await textRows(tx, journal.entryId)).map((r) => r.locale),
      ).toEqual(["en"]);
      await save(tx, journal.entryId, {
        reflections: [{ trackId, texts: { en: null } }],
      });
      expect(await textRows(tx, journal.entryId)).toEqual([]);
      // The reflection and its flags are still there.
      const state = (await getTrackByTrack(tx, author, journal.entryId))!
        .tracks[0]!;
      expect(state.reflection).toMatchObject({ texts: {} });
    });
  });

  it("keeps favourite, still writing, the track rating, and the album rating independent", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const [a, b, c] = journal.trackIds as [string, string, string];
      await save(tx, journal.entryId, {
        albumRating: 9,
        reflections: [
          { trackId: a, isFavourite: true },
          { trackId: b, isFavourite: true, ratingHalfSteps: 1 },
          { trackId: c, isStillWriting: true, ratingHalfSteps: 10 },
        ],
      });
      const view = (await getTrackByTrack(tx, author, journal.entryId))!;
      // More than one favourite is allowed: the mark belongs to the track in
      // this journal, with no limit.
      expect(view.tracks.map((t) => t.reflection?.isFavourite)).toEqual([
        true,
        true,
        false,
      ]);
      expect(view.tracks.map((t) => t.reflection?.ratingHalfSteps)).toEqual([
        null,
        1,
        10,
      ]);
      expect(view.tracks.map((t) => t.reflection?.isStillWriting)).toEqual([
        false,
        false,
        true,
      ]);
      expect(view.albumRating).toBe(9);

      // Clearing the album rating leaves every track rating; and the reverse.
      await save(tx, journal.entryId, { albumRating: null });
      await save(tx, journal.entryId, {
        reflections: [{ trackId: c, ratingHalfSteps: null }],
      });
      const after = (await getTrackByTrack(tx, author, journal.entryId))!;
      expect(after.albumRating).toBeNull();
      expect(after.tracks.map((t) => t.reflection?.ratingHalfSteps)).toEqual([
        null,
        1,
        null,
      ]);
    });
  });

  it("accepts only half-step ratings from 0.5 to 5 stars", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const trackId = journal.trackIds[0]!;
      for (const halfSteps of [1, 2, 5, 9, 10]) {
        await save(tx, journal.entryId, {
          albumRating: halfSteps,
          reflections: [{ trackId, ratingHalfSteps: halfSteps }],
        });
      }
      const before = await versionOf(tx, journal.entryId);
      for (const bad of [0, 11, -1, 1.5, 0.5, "7", Number.NaN, true]) {
        expect(
          await failureOf(tx, (db) =>
            saveAlbumJournal(db, author, {
              entryId: journal.entryId,
              expectedVersion: before,
              reflections: [{ trackId, ratingHalfSteps: bad }],
            }),
          ),
        ).toBe("invalid_input");
        expect(
          await failureOf(tx, (db) =>
            saveAlbumJournal(db, author, {
              entryId: journal.entryId,
              expectedVersion: before,
              albumRating: bad,
            }),
          ),
        ).toBe("invalid_input");
      }
      expect(await versionOf(tx, journal.entryId)).toBe(before);
    });
  });

  it("treats text made only of invisible or Unicode white space as blank", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const trackId = journal.trackIds[0]!;
      for (const blank of [
        "\u00A0",
        "\u3000 \u2003",
        "\u200B",
        "\uFEFF\n \u2060",
      ]) {
        await save(tx, journal.entryId, {
          reflections: [{ trackId, isFavourite: true, texts: { en: blank } }],
        });
        // No row: a text row always means text.
        expect(await textRows(tx, journal.entryId)).toEqual([]);
      }
      await save(tx, journal.entryId, {
        reflections: [{ trackId, texts: { en: "[Test] Real" } }],
      });
      await save(tx, journal.entryId, {
        reflections: [{ trackId, texts: { en: "\u00A0\u200B" } }],
      });
      expect(await textRows(tx, journal.entryId)).toEqual([]);
    });
  });

  it("refuses malformed reflections without writing anything", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const trackId = journal.trackIds[0]!;
      const before = await versionOf(tx, journal.entryId);
      for (const reflections of [
        [{ trackId }], // names nothing
        [{ trackId, texts: {} }],
        [{ trackId: "not-a-uuid", isFavourite: true }],
        [
          { trackId, isFavourite: true },
          { trackId, isStillWriting: true },
        ], // twice
        [{ trackId, isFavourite: "yes" }],
        [{ trackId, texts: { fr: "[Test] Français" } }],
        [{ trackId, status: "published" }], // unknown key
        [{ trackId, texts: { en: "x".repeat(20_001) } }],
        [],
      ]) {
        expect(
          await failureOf(tx, (db) =>
            saveAlbumJournal(db, author, {
              entryId: journal.entryId,
              expectedVersion: before,
              reflections,
            }),
          ),
        ).toBe("invalid_input");
      }
      expect(await versionOf(tx, journal.entryId)).toBe(before);
      expect(await textRows(tx, journal.entryId)).toEqual([]);
    });
  });
});

describe("which tracks can be written about", () => {
  it("refuses a recording that is not on the journal's album, and writes nothing", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const other = await createTestJournal(tx);
      const before = await versionOf(tx, journal.entryId);
      for (const trackId of [
        other.trackIds[0]!,
        "00000000-0000-4000-8000-00000000dead",
      ]) {
        expect(
          await failureOf(tx, (db) =>
            saveAlbumJournal(db, author, {
              entryId: journal.entryId,
              expectedVersion: before,
              reflections: [{ trackId, texts: { en: "[Test] Wrong album" } }],
            }),
          ),
        ).toBe("track_not_in_album");
      }
      expect(await versionOf(tx, journal.entryId)).toBe(before);
      expect(await textRows(tx, journal.entryId)).toEqual([]);
    });
  });

  it("refuses to start on an archived recording, and keeps an existing reflection editable", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const [written, empty] = journal.trackIds as [string, string, string];
      await save(tx, journal.entryId, {
        reflections: [
          { trackId: written, texts: { en: "[Test] Before archiving" } },
        ],
      });
      await tx
        .update(schema.tracks)
        .set({ archivedAt: sql`now()` })
        .where(sql`id in (${written}, ${empty})`);

      expect(
        await failureOf(tx, async (db) =>
          save(db, journal.entryId, {
            reflections: [{ trackId: empty, texts: { en: "[Test] New" } }],
          }),
        ),
      ).toBe("track_archived");
      await save(tx, journal.entryId, {
        reflections: [
          { trackId: written, texts: { en: "[Test] After archiving" } },
        ],
      });
      const view = (await getTrackByTrack(tx, author, journal.entryId))!;
      expect(view.tracks.find((t) => t.trackId === written)).toMatchObject({
        archived: true,
        reflection: { texts: { en: "[Test] After archiving" } },
      });
    });
  });

  it("lists a reflection on a recording the reference edition lacks after the ordered tracks", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const [extra] = await tx
        .insert(schema.tracks)
        .values({ title: "[Test] Bonus" })
        .returning({ id: schema.tracks.id });
      await tx
        .insert(schema.albumTracks)
        .values({ albumId: journal.albumId, trackId: extra!.id });
      await save(tx, journal.entryId, {
        reflections: [
          { trackId: extra!.id, texts: { en: "[Test] Outside the edition" } },
        ],
      });
      const view = (await getTrackByTrack(tx, author, journal.entryId))!;
      expect(view.tracks.map((t) => [t.title, t.inReferenceEdition])).toEqual([
        ["[Test] Track 1", true],
        ["[Test] Track 2", true],
        ["[Test] Track 3", true],
        ["[Test] Bonus", false],
      ]);
      expect(view.tracks.at(-1)?.number).toBe(4);
    });
  });

  it("leaves text the plain editor cannot reproduce exactly untouched", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const trackId = journal.trackIds[0]!;
      const reflectionId = await createTestTrackReflection(tx, {
        albumJournalId: journal.entryId,
        albumId: journal.albumId,
        trackId,
        texts: { en: "[Test] plain" },
      });
      const formatted = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "[Test] Heading" }],
          },
        ],
      };
      await tx
        .update(schema.trackReflectionTexts)
        .set({ body: formatted, bodyText: "[Test] Heading" })
        .where(eq(schema.trackReflectionTexts.trackReflectionId, reflectionId));

      expect(
        await failureOf(tx, (db) =>
          save(db, journal.entryId, {
            reflections: [{ trackId, texts: { en: "[Test] flattened" } }],
          }),
        ),
      ).toBe("unsupported_content");
      // It is shown as unreadable by the plain editor, not as empty.
      const view = (await getTrackByTrack(tx, author, journal.entryId))!;
      expect(view.tracks[0]?.reflection?.texts).toEqual({ en: null });
      const [row] = await tx
        .select({ body: schema.trackReflectionTexts.body })
        .from(schema.trackReflectionTexts)
        .where(eq(schema.trackReflectionTexts.trackReflectionId, reflectionId));
      expect(row?.body).toEqual(formatted);
      // Flags can still change without touching the text.
      await save(tx, journal.entryId, {
        reflections: [{ trackId, isFavourite: true }],
      });
    });
  });
});

describe("saving and the entry version", () => {
  it("bumps the version for every kind of save, and refuses a stale one", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const trackId = journal.trackIds[0]!;
      const start = await versionOf(tx, journal.entryId);
      await save(tx, journal.entryId, { albumRating: 4 });
      await save(tx, journal.entryId, {
        reflections: [{ trackId, isFavourite: true }],
      });
      await save(tx, journal.entryId, {
        reflections: [{ trackId, texts: { en: "[Test] x" } }],
      });
      await save(tx, journal.entryId, { opening: "[Test] Opening" });
      expect(await versionOf(tx, journal.entryId)).toBe(start + 4);

      const stale = start + 1;
      expect(
        await failureOf(tx, (db) =>
          saveAlbumJournal(db, author, {
            entryId: journal.entryId,
            expectedVersion: stale,
            albumRating: 2,
            reflections: [{ trackId, texts: { en: "[Test] Overwritten" } }],
          }),
        ),
      ).toBe("version_conflict");
      const view = (await getTrackByTrack(tx, author, journal.entryId))!;
      expect(view.albumRating).toBe(4);
      expect(view.tracks[0]?.reflection?.texts).toEqual({ en: "[Test] x" });
    });
  });
});

describe("what a flag does and does not do", () => {
  it("never makes a reflection public by itself: a draft and a private journal stay private", async () => {
    await inScratchTransaction(async (tx) => {
      for (const status of ["draft", "private"] as const) {
        const journal = await createTestJournal(tx, {
          versions: [{ locale: "en", status }],
        });
        const trackId = journal.trackIds[0]!;
        await save(tx, journal.entryId, {
          reflections: [
            {
              trackId,
              isPublished: true,
              texts: { en: "[Test] Selected, not public" },
            },
          ],
        });
        const view = (await getTrackByTrack(tx, author, journal.entryId))!;
        // Saved privately, and selected for possible public display...
        expect(view.tracks[0]?.reflection).toMatchObject({ isPublished: true });
        // ...and not visible through any language version.
        expect(view.tracks[0]?.reflection?.publicIn).toEqual([]);
        expect(await listPublicLanguageVersions(tx, journal.entryId)).toEqual(
          [],
        );
        expect(
          await listPublicTrackReflections(tx, journal.entryId, "en"),
        ).toEqual([]);
      }
    });
  });

  it("keeps an unpublished translation private even when its reflection is flagged", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx, {
        versions: [
          { locale: "en", status: "published" },
          { locale: "pt-BR", isOriginal: false, status: "private" },
        ],
      });
      const trackId = journal.trackIds[0]!;
      // The flag and the Portuguese text are written while English is public
      // and Portuguese is not. The save adds a Portuguese text to a
      // reflection that is not yet shown, so nothing public changes.
      await save(tx, journal.entryId, {
        reflections: [
          {
            trackId,
            isPublished: false,
            texts: { "pt-BR": "[Test] Reflexão privada" },
          },
        ],
      });
      // Flagging it now would show the English text if there were one; with
      // only a Portuguese text, nothing becomes public in English.
      await save(tx, journal.entryId, {
        reflections: [{ trackId, isPublished: true }],
      });
      expect(
        await listPublicTrackReflections(tx, journal.entryId, "pt-BR"),
      ).toEqual([]);
      expect(
        await listPublicTrackReflections(tx, journal.entryId, "en"),
      ).toEqual([]);
      const view = (await getTrackByTrack(tx, author, journal.entryId))!;
      expect(view.tracks[0]?.reflection).toMatchObject({
        isPublished: true,
        texts: { "pt-BR": "[Test] Reflexão privada" },
        publicIn: [],
      });
    });
  });

  it("agrees with the public queries about where a flagged reflection is visible", async () => {
    await inScratchTransaction(async (tx) => {
      for (const deleted of [false, true]) {
        for (const enStatus of ["draft", "private", "published"] as const) {
          for (const ptStatus of ["draft", "private", "published"] as const) {
            const journal = await createTestJournal(tx, {
              versions: [
                { locale: "en", status: enStatus },
                { locale: "pt-BR", isOriginal: false, status: ptStatus },
              ],
            });
            const trackId = journal.trackIds[0]!;
            await createTestTrackReflection(tx, {
              albumJournalId: journal.entryId,
              albumId: journal.albumId,
              trackId,
              isPublished: true,
              texts: { en: "[Test] English", "pt-BR": "[Test] Português" },
            });
            if (deleted) {
              await tx
                .update(schema.entries)
                .set({ deletedAt: sql`now()` })
                .where(eq(schema.entries.id, journal.entryId));
            }
            const view = (await getTrackByTrack(tx, author, journal.entryId))!;
            const shown = [];
            for (const locale of ["en", "pt-BR"] as const) {
              if (
                (await listPublicTrackReflections(tx, journal.entryId, locale))
                  .length > 0
              ) {
                shown.push(locale);
              }
            }
            expect(view.tracks[0]?.reflection?.publicIn.toSorted()).toEqual(
              shown.toSorted(),
            );
          }
        }
      }
    });
  });

  it('"still writing" never changes whether a reflection is public (INV-2)', async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx, {
        versions: [{ locale: "en", status: "private" }],
      });
      const trackId = journal.trackIds[0]!;
      await save(tx, journal.entryId, {
        reflections: [
          { trackId, isPublished: true, texts: { en: "[Test] x" } },
        ],
      });
      const shownWith = async (stillWriting: boolean) => {
        await save(tx, journal.entryId, {
          reflections: [{ trackId, isStillWriting: stillWriting }],
        });
        return (await getTrackByTrack(tx, author, journal.entryId))!.tracks[0]!
          .reflection!.publicIn;
      };
      expect(await shownWith(true)).toEqual(await shownWith(false));
    });
  });
});

describe("deleting and restoring a journal with reflections", () => {
  it("refuses a save while the journal is in Recently deleted, and a restore keeps every reflection", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const trackId = journal.trackIds[0]!;
      await save(tx, journal.entryId, {
        albumRating: 8,
        reflections: [
          {
            trackId,
            isPublished: true,
            isFavourite: true,
            ratingHalfSteps: 5,
            texts: { en: "[Test] Kept", "pt-BR": "[Test] Mantida" },
          },
        ],
      });
      const before = (await getTrackByTrack(tx, author, journal.entryId))!;

      await deleteAlbumJournal(tx, author, journal.entryId);
      expect(
        await failureOf(tx, (db) =>
          save(db, journal.entryId, {
            reflections: [{ trackId, isFavourite: false }],
          }),
        ),
      ).toBe("entry_deleted");

      await restoreAlbumJournal(tx, author, journal.entryId);
      const after = (await getTrackByTrack(tx, author, journal.entryId))!;
      expect(after.tracks).toEqual(before.tracks);
      expect(after.albumRating).toBe(8);
      // A restore does not bump the version (ADR 0005, decision 9).
      expect(after.version).toBe(before.version);
      // And nothing is public afterwards.
      expect(await listPublicLanguageVersions(tx, journal.entryId)).toEqual([]);
    });
  });
});

describe("the writing of other languages and kinds is never disturbed", () => {
  it("leaves the journal's own text, slug, status, and featured state alone", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const trackId = journal.trackIds[0]!;
      const snapshot = async () =>
        (
          await tx.execute(sql`
            select t.status, t.body, t.opening, s.slug, j.is_featured
              from entry_texts t
              join entry_slugs s on s.entry_id = t.entry_id and s.is_current
              join album_journals j on j.entry_id = t.entry_id
             where t.entry_id = ${journal.entryId}`)
        ).rows;
      const before = await snapshot();
      await save(tx, journal.entryId, {
        albumRating: 3,
        reflections: [
          { trackId, isPublished: true, texts: { en: "[Test] x" } },
        ],
      });
      expect(await snapshot()).toEqual(before);
    });
  });

  it("does not write a text row for an empty reflection created by a flag alone", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx);
      const trackId = journal.trackIds[0]!;
      await save(tx, journal.entryId, {
        reflections: [{ trackId, isFavourite: true, isPublished: true }],
      });
      expect(await textRows(tx, journal.entryId)).toEqual([]);
      const rows = await tx
        .select()
        .from(schema.trackReflections)
        .where(
          and(eq(schema.trackReflections.albumJournalId, journal.entryId)),
        );
      expect(rows).toHaveLength(1);
      // Flagged, with no text: nothing a reader could ever see.
    });
  });
});
