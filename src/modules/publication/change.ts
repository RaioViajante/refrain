import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { DatabaseExecutor, Transaction } from "@/db";
import {
  CONFIRMATION_VALIDITY_MS,
  confirmationAvailable,
  confirmationIsCurrent,
  signConfirmation,
  verifyConfirmation,
  type AuthorizedAuthor,
  type VerifiedConfirmation,
} from "@/modules/identity";

import { canonicalJson } from "./disclosure";
import { PublicationError } from "./errors";
import { inSnapshot } from "./lock";
import {
  applyChange,
  exposureDelta,
  publicAtoms,
  publicVersionsStayPublishable,
  readEntrySurface,
  samePublicAtoms,
  type EntrySurface,
  type ProposedChange,
  type PublicChangeDelta,
} from "./surface";

// Changes to a public journal (ADR 0006 § 5). Two operations:
//
//   previewPublicChange         computes the exposure delta of a proposed save
//                               and, when there is one, mints a `change_public`
//                               token for exactly that delta. Writes nothing
//                               and holds no lock.
//   requirePublicChangeConfirmation
//                               runs inside the save, under the entry lock,
//                               before anything is written: with a delta, the
//                               token must be authentic, current, and bound to
//                               the delta computed in that same transaction.
//
// The token is evidence of a server-issued delta, never proof that the author
// read it (ADR 0006 § 3). A refusal returns the fresh delta and no token, so
// the code that receives one has nothing to retry with. Nothing here mints a
// token and consumes it.

const bindingInput = z.strictObject({
  entryId: z.uuid(),
  expectedVersion: z.number().int().min(1).max(2_147_483_647),
});

function parseBinding(input: { entryId: string; expectedVersion: number }) {
  const result = bindingInput.safeParse({
    entryId: input.entryId,
    expectedVersion: input.expectedVersion,
  });
  if (!result.success) {
    throw new PublicationError("invalid_input");
  }
  return result.data;
}

export interface PublicChangePreview {
  delta: PublicChangeDelta;
  /**
   * The confirmation token for exactly this delta, session, and operation, or
   * `null` when the change touches nothing a reader can see and needs none.
   * It goes only to the confirmation dialog, and leaves it only from the
   * confirm control.
   */
  confirmation: string | null;
  /** When the token stops being valid, in milliseconds since the epoch. */
  expiresAtMs: number | null;
}

/**
 * The state fingerprint of a change (ADR 0006 § 3): the entry, the operation,
 * `entries.version`, the stamp (`entries.updated_at` and every language
 * version's status and `updated_at`), and the exposure delta with the old and
 * new value of each atom. A different input with the same delta validates,
 * which is harmless: what is bound is what becomes public.
 */
function changeFingerprint(
  before: EntrySurface,
  delta: PublicChangeDelta,
): string {
  const material = {
    entryId: delta.entryId,
    operation: "change_public",
    entryVersion: delta.entryVersion,
    stamp: {
      entryUpdatedAt: before.updatedAt,
      versions: before.versions.map((version) => ({
        locale: version.locale,
        status: version.status,
        updatedAt: version.updatedAt,
      })),
    },
    changes: delta.changes.map((change) => ({
      atom: change.atom,
      kind: change.kind,
      before: change.before ?? null,
      after: change.after,
    })),
  };
  return hash(canonicalJson(material));
}

function hash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64url");
}

// The checks the preview and the save share, in the order of ADR 0006 § 4:
// deleted, stale editor, a public version left with nothing to publish.
function evaluate(
  before: EntrySurface,
  expectedVersion: number,
  change: ProposedChange,
) {
  if (before.deleted) {
    throw new PublicationError("entry_deleted");
  }
  if (before.version !== expectedVersion) {
    throw new PublicationError("version_conflict");
  }
  const predicted = applyChange(before, change);
  if (!publicVersionsStayPublishable(predicted, change)) {
    throw new PublicationError("nothing_to_publish");
  }
  const delta: PublicChangeDelta = {
    entryId: before.entryId,
    entryVersion: before.version,
    changes: exposureDelta(publicAtoms(before), publicAtoms(predicted)),
  };
  return { predicted, delta };
}

/**
 * Computes what a proposed save would change on the public page and, if
 * anything, returns a token for exactly that (ADR 0006 § 5). Takes the same
 * pre-checks and refusals as the save (`entry_deleted`, `version_conflict`,
 * `nothing_to_publish`), so it never mints a token for a request the save
 * would refuse. Writes nothing, holds no lock.
 *
 * `change` is already validated and normalized by the Journals module.
 */
export async function previewPublicChange(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: { entryId: string; expectedVersion: number; change: ProposedChange },
): Promise<PublicChangePreview> {
  const binding = parseBinding(input);
  const before = await inSnapshot(db, (executor) =>
    readEntrySurface(executor, binding.entryId),
  );
  const { delta } = evaluate(before, binding.expectedVersion, input.change);
  if (delta.changes.length === 0) {
    return { delta, confirmation: null, expiresAtMs: null };
  }
  if (!confirmationAvailable()) {
    throw new PublicationError("unavailable");
  }
  const signed = signConfirmation(author, {
    purpose: "change_public",
    entryId: binding.entryId,
    entryVersion: before.version,
    fingerprint: changeFingerprint(before, delta),
    issuedAtMs: before.nowMs,
  });
  if (!signed.ok) {
    throw new PublicationError("unavailable");
  }
  return {
    delta,
    confirmation: signed.token,
    expiresAtMs: before.nowMs + CONFIRMATION_VALIDITY_MS,
  };
}

/**
 * Authenticates a `change_public` token before any lock is taken (ADR 0006
 * § 4, steps 1 and 2): the key is available, the MAC is valid, and the token
 * is bound to this author's session, this entry, and `expectedVersion`. A pure
 * computation, so a forged token never holds the entry lock. Expiry and the
 * delta are checked later, under the lock.
 */
export function verifyChangeConfirmation(
  author: AuthorizedAuthor,
  token: string,
  input: { entryId: string; expectedVersion: number },
): VerifiedConfirmation {
  const binding = parseBinding(input);
  const verified = verifyConfirmation(author, token, {
    purpose: "change_public",
    entryId: binding.entryId,
    entryVersion: binding.expectedVersion,
  });
  if (!verified.ok) {
    throw new PublicationError(
      verified.reason === "unavailable"
        ? "unavailable"
        : "confirmation_invalid",
    );
  }
  return verified.claims;
}

/**
 * The gate of a save, called by the Journals module inside its transaction
 * after the entry lock was granted and before anything is written. It reads
 * the locked rows, predicts the rows after the change, and computes the
 * exposure delta:
 *
 * - no delta: the save may proceed, and a token that was supplied is ignored
 *   unread;
 * - a delta and no token: `confirmation_required`;
 * - an old token (by the database clock, read after the lock): `confirmation_expired`;
 * - a token for another delta or state: `confirmation_stale`;
 * - each of those three carries the fresh delta and no token, and writes nothing.
 *
 * Also refuses a deleted entry, a stale `expectedVersion`, and a save that
 * would leave a public version with nothing to publish. Returns the predicted
 * rows, which `assertWrittenAsPredicted` compares with what was written.
 */
export async function requirePublicChangeConfirmation(
  tx: Transaction,
  _author: AuthorizedAuthor,
  input: {
    entryId: string;
    expectedVersion: number;
    change: ProposedChange;
    confirmation?: VerifiedConfirmation;
  },
): Promise<{ predicted: EntrySurface; delta: PublicChangeDelta }> {
  const binding = parseBinding(input);
  const before = await readEntrySurface(tx, binding.entryId);
  const { predicted, delta } = evaluate(
    before,
    binding.expectedVersion,
    input.change,
  );
  if (delta.changes.length === 0) {
    return { predicted, delta };
  }
  const presented = input.confirmation;
  if (presented === undefined) {
    throw new PublicationError("confirmation_required", undefined, delta);
  }
  if (!confirmationIsCurrent(presented, before.nowMs)) {
    throw new PublicationError("confirmation_expired", undefined, delta);
  }
  if (presented.fingerprint !== changeFingerprint(before, delta)) {
    throw new PublicationError("confirmation_stale", undefined, delta);
  }
  return { predicted, delta };
}

/**
 * After the save wrote its rows, and still inside its transaction, reads them
 * again and checks that a reader would see exactly what was predicted and
 * confirmed. A difference means the prediction and the write disagree: the
 * transaction is rolled back, nothing becomes public, and nothing of the
 * writing is in the error.
 */
export async function assertWrittenAsPredicted(
  tx: Transaction,
  predicted: EntrySurface,
): Promise<void> {
  const written = await readEntrySurface(tx, predicted.entryId);
  if (!samePublicAtoms(written, predicted)) {
    throw new Error(
      "The saved rows do not match the confirmed public change; the save was rolled back.",
    );
  }
}
