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

/** The opening sentence: one line; blank becomes `null`. */
const opening = z
  .string()
  .nullish()
  .transform((value) =>
    value == null
      ? null
      : cleanText(value)
          .replace(/\s*\n\s*/g, " ")
          .trim(),
  )
  .pipe(z.string().max(MAX_OPENING_LENGTH).nullable())
  .transform((value) => (value === "" ? null : value));

/** The reflection, in canonical form (see `normalizeBodyText`). */
const body = z
  .string()
  .nullish()
  .transform((value) => normalizeBodyText(value ?? ""))
  .pipe(z.string().max(MAX_BODY_LENGTH));

export const createAlbumJournalInput = z.object({
  albumId: z.uuid(),
  // The language the journal is written in. It is recorded once and never
  // translated automatically (ADR 0002, D3).
  locale: z.enum(locales),
  opening,
  body,
});
export type CreateAlbumJournalInput = z.input<typeof createAlbumJournalInput>;

export const saveAlbumJournalInput = z.object({
  entryId: z.uuid(),
  // The `entries.version` the editor loaded.
  expectedVersion: z.number().int().min(1).max(2_147_483_647),
  opening,
  body,
});
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
