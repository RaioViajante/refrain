import type { Metadata } from "next";

import {
  loadFeatured,
  loadPublishedMixtapes,
  loadSiteImages,
  loadSiteTexts,
} from "@/server/site";

import { HOME_IMAGE_SLOTS, HOME_TEXT_KEYS, HomeView } from "./home-view";

export const metadata: Metadata = {
  title: { absolute: "refrain · músicas que voltam" },
};

export default async function HomePage() {
  const [texts, photos, { featured, first }, published] = await Promise.all([
    loadSiteTexts(HOME_TEXT_KEYS),
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
