import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  locales,
  type DatabaseExecutor,
  type Locale,
  type Transaction,
} from "@/db";
import {
  CONFIRMATION_VALIDITY_MS,
  confirmationAvailable,
  confirmationIsCurrent,
  MAX_CONFIRMATION_TOKEN_LENGTH,
  signConfirmation,
  verifyConfirmation,
  type AuthorizedAuthor,
  type VerifiedConfirmation,
} from "@/modules/identity";

import {
  disclosureOf,
  fingerprintOf,
  hasPublishableText,
  readPublishState,
  type PublishDisclosure,
  type PublishState,
} from "./disclosure";
import { PublicationError } from "./errors";
import { inSnapshot, lockEntry } from "./lock";

// Publishing (ADR 0006 §§ 2 to 4). Two operations and nothing else makes a
// language version public:
//
//   previewPublication        reads the disclosure and mints a token. Writes
//                             nothing, holds no lock.
//   publishLanguageVersion    makes the version public if, under the entry
//                             lock, the token is authentic, current, and
//                             matches the disclosure computed in that same
//                             transaction.
//
// The write of the status is `markVersionPublished`, which is not exported
// from this file, from commands.ts, or from the index, so no other module
// can publish without a token (ADR 0006 § 9).
//
// The token is evidence of a server-issued disclosure. It is never proof that
// the author read or acknowledged it, and nothing here may say so. A refusal
// returns the fresh disclosure and no token, so code that receives a refusal
// has nothing to retry with. Nothing here mints a token and consumes it.

const TOKEN_FORM = /^ct1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const previewInput = z.strictObject({
  entryId: z.uuid(),
  locale: z.enum(locales),
});

const publishInput = z.strictObject({
  entryId: z.uuid(),
  locale: z.enum(locales),
  // The `entries.version` the author's editor and preview were at.
  expectedVersion: z.number().int().min(1).max(2_147_483_647),
  // Absent is not an input error: it is `confirmation_required`, which
  // returns the disclosure to show. Present but malformed is `invalid_input`.
  confirmation: z
    .string()
    .max(MAX_CONFIRMATION_TOKEN_LENGTH)
    .regex(TOKEN_FORM)
    .optional(),
});

// The input is never echoed: a failure is a fixed code.
function parse<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new PublicationError("invalid_input");
  }
  return result.data;
}

export interface PublishPreview {
  disclosure: PublishDisclosure;
  /**
   * The confirmation token for exactly this disclosure, session, and
   * operation. It is valid for 15 minutes by the database clock. It goes only
   * to the confirmation dialog, and leaves it only from the confirm control.
   */
  confirmation: string;
  /** When the token stops being valid, in milliseconds since the epoch. */
  expiresAtMs: number;
}

// The rules every publication shares, in the order of ADR 0006 § 4 (steps 4
// to 7). `expectedVersion` is checked only where there is one.
function assertPublishable(state: PublishState, expectedVersion?: number) {
  if (state.deleted) {
    throw new PublicationError("entry_deleted");
  }
  if (expectedVersion !== undefined && state.entryVersion !== expectedVersion) {
    throw new PublicationError("version_conflict");
  }
  if (!hasPublishableText(state)) {
    throw new PublicationError("nothing_to_publish");
  }
  if (state.slug === null) {
    throw new PublicationError("no_current_slug");
  }
}

/**
 * Reads what publishing one language version would make public, and returns
 * it with a confirmation token (ADR 0006 § 2). Writes nothing and holds no
 * lock. The token is bound to the author's session, this entry, language, and
 * version, and to a fingerprint of the exact disclosure, so any change
 * before it is used makes it stale.
 *
 * Refused: `invalid_input`, `unavailable` (the secret is not configured),
 * `entry_not_found`, `version_not_found`, `entry_deleted`,
 * `nothing_to_publish`, `no_current_slug`.
 */
export async function previewPublication(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<PublishPreview> {
  const data = parse(previewInput, input);
  if (!confirmationAvailable()) {
    throw new PublicationError("unavailable");
  }
  const state = await inSnapshot(db, (executor) =>
    readPublishState(executor, data.entryId, data.locale),
  );
  assertPublishable(state);

  const disclosure = disclosureOf(state, data.entryId, data.locale);
  const signed = signConfirmation(author, {
    purpose: "publish",
    entryId: data.entryId,
    locale: data.locale,
    entryVersion: state.entryVersion,
    fingerprint: fingerprintOf(state, disclosure),
    issuedAtMs: state.nowMs,
  });
  if (!signed.ok) {
    throw new PublicationError("unavailable");
  }
  return {
    disclosure,
    confirmation: signed.token,
    expiresAtMs: state.nowMs + CONFIRMATION_VALIDITY_MS,
  };
}

/**
 * Publishes one language version (ADR 0006 § 4; ADR 0002, D3.2 and D4.1).
 * The only way to make a version public. Draft and Private take exactly the
 * same path, and an empty disclosure needs its token too.
 *
 * In one transaction, and a failed call writes nothing:
 *
 * 1. the input is validated (`invalid_input`);
 * 2. the key is available (`unavailable`) and the token, when present, is
 *    authentic and bound to this author's session, entry, language, and
 *    `expectedVersion` (`confirmation_invalid`), before any lock is taken;
 * 3. the entry row is locked (`entry_not_found`, `version_not_found`);
 * 4. a deleted entry is refused (`entry_deleted`);
 * 5. a stale editor is refused (`version_conflict`);
 * 6. a version with no non-whitespace opening or body is refused
 *    (`nothing_to_publish`);
 * 7. an entry without a current address is refused (`no_current_slug`);
 * 8. the disclosure and fingerprint are computed now, under the lock: no
 *    token is `confirmation_required`, an old one `confirmation_expired`
 *    (by the database clock, read after the lock was granted), one for
 *    another state `confirmation_stale`; each carries the fresh disclosure
 *    and no token;
 * 9. only then is anything written.
 *
 * Already public with a matching token: nothing is written and the result
 * is `changed: false`, so the token survives a repeated call until it
 * expires. Otherwise `published_at` becomes now; `first_published_at` is set
 * once and never overwritten, on the version and on the entry; the current
 * slug is marked as published so it stays reserved (ADR 0003). Track
 * reflections are not touched (ADR 0002, D5.2).
 */
export async function publishLanguageVersion(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<{ changed: boolean }> {
  const data = parse(publishInput, input);
  if (!confirmationAvailable()) {
    throw new PublicationError("unavailable");
  }

  // Pure computations: a forged token is refused before it holds a lock.
  let presented: VerifiedConfirmation | undefined;
  if (data.confirmation !== undefined) {
    const verified = verifyConfirmation(author, data.confirmation, {
      purpose: "publish",
      entryId: data.entryId,
      locale: data.locale,
      entryVersion: data.expectedVersion,
    });
    if (!verified.ok) {
      throw new PublicationError(
        verified.reason === "unavailable"
          ? "unavailable"
          : "confirmation_invalid",
      );
    }
    presented = verified.claims;
  }

  return db.transaction(async (tx) => {
    await lockEntry(tx, data.entryId);
    // Read after the lock was granted, so the database clock below is too.
    const state = await readPublishState(tx, data.entryId, data.locale);
    assertPublishable(state, data.expectedVersion);

    const disclosure = disclosureOf(state, data.entryId, data.locale);
    if (presented === undefined) {
      throw new PublicationError("confirmation_required", disclosure);
    }
    if (!confirmationIsCurrent(presented, state.nowMs)) {
      throw new PublicationError("confirmation_expired", disclosure);
    }
    if (presented.fingerprint !== fingerprintOf(state, disclosure)) {
      throw new PublicationError("confirmation_stale", disclosure);
    }

    if (state.status === "published") {
      return { changed: false };
    }
    await markVersionPublished(tx, data.entryId, data.locale);
    return { changed: true };
  });
}

// The only write of `published` in the application (ADR 0006 § 9). Not
// exported. Runs under the entry lock, after every check above.
async function markVersionPublished(
  tx: Transaction,
  entryId: string,
  locale: Locale,
): Promise<void> {
  const updated = await tx.execute(sql`
    update entry_texts
       set status = 'published',
           published_at = case when status = 'published'
                               then published_at else now() end,
           first_published_at = coalesce(first_published_at, now()),
           updated_at = now()
     where entry_id = ${entryId} and locale = ${locale}
    returning locale`);
  if (updated.rows.length === 0) {
    throw new PublicationError("version_not_found");
  }

  await tx.execute(sql`
    update entries
       set first_published_at = least(
             first_published_at,
             (select min(t.first_published_at)
                from entry_texts t
               where t.entry_id = ${entryId})),
           updated_at = now()
     where id = ${entryId}`);

  const marked = await tx.execute(sql`
    update entry_slugs
       set was_published = true
     where entry_id = ${entryId} and is_current
    returning slug`);
  if (marked.rows.length === 0) {
    throw new PublicationError("no_current_slug");
  }
}
