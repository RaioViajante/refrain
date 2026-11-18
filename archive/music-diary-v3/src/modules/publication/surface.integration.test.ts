import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Locale, type VisibilityStatus } from "@/db";
import {
  createTestJournal,
  createTestTrackReflection,
  inScratchTransaction,
  publicAtomsFromQueries,
} from "@/testing";

import { canonicalJson } from "./disclosure";
import { publicAtoms, readEntrySurface } from "./surface";

// ADR 0006 § 11 and § 13 (test 13): the public atoms that the confirmation
// weighs are the same ones a reader gets from the live public queries, over
// the whole state matrix. The queries side is an independent implementation
// (src/testing/public-atoms.ts). A rule that is wrong in any cell fails.

const statuses: VisibilityStatus[] = ["draft", "private", "published"];

function plain(map: Map<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    [...map].sort().map(([key, value]) => [key, canonicalJson(value)]),
  );
}

describe("the public atoms agree with the public queries", () => {
  it("in every state of the matrix", async () => {
    await inScratchTransaction(async (tx) => {
      let cells = 0;
      for (const deleted of [false, true]) {
        for (const en of statuses) {
          for (const pt of statuses) {
            for (const flagged of [false, true]) {
              for (const texts of [
                { en: false, "pt-BR": false },
                { en: true, "pt-BR": false },
                { en: false, "pt-BR": true },
                { en: true, "pt-BR": true },
              ]) {
                for (const rated of [false, true]) {
                  const journal = await createTestJournal(tx, {
                    versions: [
                      { locale: "en", status: en },
                      { locale: "pt-BR", isOriginal: false, status: pt },
                    ],
                    ratingHalfSteps: rated ? 7 : null,
                  });
                  await createTestTrackReflection(tx, {
                    albumJournalId: journal.entryId,
                    albumId: journal.albumId,
                    trackId: journal.trackIds[0]!,
                    isPublished: flagged,
                    isFavourite: true,
                    isStillWriting: flagged,
                    ratingHalfSteps: 4,
                    texts: {
                      ...(texts.en ? { en: "[Test] English" } : {}),
                      ...(texts["pt-BR"]
                        ? { "pt-BR": "[Test] Português" }
                        : {}),
                    } as Partial<Record<Locale, string>>,
                  });
                  if (deleted) {
                    await tx
                      .update(schema.entries)
                      .set({ deletedAt: sql`now()` })
                      .where(eq(schema.entries.id, journal.entryId));
                  }
                  const mine = publicAtoms(
                    await readEntrySurface(tx, journal.entryId),
                  );
                  const theirs = await publicAtomsFromQueries(
                    tx,
                    journal.entryId,
                  );
                  expect(plain(mine)).toEqual(plain(theirs));
                  cells += 1;
                }
              }
            }
          }
        }
      }
      expect(cells).toBe(2 * 3 * 3 * 2 * 4 * 2);
    });
  }, 120_000);

  it("shows nothing at all once the journal is deleted, and never the rating of a private journal", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await createTestJournal(tx, {
        versions: [{ locale: "en", status: "private" }],
        ratingHalfSteps: 9,
      });
      expect(
        publicAtoms(await readEntrySurface(tx, journal.entryId)).size,
      ).toBe(0);
    });
  });
});
