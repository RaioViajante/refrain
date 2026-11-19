import type { Metadata } from "next";

import { loadSiteImages, loadSiteTexts } from "@/server/site";

import { ABOUT_IMAGE_SLOTS, ABOUT_TEXT_KEYS, AboutView } from "./about-view";

export const metadata: Metadata = { title: "sobre" };

export default async function AboutPage() {
  const [texts, images] = await Promise.all([
    loadSiteTexts(ABOUT_TEXT_KEYS),
    loadSiteImages(ABOUT_IMAGE_SLOTS),
  ]);
  return <AboutView texts={texts} images={images} />;
}
