import type { Metadata } from "next";

import {
  ABOUT_IMAGE_SLOTS,
  ABOUT_TEXT_KEYS,
  AboutView,
} from "@/app/sobre/about-view";
import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { getSiteTextsPreview } from "@/server/studio/preview";
import { loadSiteImages } from "@/server/site";

export const metadata: Metadata = { title: "sobre" };

/** The about page with its draft texts; photographs as on the site. */
export default async function AboutPreview() {
  await requireStudio();
  const [texts, images] = await Promise.all([
    getSiteTextsPreview(getDatabase(), ABOUT_TEXT_KEYS),
    loadSiteImages(ABOUT_IMAGE_SLOTS),
  ]);
  return <AboutView texts={texts} images={images} />;
}
