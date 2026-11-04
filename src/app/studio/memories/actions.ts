"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import { authorizeAuthor } from "@/modules/identity";
import {
  createMemory,
  deleteMemory,
  publishMemoryVersion,
  restoreMemory,
  saveMemory,
  setMemoryPrivacy,
} from "@/modules/journals";

// The memory editor's server actions (M3.6, M3.7). Server actions are public
// POST endpoints: each one authorizes the request itself, first, then runs its
// command through `perform` (which also requires the application's own
// Origin), and the domain command validates the input.
//
// Publication (ADR 0006): the confirmation token is minted only by the two
// memory preview actions (their own files, so nothing here can call one) and
// arrives here only in the request body, sent by a confirmation dialog's
// confirm control. Nothing in this file previews, mints, retries, or supplies
// a token. A restore never publishes.

export async function createMemoryAction(
  input: unknown,
): Promise<ActionResult<{ entryId: string; version: number }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => createMemory(authorization.author, input));
}

/**
 * Saves the title, the "when", the writing, and the ordered recordings. When
 * the save would change what readers see of a published memory it needs the
 * `confirmation` that the change dialog sends, from a separate preview
 * request; without a valid one the command refuses and writes nothing (ADR
 * 0006 § 5). The token comes from the request body only.
 */
export async function saveMemoryAction(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => saveMemory(authorization.author, input), "visibility");
}

/** Draft or private only: nothing here can publish. */
export async function setMemoryPrivacyAction(
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => setMemoryPrivacy(authorization.author, input),
    "visibility",
  );
}

export async function deleteMemoryAction(
  entryId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => deleteMemory(authorization.author, entryId),
    "visibility",
  );
}

export async function restoreMemoryAction(
  entryId: unknown,
): Promise<ActionResult<{ madePrivate: ("en" | "pt-BR")[] }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => restoreMemory(authorization.author, entryId),
    "visibility",
  );
}

/**
 * Publishes the memory's version with the confirmation token that a separate
 * preview request returned. The command, not this action, decides: it checks
 * the token, the version, and the disclosure under the entry lock (ADR 0006
 * § 4). Reports success only after the database commit.
 */
export async function publishMemoryVersionAction(
  input: unknown,
): Promise<ActionResult<{ changed: boolean }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => publishMemoryVersion(authorization.author, input),
    "visibility",
  );
}
