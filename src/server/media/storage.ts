// Where photographs are stored. With BLOB_READ_WRITE_TOKEN (production):
// Vercel Blob, under an unguessable name. Without it, outside production
// only: the local .media/ folder, served by src/app/media/[file]/route.ts.
import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { del, put } from "@vercel/blob";

import type { ImageKind } from "./image-file";

export const LOCAL_MEDIA_DIR = path.join(process.cwd(), ".media");
const LOCAL_NAME = /^[a-z0-9-]+\.(jpg|png)$/;
const EXTENSION: Record<ImageKind, "jpg" | "png"> = { jpeg: "jpg", png: "png" };
const CONTENT_TYPE: Record<ImageKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
};

export class StorageError extends Error {
  override name = "StorageError";
}

export function storageDriver(): "blob" | "local" | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (process.env.NODE_ENV !== "production") return "local";
  return null;
}

export async function storeImage(
  bytes: Uint8Array,
  kind: ImageKind,
): Promise<string> {
  const name = `${randomUUID()}.${EXTENSION[kind]}`;
  const driver = storageDriver();
  if (driver === "blob") {
    const blob = await put(`fotos/${name}`, Buffer.from(bytes), {
      access: "public",
      contentType: CONTENT_TYPE[kind],
      addRandomSuffix: true,
    });
    return blob.url;
  }
  if (driver === "local") {
    await mkdir(LOCAL_MEDIA_DIR, { recursive: true });
    await writeFile(path.join(LOCAL_MEDIA_DIR, name), bytes);
    return `/media/${name}`;
  }
  throw new StorageError("O armazenamento de fotos não está configurado.");
}

export async function removeStoredImage(url: string): Promise<void> {
  if (url.startsWith("/media/")) {
    const name = url.slice("/media/".length);
    if (LOCAL_NAME.test(name)) {
      await unlink(path.join(LOCAL_MEDIA_DIR, name)).catch(() => undefined);
    }
    return;
  }
  if (storageDriver() === "blob") await del(url);
}

/** A locally stored file, only outside production; null otherwise. */
export async function readLocalImage(
  name: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (storageDriver() !== "local" || !LOCAL_NAME.test(name)) return null;
  try {
    const bytes = await readFile(path.join(LOCAL_MEDIA_DIR, name));
    return {
      bytes,
      contentType: name.endsWith(".png") ? "image/png" : "image/jpeg",
    };
  } catch {
    return null;
  }
}
