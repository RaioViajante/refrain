"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import { authorizeAuthor } from "@/modules/identity";
import {
  createAlbumJournal,
  deleteAlbumJournal,
  restoreAlbumJournal,
  saveAlbumJournal,
  setAlbumJournalPrivacy,
} from "@/modules/journals";

// Server actions are public POST endpoints. Each one authorizes the request
// itself, first, then validates the input inside the domain command. Nothing
// here publishes: the only visibility change offered reaches `draft` or
// `private`, and the command refuses anything else. Restoring a journal from
// Recently deleted never publishes either: a published version returns as
// private (docs/roadmap.md, owner-accepted restoration policy).

export async function createJournalAction(
  input: unknown,
): Promise<ActionResult<{ entryId: string; version: number }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => createAlbumJournal(authorization.author, input));
}

// Interim, fail closed (ADR 0006 § 5; M2.3 builds the dialogs). A save that
// would change what readers see of a published journal needs a confirmation
// token that only the confirmation dialog may send, and no dialog exists yet.
// So this action never forwards a `confirmation` from the request: the domain
// command then refuses such a save and writes nothing. Nothing here previews,
// mints, or supplies a token.
function withoutConfirmation(input: unknown): unknown {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const rest: Record<string, unknown> = { ...input };
    delete rest.confirmation;
    return rest;
  }
  return input;
}

export async function saveJournalAction(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() =>
    saveAlbumJournal(authorization.author, withoutConfirmation(input)),
  );
}

export async function setJournalPrivacyAction(
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => setAlbumJournalPrivacy(authorization.author, input));
}

export async function deleteJournalAction(
  entryId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => deleteAlbumJournal(authorization.author, entryId));
}

export async function restoreJournalAction(
  entryId: unknown,
): Promise<ActionResult<{ madePrivate: ("en" | "pt-BR")[] }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => restoreAlbumJournal(authorization.author, entryId));
}
