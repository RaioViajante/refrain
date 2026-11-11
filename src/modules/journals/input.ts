import { z } from "zod";

import { locales } from "@/db";
import { MAX_CONFIRMATION_TOKEN_LENGTH } from "@/modules/identity";
import { cleanText } from "@/validation";

import { normalizeBodyText } from "./body";

// Input schemas for the journal commands. They run inside the commands. The
// writing is plain text here; the command stores it as the accepted document
// format (./body.ts). Unknown keys are dropped, so a client cannot set
// visibility, version, featured state, or ids the schema does not name.

export const MAX_OPENING_LENGTH = 300;
export const MAX_BODY_LENGTH = 100_000;

// The contract is the catalog's (src/modules/catalog/input.ts): a create takes
// the whole record, and a save is a patch. A field left out of a save is
// unchanged. A field that is present replaces the stored one; clearing the
// opening sentence or the reflection is done on purpose with `null` or a blank
// string. A save that names neither is refused, so the author's text can never
// disappear because an unrelated field was updated.

/** The opening sentence: one line; `null` or blank clears it. */
const opening = z
  .string()
  .transform((value) =>
    cleanText(value)
      .replace(/\s*\n\s*/g, " ")
      .trim(),
  )
  .pipe(z.string().max(MAX_OPENING_LENGTH))
  .transform((value) => (value === "" ? null : value))
  .nullable();

/** The reflection, in canonical form (see `normalizeBodyText`); `null` or blank clears it. */
const body = z
  .string()
  .transform(normalizeBodyText)
  .pipe(z.string().max(MAX_BODY_LENGTH))
  .nullable();

export const createAlbumJournalInput = z.object({
  albumId: z.uuid(),
  // The language the journal is written in. It is recorded once and never
  // translated automatically (ADR 0002, D3).
  locale: z.enum(locales),
  opening: opening.optional().transform((value) => value ?? null),
  body: body.optional().transform((value) => value ?? ""),
});
export type CreateAlbumJournalInput = z.input<typeof createAlbumJournalInput>;

// A reflection on one track is plain text, like the journal's own. It is
// shorter than a whole-album reflection, and a blank text removes it.
export const MAX_REFLECTION_LENGTH = 20_000;
export const MAX_REFLECTIONS_PER_SAVE = 500;

// Unicode white space only, and the zero-width characters that render as
// nothing, is blank (ADR 0006 § 4, step 6): a text row always means text.
const INVISIBLE_ONLY = /^[\p{White_Space}\u200B-\u200D\u2060\uFEFF]*$/u;

const reflectionText = z
  .string()
  .transform(normalizeBodyText)
  .pipe(z.string().max(MAX_REFLECTION_LENGTH))
  .transform((value) => (INVISIBLE_ONLY.test(value) ? null : value))
  .nullable();

/** A rating in half steps (docs/data-model.md § Ratings): 1 to 10, `null` clears. */
const ratingHalfSteps = z.number().int().min(1).max(10).nullable();

/**
 * What changes on one track's reflection. A field left out is unchanged. The
 * language of a text is the key it is under, so one language is never written
 * into another. A blank text, or `null`, removes the text in that language and
 * nothing else.
 */
const reflectionInput = z
  .strictObject({
    trackId: z.uuid(),
    // The author's explicit permission to show it publicly. On its own it
    // makes nothing public (ADR 0002, D5.2).
    isPublished: z.boolean().optional(),
    isStillWriting: z.boolean().optional(),
    isFavourite: z.boolean().optional(),
    ratingHalfSteps: ratingHalfSteps.optional(),
    texts: z
      .strictObject({
        en: reflectionText.optional(),
        "pt-BR": reflectionText.optional(),
      })
      .optional(),
  })
  .refine(
    (reflection) =>
      Object.keys(reflection).some((key) => key !== "trackId") &&
      (reflection.texts === undefined ||
        Object.values(reflection.texts).some((text) => text !== undefined)),
  );

/** The `ct1` form; the token is authenticated later (ADR 0006 § 3). */
const TOKEN_FORM = /^ct1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const saveAlbumJournalInput = z
  .object({
    entryId: z.uuid(),
    // The `entries.version` the editor loaded.
    expectedVersion: z.number().int().min(1).max(2_147_483_647),
    opening,
    body,
    // The album rating, independent of every track rating; `null` clears it.
    albumRating: ratingHalfSteps,
    reflections: z
      .array(reflectionInput)
      .max(MAX_REFLECTIONS_PER_SAVE)
      .refine(
        (list) =>
          new Set(list.map((item) => item.trackId)).size === list.length,
      ),
    // The language versions the author's editor showed as published (issue
    // #54). When it is given and the journal's published versions are no
    // longer exactly these (another tab published or unpublished one), the
    // save, and its preview, are refused as `status_changed`: a removal from
    // a public page needs no token, and the interface must ask first (ADR
    // 0006 § 5), which an editor that believes nothing is public cannot do.
    // The same guard as a memory's `expectedStatus` (M3.7).
    expectedPublished: z
      .array(z.enum(locales))
      .max(locales.length)
      .refine((list) => new Set(list).size === list.length),
    // Needed only when the save changes what a reader sees of a public
    // journal. It comes from the confirmation dialog and nowhere else.
    confirmation: z
      .string()
      .max(MAX_CONFIRMATION_TOKEN_LENGTH)
      .regex(TOKEN_FORM),
  })
  .partial({
    opening: true,
    body: true,
    albumRating: true,
    reflections: true,
    expectedPublished: true,
    confirmation: true,
  })
  .refine(
    (save) =>
      save.opening !== undefined ||
      save.body !== undefined ||
      save.albumRating !== undefined ||
      (save.reflections !== undefined && save.reflections.length > 0),
  );
export type SaveAlbumJournalInput = z.input<typeof saveAlbumJournalInput>;

/** Only `draft` and `private`: nothing here can publish (ADR 0002, D4.1). */
export const journalPrivacyStatuses = ["draft", "private"] as const;

export const journalPrivacyInput = z.object({
  entryId: z.uuid(),
  locale: z.enum(locales),
  status: z.enum(journalPrivacyStatuses),
  // The status the author's screen showed. The change is applied only if the
  // version still has it, so a stale tab cannot silently undo what another
  // tab did (it could unpublish a version that was published meanwhile).
  expectedStatus: z.enum(["draft", "private", "published"]),
});
export type JournalPrivacyInput = z.input<typeof journalPrivacyInput>;

export const journalId = z.uuid();

// ---------------------------------------------------------------------------
// Memories (M3.6)
//
// A memory is titled writing, an optional free-text "when", and an ordered
// list of recordings from the catalog. It has no rating and no favourite, and
// it never touches an album journal or its track reflections.
//
// Owner decisions for M3.6: the recording list holds catalog recordings only
// (`memory_music.track_id`). M3.6 also limited a memory to English; by the
// owner's decision of 2026-11-10 (ADR 0008 § 10) a memory may be written
// originally in English or Brazilian Portuguese. Nothing is translated.

export const MAX_MEMORY_TITLE_LENGTH = 200;
export const MAX_REMEMBERED_WHEN_LENGTH = 200;
export const MAX_MEMORY_RECORDINGS = 50;

/** The memory's title: one line, never blank (docs/data-model.md). */
const memoryTitle = z
  .string()
  .transform((value) =>
    cleanText(value)
      .replace(/\s*\n\s*/g, " ")
      .trim(),
  )
  .pipe(z.string().min(1).max(MAX_MEMORY_TITLE_LENGTH));

/** "A date, a season, a year": one line; `null` or blank clears it. */
const rememberedWhen = z
  .string()
  .transform((value) =>
    cleanText(value)
      .replace(/\s*\n\s*/g, " ")
      .trim(),
  )
  .pipe(z.string().max(MAX_REMEMBERED_WHEN_LENGTH))
  .transform((value) => (value === "" ? null : value))
  .nullable();

/**
 * The ordered recordings, by catalog id. The order is the list's order, and a
 * recording appears at most once (also a database constraint).
 */
const recordingIds = z
  // Lower case, as the database returns ids, so that the same recording
  // spelled in upper case is the same link, and a duplicate however spelled.
  .array(z.uuid().transform((id) => id.toLowerCase()))
  .max(MAX_MEMORY_RECORDINGS)
  .refine((list) => new Set(list).size === list.length, {
    message: "duplicate",
  });

export const createMemoryInput = z.object({
  // The language the memory is written in (ADR 0008 § 10), validated against
  // the existing enum. Recorded once as the original language and never
  // converted. Left out, it is English, as before.
  locale: z.enum(locales).optional().default("en"),
  title: memoryTitle,
  rememberedWhen: rememberedWhen.optional().transform((value) => value ?? null),
  body: body.optional().transform((value) => value ?? ""),
  trackIds: recordingIds.optional().default([]),
});
export type CreateMemoryInput = z.input<typeof createMemoryInput>;

export const saveMemoryInput = z
  .object({
    entryId: z.uuid(),
    // The `entries.version` the editor loaded.
    expectedVersion: z.number().int().min(1).max(2_147_483_647),
    title: memoryTitle,
    rememberedWhen,
    body,
    // The whole ordered list: what is left out is unlinked, never deleted
    // from the catalog.
    trackIds: recordingIds,
    // The status the author's editor showed (M3.7). When it is given and the
    // memory's status is no longer it (another tab published or unpublished
    // it), the save is refused as `status_changed`: a removal from a public
    // memory needs no token, and the interface must ask first (ADR 0006
    // § 5), which an editor that believes the memory private cannot do.
    expectedStatus: z.enum(["draft", "private", "published"]),
    // Needed only when the save changes what a reader sees of a public
    // memory (M3.7). It comes from the confirmation dialog and nowhere else.
    confirmation: z
      .string()
      .max(MAX_CONFIRMATION_TOKEN_LENGTH)
      .regex(TOKEN_FORM),
  })
  .partial({
    title: true,
    rememberedWhen: true,
    body: true,
    trackIds: true,
    expectedStatus: true,
    confirmation: true,
  })
  .refine(
    (save) =>
      save.title !== undefined ||
      save.rememberedWhen !== undefined ||
      save.body !== undefined ||
      save.trackIds !== undefined,
  );
export type SaveMemoryInput = z.input<typeof saveMemoryInput>;
