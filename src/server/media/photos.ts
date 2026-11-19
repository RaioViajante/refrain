// Photographs are stored in PostgreSQL (image_files) and served only by
// src/app/fotos/[id]/route.ts, which asks this module what to answer.
import "server-only";

import { eq, sql } from "drizzle-orm";

import { imageFiles } from "@/db/schema";
import type { Database } from "@/db/types";

import { photoIsPublic } from "../visibility";

/** The application's URL for a photograph. */
export function photoUrl(id: string): string {
  return `/fotos/${id}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Public photos may be stored by browsers but must be revalidated on every
 * use (a cheap 304 when nothing changed), and no shared cache (Vercel's CDN,
 * an image optimizer) keeps them: whether a photo is public is decided again
 * on every request, so a revocation or an unpublished tape takes effect at
 * once, everywhere.
 */
export const PUBLIC_PHOTO_CACHE = "public, no-cache";
export const PRIVATE_PHOTO_CACHE = "private, no-store";
/** Tells Vercel's CDN (and any other CDN) never to store a photo response. */
export const CDN_NO_STORE = {
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
} as const;

/** A photo's bytes never change (a new upload is a new id). */
export function photoEtag(id: string): string {
  return `"${id}"`;
}

export type PhotoResponse =
  | { status: 404 }
  | { status: 304; cacheControl: string; etag: string }
  | {
      status: 200;
      bytes: Buffer;
      contentType: string;
      cacheControl: string;
      etag: string;
    };

/**
 * What to answer for /fotos/<id>: the bytes to anyone when the photo is
 * public, to the signed-in owner always, and 404 otherwise (never revealing
 * whether a private photo exists).
 */
export async function resolvePhoto(
  db: Database,
  id: string,
  signedIn: boolean,
  ifNoneMatch?: string | null,
): Promise<PhotoResponse> {
  if (!UUID.test(id)) return { status: 404 };
  // The decision first, without the bytes.
  const [meta] = await db
    .select({ isPublic: sql<boolean>`${photoIsPublic(id)}` })
    .from(imageFiles)
    .where(eq(imageFiles.imageId, id))
    .limit(1);
  if (!meta || (!meta.isPublic && !signedIn)) return { status: 404 };
  const cacheControl = meta.isPublic ? PUBLIC_PHOTO_CACHE : PRIVATE_PHOTO_CACHE;
  const etag = photoEtag(id);
  if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === etag)) {
    return { status: 304, cacheControl, etag };
  }
  const [file] = await db
    .select({ bytes: imageFiles.bytes, contentType: imageFiles.contentType })
    .from(imageFiles)
    .where(eq(imageFiles.imageId, id))
    .limit(1);
  if (!file) return { status: 404 };
  return {
    status: 200,
    bytes: file.bytes,
    contentType: file.contentType,
    cacheControl,
    etag,
  };
}
