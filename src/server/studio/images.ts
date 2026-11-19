// Studio reads and writes for the photograph library. Callers authorize
// first. The bytes live in image_files and are served by /fotos/<id>.
import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { SITE_IMAGES } from "@/content/site-images";
import { imageFiles, images, mixtapes, siteImages } from "@/db/schema";
import type { Database } from "@/db/types";

import { StudioError } from "./errors";
import type { ImageFields } from "./schemas";

export type ImageUsage = { kind: "cover" | "detail" | "slot"; label: string };

export async function listImagesForStudio(db: Database) {
  const usage = sql<ImageUsage[]>`(
    select coalesce(json_agg(u), '[]'::json) from (
      select 'cover' as kind, ${mixtapes.title} as label from ${mixtapes}
        where ${mixtapes.coverImageId} = ${images.id}
      union all
      select 'detail', ${mixtapes.title} from ${mixtapes}
        where ${mixtapes.detailImageId} = ${images.id}
      union all
      select 'slot', ${siteImages.slot} from ${siteImages}
        where ${siteImages.imageId} = ${images.id}
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
  return SITE_IMAGES[u.label as keyof typeof SITE_IMAGES] ?? u.label;
}

/** Deletes an unused photograph (its bytes go with it). */
export async function deleteImage(db: Database, id: string): Promise<void> {
  const [image] = (await listImagesForStudio(db)).filter((i) => i.id === id);
  if (!image) throw new StudioError("essa foto não existe.");
  if (image.usage.length > 0) {
    throw new StudioError(
      `essa foto está em uso (${image.usage.map(usageLabel).join(", ")}). tire-a de lá antes de excluir.`,
    );
  }
  await db.delete(images).where(eq(images.id, id));
}
