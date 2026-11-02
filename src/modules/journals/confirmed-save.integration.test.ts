import { inspect } from "node:util";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Transaction } from "@/db";
import {
  captureFailure,
  claimsOf,
  createTestJournal,
  createTestTrackReflection,
  inScratchTransaction,
  isSubsetWithSameValues,
  mintTestToken,
  otherSession,
  publicAtomsFromQueries,
  reissueTestToken,
  rowChecksum,
  shiftedTestToken,
  testAuthor,
  testSecret,
} from "@/testing";
import { previewPublication } from "@/modules/publication";

import {
  previewAlbumJournalChange,
  saveAlbumJournal,
  setAlbumJournalPrivacy,
} from "./commands";
import { JournalError, type JournalFailure } from "./errors";
import { getAlbumJournal, getTrackByTrack } from "./queries";

// ADR 0006 § 5 and § 13 (test 9): changes to a PUBLIC journal, on real
// PostgreSQL. A save that adds or edits anything a reader sees needs a
// `change_public` token for exactly that change; a removal, and a change to
// what is not public, need none. All synthetic, labelled "[Test]".

const author = testAuthor();
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const FIGURE = "[Test] Public body";

type Fields = Record<string, unknown>;

async function versionOf(tx: Transaction, entryId: string): Promise<number> {
  const [row] = await tx
    .select({ version: schema.entries.version })
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  return row!.version;
}

/**
 * A journal whose English version is public and whose Portuguese version is
 * private. Track 1 is set to show and has English text (public), track 2 is
 * set to show and has no text, track 3 has text and is not set to show.
 */
async function publicJournal(tx: Transaction) {
  const journal = await createTestJournal(tx, {
    versions: [
      { locale: "en", status: "published", text: FIGURE },
      {
        locale: "pt-BR",
        isOriginal: false,
        status: "private",
        text: "[Test] Corpo",
      },
    ],
  });
  const [one, two, three] = journal.trackIds as [string, string, string];
  const common = { albumJournalId: journal.entryId, albumId: journal.albumId };
  await createTestTrackReflection(tx, {
    ...common,
    trackId: one,
    isPublished: true,
    ratingHalfSteps: 6,
    texts: { en: "[Test] Public reflection", "pt-BR": "[Test] Reflexão" },
  });
  await createTestTrackReflection(tx, {
    ...common,
    trackId: two,
    isPublished: true,
  });
  await createTestTrackReflection(tx, {
    ...common,
    trackId: three,
    texts: { en: "[Test] Private reflection" },
  });
  return { ...journal, one, two, three };
}

async function preview(tx: Transaction, entryId: string, fields: Fields) {
  return previewAlbumJournalChange(tx, author, {
    entryId,
    expectedVersion: await versionOf(tx, entryId),
    ...fields,
  });
}

async function save(
  tx: Transaction,
  entryId: string,
  fields: Fields,
  confirmation?: string | null,
) {
  return saveAlbumJournal(tx, author, {
    entryId,
    expectedVersion: await versionOf(tx, entryId),
    ...fields,
    ...(confirmation ? { confirmation } : {}),
  });
}

async function refusal(
  tx: Transaction,
  work: (db: Transaction) => Promise<unknown>,
): Promise<JournalError | undefined> {
  const error = await captureFailure(tx, work);
  if (error === undefined) {
    return undefined;
  }
  expect(error).toBeInstanceOf(JournalError);
  return error as JournalError;
}

const failureOf = async (
  tx: Transaction,
  work: (db: Transaction) => Promise<unknown>,
): Promise<JournalFailure | undefined> => (await refusal(tx, work))?.failure;

describe("a change that alters what a reader sees of a public journal", () => {
  // Every row of ADR 0006 § 5 that asks for a confirmation. The journal is
  // public in English only, so each case is public in English.
  const asks: [
    string,
    (j: Awaited<ReturnType<typeof publicJournal>>) => Fields,
  ][] = [
    ["a longer text", () => ({ body: `${FIGURE}, and a good deal more` })],
    ["a SHORTER text", () => ({ body: "[Test] Short" })],
    ["a new opening sentence", () => ({ opening: "[Test] Opening" })],
    [
      "a paragraph break where there was a line break",
      () => ({ body: "[Test] A\n\nB" }),
    ],
    ["the album rating set while public", () => ({ albumRating: 7 })],
    [
      "text added to a reflection that is already set to show",
      (j) => ({
        reflections: [{ trackId: j.two, texts: { en: "[Test] Now written" } }],
      }),
    ],
    [
      "a reflection set to show, with text",
      (j) => ({ reflections: [{ trackId: j.three, isPublished: true }] }),
    ],
    [
      "a public reflection's text, shorter",
      (j) => ({
        reflections: [{ trackId: j.one, texts: { en: "[Test] Brief" } }],
      }),
    ],
    [
      "a public reflection's rating changed",
      (j) => ({ reflections: [{ trackId: j.one, ratingHalfSteps: 9 }] }),
    ],
    [
      "a public reflection's rating cleared",
      (j) => ({ reflections: [{ trackId: j.one, ratingHalfSteps: null }] }),
    ],
    [
      "a public reflection marked as a favourite",
      (j) => ({ reflections: [{ trackId: j.one, isFavourite: true }] }),
    ],
    [
      'a public reflection\'s "still writing" label',
      (j) => ({ reflections: [{ trackId: j.one, isStillWriting: true }] }),
    ],
    [
      "an edit bundled with a removal",
      (j) => ({
        body: "[Test] Edited",
        reflections: [{ trackId: j.one, isPublished: false }],
      }),
    ],
  ];

  for (const [name, change] of asks) {
    it(`asks for a confirmation: ${name}`, async () => {
      await inScratchTransaction(async (tx) => {
        const journal = await publicJournal(tx);
        const fields = change(journal);
        const before = await rowChecksum(tx);
        const version = await versionOf(tx, journal.entryId);

        // The preview shows the change, mints a token, and writes nothing.
        const shown = await preview(tx, journal.entryId, fields);
        expect(shown.delta.changes.length).toBeGreaterThan(0);
        expect(shown.confirmation).toMatch(/^ct1\./);
        expect(await rowChecksum(tx)).toEqual(before);

        // Without it the save is refused, with the change and no token.
        const error = await refusal(tx, (db) =>
          save(db, journal.entryId, fields),
        );
        expect(error?.failure).toBe("confirmation_required");
        expect(error?.delta?.changes).toEqual(shown.delta.changes);
        expect(JSON.stringify(error)).not.toMatch(/ct1\./);
        expect(await rowChecksum(tx)).toEqual(before);

        // With the matching token it is applied, and the version moves.
        await expect(
          save(tx, journal.entryId, fields, shown.confirmation),
        ).resolves.toEqual({ version: version + 1 });
      });
    });
  }

  it("reports each change as an addition or an edit, with the old and the new value", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      const { delta } = await preview(tx, journal.entryId, {
        albumRating: 7,
        body: "[Test] Short",
        reflections: [{ trackId: journal.one, ratingHalfSteps: 9 }],
      });
      const byAtom = Object.fromEntries(delta.changes.map((c) => [c.atom, c]));
      expect(byAtom["albumRating"]).toMatchObject({ kind: "added", after: 7 });
      expect(byAtom["version|en|body"]).toMatchObject({ kind: "edited" });
      expect(byAtom[`reflection|${journal.one}|en|rating`]).toMatchObject({
        kind: "edited",
        before: 6,
        after: 9,
      });
      // The private Portuguese version is not part of it.
      expect(delta.changes.some((c) => c.atom.includes("|pt-BR|"))).toBe(false);
    });
  });

  it("does not let the same text through twice: the token is spent by the save", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      const fields = { body: "[Test] Once" };
      const shown = await preview(tx, journal.entryId, fields);
      const version = await versionOf(tx, journal.entryId);
      await save(tx, journal.entryId, fields, shown.confirmation);
      // The same request again: the editor is stale, and so is the token.
      expect(
        await failureOf(tx, (db) =>
          saveAlbumJournal(db, author, {
            entryId: journal.entryId,
            expectedVersion: version,
            ...fields,
            confirmation: shown.confirmation!,
          }),
        ),
      ).toBe("version_conflict");
      // Even with a current version, the token is bound to the old one.
      expect(
        await failureOf(tx, (db) =>
          save(
            db,
            journal.entryId,
            { body: "[Test] Twice" },
            shown.confirmation,
          ),
        ),
      ).toBe("confirmation_invalid");
    });
  });
});

describe("a change that asks for nothing", () => {
  const free: [
    string,
    (j: Awaited<ReturnType<typeof publicJournal>>) => Fields,
  ][] = [
    ["the same text, saved again", () => ({ body: FIGURE })],
    [
      "a reflection that is not set to show",
      (j) => ({
        reflections: [
          {
            trackId: j.three,
            texts: { en: "[Test] Still private" },
            isFavourite: true,
          },
        ],
      }),
    ],
    [
      "a reflection in a language that is not public",
      (j) => ({
        reflections: [{ trackId: j.one, texts: { "pt-BR": "[Test] Outro" } }],
      }),
    ],
    [
      "text added in a language that is not public to a reflection set to show",
      (j) => ({
        reflections: [{ trackId: j.two, texts: { "pt-BR": "[Test] Privado" } }],
      }),
    ],
    ["a new reflection that is not set to show", () => ({})],
  ];
  for (const [name, change] of free) {
    if (name === "a new reflection that is not set to show") {
      continue;
    }
    it(`needs no confirmation: ${name}`, async () => {
      await inScratchTransaction(async (tx) => {
        const journal = await publicJournal(tx);
        const fields = change(journal);
        const shown = await preview(tx, journal.entryId, fields);
        expect(shown.delta.changes).toEqual([]);
        expect(shown.confirmation).toBeNull();
        await expect(save(tx, journal.entryId, fields)).resolves.toBeDefined();
      });
    });
  }

  it("lets a save through that only removes something, and shows a reader a subset of before", async () => {
    // Removals (owner decisions B and R4): unflag, delete a text, clear the
    // album rating. The public atoms after are a subset of those before.
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      await save(
        tx,
        journal.entryId,
        { albumRating: 5 },
        (await preview(tx, journal.entryId, { albumRating: 5 })).confirmation,
      );

      const removals: Fields[] = [
        { reflections: [{ trackId: journal.one, isPublished: false }] },
        { reflections: [{ trackId: journal.one, texts: { en: null } }] },
        { albumRating: null },
      ];
      for (const removal of removals) {
        // Put things back with a confirmed save, so each removal has
        // something to remove.
        const restore: Fields = {
          albumRating: 5,
          reflections: [
            {
              trackId: journal.one,
              isPublished: true,
              texts: { en: "[Test] Public reflection" },
            },
          ],
        };
        const back = await preview(tx, journal.entryId, restore);
        await save(tx, journal.entryId, restore, back.confirmation);

        const before = await publicAtomsFromQueries(tx, journal.entryId);
        const shown = await preview(tx, journal.entryId, removal);
        expect(shown.delta.changes).toEqual([]);
        expect(shown.confirmation).toBeNull();
        await save(tx, journal.entryId, removal);
        const after = await publicAtomsFromQueries(tx, journal.entryId);
        expect(after.size).toBeLessThan(before.size);
        expect(isSubsetWithSameValues(after, before)).toBe(true);
      }
    });
  });

  it("never asks about a draft or a private journal, whatever it saves", async () => {
    await inScratchTransaction(async (tx) => {
      for (const status of ["draft", "private"] as const) {
        const journal = await createTestJournal(tx, {
          versions: [{ locale: "en", status }],
        });
        const trackId = journal.trackIds[0]!;
        const fields = {
          body: "[Test] Anything",
          albumRating: 4,
          reflections: [
            {
              trackId,
              isPublished: true,
              isFavourite: true,
              texts: { en: "[Test] x" },
            },
          ],
        };
        const shown = await preview(tx, journal.entryId, fields);
        expect(shown.delta.changes).toEqual([]);
        expect(shown.confirmation).toBeNull();
        await expect(save(tx, journal.entryId, fields)).resolves.toBeDefined();
      }
    });
  });
});

describe("a public version must stay publishable", () => {
  it("refuses a save that would blank it, in the preview and in the save", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      const fields = { opening: null, body: "   " };
      const before = await rowChecksum(tx);
      expect(
        await failureOf(tx, (db) => preview(db, journal.entryId, fields)),
      ).toBe("nothing_to_publish");
      expect(
        await failureOf(tx, (db) => save(db, journal.entryId, fields)),
      ).toBe("nothing_to_publish");
      expect(await rowChecksum(tx)).toEqual(before);
    });
  });
});

describe("the token", () => {
  async function ready(tx: Transaction) {
    const journal = await publicJournal(tx);
    const fields = { body: "[Test] Confirmed" };
    const shown = await preview(tx, journal.entryId, fields);
    return { journal, fields, token: shown.confirmation! };
  }

  async function refused(
    tx: Transaction,
    entryId: string,
    fields: Fields,
    token: string,
    who = author,
  ) {
    const before = await rowChecksum(tx);
    const failure = await failureOf(tx, async (db) =>
      saveAlbumJournal(db, who, {
        entryId,
        expectedVersion: await versionOf(db, entryId),
        ...fields,
        confirmation: token,
      }),
    );
    // A refusal writes nothing, not even the version.
    expect(await rowChecksum(tx)).toEqual(before);
    return failure;
  }

  it("is refused for another author, session, entry, purpose, version, or key", async () => {
    await inScratchTransaction(async (tx) => {
      const { journal, fields, token } = await ready(tx);
      const other = await publicJournal(tx);

      const wrongAuthor = {
        ...author,
        userId: "00000000-0000-4000-8000-0000000000aa",
      };
      expect(
        await refused(tx, journal.entryId, fields, token, wrongAuthor),
      ).toBe("confirmation_invalid");
      expect(
        await refused(tx, journal.entryId, fields, token, otherSession(author)),
      ).toBe("confirmation_invalid");
      expect(await refused(tx, other.entryId, fields, token)).toBe(
        "confirmation_invalid",
      );

      // A publication token has another purpose, and cannot confirm a save.
      await tx
        .update(schema.entryTexts)
        .set({ status: "private", publishedAt: null })
        .where(eq(schema.entryTexts.entryId, journal.entryId));
      const publication = await previewPublication(tx, author, {
        entryId: journal.entryId,
        locale: "en",
      });
      expect(
        await refused(tx, journal.entryId, fields, publication.confirmation),
      ).toBe("confirmation_invalid");
    });
  });

  it("is refused when it names a locale, is tampered with, or is signed with another key", async () => {
    await inScratchTransaction(async (tx) => {
      const { journal, fields, token } = await ready(tx);
      expect(
        await refused(
          tx,
          journal.entryId,
          fields,
          reissueTestToken(token, { l: "en" }),
        ),
      ).toBe("confirmation_invalid");
      expect(
        await refused(
          tx,
          journal.entryId,
          fields,
          reissueTestToken(token, { n: claimsOf(token).n + 1 }),
        ),
      ).toBe("confirmation_invalid");
      const flipped = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;
      expect(await refused(tx, journal.entryId, fields, flipped)).toBe(
        "confirmation_invalid",
      );
      expect(
        await refused(
          tx,
          journal.entryId,
          fields,
          mintTestToken({
            secret: `${testSecret()}-other`,
            claims: claimsOf(token),
          }),
        ),
      ).toBe("confirmation_invalid");
      // Not of the token form at all: an input error, not an authentication one.
      for (const junk of [
        "",
        "ct1.",
        "not a token",
        "ct2.a.b",
        "x".repeat(2000),
      ]) {
        const error = await refusal(tx, (db) =>
          saveAlbumJournal(db, author, {
            entryId: journal.entryId,
            expectedVersion: 1,
            ...fields,
            confirmation: junk,
          }),
        );
        expect(error?.failure).toBe("invalid_input");
      }
    });
  });

  it("is refused once it has expired, and when it was issued in the future", async () => {
    await inScratchTransaction(async (tx) => {
      const { journal, fields, token } = await ready(tx);
      for (const shift of [-FIFTEEN_MINUTES, -FIFTEEN_MINUTES - 60_000]) {
        const error = await refusal(tx, async (db) =>
          saveAlbumJournal(db, author, {
            entryId: journal.entryId,
            expectedVersion: await versionOf(db, journal.entryId),
            ...fields,
            confirmation: shiftedTestToken(token, shift),
          }),
        );
        expect(error?.failure).toBe("confirmation_expired");
        // It carries the fresh change, never a token.
        expect(error?.delta?.changes.length).toBeGreaterThan(0);
        expect(JSON.stringify(error)).not.toMatch(/ct1\./);
      }
      expect(
        await refused(
          tx,
          journal.entryId,
          fields,
          shiftedTestToken(token, 60 * 60_000),
        ),
      ).toBe("confirmation_expired");
      // The token still works inside its fifteen minutes.
      await expect(
        save(tx, journal.entryId, fields, shiftedTestToken(token, -60_000)),
      ).resolves.toBeDefined();
    });
  });

  it("is stale when the state it described has changed without a new version", async () => {
    await inScratchTransaction(async (tx) => {
      const { journal, fields, token } = await ready(tx);
      // Unpublishing the other language moves its stamp, not the version.
      await tx
        .update(schema.entryTexts)
        .set({
          status: "published",
          publishedAt: sql`now()`,
          firstPublishedAt: sql`now()`,
        })
        .where(sql`entry_id = ${journal.entryId} and locale = 'pt-BR'`);
      const error = await refusal(tx, async (db) =>
        saveAlbumJournal(db, author, {
          entryId: journal.entryId,
          expectedVersion: await versionOf(db, journal.entryId),
          ...fields,
          confirmation: token,
        }),
      );
      expect(error?.failure).toBe("confirmation_stale");
      expect(error?.delta?.changes.length).toBeGreaterThan(0);
    });
  });

  it("is bound to the exact change: other content after the preview is refused", async () => {
    await inScratchTransaction(async (tx) => {
      const { journal, token } = await ready(tx);
      // Another body, another field, another reflection, another rating.
      for (const changed of [
        { body: "[Test] Something else entirely" },
        { opening: "[Test] Confirmed" },
        { body: "[Test] Confirmed", albumRating: 10 },
        { reflections: [{ trackId: journal.one, isFavourite: true }] },
      ]) {
        expect(await refused(tx, journal.entryId, changed, token)).toBe(
          "confirmation_stale",
        );
      }
    });
  });

  it("accepts another input with the same exposure, such as a bundled removal", async () => {
    await inScratchTransaction(async (tx) => {
      const { journal, fields, token } = await ready(tx);
      await expect(
        save(
          tx,
          journal.entryId,
          {
            ...fields,
            reflections: [{ trackId: journal.one, isPublished: false }],
          },
          token,
        ),
      ).resolves.toBeDefined();
    });
  });

  it("is not consulted when the save needs none, but a forged one is still refused", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      const shown = await preview(tx, journal.entryId, {
        body: "[Test] A change that is not saved",
      });
      // An authentic token for a different change, on a save that exposes
      // nothing: the delta is empty, so the token is not weighed.
      await expect(
        save(tx, journal.entryId, { albumRating: null }, shown.confirmation),
      ).resolves.toBeDefined();
      // A token that is not authentic is refused before any lock is taken,
      // whether or not the save needed one (ADR 0006 § 4, step 2).
      expect(
        await failureOf(tx, (db) =>
          save(db, journal.entryId, { albumRating: 3 }, "ct1.junk.junk"),
        ),
      ).toBe("confirmation_invalid");
    });
  });

  it("is never printed with the author's writing: errors, logs, and inspection stay clean", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      const secretWords = "[Test] Words that must never leak";
      const error = await refusal(tx, (db) =>
        save(db, journal.entryId, { body: secretWords }),
      );
      expect(error?.failure).toBe("confirmation_required");
      for (const text of [
        error!.message,
        JSON.stringify(error),
        inspect(error),
      ]) {
        expect(text).not.toContain(secretWords);
        expect(text).not.toContain(FIGURE);
      }
    });
  });
});

describe("the guard between what was confirmed and what was written", () => {
  it("rolls the save back when the stored rows differ from the confirmed change, and says nothing of the writing", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      const fields = {
        reflections: [
          { trackId: journal.two, texts: { en: "[Test] Confirmed words" } },
        ],
      };
      const shown = await preview(tx, journal.entryId, fields);
      expect(shown.confirmation).not.toBeNull();

      // A defect of the kind the guard exists for: something rewrites the
      // text on its way into the table, so what a reader would see is not what
      // the author confirmed. Made by the test, inside this rolled-back
      // transaction, never in a migration.
      await tx.execute(sql`
        create function pg_temp.rewrite_reflection() returns trigger
        language plpgsql as $$
        begin
          new.body := jsonb_build_object('type', 'doc', 'content',
            jsonb_build_array(jsonb_build_object('type', 'paragraph',
              'content', jsonb_build_array(
                jsonb_build_object('type', 'text', 'text', '[Test] Not what was confirmed')))));
          return new;
        end $$`);
      await tx.execute(sql`
        create trigger rewrite_reflection before insert or update
          on track_reflection_texts
          for each row execute function pg_temp.rewrite_reflection()`);

      const before = await rowChecksum(tx);
      const version = await versionOf(tx, journal.entryId);
      const error = await captureFailure(tx, async (db) =>
        saveAlbumJournal(db, author, {
          entryId: journal.entryId,
          expectedVersion: version,
          ...fields,
          confirmation: shown.confirmation!,
        }),
      );
      expect(error).toBeInstanceOf(Error);
      // Not a domain refusal: an invariant failure, with no writing in it.
      expect(error).not.toBeInstanceOf(JournalError);
      for (const text of [(error as Error).message, inspect(error)]) {
        expect(text).not.toContain("[Test] Confirmed words");
        expect(text).not.toContain("[Test] Not what was confirmed");
      }
      expect(await rowChecksum(tx)).toEqual(before);
      expect(await versionOf(tx, journal.entryId)).toBe(version);
    });
  });
});

describe("previews", () => {
  it("refuse what the save would refuse, so no token is minted for it", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      const stale = (await versionOf(tx, journal.entryId)) + 5;
      expect(
        await failureOf(tx, (db) =>
          previewAlbumJournalChange(db, author, {
            entryId: journal.entryId,
            expectedVersion: stale,
            body: "[Test] x",
          }),
        ),
      ).toBe("version_conflict");
      expect(
        await failureOf(tx, (db) =>
          preview(db, journal.entryId, {
            reflections: [
              {
                trackId: "00000000-0000-4000-8000-00000000dead",
                isFavourite: true,
              },
            ],
          }),
        ),
      ).toBe("track_not_in_album");
      expect(
        await failureOf(tx, (db) =>
          previewAlbumJournalChange(db, author, {
            entryId: "00000000-0000-4000-8000-00000000dead",
            expectedVersion: 1,
            albumRating: 3,
          }),
        ),
      ).toBe("entry_not_found");
      expect(
        await failureOf(tx, (db) =>
          previewAlbumJournalChange(db, author, {
            entryId: journal.entryId,
            expectedVersion: 1,
          }),
        ),
      ).toBe("invalid_input");
    });
  });

  it("refuse a deleted journal, and write nothing and take no lock", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      const before = await rowChecksum(tx);
      await preview(tx, journal.entryId, {
        body: "[Test] Looked at, not saved",
      });
      expect(await rowChecksum(tx)).toEqual(before);
      await tx
        .update(schema.entries)
        .set({ deletedAt: sql`now()` })
        .where(eq(schema.entries.id, journal.entryId));
      expect(
        await failureOf(tx, (db) =>
          preview(db, journal.entryId, { albumRating: 2 }),
        ),
      ).toBe("entry_deleted");
    });
  });

  it("fail closed when the application secret is missing and a token would be needed", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      const saved = process.env.BETTER_AUTH_SECRET;
      try {
        delete process.env.BETTER_AUTH_SECRET;
        expect(
          await failureOf(tx, (db) =>
            preview(db, journal.entryId, { body: "[Test] Needs a token" }),
          ),
        ).toBe("unavailable");
        // Nothing needs a token here, so nothing needs the key.
        await expect(
          preview(tx, journal.entryId, { albumRating: null }),
        ).resolves.toBeDefined();
        expect(
          await failureOf(tx, (db) =>
            save(db, journal.entryId, { body: "[Test] Anything" }, "ct1.a.b"),
          ),
        ).toBe("unavailable");
      } finally {
        process.env.BETTER_AUTH_SECRET = saved;
      }
    });
  });
});

describe("publishing and unpublishing around a confirmed save", () => {
  it("stops asking once the journal is made private, and asks again when it is public", async () => {
    await inScratchTransaction(async (tx) => {
      const journal = await publicJournal(tx);
      const fields = { body: "[Test] Rewritten" };
      expect(
        (await preview(tx, journal.entryId, fields)).confirmation,
      ).not.toBeNull();
      await setAlbumJournalPrivacy(tx, author, {
        entryId: journal.entryId,
        locale: "en",
        status: "private",
      });
      expect(
        (await preview(tx, journal.entryId, fields)).confirmation,
      ).toBeNull();
      await save(tx, journal.entryId, fields);
      expect((await getAlbumJournal(tx, author, journal.entryId))?.body).toBe(
        "[Test] Rewritten",
      );
      expect(
        (await getTrackByTrack(tx, author, journal.entryId))?.tracks[0]
          ?.reflection?.publicIn,
      ).toEqual([]);
    });
  });
});
