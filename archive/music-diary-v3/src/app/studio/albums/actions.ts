"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import {
  addTrackToAlbum,
  archiveAlbum,
  createAlbum,
  deleteAlbum,
  moveTrackInAlbum,
  removeAlbumArtwork,
  removeTrackFromAlbum,
  restoreAlbum,
  setAlbumArtwork,
  updateAlbum,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

// Server actions are public POST endpoints. Each one authorizes the request
// itself, first, then validates the input inside the domain command.

export async function createAlbumAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => createAlbum(authorization.author, input));
}

export async function updateAlbumAction(
  albumId: unknown,
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => updateAlbum(authorization.author, albumId, input));
}

export async function archiveAlbumAction(
  albumId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => archiveAlbum(authorization.author, albumId));
}

export async function restoreAlbumAction(
  albumId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => restoreAlbum(authorization.author, albumId));
}

export async function deleteAlbumAction(
  albumId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => deleteAlbum(authorization.author, albumId));
}

export async function addTrackToAlbumAction(
  albumId: unknown,
  trackId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => addTrackToAlbum(authorization.author, albumId, trackId));
}

export async function removeTrackFromAlbumAction(
  albumId: unknown,
  trackId: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() =>
    removeTrackFromAlbum(authorization.author, albumId, trackId),
  );
}

export async function moveTrackInAlbumAction(
  albumId: unknown,
  trackId: unknown,
  direction: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() =>
    moveTrackInAlbum(authorization.author, albumId, trackId, direction),
  );
}

// Artwork (M3.2): a front cover from the Cover Art Archive, chosen by the
// author, or none. Refused while a published journal shows the album (gate G8).

export async function setAlbumArtworkAction(
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => setAlbumArtwork(authorization.author, input));
}

export async function removeAlbumArtworkAction(
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => removeAlbumArtwork(authorization.author, input));
}
