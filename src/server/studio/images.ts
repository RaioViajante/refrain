// Studio reads and writes for the photograph library. Callers authorize
// first. The bytes live in image_files and are served by /fotos/<id>.
import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { SITE_IMAGES } from "@/content/site-images";
import { imageFiles, images } from "@/db/schema";
import type { Database } from "@/db/types";

import { pgCode, STILL_REFERENCED, StudioError } from "./errors";
import type { ImageFields } from "./schemas";
import { purgeExpiredReferencesTo, trashImage } from "./trash";

export type ImageUsage = {
  kind: "cover" | "detail" | "slot" | "trash";
  label: string;
};

export async function listImagesForStudio(db: Database) {
  // Plain SQL with explicit table names: in a single-table select, Drizzle
  // writes interpolated columns without their table, so "id" inside these
  // subqueries would name the subquery's own table, never the photo's.
  const usage = sql<ImageUsage[]>`(
    select coalesce(json_agg(u), '[]'::json) from (
      select 'cover' as kind, m.title as label from mixtapes m
        where m.cover_image_id = images.id
      union all
      select 'detail', m.title from mixtapes m
        where m.detail_image_id = images.id
      union all
      select 'slot', s.slot from site_images s
        where s.image_id = images.id
      union all
      select 'trash', t.label from trash_image_refs r
        join trash_items t on t.id = r.trash_item_id
        where r.image_id = images.id and t.purge_after > now()
    ) u
  )`;
  return db
    .select({
      id: images.id,
      url: sql<string>`'/fotos/' || ${images.id}`,
      alt: images.alt,
      width: images.width,
      height: images.height,
      focus: images.focus,
      treatment: sql<"mood" | "original">`${images.treatment}`,
      rightsConfirmed: images.rightsConfirmed,
      rightsNote: images.rightsNote,
      createdAt: images.createdAt,
      usage,
    })
    .from(images)
    .orderBy(desc(images.createdAt));
}
export type StudioImage = Awaited<
  ReturnType<typeof listImagesForStudio>
>[number];

/** Records a photograph and its bytes, in one transaction. */
export async function createImage(
  db: Database,
  values: {
    width: number;
    height: number;
    alt: string;
    rightsConfirmed: boolean;
    rightsNote: string;
  },
  file: { bytes: Uint8Array; contentType: "image/jpeg" | "image/png" },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(images)
      .values(values)
      .returning({ id: images.id });
    await tx.insert(imageFiles).values({
      imageId: row!.id,
      contentType: file.contentType,
      byteSize: file.bytes.length,
      bytes: Buffer.from(file.bytes),
    });
    return row!.id;
  });
}

export async function updateImage(
  db: Database,
  id: string,
  fields: ImageFields,
): Promise<void> {
  const updated = await db
    .update(images)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(images.id, id))
    .returning({ id: images.id });
  if (updated.length === 0) throw new StudioError("essa foto não existe.");
}

/** A readable name for where a photo is used ("capa de core", a slot's label). */
export function usageLabel(u: ImageUsage): string {
  if (u.kind === "cover") return `capa de ${u.label}`;
  if (u.kind === "detail") return `foto de apoio de ${u.label}`;
  if (u.kind === "trash") return `${u.label} (na lixeira)`;
  return SITE_IMAGES[u.label as keyof typeof SITE_IMAGES] ?? u.label;
}

/**
 * Moves an unused photograph and its bytes to the trash for 30 days. A photo
 * is in use while a tape, a page slot, or a restorable trash item uses it.
 */
export async function deleteImage(db: Database, id: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: images.id })
        .from(images)
        .where(eq(images.id, id))
        .for("update");
      if (!locked) throw new StudioError("essa foto não existe.");
      await purgeExpiredReferencesTo(tx, id);
      const [image] = (await listImagesForStudio(tx)).filter(
        (i) => i.id === id,
      );
      if (image!.usage.length > 0) {
        throw new StudioError(
          `essa foto está em uso (${image!.usage.map(usageLabel).join(", ")}). tire-a de lá antes de excluir.`,
        );
      }
      await trashImage(tx, id);
    });
  } catch (error) {
    // A tape or slot took the photo while it was being deleted.
    if (STILL_REFERENCED.has(pgCode(error) ?? "")) {
      throw new StudioError("essa foto passou a ser usada. tente de novo.");
    }
    throw error;
  }
}
