"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import {
  archiveTrack,
  createTrack,
  deleteTrack,
  restoreTrack,
  updateTrack,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

// Server actions are public POST endpoints. Each one authorizes the request
// itself, first, then validates the input inside the domain command.

export async function createTrackAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => createTrack(authorization.author, input));
}

export async function updateTrackAction(
  trackId: unknown,
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => updateTrack(authorization.author, trackId, input));
}

export async function archiveTrackAction(
  trackId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => archiveTrack(authorization.author, trackId));
}

export async function restoreTrackAction(
  trackId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => restoreTrack(authorization.author, trackId));
}

export async function deleteTrackAction(
  trackId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => deleteTrack(authorization.author, trackId));
}
