"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import { authorizeAuthor } from "@/modules/identity";
import {
  createAlbumJournal,
  deleteAlbumJournal,
  publishAlbumJournalVersion,
  restoreAlbumJournal,
  saveAlbumJournal,
  setAlbumJournalPrivacy,
} from "@/modules/journals";

// Server actions are public POST endpoints. Each one authorizes the request
// itself, first, then runs its command through `perform` (which also requires
// the application's own Origin), and validates the input inside the domain
// command.
//
// Publication (ADR 0006): the confirmation token is minted only by the two
// preview actions (their own files, so nothing here can call one) and arrives
// here only in the request body, sent by the confirmation dialog's confirm
// control. Nothing in this file previews, mints, retries, or supplies a token.
// A restore from Recently deleted never publishes: a published version returns
// as private (docs/roadmap.md, owner-accepted restoration policy).

export async function createJournalAction(
  input: unknown,
): Promise<ActionResult<{ entryId: string; version: number }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => createAlbumJournal(authorization.author, input));
}

/**
 * Saves the journal. When the save would change what readers see of a public
 * journal it needs the `confirmation` that the change dialog sends, from a
 * separate preview request; without a valid one the command refuses and writes
 * nothing (ADR 0006 § 5). The token comes from the request body only.
 */
export async function saveJournalAction(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => saveAlbumJournal(authorization.author, input),
    "visibility",
  );
}

export async function setJournalPrivacyAction(
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => setAlbumJournalPrivacy(authorization.author, input),
    "visibility",
  );
}

export async function deleteJournalAction(
  entryId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => deleteAlbumJournal(authorization.author, entryId),
    "visibility",
  );
}

export async function restoreJournalAction(
  entryId: unknown,
): Promise<ActionResult<{ madePrivate: ("en" | "pt-BR")[] }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => restoreAlbumJournal(authorization.author, entryId),
    "visibility",
  );
}

/**
 * Publishes one language version with the confirmation token that a separate
 * preview request returned. The command, not this action, decides: it checks
 * the token, the version, and the disclosure under the entry lock (ADR 0006
 * § 4). Reports success only after the database commit.
 */
export async function publishJournalVersionAction(
  input: unknown,
): Promise<ActionResult<{ changed: boolean }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => publishAlbumJournalVersion(authorization.author, input),
    "visibility",
  );
}
