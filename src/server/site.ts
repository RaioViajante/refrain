// Request-scoped loaders for public pages. Each calls connection() so the
// route renders per request and the build never needs a database.
import "server-only";

import { connection } from "next/server";
import { cache } from "react";

import type { SiteImageSlot } from "@/content/site-images";
import type { SiteTextKey } from "@/content/site-texts";
import { getDatabase } from "@/db/client";

import {
  getMixtapePage,
  getPublishedMixtape,
  getSiteImages,
  getSiteTexts,
  listFeaturedMixtapes,
  listPublishedMixtapes,
} from "./public-queries";

export async function loadSiteTexts<K extends SiteTextKey>(keys: readonly K[]) {
  await connection();
  return getSiteTexts(getDatabase(), keys);
}

export async function loadSiteImages<K extends SiteImageSlot>(
  slots: readonly K[],
) {
  await connection();
  return getSiteImages(getDatabase(), slots);
}

export const getFooterImages = cache(() =>
  loadSiteImages(["footer.road", "footer.road_mobile"] as const),
);

/** Published tapes, by number (catalogue and the home constellation). */
export const loadPublishedMixtapes = cache(async () => {
  await connection();
  return listPublishedMixtapes(getDatabase());
});

/** The home page's featured tapes, and the first one's tracklist. */
export const loadFeatured = cache(async () => {
  await connection();
  const db = getDatabase();
  const featured = await listFeaturedMixtapes(db);
  const first = featured[0]
    ? await getPublishedMixtape(db, featured[0].slug)
    : null;
  return { featured, first };
});

export const loadMixtapePage = cache(async (slug: string) => {
  await connection();
  return getMixtapePage(getDatabase(), slug);
});
