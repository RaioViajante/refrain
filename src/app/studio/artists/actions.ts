"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import {
  archiveArtist,
  createArtist,
  deleteArtist,
  restoreArtist,
  updateArtist,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

// Server actions are public POST endpoints. Each one authorizes the request
// itself, first, then validates the input inside the domain command.

export async function createArtistAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => createArtist(authorization.author, input));
}

export async function updateArtistAction(
  artistId: unknown,
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => updateArtist(authorization.author, artistId, input));
}

export async function archiveArtistAction(
  artistId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => archiveArtist(authorization.author, artistId));
}

export async function restoreArtistAction(
  artistId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => restoreArtist(authorization.author, artistId));
}

export async function deleteArtistAction(
  artistId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => deleteArtist(authorization.author, artistId));
}
