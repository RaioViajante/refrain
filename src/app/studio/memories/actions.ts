"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import { authorizeAuthor } from "@/modules/identity";
import {
  createMemory,
  deleteMemory,
  restoreMemory,
  saveMemory,
  setMemoryPrivacy,
} from "@/modules/journals";

// The memory editor's server actions (M3.6). Server actions are public POST
// endpoints: each one authorizes the request itself, first, then runs its
// command through `perform` (which also requires the application's own
// Origin), and the domain command validates the input.
//
// There is no memory preview or publish action, and nothing here takes a
// confirmation token: publishing a memory is M3.7. A save of a memory with a
// published version is refused by the command, and a restore never publishes.

export async function createMemoryAction(
  input: unknown,
): Promise<ActionResult<{ entryId: string; version: number }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => createMemory(authorization.author, input));
}

/** Saves the title, the "when", the writing, and the ordered recordings. */
export async function saveMemoryAction(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => saveMemory(authorization.author, input));
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
