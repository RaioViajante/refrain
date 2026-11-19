// Studio reads and writes for the photograph library. Callers authorize
// first. The files themselves are stored by src/server/media/storage.ts.
import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { images, mixtapes, siteImages } from "@/db/schema";
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
      url: images.url,
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

export async function createImage(
  db: Database,
  values: {
    url: string;
    width: number;
    height: number;
    alt: string;
    rightsConfirmed: boolean;
    rightsNote: string;
  },
): Promise<string> {
  const [row] = await db
    .insert(images)
    .values(values)
    .returning({ id: images.id });
  return row!.id;
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

/** Deletes an unused photograph's record and returns its URL for storage. */
export async function deleteImage(db: Database, id: string): Promise<string> {
  const [image] = (await listImagesForStudio(db)).filter((i) => i.id === id);
  if (!image) throw new StudioError("essa foto não existe.");
  if (image.usage.length > 0) {
    throw new StudioError(
      `essa foto está em uso (${image.usage.map((u) => u.label).join(", ")}). tire-a de lá antes de excluir.`,
    );
  }
  await db.delete(images).where(eq(images.id, id));
  return image.url;
}
