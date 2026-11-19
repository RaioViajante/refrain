// Studio reads and writes for the owner's page texts and photograph slots.
// Callers authorize first.
import "server-only";

import { eq, sql } from "drizzle-orm";

import type { SiteImageSlot } from "@/content/site-images";
import type { SiteTextKey } from "@/content/site-texts";
import { images, siteImages, siteTexts } from "@/db/schema";
import type { Database } from "@/db/types";

import { StudioError } from "./errors";

export type StudioSiteText = {
  key: string;
  body: string;
  published: boolean;
  updatedAt: Date;
};

export async function listSiteTextsForStudio(
  db: Database,
): Promise<Map<string, StudioSiteText>> {
  const rows = await db
    .select({
      key: siteTexts.key,
      body: siteTexts.body,
      published: siteTexts.published,
      updatedAt: siteTexts.updatedAt,
    })
    .from(siteTexts);
  return new Map(rows.map((r) => [r.key, r]));
}

/**
 * Saves a text. A new text starts as a draft; an existing one keeps its state
 * (a published text's change is public at once). An empty body deletes it.
 */
export async function saveSiteText(
  db: Database,
  key: SiteTextKey,
  body: string,
): Promise<void> {
  if (body === "") {
    await db.delete(siteTexts).where(eq(siteTexts.key, key));
    return;
  }
  await db
    .insert(siteTexts)
    .values({ key, body })
    .onConflictDoUpdate({
      target: siteTexts.key,
      set: { body, updatedAt: new Date() },
    });
}

export async function setSiteTextPublished(
  db: Database,
  key: SiteTextKey,
  published: boolean,
): Promise<void> {
  const updated = await db
    .update(siteTexts)
    .set({ published, updatedAt: new Date() })
    .where(eq(siteTexts.key, key))
    .returning({ key: siteTexts.key });
  if (updated.length === 0) {
    throw new StudioError("escreva o texto antes de publicá-lo.");
  }
}

/** Every slot's assigned image id (rights confirmed or not). */
export async function listSlotsForStudio(
  db: Database,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ slot: siteImages.slot, imageId: siteImages.imageId })
    .from(siteImages);
  return new Map(rows.map((r) => [r.slot, r.imageId]));
}

export async function setSiteImage(
  db: Database,
  slot: SiteImageSlot,
  imageId: string | null,
): Promise<void> {
  if (imageId === null) {
    await db.delete(siteImages).where(eq(siteImages.slot, slot));
    return;
  }
  const [image] = await db
    .select({ id: images.id })
    .from(images)
    .where(eq(images.id, imageId));
  if (!image) throw new StudioError("essa foto não existe.");
  await db
    .insert(siteImages)
    .values({ slot, imageId })
    .onConflictDoUpdate({
      target: siteImages.slot,
      set: { imageId, updatedAt: sql`now()` },
    });
}
