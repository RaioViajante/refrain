import type { Metadata } from "next";

import { HOME_IMAGE_SLOTS, HOME_TEXT_KEYS, HomeView } from "@/app/home-view";
import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { getSiteTextsPreview } from "@/server/studio/preview";
import {
  loadFeatured,
  loadPublishedMixtapes,
  loadSiteImages,
} from "@/server/site";

export const metadata: Metadata = { title: "home" };

/**
 * The home page with its draft texts. The tapes stay the published ones, and
 * photographs follow the public rule (rights confirmed).
 */
export default async function HomePreview() {
  await requireStudio();
  const [texts, photos, { featured, first }, published] = await Promise.all([
    getSiteTextsPreview(getDatabase(), HOME_TEXT_KEYS),
    loadSiteImages(HOME_IMAGE_SLOTS),
    loadFeatured(),
    loadPublishedMixtapes(),
  ]);
  return (
    <HomeView
      texts={texts}
      photos={photos}
      featured={featured}
      first={first}
      published={published}
    />
  );
}
