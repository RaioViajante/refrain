"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import {
  archiveArtist,
  createArtist,
  deleteArtist,
  removeArtistPhoto,
  restoreArtist,
  setArtistPhoto,
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

// An artist's photograph (M3.3): a Wikimedia Commons file the author
// reviewed and chose, or none. The command asks Commons again, and refuses a
// change to a photograph the author did not see.

export async function setArtistPhotoAction(
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => setArtistPhoto(authorization.author, input));
}

export async function removeArtistPhotoAction(
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => removeArtistPhoto(authorization.author, input));
}
