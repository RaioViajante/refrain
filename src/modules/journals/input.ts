import { z } from "zod";

import { locales } from "@/db";
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

export const saveAlbumJournalInput = z
  .object({
    entryId: z.uuid(),
    // The `entries.version` the editor loaded.
    expectedVersion: z.number().int().min(1).max(2_147_483_647),
    opening,
    body,
  })
  .partial({ opening: true, body: true })
  .refine((save) => save.opening !== undefined || save.body !== undefined);
export type SaveAlbumJournalInput = z.input<typeof saveAlbumJournalInput>;

/** Only `draft` and `private`: nothing here can publish (ADR 0002, D4.1). */
export const journalPrivacyStatuses = ["draft", "private"] as const;

export const journalPrivacyInput = z.object({
  entryId: z.uuid(),
  locale: z.enum(locales),
  status: z.enum(journalPrivacyStatuses),
});
export type JournalPrivacyInput = z.input<typeof journalPrivacyInput>;

export const journalId = z.uuid();
