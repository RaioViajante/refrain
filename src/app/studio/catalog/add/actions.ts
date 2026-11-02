"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import {
  importMusicArtist,
  importMusicRelease,
  linkAlbumToMusic,
  linkArtistToMusic,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

// Add music (M3.2). Server actions are public POST endpoints: each one
// authorizes the request itself, first. The command then fetches the record
// from MusicBrainz again, before any transaction, and writes only what the
// author reviewed (the `review` fingerprint). The browser never sends catalog
// data, only identifiers and the fingerprint.

export async function importMusicReleaseAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => importMusicRelease(authorization.author, input));
}

export async function linkAlbumToMusicAction(
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => linkAlbumToMusic(authorization.author, input));
}

export async function importMusicArtistAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => importMusicArtist(authorization.author, input));
}

export async function linkArtistToMusicAction(
  input: unknown,
): Promise<ActionResult> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(() => linkArtistToMusic(authorization.author, input));
}
