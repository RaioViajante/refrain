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

/** Public photos: browsers and the image optimizer keep them at most 60 s,
 *  so a revocation reaches every cache within a minute; the CDN keeps none. */
export const PUBLIC_PHOTO_CACHE = "public, max-age=60, must-revalidate";
export const PRIVATE_PHOTO_CACHE = "private, no-store";

export type PhotoResponse =
  | { status: 404 }
  | {
      status: 200;
      bytes: Buffer;
      contentType: string;
      cacheControl: string;
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
): Promise<PhotoResponse> {
  if (!UUID.test(id)) return { status: 404 };
  const [row] = await db
    .select({
      bytes: imageFiles.bytes,
      contentType: imageFiles.contentType,
      isPublic: sql<boolean>`${photoIsPublic(id)}`,
    })
    .from(imageFiles)
    .where(eq(imageFiles.imageId, id))
    .limit(1);
  if (!row) return { status: 404 };
  if (row.isPublic) {
    return {
      status: 200,
      bytes: row.bytes,
      contentType: row.contentType,
      cacheControl: PUBLIC_PHOTO_CACHE,
    };
  }
  if (signedIn) {
    return {
      status: 200,
      bytes: row.bytes,
      contentType: row.contentType,
      cacheControl: PRIVATE_PHOTO_CACHE,
    };
  }
  return { status: 404 };
}
